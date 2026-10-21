// Particles (smoke, dust, sparkles) and item "hops" for deliveries.

import * as THREE from 'three';
import { ItemId } from '../sim/data';

const MAX = 1500;

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; grow: number;
  r: number; g: number; b: number;
  a: number;
  drag: number;
}

export class Particles {
  points: THREE.Points;
  private ps: P[] = [];
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 4);
  private size = new Float32Array(MAX);
  private geo = new THREE.BufferGeometry();

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 400 }, uLight: { value: 1 } },
      vertexShader: `
        attribute float size; attribute vec4 color; varying vec4 vC; uniform float uScale;
        void main() {
          vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // keep puffs that drift close to the camera from turning into big blobs
          gl_PointSize = min(size * uScale / -mv.z, 46.0);
          vC.a *= smoothstep(2.5, 6.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec4 vC; uniform float uLight;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float a = smoothstep(0.5, 0.15, r) * vC.a;
          gl_FragColor = vec4(vC.rgb * mix(0.45, 1.0, uLight), a);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setScale(viewportHeight: number, fov: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = viewportHeight / (2 * Math.tan((fov * Math.PI) / 360));
  }
  setLight(l: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uLight.value = l;
  }

  emit(p: Partial<P> & { x: number; y: number; z: number }) {
    if (this.ps.length >= MAX) return;
    this.ps.push({
      vx: 0, vy: 0, vz: 0, life: 0, max: 2, size: 0.2, grow: 0.2, r: 1, g: 1, b: 1, a: 0.6, drag: 0.5, ...p,
    });
  }

  smoke(x: number, y: number, z: number, dark = false) {
    const c = dark ? 0.45 + Math.random() * 0.1 : 0.88 + Math.random() * 0.1;
    this.emit({
      x: x + (Math.random() - 0.5) * 0.05, y, z: z + (Math.random() - 0.5) * 0.05,
      vx: 0.12 + Math.random() * 0.05, vy: 0.35 + Math.random() * 0.15, vz: 0.05,
      max: 2.4 + Math.random(), size: 0.09, grow: 0.13, r: c, g: c, b: c * 0.98, a: dark ? 0.42 : 0.32, drag: 0.2,
    });
  }

  dust(x: number, y: number, z: number, radius: number, n = 24) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.random() * 0.8;
      this.emit({
        x: x + Math.cos(a) * radius * 0.5, y: y + 0.05, z: z + Math.sin(a) * radius * 0.5,
        vx: Math.cos(a) * s, vy: 0.3 + Math.random() * 0.4, vz: Math.sin(a) * s,
        max: 0.7 + Math.random() * 0.4, size: 0.22, grow: 0.3, r: 0.86, g: 0.78, b: 0.64, a: 0.7, drag: 3,
      });
    }
  }

  sparkle(x: number, y: number, z: number, n = 14, color = [1, 0.85, 0.35]) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.4 + Math.random() * 0.9;
      this.emit({
        x, y, z, vx: Math.cos(a) * s, vy: 0.8 + Math.random() * 1.2, vz: Math.sin(a) * s,
        max: 0.8 + Math.random() * 0.6, size: 0.09, grow: -0.05, r: color[0], g: color[1], b: color[2], a: 1, drag: 1.5,
      });
    }
  }

  firework(x: number, y: number, z: number) {
    const palette = [[1, 0.5, 0.4], [1, 0.85, 0.35], [0.5, 0.8, 1], [0.7, 1, 0.6], [1, 0.6, 0.9]];
    const c = palette[Math.floor(Math.random() * palette.length)];
    for (let i = 0; i < 60; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = 2 + Math.random() * 0.6;
      this.emit({
        x, y, z, vx: r * Math.cos(th) * s, vy: u * s + 0.3, vz: r * Math.sin(th) * s,
        max: 1.3 + Math.random() * 0.5, size: 0.12, grow: -0.06, r: c[0], g: c[1], b: c[2], a: 1, drag: 1.6,
      });
    }
  }

  update(dt: number) {
    const ps = this.ps;
    let n = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vz *= k;
      if (p.drag > 1) p.vy = p.vy * k - 0.6 * dt; // heavier particles fall
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      ps[n++] = p;
    }
    ps.length = n;
    for (let i = 0; i < n; i++) {
      const p = ps[i];
      const t = p.life / p.max;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.col[i * 4] = p.r;
      this.col[i * 4 + 1] = p.g;
      this.col[i * 4 + 2] = p.b;
      this.col[i * 4 + 3] = p.a * Math.min(1, t * 6) * (1 - t);
      this.size[i] = Math.max(0.01, p.size + p.grow * p.life);
    }
    this.geo.setDrawRange(0, n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }
}

export interface Hop {
  item: ItemId;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  height: number;
}
