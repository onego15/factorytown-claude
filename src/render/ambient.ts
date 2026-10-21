// Ambient life: villagers strolling the streets, drifting clouds and birds.

import * as THREE from 'three';
import { DX, DY, LEVEL_H } from '../sim/geom';
import { World } from '../sim/world';
import { Kit } from './kit';

interface Walker {
  x: number; // tile
  y: number;
  tx: number;
  ty: number;
  t: number;
  speed: number;
  ox: number;
  oz: number;
  shirt: THREE.Color;
  phase: number;
  dir: number;
}

const SHIRTS = [0xd2483b, 0x3e6db5, 0x3f8f7d, 0xe0a23a, 0x8a4d6a, 0x5f9a45, 0xf3ead6];

export class Villagers {
  group = new THREE.Group();
  private bodies: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private walkers: Walker[] = [];
  private roads: [number, number][] = [];
  constructor(private world: World) {
    const bk = new Kit();
    bk.jitter = 0;
    bk.cyl(0.035, 0.05, 0.13, 0xffffff, 0, 0.03, 0, 6);
    bk.box(0.025, 0.04, 0.025, 0x3d3a45, -0.018, 0, 0);
    bk.box(0.025, 0.04, 0.025, 0x3d3a45, 0.018, 0, 0);
    const hk = new Kit();
    hk.jitter = 0;
    hk.sphere(0.035, 0xf0c8a0, 0, 0.19, 0, 1);
    hk.cyl(0.04, 0.045, 0.02, 0x6b4a30, 0, 0.215, 0, 6);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });
    this.bodies = new THREE.InstancedMesh(bk.build(), mat, 120);
    this.heads = new THREE.InstancedMesh(hk.build(), mat, 120);
    for (const m of [this.bodies, this.heads]) {
      m.castShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  refreshRoads() {
    this.roads = [];
    for (const e of this.world.entities.values()) if (e.type === 'road') this.roads.push([e.x, e.y]);
  }

  private isRoad(x: number, y: number) {
    const e = this.world.entAt(x, y);
    return !!e && (e.type === 'road' || e.type === 'hall');
  }

  update(dt: number) {
    const w = this.world;
    const target = this.roads.length ? Math.min(100, Math.floor(w.pop / 2.2), this.roads.length * 2) : 0;
    while (this.walkers.length < target) {
      const [x, y] = this.roads[Math.floor(Math.random() * this.roads.length)];
      this.walkers.push({
        x, y, tx: x, ty: y, t: 1, speed: 0.45 + Math.random() * 0.3,
        ox: (Math.random() - 0.5) * 0.5, oz: (Math.random() - 0.5) * 0.5,
        shirt: new THREE.Color(SHIRTS[Math.floor(Math.random() * SHIRTS.length)]), phase: Math.random() * 6, dir: Math.floor(Math.random() * 4),
      });
    }
    if (this.walkers.length > target) this.walkers.length = target;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (const v of this.walkers) {
      if (!this.isRoad(v.x, v.y) && !this.isRoad(v.tx, v.ty)) {
        // road removed under the walker: respawn
        if (!this.roads.length) continue;
        const [x, y] = this.roads[Math.floor(Math.random() * this.roads.length)];
        v.x = v.tx = x;
        v.y = v.ty = y;
        v.t = 1;
      }
      v.t += (dt * v.speed);
      if (v.t >= 1) {
        v.x = v.tx;
        v.y = v.ty;
        v.t = 0;
        // choose next tile: prefer straight on, avoid going back
        const opts: number[] = [];
        for (let d = 0; d < 4; d++) {
          const nx = v.x + DX[d], ny = v.y + DY[d];
          if (!this.isRoad(nx, ny)) continue;
          if (Math.abs(w.heightAt(nx, ny) - w.heightAt(v.x, v.y)) > 1) continue;
          if (d === ((v.dir + 2) & 3)) continue;
          opts.push(d, d === v.dir ? d : -1);
        }
        const valid = opts.filter((d) => d >= 0);
        let d: number;
        if (valid.length) d = valid[Math.floor(Math.random() * valid.length)];
        else d = (v.dir + 2) & 3;
        if (this.isRoad(v.x + DX[d], v.y + DY[d])) {
          v.tx = v.x + DX[d];
          v.ty = v.y + DY[d];
          v.dir = d;
        } else {
          v.t = 0.5;
        }
      }
      const fx = v.x + (v.tx - v.x) * v.t, fy = v.y + (v.ty - v.y) * v.t;
      const h0 = w.heightAt(v.x, v.y) * LEVEL_H, h1 = w.heightAt(v.tx, v.ty) * LEVEL_H;
      const hy = h0 + (h1 - h0) * v.t;
      const bob = Math.abs(Math.sin((v.t + v.phase) * Math.PI * 4)) * 0.02;
      p.set(fx + 0.5 - w.W / 2 + v.ox * 0.6, hy + 0.07 + bob, fy + 0.5 - w.H / 2 + v.oz * 0.6);
      q.setFromAxisAngle(up, -v.dir * Math.PI * 0.5);
      m.compose(p, q, s);
      this.bodies.setMatrixAt(n, m);
      this.heads.setMatrixAt(n, m);
      this.bodies.setColorAt(n, v.shirt);
      n++;
    }
    this.bodies.count = n;
    this.heads.count = n;
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
  }
}

export class Clouds {
  group = new THREE.Group();
  private clouds: { obj: THREE.Mesh; speed: number }[] = [];
  material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, transparent: true, opacity: 0.92 });
  constructor() {
    for (let i = 0; i < 9; i++) {
      const k = new Kit();
      k.jitter = 0.03;
      const n = 3 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n; j++) k.sphere(0.8 + Math.random() * 0.7, 0xffffff, j * 1.1 - n * 0.5, Math.random() * 0.4, (Math.random() - 0.5) * 0.8, 1);
      const m = new THREE.Mesh(k.build(), this.material);
      m.scale.set(1, 0.55, 0.8);
      m.position.set((Math.random() - 0.5) * 80, 9 + Math.random() * 3, (Math.random() - 0.5) * 80);
      m.castShadow = true;
      this.group.add(m);
      this.clouds.push({ obj: m, speed: 0.4 + Math.random() * 0.4 });
    }
  }
  update(dt: number) {
    for (const c of this.clouds) {
      c.obj.position.x += c.speed * dt;
      c.obj.position.z += c.speed * 0.3 * dt;
      if (c.obj.position.x > 45) {
        c.obj.position.x = -45;
        c.obj.position.z = (Math.random() - 0.5) * 80;
      }
      if (c.obj.position.z > 45) c.obj.position.z = -45;
    }
  }
}

export class Birds {
  group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private flocks: { cx: number; cz: number; r: number; y: number; a: number; s: number; n: number }[] = [];
  private t = 0;
  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.12, 0.04, -0.15, 0.06, 0, 0, 0, 0, 0, 0.06, 0, 0, -0.12, 0.04, 0.15], 3));
    g.computeVertexNormals();
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x3a3a46, side: THREE.DoubleSide }), 40);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    for (let i = 0; i < 3; i++)
      this.flocks.push({ cx: (Math.random() - 0.5) * 30, cz: (Math.random() - 0.5) * 30, r: 6 + Math.random() * 6, y: 5 + Math.random() * 2, a: Math.random() * 6, s: 0.15 + Math.random() * 0.1, n: 4 + Math.floor(Math.random() * 4) });
  }
  update(dt: number) {
    this.t += dt;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    let n = 0;
    for (const f of this.flocks) {
      f.a += f.s * dt;
      for (let i = 0; i < f.n; i++) {
        const a = f.a - i * 0.05;
        const off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.25;
        p.set(f.cx + Math.cos(a) * (f.r + off), f.y + Math.sin(this.t * 0.7 + i) * 0.2, f.cz + Math.sin(a) * (f.r + off));
        q.setFromEuler(new THREE.Euler(0, -a - Math.PI / 2, 0));
        const flap = 0.6 + Math.abs(Math.sin(this.t * 8 + i * 1.3)) * 0.8;
        s.set(1.4, flap * 1.4, 1.4);
        m.compose(p, q, s);
        this.mesh.setMatrixAt(n++, m);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
