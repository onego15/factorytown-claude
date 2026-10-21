// Conveyor belts (instanced) and the goods travelling on them.

import * as THREE from 'three';
import { ITEM_IDS, ItemId } from '../sim/data';
import { BELT_Y, BeltGeom, V3, beltPoint, beltYaw } from '../sim/geom';
import { World } from '../sim/world';
import { itemGeom } from './itemModels';
import { Kit } from './kit';
import { PAL } from './palette';

function beltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a4650';
  g.fillRect(0, 0, 128, 64);
  // fine ribs
  for (let x = 0; x < 128; x += 8) {
    g.fillStyle = x % 16 ? '#423e48' : '#524d58';
    g.fillRect(x, 0, 3, 64);
  }
  // chevrons pointing +u
  g.strokeStyle = '#e9c46a';
  g.lineWidth = 7;
  g.lineCap = 'round';
  for (const ox of [20, 84]) {
    g.beginPath();
    g.moveTo(ox, 16);
    g.lineTo(ox + 18, 32);
    g.lineTo(ox, 48);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** belt surface strip for a straight segment along +x, at y=0 */
function straightSurface(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 0.5, 1, 1);
  g.rotateX(-Math.PI / 2);
  // uv u along +x: PlaneGeometry maps u along x already
  return g;
}

/** curved belt surface; enters from the left (-z) side and exits at +x */
function curveSurface(mirror: boolean): THREE.BufferGeometry {
  const seg = 8;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const cx = 0.5, cz = mirror ? 0.5 : -0.5;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = Math.PI - (t * Math.PI) / 2; // from pi (start) to pi/2 (end)
    for (const [r, v] of [[0.25, 0], [0.75, 1]] as const) {
      const x = cx + Math.cos(a) * r;
      const z = mirror ? cz - Math.sin(a) * r : cz + Math.sin(a) * r;
      pos.push(x, 0, z);
      uv.push(t, mirror ? 1 - v : v);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    if (mirror) idx.push(a, b, c, b, d, c);
    else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function straightFrame(): THREE.BufferGeometry {
  const k = new Kit();
  k.jitter = 0.03;
  k.box(1.0, 0.07, 0.62, PAL.darkWood, 0, -0.09, 0);
  k.box(1.0, 0.07, 0.06, PAL.brass, 0, -0.04, 0.29);
  k.box(1.0, 0.07, 0.06, PAL.brass, 0, -0.04, -0.29);
  k.box(1.0, 0.025, 0.08, PAL.wood, 0, -0.04, 0.29, { sy: 1 });
  for (const x of [-0.3, 0.3]) {
    k.box(0.06, BELT_Y, 0.06, PAL.darkWood, x, -BELT_Y, 0.25);
    k.box(0.06, BELT_Y, 0.06, PAL.darkWood, x, -BELT_Y, -0.25);
  }
  // rollers at the ends
  k.cyl(0.035, 0.035, 0.56, PAL.metal, 0.47, -0.035, 0, 6, { rx: Math.PI / 2 });
  return k.build();
}

function curveFrame(mirror: boolean): THREE.BufferGeometry {
  const k = new Kit();
  k.jitter = 0.03;
  const seg = 6;
  const cx = 0.5, cz = mirror ? 0.5 : -0.5;
  for (let i = 0; i < seg; i++) {
    const a0 = Math.PI - (i / seg) * (Math.PI / 2);
    const a1 = Math.PI - ((i + 1) / seg) * (Math.PI / 2);
    const am = (a0 + a1) / 2;
    const sgn = mirror ? -1 : 1;
    const step = (Math.PI / 2 / seg) * 1.04;
    for (const [r, len, th, color, dy] of [
      [0.5, 0.82 * step, 0.62, PAL.darkWood, -0.09],
      [0.2, 0.2 * step + 0.01, 0.06, PAL.brass, -0.04],
      [0.8, 0.8 * step + 0.01, 0.06, PAL.brass, -0.04],
    ] as const) {
      const x = cx + Math.cos(am) * r, z = cz + sgn * Math.sin(am) * r;
      const ry = Math.atan2(-sgn * Math.cos(am), -Math.sin(am));
      k.box(len, 0.07, th, color, x, dy, z, { ry });
    }
    void a0;
    void a1;
  }
  for (const [x, z] of [[0.15, mirror ? 0.15 : -0.15], [0.3, mirror ? -0.25 : 0.25]]) k.box(0.06, BELT_Y, 0.06, PAL.darkWood, x, -BELT_Y, z);
  return k.build();
}

const MAX_BELTS = 4096;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class BeltView {
  group = new THREE.Group();
  tex = beltTexture();
  private frames: THREE.InstancedMesh[] = [];
  private surfaces: THREE.InstancedMesh[] = [];
  private supports: THREE.InstancedMesh;
  private items = new Map<ItemId, THREE.InstancedMesh>();
  private itemCap = 2048;
  private tmp: V3 = { x: 0, y: 0, z: 0 };
  extraItems: { item: ItemId; x: number; y: number; z: number; s: number; ry: number }[] = [];

  constructor(private world: World) {
    const frameMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1, flatShading: true });
    const surfMat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.8 });
    const frames = [straightFrame(), curveFrame(false), curveFrame(true)];
    const surfs = [straightSurface(), curveSurface(false), curveSurface(true)];
    for (let i = 0; i < 3; i++) {
      const f = new THREE.InstancedMesh(frames[i], frameMat, MAX_BELTS);
      const s = new THREE.InstancedMesh(surfs[i], surfMat, MAX_BELTS);
      for (const m of [f, s]) {
        m.count = 0;
        m.frustumCulled = false;
        m.receiveShadow = true;
        this.group.add(m);
      }
      f.castShadow = true;
      this.frames.push(f);
      this.surfaces.push(s);
    }
    const sk = new Kit();
    sk.box(0.08, 1, 0.5, PAL.darkWood, 0, 0, 0);
    sk.box(0.1, 0.04, 0.56, PAL.brass, 0, 0.96, 0);
    this.supports = new THREE.InstancedMesh(sk.build(), frameMat, MAX_BELTS);
    this.supports.count = 0;
    this.supports.castShadow = true;
    this.supports.frustumCulled = false;
    this.group.add(this.supports);

    const itemMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true });
    for (const id of ITEM_IDS) {
      const m = new THREE.InstancedMesh(itemGeom(id), itemMat, this.itemCap);
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      this.items.set(id, m);
      this.group.add(m);
    }
  }

  /** Rebuild belt instances (call when topology changes) */
  rebuild() {
    const w = this.world;
    w.ensureTopology();
    const counts = [0, 0, 0];
    let sup = 0;
    for (const e of w.entities.values()) {
      if (e.type !== 'belt') continue;
      const shape = e.shape ?? 0;
      const cx = e.x + 0.5 - w.W / 2, cz = e.y + 0.5 - w.H / 2;
      const yIn = e.yIn!, yOut = e.yOut!;
      _q.setFromAxisAngle(_up, -e.dir * Math.PI * 0.5);
      _p.set(cx, (yIn + yOut) / 2, cz);
      _m.compose(_p, _q, _s.set(1, 1, 1));
      if (shape === 0 && yIn !== yOut) {
        // shear so that the belt rises/falls along its local +x
        const sh = new THREE.Matrix4().set(1, 0, 0, 0, yOut - yIn, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
        _m.multiply(sh);
        // support under the high end
        const hiX = yOut > yIn ? 0.4 : -0.4;
        const hiY = Math.max(yIn, yOut);
        const ground = hiY - (Math.abs(yOut - yIn)) - BELT_Y;
        const sm = new THREE.Matrix4().compose(
          new THREE.Vector3(cx + Math.cos(-e.dir * Math.PI * 0.5) * hiX, ground, cz - Math.sin(-e.dir * Math.PI * 0.5) * hiX),
          _q,
          new THREE.Vector3(1, hiY - 0.1 - ground, 1),
        );
        this.supports.setMatrixAt(sup++, sm);
      }
      const n = counts[shape]++;
      this.frames[shape].setMatrixAt(n, _m);
      this.surfaces[shape].setMatrixAt(n, _m);
    }
    for (let i = 0; i < 3; i++) {
      this.frames[i].count = counts[i];
      this.surfaces[i].count = counts[i];
      this.frames[i].instanceMatrix.needsUpdate = true;
      this.surfaces[i].instanceMatrix.needsUpdate = true;
    }
    this.supports.count = sup;
    this.supports.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, alpha: number, running: boolean) {
    const w = this.world;
    if (running) this.tex.offset.x -= w.beltSpeed() * dt * 2;
    const counts = new Map<ItemId, number>();
    for (const id of ITEM_IDS) counts.set(id, 0);
    const tmp = this.tmp;
    for (const e of w.entities.values()) {
      if (e.type !== 'belt') continue;
      const g = e as unknown as BeltGeom;
      for (const it of e.items!) {
        beltPoint(g, it.pos, w.W, w.H, tmp);
        const x = it.px + (tmp.x - it.px) * alpha;
        const y = it.py + (tmp.y - it.py) * alpha;
        const z = it.pz + (tmp.z - it.pz) * alpha;
        const ry = beltYaw(g, it.pos);
        const mesh = this.items.get(it.item)!;
        const n = counts.get(it.item)!;
        if (n >= this.itemCap) continue;
        _q.setFromAxisAngle(_up, ry);
        _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
        mesh.setMatrixAt(n, _m);
        counts.set(it.item, n + 1);
      }
    }
    for (const ex of this.extraItems) {
      const mesh = this.items.get(ex.item)!;
      const n = counts.get(ex.item)!;
      if (n >= this.itemCap) continue;
      _q.setFromAxisAngle(_up, ex.ry);
      _m.compose(_p.set(ex.x, ex.y, ex.z), _q, _s.set(ex.s, ex.s, ex.s));
      mesh.setMatrixAt(n, _m);
      counts.set(ex.item, n + 1);
    }
    for (const [id, m] of this.items) {
      m.count = counts.get(id)!;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}
