// Mouse / keyboard controller: camera, building placement, belt drawing, selection and demolition.

import { BUILDINGS, BuildingId, ITEMS } from '../sim/data';
import { DX, DY } from '../sim/geom';
import { audio } from '../audio/audio';
import { GameScene } from '../render/scene';
import { GameApi, UI } from './ui';
import { SVG } from './svg';

type Drag =
  | { kind: 'pan'; x: number; y: number; moved: boolean }
  | { kind: 'rotate'; x: number; y: number; moved: boolean }
  | { kind: 'path'; sx: number; sy: number }
  | { kind: 'rect'; sx: number; sy: number }
  | null;

export class Input {
  rot = 0;
  private drag: Drag = null;
  private hover: { x: number; y: number } | null = null;
  private mouse = { x: 0, y: 0 };
  private keys = new Set<string>();

  constructor(private g: GameApi, private scene: GameScene, private ui: UI, private canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scene.rig.zoom(Math.pow(1.0015, e.deltaY));
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private get tool() {
    return this.g.tool;
  }

  // ---------------------------------------------------------------- pointer
  private down(e: PointerEvent) {
    audio.init();
    this.canvas.focus();
    this.mouse = { x: e.clientX, y: e.clientY };
    if (e.button === 2) {
      this.drag = { kind: 'rotate', x: e.clientX, y: e.clientY, moved: false };
      return;
    }
    if (e.button === 1) {
      this.drag = { kind: 'pan', x: e.clientX, y: e.clientY, moved: true };
      return;
    }
    if (e.button !== 0) return;
    const t = this.scene.pickTile(e.clientX, e.clientY);
    const tool = this.tool;
    if (tool.kind === 'build') {
      if (!t) return;
      if (tool.type === 'belt' || tool.type === 'road') {
        this.drag = { kind: 'path', sx: t.x, sy: t.y };
        this.updatePreview();
      } else {
        this.placeBuilding(tool.type, t.x, t.y);
      }
      return;
    }
    if (tool.kind === 'remove') {
      if (!t) return;
      this.drag = { kind: 'rect', sx: t.x, sy: t.y };
      this.updatePreview();
      return;
    }
    this.drag = { kind: 'pan', x: e.clientX, y: e.clientY, moved: false };
  }

  private move(e: PointerEvent) {
    const dx = e.clientX - this.mouse.x, dy = e.clientY - this.mouse.y;
    this.mouse = { x: e.clientX, y: e.clientY };
    const d = this.drag;
    if (d && (d.kind === 'pan' || d.kind === 'rotate')) {
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
      if (d.moved) {
        if (d.kind === 'pan') this.scene.rig.pan(dx, dy);
        else {
          this.scene.rig.rotate(dx * 0.008);
          this.scene.rig.tilt(dy * 0.005);
        }
      }
      return;
    }
    if (e.target !== this.canvas && !d) {
      this.hover = null;
      if (this.tool.kind !== 'select') this.scene.clearPreview();
      return;
    }
    this.hover = this.scene.pickTile(e.clientX, e.clientY);
    this.updatePreview();
  }

  private up(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'rotate') {
      if (!d.moved) {
        // right click: cancel tool / deselect
        if (this.tool.kind !== 'select') this.g.setTool({ kind: 'select' });
        else this.g.select(null);
      }
      return;
    }
    if (d.kind === 'pan') {
      if (!d.moved && e.button === 0 && this.tool.kind === 'select') {
        const id = this.scene.pickEntity(e.clientX, e.clientY);
        if (id !== null) audio.play('click');
        this.g.select(id);
      }
      return;
    }
    if (d.kind === 'path') {
      this.commitPath(d.sx, d.sy);
      this.updatePreview();
      return;
    }
    if (d.kind === 'rect') {
      this.commitRemove(d.sx, d.sy);
      this.updatePreview();
    }
  }

  // ---------------------------------------------------------------- keyboard
  private key(e: KeyboardEvent, down: boolean) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (!down) return;
    if ((document.getElementById('title') as HTMLElement).style.display !== 'none') return;
    const w = this.g.world;
    switch (k) {
      case 'escape':
        if (this.ui.closeModals()) return;
        if (this.tool.kind !== 'select') this.g.setTool({ kind: 'select' });
        else if (this.g.selected !== null) this.g.select(null);
        else this.ui.openMenu();
        break;
      case 'r':
        if (this.tool.kind === 'build') {
          this.rot = (this.rot + 1) & 3;
          audio.play('rotate');
          this.updatePreview();
        } else if (this.g.selected !== null && w.entities.get(this.g.selected)?.type === 'belt') {
          w.rotateBelt(this.g.selected);
          audio.play('rotate');
        }
        break;
      case ' ':
        e.preventDefault();
        this.g.setSpeed(this.g.speed === 0 ? 1 : 0);
        break;
      case 'x':
      case 'delete':
        if (this.g.selected !== null && k === 'delete') {
          if (w.remove(this.g.selected)) {
            audio.play('remove');
            this.g.select(null);
          }
        } else this.g.setTool({ kind: 'remove' });
        break;
      case 't':
        this.ui.openResearch();
        break;
      case 'g':
        this.ui.openStats();
        break;
      default: {
        // building hotkeys
        const id = (Object.keys(BUILDINGS) as BuildingId[]).find((b) => BUILDINGS[b].hotkey?.toLowerCase() === k);
        if (id && (this.tool.kind === 'build' || !'123'.includes(k))) {
          if (w.isUnlocked(id)) {
            audio.play('click');
            this.g.setTool({ kind: 'build', type: id });
          }
          return;
        }
        if ('123'.includes(k)) this.g.setSpeed(+k);
      }
    }
  }

  /** continuous keyboard camera movement */
  update(dt: number) {
    const k = this.keys;
    const rig = this.scene.rig;
    const sp = rig.dist * 0.9 * dt;
    let mx = 0, mz = 0;
    if (k.has('w') || k.has('arrowup')) mz += 1;
    if (k.has('s') || k.has('arrowdown')) mz -= 1;
    if (k.has('a') || k.has('arrowleft')) mx -= 1;
    if (k.has('d') || k.has('arrowright')) mx += 1;
    if (mx || mz) rig.panWorld(mx * sp, mz * sp);
    if (k.has('q')) rig.rotate(-1.6 * dt);
    if (k.has('e')) rig.rotate(1.6 * dt);
    if (mx || mz || k.has('q') || k.has('e')) {
      if (this.mouse) this.hover = this.scene.pickTile(this.mouse.x, this.mouse.y);
    }
  }

  // ---------------------------------------------------------------- building
  private anchor(type: BuildingId, x: number, y: number) {
    const [w, h] = this.g.world.footprint(type, this.rot);
    return { x: x - Math.floor((w - 1) / 2), y: y - Math.floor((h - 1) / 2) };
  }

  private placeBuilding(type: BuildingId, tx: number, ty: number) {
    const w = this.g.world;
    const a = this.anchor(type, tx, ty);
    const r = w.place(type, a.x, a.y, this.rot);
    if (typeof r === 'string') {
      audio.play('error');
      this.ui.toast(r, true);
      return;
    }
    audio.play('place');
    this.updatePreview();
  }

  /** L-shaped path from start to current hover tile */
  private path(sx: number, sy: number): { x: number; y: number; dir: number }[] {
    const h = this.hover ?? { x: sx, y: sy };
    const ex = h.x, ey = h.y;
    if (ex === sx && ey === sy) return [{ x: sx, y: sy, dir: this.rot }];
    const pts: { x: number; y: number }[] = [];
    const horizFirst = Math.abs(ex - sx) >= Math.abs(ey - sy);
    let x = sx, y = sy;
    pts.push({ x, y });
    const stepX = () => {
      while (x !== ex) {
        x += Math.sign(ex - x);
        pts.push({ x, y });
      }
    };
    const stepY = () => {
      while (y !== ey) {
        y += Math.sign(ey - y);
        pts.push({ x, y });
      }
    };
    if (horizFirst) {
      stepX();
      stepY();
    } else {
      stepY();
      stepX();
    }
    const dirOf = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      for (let d = 0; d < 4; d++) if (a.x + DX[d] === b.x && a.y + DY[d] === b.y) return d;
      return 0;
    };
    return pts.map((p, i) => ({ ...p, dir: i < pts.length - 1 ? dirOf(p, pts[i + 1]) : dirOf(pts[i - 1], p) }));
  }

  private commitPath(sx: number, sy: number) {
    const tool = this.tool;
    if (tool.kind !== 'build') return;
    const w = this.g.world;
    const p = this.path(sx, sy);
    let placed = 0, failed = '';
    for (const s of p) {
      const existing = w.entAt(s.x, s.y);
      if (tool.type === 'road' && existing?.type === 'road') continue;
      const r = w.place(tool.type, s.x, s.y, s.dir);
      if (typeof r === 'string') failed = r;
      else placed++;
    }
    if (placed) audio.play(tool.type === 'belt' ? 'belt' : 'place');
    if (failed && !placed) {
      audio.play('error');
      this.ui.toast(failed, true);
    } else if (failed) this.ui.toast(`一部の場所に置けませんでした：${failed}`, true);
  }

  private rectTiles(sx: number, sy: number) {
    const h = this.hover ?? { x: sx, y: sy };
    const x0 = Math.min(sx, h.x), x1 = Math.max(sx, h.x), y0 = Math.min(sy, h.y), y1 = Math.max(sy, h.y);
    const tiles: { x: number; y: number }[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ x, y });
    return tiles;
  }

  private commitRemove(sx: number, sy: number) {
    const w = this.g.world;
    const ids = new Set<number>();
    for (const t of this.rectTiles(sx, sy)) {
      const e = w.entAt(t.x, t.y);
      if (e && e.type !== 'hall') ids.add(e.id);
    }
    let n = 0;
    for (const id of ids) if (w.remove(id)) n++;
    if (n) audio.play('remove');
    if (this.g.selected !== null && !w.entities.has(this.g.selected)) this.g.select(null);
  }

  // ---------------------------------------------------------------- previews & tooltip
  updatePreview() {
    const tool = this.tool;
    const w = this.g.world;
    const h = this.hover;
    if (tool.kind === 'select') {
      this.scene.clearPreview();
      // show hover tooltip for items on belts / buildings
      this.ui.hideTip();
      if (this.g.selected !== null) this.scene.setSelection(this.g.selected);
      return;
    }
    if (!h) {
      this.scene.clearPreview();
      this.ui.hideTip();
      return;
    }
    const d = this.drag;
    if (tool.kind === 'remove') {
      const tiles = d && d.kind === 'rect' ? this.rectTiles(d.sx, d.sy) : [h];
      const marks = tiles.map((t) => ({ ...t, dir: 0, ok: false }));
      this.scene.showBeltPath(marks, 'remove');
      const ids = new Set<number>();
      for (const t of tiles) {
        const e = w.entAt(t.x, t.y);
        if (e && e.type !== 'hall') ids.add(e.id);
      }
      if (ids.size) {
        let coins = 0;
        for (const id of ids) coins += BUILDINGS[w.entities.get(id)!.type].cost.coins;
        const one = ids.size === 1 ? BUILDINGS[w.entities.get([...ids][0])!.type].name : `${ids.size}件`;
        this.ui.showTip(`<div class="n">撤去：${one}</div><div class="good">建設費が戻ります（${SVG.coin.replace('<svg', '<svg class="ico sm"')}${coins}）</div>`, this.mouse.x + 18, this.mouse.y + 18);
      } else this.ui.hideTip();
      return;
    }
    const def = BUILDINGS[tool.type];
    if (tool.type === 'belt' || tool.type === 'road') {
      const p = d && d.kind === 'path' ? this.path(d.sx, d.sy) : [{ x: h.x, y: h.y, dir: this.rot }];
      let coinsNeeded = 0;
      const marks = p.map((s) => {
        const existing = w.entAt(s.x, s.y);
        const reuse = (tool.type === 'belt' && existing?.type === 'belt') || (tool.type === 'road' && existing?.type === 'road');
        const c = w.checkPlace(tool.type, s.x, s.y, s.dir, true);
        if (!reuse && c.ok) coinsNeeded += def.cost.coins;
        return { ...s, ok: c.ok || reuse, reason: c.reason };
      });
      this.scene.showBeltPath(marks, tool.type);
      const bad = marks.find((m) => !m.ok);
      const afford = w.coins >= coinsNeeded;
      let tip = `<div class="n">${def.name}${p.length > 1 ? ` ×${p.length}` : ''}</div><div class="c">${SVG.coin.replace('<svg', '<svg class="ico sm"')}${coinsNeeded}</div>`;
      if (!afford) tip += `<div class="bad">コインが足りません</div>`;
      if (bad) tip += `<div class="bad">${bad.reason}</div>`;
      if (tool.type === 'belt') {
        if (p.length === 1) tip += `<div class="hint" style="margin-top:4px">ドラッグで連続して敷設・R で向きを回転</div>`;
        tip += this.beltHint(p);
      }
      this.ui.showTip(tip, this.mouse.x + 18, this.mouse.y + 18);
      return;
    }
    const a = this.anchor(tool.type, h.x, h.y);
    const c = w.checkPlace(tool.type, a.x, a.y, this.rot);
    this.scene.showBuildingGhost(tool.type, a.x, a.y, this.rot, c.ok, c.badTiles);
    let tip = `<div class="n">${def.name}</div>`;
    if (!c.ok) tip += `<div class="bad">${c.reason}</div>`;
    else {
      if (c.eff !== undefined) tip += `<div class="${c.eff >= 0.99 ? 'good' : 'warn'}">効率 ${Math.round(c.eff * 100)}%</div>`;
      if (c.warn && !(c.eff !== undefined && c.warn.startsWith('近く'))) tip += `<div class="warn">${c.warn}</div>`;
      if (def.radius && (def.kind === 'storage' || def.kind === 'hall')) tip += `<div class="hint">円の内側の住宅へ物資を配達します</div>`;
    }
    tip += `<div class="hint" style="margin-top:4px">R で回転・右クリックで終了</div>`;
    this.ui.showTip(tip, this.mouse.x + 18, this.mouse.y + 18);
  }

  private beltHint(p: { x: number; y: number; dir: number }[]): string {
    // explain what the end of the belt connects to
    const w = this.g.world;
    const last = p[p.length - 1];
    const t = w.entAt(last.x + DX[last.dir], last.y + DY[last.dir]);
    if (t && t.type !== 'belt' && t.type !== 'road' && t.type !== 'house') {
      const def = BUILDINGS[t.type];
      const accepts = def.recipe?.in ? Object.keys(def.recipe.in).map((k) => ITEMS[k as keyof typeof ITEMS].name).join('・') : '';
      const what = def.kind === 'crafter' ? `（${accepts}を受け入れ）` : def.kind === 'hall' || def.kind === 'storage' ? '（すべての資源を貯蔵）' : def.kind === 'trade' ? '（売却）' : '';
      return `<div class="good">→ ${def.name}へ搬入${what}</div>`;
    }
    const first = p[0];
    const b = w.entAt(first.x - DX[first.dir], first.y - DY[first.dir]);
    if (b && w.isOutputter(b)) return `<div class="good">← ${BUILDINGS[b.type].name}から搬出</div>`;
    if (!b || (b.type !== 'belt' && !w.isOutputter(b))) {
      const sides = [(first.dir + 1) & 3, (first.dir + 3) & 3].map((d) => w.entAt(first.x + DX[d], first.y + DY[d])).filter((s) => s && w.isOutputter(s));
      if (sides.length === 1) return `<div class="good">← ${BUILDINGS[sides[0]!.type].name}から搬出</div>`;
    }
    return '';
  }

  onToolChanged() {
    this.drag = null;
    this.scene.clearPreview();
    this.ui.hideTip();
    this.updatePreview();
  }
}
