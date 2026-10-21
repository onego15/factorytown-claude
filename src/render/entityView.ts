// Buildings, houses and roads in the 3D scene, with their animations and status badges.

import * as THREE from 'three';
import { BUILDINGS, HOUSE_TIERS } from '../sim/data';
import { LEVEL_H } from '../sim/geom';
import { Entity, World } from '../sim/world';
import { Kit } from './kit';
import { AnimPart, getModel } from './models';
import { PAL } from './palette';

export interface View {
  id: number;
  key: string;
  root: THREE.Group;
  anims: { obj: THREE.Object3D; part: AnimPart }[];
  smoke: THREE.Vector3[];
  height: number;
  born: number;
  badge?: THREE.Sprite;
  badgeKind?: string;
  badgeT: number;
  glowMeshes: THREE.Mesh[];
}

export const materials = {
  base: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02, flatShading: true }),
  glow: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, flatShading: true, emissive: new THREE.Color(0xffb04a), emissiveIntensity: 0 }),
  fire: new THREE.MeshBasicMaterial({ vertexColors: true }),
  lamp: new THREE.MeshBasicMaterial({ color: 0xffe2a0 }),
};

function badgeTexture(kind: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const colors: Record<string, string> = {
    noInput: '#e8913a', outputFull: '#d4523f', noWorkers: '#8a63c9', noResource: '#7d7468', house: '#d4523f', cover: '#4a79c4',
  };
  // bubble
  g.fillStyle = 'rgba(40,30,20,0.25)';
  g.beginPath();
  g.arc(64, 66, 50, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fffaf0';
  g.beginPath();
  g.arc(64, 60, 50, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = colors[kind] ?? '#888';
  g.stroke();
  g.fillStyle = colors[kind] ?? '#888';
  g.strokeStyle = colors[kind] ?? '#888';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 9;
  switch (kind) {
    case 'noInput': // empty box with arrow in
      g.strokeRect(40, 64, 48, 26);
      g.beginPath();
      g.moveTo(64, 26);
      g.lineTo(64, 54);
      g.moveTo(52, 44);
      g.lineTo(64, 56);
      g.lineTo(76, 44);
      g.stroke();
      break;
    case 'outputFull': // stacked boxes
      g.fillRect(38, 66, 24, 24);
      g.fillRect(66, 66, 24, 24);
      g.fillRect(52, 38, 24, 24);
      break;
    case 'noWorkers': // person
      g.beginPath();
      g.arc(64, 42, 13, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(40, 90);
      g.quadraticCurveTo(64, 50, 88, 90);
      g.fill();
      break;
    case 'noResource':
      g.beginPath();
      g.moveTo(44, 40);
      g.lineTo(84, 80);
      g.moveTo(84, 40);
      g.lineTo(44, 80);
      g.stroke();
      break;
    case 'house': // sad face
    case 'cover':
      g.lineWidth = 7;
      g.beginPath();
      g.arc(50, 50, 4, 0, Math.PI * 2);
      g.arc(78, 50, 4, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(64, 90, 18, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
      break;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const badgeMats = new Map<string, THREE.SpriteMaterial>();
function badgeMaterial(kind: string) {
  let m = badgeMats.get(kind);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: badgeTexture(kind), depthTest: false, transparent: true });
    badgeMats.set(kind, m);
  }
  return m;
}

function roadGeom(): THREE.BufferGeometry {
  const k = new Kit();
  k.jitter = 0.08;
  k.box(1.0, 0.04, 1.0, 0x9c9384, 0, 0, 0);
  const cols = [0xb3ab9c, 0xa69e8f, 0xc0b8a8, 0x958d7f];
  let n = 0;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const off = i % 2 ? 0.12 : 0;
      const x = -0.37 + j * 0.245 + off;
      if (x > 0.45) continue;
      k.box(0.21, 0.03, 0.21, cols[n++ % 4], x, 0.035, -0.37 + i * 0.245);
    }
  return k.build();
}

function lampGeom(): THREE.BufferGeometry {
  const k = new Kit();
  k.cyl(0.025, 0.035, 0.75, PAL.metalDark, 0, 0, 0, 6);
  k.box(0.12, 0.03, 0.03, PAL.metalDark, 0.05, 0.72, 0);
  k.pyramid(0.14, 0.14, 0.06, PAL.metalDark, 0.1, 0.78, 0);
  return k.build();
}

export class EntityView {
  group = new THREE.Group();
  views = new Map<number, View>();
  private roads: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh;
  private bulbs: THREE.InstancedMesh;
  time = 0;
  night = 0;

  constructor(private world: World) {
    const cap = world.W * world.H;
    this.roads = new THREE.InstancedMesh(roadGeom(), materials.base, cap);
    this.roads.receiveShadow = true;
    this.roads.frustumCulled = false;
    this.lamps = new THREE.InstancedMesh(lampGeom(), materials.base, cap);
    this.lamps.castShadow = true;
    this.lamps.frustumCulled = false;
    const bulb = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    this.bulbs = new THREE.InstancedMesh(bulb, materials.lamp, cap);
    this.bulbs.frustumCulled = false;
    this.group.add(this.roads, this.lamps, this.bulbs);
  }

  private keyFor(e: Entity) {
    return `${e.type}:${e.level}:${e.variant ?? 0}:${e.tier ?? 0}:${e.type === 'hall' ? this.world.milestone : 0}`;
  }

  private create(e: Entity): View {
    const m = getModel(e.type, e.level, e.variant ?? 0, e.tier ?? 0, e.type === 'hall' ? this.world.milestone : 0);
    const root = new THREE.Group();
    const base = new THREE.Mesh(m.base, materials.base);
    base.castShadow = true;
    base.receiveShadow = true;
    base.userData.entityId = e.id;
    root.add(base);
    const glowMeshes: THREE.Mesh[] = [];
    if (m.glow) {
      const g = new THREE.Mesh(m.glow, materials.glow);
      g.userData.entityId = e.id;
      root.add(g);
      glowMeshes.push(g);
    }
    if (m.fire) {
      const f = new THREE.Mesh(m.fire, materials.fire);
      root.add(f);
    }
    const anims = m.anims.map((part) => {
      const obj = new THREE.Mesh(part.geom, materials.base);
      obj.castShadow = true;
      obj.position.set(...part.pos);
      obj.userData.entityId = e.id;
      root.add(obj);
      return { obj, part };
    });
    // place: rotate around footprint center, sit on terrain
    const cx = e.x + e.w / 2 - this.world.W / 2, cz = e.y + e.h / 2 - this.world.H / 2;
    const y = this.world.heightAt(e.x, e.y) * LEVEL_H;
    root.position.set(cx, y, cz);
    root.rotation.y = -e.dir * Math.PI * 0.5;
    root.updateMatrixWorld(true);
    const smoke = m.smoke.map((s) => new THREE.Vector3(...s).applyMatrix4(root.matrixWorld));
    const v: View = { id: e.id, key: this.keyFor(e), root, anims, smoke, height: m.height, born: this.time, badgeT: 0, glowMeshes };
    return v;
  }

  /** Create/remove/refresh views to match the world */
  sync(newIds: Set<number> = new Set()) {
    const w = this.world;
    for (const [id, v] of this.views) {
      const e = w.entities.get(id);
      if (!e) {
        this.group.remove(v.root);
        this.views.delete(id);
        continue;
      }
      const key = this.keyFor(e);
      if (key !== v.key) {
        this.group.remove(v.root);
        const nv = this.create(e);
        nv.born = this.time - 0.15; // quick refresh pop
        this.views.set(id, nv);
        this.group.add(nv.root);
      }
    }
    for (const e of w.entities.values()) {
      if (e.type === 'belt' || e.type === 'road' || e.type === 'bridgeEnd') continue;
      if (this.views.has(e.id)) continue;
      const v = this.create(e);
      if (!newIds.has(e.id)) v.born = -10; // pre-existing (loaded) entities appear instantly
      this.views.set(e.id, v);
      this.group.add(v.root);
    }
    this.rebuildRoads();
  }

  rebuildRoads() {
    const w = this.world;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    let n = 0, l = 0;
    const lampsOn = w.milestone >= 2;
    for (const e of w.entities.values()) {
      if (e.type !== 'road') continue;
      const cx = e.x + 0.5 - w.W / 2, cz = e.y + 0.5 - w.H / 2, y = w.heightAt(e.x, e.y) * LEVEL_H;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((e.x * 3 + e.y * 5) % 4) * Math.PI * 0.5);
      m.compose(p.set(cx, y, cz), q, s);
      this.roads.setMatrixAt(n++, m);
      if (lampsOn && (e.x * 7 + e.y * 3) % 5 === 0) {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((e.x + e.y) % 4) * Math.PI * 0.5);
        m.compose(p.set(cx + 0.38, y, cz + 0.38), q, s);
        this.lamps.setMatrixAt(l, m);
        const bx = new THREE.Vector3(0.1, 0.72, 0).applyQuaternion(q);
        m.compose(p.set(cx + 0.38 + bx.x, y + 0.72, cz + 0.38 + bx.z), q, s);
        this.bulbs.setMatrixAt(l, m);
        l++;
      }
    }
    this.roads.count = n;
    this.lamps.count = l;
    this.bulbs.count = l;
    this.roads.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
    this.bulbs.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, running: boolean) {
    this.time += dt;
    const w = this.world;
    materials.glow.emissiveIntensity = this.night * 1.6;
    materials.lamp.color.setRGB(0.55 + this.night * 0.6, 0.5 + this.night * 0.45, 0.35 + this.night * 0.2);
    for (const v of this.views.values()) {
      const e = w.entities.get(v.id);
      if (!e) continue;
      // construction pop
      const age = this.time - v.born;
      if (age < 0.6) {
        const t = Math.max(0, age / 0.6);
        const sy = t < 0.7 ? (t / 0.7) * 1.08 : 1.08 - ((t - 0.7) / 0.3) * 0.08;
        const sxz = 0.85 + 0.15 * Math.min(1, t * 1.5);
        v.root.scale.set(sxz, Math.max(0.01, sy), sxz);
      } else if (v.root.scale.y !== 1) v.root.scale.set(1, 1, 1);

      const working = e.status === 'working' && running;
      for (const a of v.anims) {
        const p = a.part;
        if (p.kind === 'crop') {
          const grow = BUILDINGS[e.type].kind === 'gatherer' ? e.progress : 1;
          a.obj.scale.y = 0.15 + 0.85 * grow;
          continue;
        }
        if (p.kind === 'swing') {
          if (working) a.obj.rotation.y = Math.sin(this.time * p.speed * 1.5) * 0.9;
          continue;
        }
        const always = e.type === 'hall' || (e.type === 'mill' && running);
        const spd = working ? p.speed * (e.level >= 2 ? 1.3 : 1) : always ? p.speed * 0.3 : 0;
        a.obj.rotation[p.axis] += spd * dt;
      }
      // status badge
      let kind: string | undefined;
      const def = BUILDINGS[e.type];
      if (def.kind === 'gatherer' || def.kind === 'crafter') {
        if (e.status === 'noInput' || e.status === 'outputFull' || e.status === 'noResource' || e.status === 'noWorkers') kind = e.status;
      } else if (e.type === 'house' && !e.happy) kind = e.covered ? 'house' : 'cover';
      if (kind) v.badgeT += dt;
      else v.badgeT = 0;
      if (kind && v.badgeT > 2.5) {
        if (!v.badge || v.badgeKind !== kind) {
          if (v.badge) v.root.remove(v.badge);
          v.badge = new THREE.Sprite(badgeMaterial(kind));
          v.badge.scale.set(0.42, 0.42, 1);
          v.badge.renderOrder = 10;
          v.badgeKind = kind;
          v.root.add(v.badge);
        }
        v.badge.position.set(0, v.height + 0.3 + Math.sin(this.time * 3 + v.id) * 0.05, 0);
      } else if (v.badge) {
        v.root.remove(v.badge);
        v.badge = undefined;
        v.badgeKind = undefined;
      }
    }
  }

  pickables(): THREE.Object3D[] {
    const arr: THREE.Object3D[] = [];
    for (const v of this.views.values()) arr.push(v.root);
    return arr;
  }

  houseTierName(e: Entity) {
    return HOUSE_TIERS[e.tier ?? 0].name;
  }
}
