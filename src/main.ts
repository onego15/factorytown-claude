import './ui/styles.css';
import * as THREE from 'three';
import { audio } from './audio/audio';
import { BUILDINGS, HOUSE_TIERS, ITEMS, MILESTONES, RESEARCH } from './sim/data';
import { QUESTS, updateQuests } from './sim/quests';
import { World } from './sim/world';
import { GameScene } from './render/scene';
import { shared } from './render/terrainView';
import { renderIcons, itemImg } from './ui/icons';
import { Input } from './ui/input';
import { GameApi, Tool, UI } from './ui/ui';
import { SVG } from './ui/svg';
import { dev } from './dev/autoplay';

const SAVE_KEY = 'gearvale.save.v1';

class Game implements GameApi {
  world: World;
  scene: GameScene;
  ui!: UI;
  input!: Input;
  tool: Tool = { kind: 'select' };
  speed = 1;
  selected: number | null = null;
  playing = false;
  settings = { post: true, shadows: true };
  private last = performance.now();
  private saveT = 0;
  private titleSpin = 0;
  /** when set, the frame loop is driven manually (deterministic capture) */
  manual = false;

  constructor() {
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    canvas.tabIndex = 0;
    this.scene = new GameScene(canvas);
    this.world = new World();
    this.scene.setWorld(this.world);
    try {
      const s = JSON.parse(localStorage.getItem('gearvale.settings') ?? 'null');
      if (s) Object.assign(this.settings, s);
      const v = JSON.parse(localStorage.getItem('gearvale.volumes') ?? 'null');
      if (v) Object.assign(audio.volumes, v);
    } catch {}
    renderIcons();
    this.ui = new UI(this);
    this.input = new Input(this, this.scene, this.ui, canvas);
    this.applySettings();
    // title camera: a slow orbit over the valley
    this.scene.rig.distGoal = this.scene.rig.dist = 38;
    this.scene.rig.pitchGoal = this.scene.rig.pitch = 0.62;
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('beforeunload', () => {
      if (this.playing) this.save();
    });
    this.resize();
    requestAnimationFrame((t) => this.loop(t));
  }

  resize() {
    this.scene.resize(window.innerWidth, window.innerHeight);
  }

  applySettings() {
    this.scene.postEnabled = this.settings.post;
    this.scene.renderer.shadowMap.enabled = this.settings.shadows;
    this.scene.sun.castShadow = this.settings.shadows;
    this.scene.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    try {
      localStorage.setItem('gearvale.settings', JSON.stringify(this.settings));
    } catch {}
  }

  hasSave() {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  }

  startPlaying(cont: boolean) {
    if (cont && !this.load()) this.newGame();
    else if (!cont) this.newGame();
    this.playing = true;
    this.ui.hideTitle();
    const rig = this.scene.rig;
    rig.distGoal = 22;
    rig.pitchGoal = 0.92;
    this.ui.renderTools();
    if (!cont) setTimeout(() => this.ui.toast('ようこそ、ギアヴェイルへ！ 左の「目標」に沿って街をつくりましょう'), 900);
  }

  newGame() {
    this.world = new World();
    this.world.events = [];
    this.scene.setWorld(this.world);
    this.select(null);
    this.setTool({ kind: 'select' });
    this.save();
  }

  save(manual = false) {
    try {
      localStorage.setItem(SAVE_KEY, this.world.serialize());
      if (manual) this.ui.toast('保存しました');
    } catch (e) {
      if (manual) this.ui.toast('保存できませんでした', true);
    }
  }

  load(): boolean {
    try {
      const s = localStorage.getItem(SAVE_KEY);
      if (!s) return false;
      this.world = World.deserialize(s);
      this.world.events = [];
      this.scene.setWorld(this.world);
      this.select(null);
      this.setTool({ kind: 'select' });
      this.ui?.renderTools();
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  setTool(t: Tool) {
    this.tool = t;
    if (t.kind !== 'select') this.select(null);
    this.ui.renderTools();
    this.input.onToolChanged();
    this.scene.renderer.domElement.style.cursor = t.kind === 'select' ? 'default' : 'crosshair';
    shared.grid.value = t.kind === 'build' ? 1 : 0;
  }

  setSpeed(s: number) {
    this.speed = s;
  }

  select(id: number | null) {
    this.selected = id;
    this.scene.setSelection(id);
    if (id === null) this.scene.hideRange();
    this.ui.showInspector(id);
  }

  // ---------------------------------------------------------------- events from the simulation
  private handleEvents() {
    const w = this.world;
    const evs = w.events;
    if (!evs.length) return;
    w.events = [];
    let topo = false;
    const newIds = new Set<number>();
    for (const ev of evs) {
      switch (ev.t) {
        case 'built': {
          topo = true;
          newIds.add(ev.id);
          const e = w.entities.get(ev.id);
          if (e && this.playing && e.type !== 'belt' && e.type !== 'road') {
            const c = this.scene.entityWorldCenter(e.id)!;
            this.scene.particles.dust(c.x, c.y, c.z, Math.max(e.w, e.h), 10 + e.w * e.h * 4);
          }
          break;
        }
        case 'removed': {
          topo = true;
          const e = ev.ent;
          if (e.type !== 'belt' && e.type !== 'road') {
            const c = { x: e.x + e.w / 2 - w.W / 2, y: w.heightAt(e.x, e.y) * 0.5, z: e.y + e.h / 2 - w.H / 2 };
            this.scene.particles.dust(c.x, c.y, c.z, Math.max(e.w, e.h), 16 + e.w * e.h * 4);
          }
          if (this.selected === e.id) this.select(null);
          break;
        }
        case 'changed':
          topo = true;
          break;
        case 'deliver':
          this.scene.hop(ev.from, ev.to, ev.item);
          break;
        case 'sold': {
          const c = this.scene.entityWorldCenter(ev.id);
          if (c && this.isVisible(c)) {
            const p = this.scene.project(c.add(new THREE.Vector3(0, 1.4, 0)));
            this.ui.floater(`${SVG.coin.replace('<svg', '<svg class="ico sm"')}+${ev.coins}`, p.x, p.y);
            audio.play('coin');
          }
          break;
        }
        case 'houseTier': {
          topo = true;
          const c = this.scene.entityWorldCenter(ev.id);
          if (c && ev.up) {
            this.scene.particles.sparkle(c.x, c.y + 0.8, c.z, 24);
            audio.play('house');
            if (this.isVisible(c)) {
              const p = this.scene.project(c.add(new THREE.Vector3(0, 1.5, 0)));
              this.ui.floater(`${HOUSE_TIERS[ev.tier].name}に発展！`, p.x, p.y);
            }
          }
          break;
        }
        case 'research':
          audio.play('research');
          this.ui.toast(`研究「${RESEARCH[ev.id].name}」が完了しました`, false, SVG.flask.replace('<svg', '<svg class="ico"'));
          this.ui.renderTools();
          topo = true;
          break;
        case 'milestone': {
          const m = MILESTONES[ev.index];
          audio.play('milestone');
          this.ui.celebrate(`「${m.name}」に発展しました！`, `${m.desc}　報酬 +${m.reward} コイン`);
          topo = true;
          const hall = this.scene.entityWorldCenter(w.hallId)!;
          for (let i = 0; i < 6; i++)
            setTimeout(() => this.scene.particles.firework(hall.x + (Math.random() - 0.5) * 6, hall.y + 4 + Math.random() * 2, hall.z + (Math.random() - 0.5) * 6), i * 350);
          break;
        }
        case 'upgraded': {
          topo = true;
          const c = this.scene.entityWorldCenter(ev.id);
          if (c) this.scene.particles.sparkle(c.x, c.y + 1, c.z, 30);
          break;
        }
        case 'quest': {
          const q = QUESTS.find((q) => q.id === ev.id)!;
          audio.play('coin');
          this.ui.toast(`目標達成：${q.title}${ev.reward ? `　+${ev.reward}` : ''}`, false, SVG.coin.replace('<svg', '<svg class="ico"'));
          break;
        }
      }
    }
    if (topo) this.scene.onTopologyChanged(newIds);
  }

  private isVisible(v: THREE.Vector3) {
    const p = v.clone().project(this.scene.camera);
    return p.x > -1 && p.x < 1 && p.y > -1 && p.y < 1 && p.z < 1;
  }

  // ---------------------------------------------------------------- loop
  step(dt: number) {
    const w = this.world;
    let gameDt = 0;
    if (this.playing && this.speed > 0) {
      gameDt = dt * this.speed;
      w.advance(gameDt, 60);
    } else if (!this.playing) {
      // title screen: orbit slowly
      this.titleSpin += dt;
      this.scene.rig.yawGoal += dt * 0.06;
    }
    updateQuests(w);
    this.handleEvents();
    audio.night = this.scene.ents?.night ?? 0;
    audio.update(this.playing && this.speed > 0);
    this.input.update(dt);
    this.scene.frame(dt, this.speed > 0 ? w.tickAlpha : 1, this.playing && this.speed > 0, gameDt);
    this.ui.update(dt);
    if (this.playing) {
      this.saveT += dt;
      if (this.saveT > 30) {
        this.saveT = 0;
        this.save();
      }
    }
  }

  private loop(t: number) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (!this.manual) this.step(dt);
    requestAnimationFrame((tt) => this.loop(tt));
  }
}

declare global {
  interface Window {
    game: Game;
  }
}

const game = new Game();
window.game = game;
// expose a couple of helpers for automated tests
(window as any).__gv = {
  BUILDINGS, ITEMS, itemImg, dev, World,
  /** screen position of a tile center (for automated pointer tests) */
  tileToScreen(x: number, y: number) {
    const w = game.world;
    const v = new THREE.Vector3(x + 0.5 - w.W / 2, Math.max(0, w.heightAt(x, y)) * 0.5, y + 0.5 - w.H / 2);
    return game.scene.project(v);
  },
};
