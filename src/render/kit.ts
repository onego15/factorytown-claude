// Tiny modelling kit: compose low-poly parts with vertex colours, merged into one geometry.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type ColorLike = number | string | THREE.Color;

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export interface PartOpts {
  /** slabRoof: fill the gable ends with a wall-coloured prism of size fw × fd */
  fill?: ColorLike;
  fw?: number;
  fd?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

function paint(g: THREE.BufferGeometry, color: ColorLike, jitter = 0): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  _c.set(color as THREE.ColorRepresentation);
  for (let i = 0; i < n; i += 3) {
    // per-face jitter gives a subtle hand-painted feel
    const j = jitter ? 1 + (Math.sin(i * 12.9898 + n) * 43758.5453 % 1) * jitter : 1;
    for (let k = 0; k < 3; k++) {
      arr[(i + k) * 3] = _c.r * j;
      arr[(i + k) * 3 + 1] = _c.g * j;
      arr[(i + k) * 3 + 2] = _c.b * j;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export class Kit {
  parts: THREE.BufferGeometry[] = [];
  jitter = 0.04;

  add(g: THREE.BufferGeometry, color: ColorLike, x = 0, y = 0, z = 0, o: PartOpts = {}) {
    const geo = paint(g, color, this.jitter);
    _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    _q.setFromEuler(_e);
    _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    _p.set(x, y, z);
    _m.compose(_p, _q, _s);
    geo.applyMatrix4(_m);
    this.parts.push(geo);
    return this;
  }

  /** box with its base at y */
  box(w: number, h: number, d: number, color: ColorLike, x = 0, y = 0, z = 0, o: PartOpts = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    return this.add(g, color, x, y, z, o);
  }

  /** cylinder with its base at y */
  cyl(rt: number, rb: number, h: number, color: ColorLike, x = 0, y = 0, z = 0, seg = 8, o: PartOpts = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.translate(0, h / 2, 0);
    return this.add(g, color, x, y, z, o);
  }

  cone(r: number, h: number, color: ColorLike, x = 0, y = 0, z = 0, seg = 8, o: PartOpts = {}) {
    const g = new THREE.ConeGeometry(r, h, seg);
    g.translate(0, h / 2, 0);
    return this.add(g, color, x, y, z, o);
  }

  sphere(r: number, color: ColorLike, x = 0, y = 0, z = 0, detail = 0, o: PartOpts = {}) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    return this.add(g, color, x, y, z, o);
  }

  dodeca(r: number, color: ColorLike, x = 0, y = 0, z = 0, o: PartOpts = {}) {
    return this.add(new THREE.DodecahedronGeometry(r, 0), color, x, y, z, o);
  }

  /** Gable roof: ridge runs along x. Base at y, width w (x), depth d (z), height h, overhang included. */
  gable(w: number, d: number, h: number, color: ColorLike, x = 0, y = 0, z = 0, o: PartOpts = {}) {
    const shape = new THREE.Shape();
    shape.moveTo(-d / 2, 0);
    shape.lineTo(d / 2, 0);
    shape.lineTo(0, h);
    shape.lineTo(-d / 2, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    g.translate(0, 0, -w / 2);
    g.rotateY(Math.PI / 2);
    return this.add(g, color, x, y, z, o);
  }

  /** Thick gable roof made of two slabs, reads nicer with overhangs */
  slabRoof(w: number, d: number, h: number, t: number, color: ColorLike, x = 0, y = 0, z = 0, o: PartOpts = {}) {
    const half = d / 2;
    const len = Math.hypot(half, h);
    const ang = Math.atan2(h, half);
    const k = new Kit();
    k.jitter = this.jitter;
    k.box(w, t, len + 0.02, color, 0, 0, 0, {});
    const a = k.build();
    const b = a.clone();
    a.translate(0, 0, -(len + 0.02) / 2);
    a.rotateX(-ang);
    a.translate(0, h, 0);
    b.translate(0, 0, (len + 0.02) / 2);
    b.rotateX(ang);
    b.translate(0, h, 0);
    const pieces = [a, b];
    if (o.fill !== undefined) {
      const gk = new Kit();
      gk.jitter = this.jitter;
      gk.gable(o.fw ?? w * 0.9, o.fd ?? d * 0.8, h * 0.97, o.fill);
      pieces.push(gk.build());
    }
    const merged = mergeGeometries(pieces)!;
    _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    _q.setFromEuler(_e);
    _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    _p.set(x, y, z);
    _m.compose(_p, _q, _s);
    merged.applyMatrix4(_m);
    this.parts.push(merged);
    return this;
  }

  /** Square pyramid (hip roof) base at y */
  pyramid(w: number, d: number, h: number, color: ColorLike, x = 0, y = 0, z = 0, o: PartOpts = {}) {
    const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
    g.rotateY(Math.PI / 4);
    g.translate(0, 0.5, 0);
    g.scale(w, h, d);
    return this.add(g, color, x, y, z, o);
  }

  torus(r: number, tube: number, color: ColorLike, x = 0, y = 0, z = 0, o: PartOpts = {}) {
    return this.add(new THREE.TorusGeometry(r, tube, 5, 12), color, x, y, z, o);
  }

  merge(other: Kit, x = 0, y = 0, z = 0, ry = 0) {
    for (const p of other.parts) {
      const g = p.clone();
      g.rotateY(ry);
      g.translate(x, y, z);
      this.parts.push(g);
    }
    return this;
  }

  build(): THREE.BufferGeometry {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const parts = this.parts.map((p) => {
      for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') p.deleteAttribute(k);
      return p;
    });
    const g = mergeGeometries(parts)!;
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
