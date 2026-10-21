// Procedural low-poly models for every building. Front (door side) faces +z.

import * as THREE from 'three';
import { BuildingId } from '../sim/data';
import { Kit } from './kit';
import { PAL, ROOF_VARIANTS, WALL_VARIANTS } from './palette';

export interface AnimPart {
  geom: THREE.BufferGeometry;
  pos: [number, number, number];
  axis: 'x' | 'y' | 'z';
  speed: number; // radians per second while working
  kind?: 'spin' | 'crop' | 'swing';
}

export interface Model {
  base: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
  fire: THREE.BufferGeometry | null;
  anims: AnimPart[];
  smoke: [number, number, number][];
  height: number;
}

class Builder {
  k = new Kit();
  g = new Kit(); // window glass – glows at night
  f = new Kit(); // fire – always emissive
  anims: AnimPart[] = [];
  smoke: [number, number, number][] = [];
  height = 1;

  constructor() {
    this.g.jitter = 0;
    this.f.jitter = 0;
  }

  /** window on a wall facing +z (face='z') or +x (face='x'); sign flips side */
  win(x: number, y: number, z: number, face: 'x' | 'z', w = 0.13, h = 0.17, frame: number = PAL.timber) {
    if (face === 'z') {
      this.k.box(w + 0.05, h + 0.05, 0.03, frame, x, y - 0.025, z);
      this.g.box(w, h, 0.04, PAL.glass, x, y, z);
      this.k.box(w + 0.07, 0.03, 0.06, frame, x, y - 0.035, z + 0.01);
    } else {
      this.k.box(0.03, h + 0.05, w + 0.05, frame, x, y - 0.025, z);
      this.g.box(0.04, h, w, PAL.glass, x, y, z);
      this.k.box(0.06, 0.03, w + 0.07, frame, x + 0.01 * Math.sign(x || 1), y - 0.035, z);
    }
  }
  door(x: number, z: number, y = 0, w = 0.16, h = 0.28, face: 'x' | 'z' = 'z') {
    if (face === 'z') {
      this.k.box(w + 0.05, h + 0.04, 0.03, PAL.timber, x, y, z);
      this.k.box(w, h, 0.05, PAL.door, x, y, z);
      this.k.box(0.025, 0.025, 0.03, PAL.brass, x + w * 0.3, y + h * 0.45, z + 0.03);
    } else {
      this.k.box(0.03, h + 0.04, w + 0.05, PAL.timber, x, y, z);
      this.k.box(0.05, h, w, PAL.door, x, y, z);
    }
  }
  plinth(w: number, d: number, color: number = PAL.stone, h = 0.07) {
    this.k.box(w, h, d, color, 0, 0, 0);
  }
  chimney(x: number, y: number, z: number, h = 0.35, color: number = PAL.brick, smoke = true) {
    this.k.box(0.13, h, 0.13, color, x, y, z);
    this.k.box(0.17, 0.05, 0.17, PAL.stoneDark, x, y + h, z);
    if (smoke) this.smoke.push([x, y + h + 0.08, z]);
  }
  /** timber framing lines on a box wall (cottage style) */
  frame(w: number, d: number, y0: number, h: number) {
    const t = 0.035;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) this.k.box(t, h, t, PAL.timber, (sx * w) / 2, y0, (sz * d) / 2);
    this.k.box(w + t, t, t, PAL.timber, 0, y0 + h - t, d / 2);
    this.k.box(w + t, t, t, PAL.timber, 0, y0 + h - t, -d / 2);
    this.k.box(t, t, d + t, PAL.timber, w / 2, y0 + h - t, 0);
    this.k.box(t, t, d + t, PAL.timber, -w / 2, y0 + h - t, 0);
  }
  gear(r: number, teeth: number, thick: number, color: number, axis: 'z' | 'x' | 'y' = 'z') {
    const k = new Kit();
    k.jitter = 0;
    k.cyl(r * 0.82, r * 0.82, thick, color, 0, -thick / 2, 0, 12);
    k.cyl(r * 0.25, r * 0.25, thick * 1.6, PAL.metalDark, 0, -thick * 0.8, 0, 8);
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      k.box(r * 0.28, thick, r * 0.3, color, Math.cos(a) * r * 0.9, -thick / 2, Math.sin(a) * r * 0.9, { ry: -a });
    }
    const g = k.build();
    if (axis === 'z') g.rotateX(Math.PI / 2);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    return g;
  }
  levelDeco(level: number, x: number, z: number) {
    if (level < 2) return;
    const color = level >= 3 ? PAL.gold : PAL.flagBlue;
    this.k.cyl(0.02, 0.025, 1.0, PAL.darkWood, x, 0, z, 6);
    this.k.box(0.3, 0.18, 0.02, color, x + 0.15, 0.75, z);
    this.k.box(0.06, 0.06, 0.06, PAL.brass, x, 1.0, z);
    if (level >= 3) this.k.box(0.12, 0.12, 0.025, PAL.flagRed, x + 0.15, 0.78, z + 0.005);
  }
  done(): Model {
    return {
      base: this.k.build(),
      glow: this.g.parts.length ? this.g.build() : null,
      fire: this.f.parts.length ? this.f.build() : null,
      anims: this.anims,
      smoke: this.smoke,
      height: this.height,
    };
  }
}

// ------------------------------------------------------------------ houses
function cottage(b: Builder, v: number) {
  const roof = v % 2 === 0 ? PAL.thatch : PAL.thatchDark;
  const wall = WALL_VARIANTS[v];
  b.plinth(0.8, 0.8, PAL.stone, 0.05);
  b.k.box(0.56, 0.36, 0.44, wall, 0, 0.05, -0.04);
  b.frame(0.56, 0.44, 0.05, 0.36);
  b.k.slabRoof(0.7, 0.62, 0.32, 0.07, roof, 0, 0.38, -0.04, { fill: wall, fw: 0.56, fd: 0.44 });
  b.door(-0.1, 0.18, 0.05);
  b.win(0.13, 0.2, 0.19, 'z');
  b.win(0.29, 0.2, -0.04, 'x');
  b.chimney(0.17, 0.5, -0.16, 0.32, PAL.stoneDark);
  // little garden
  b.k.sphere(0.09, PAL.leaf, 0.3, 0.1, 0.3);
  b.k.sphere(0.06, PAL.leafLight, 0.2, 0.08, 0.33);
  b.k.box(0.02, 0.1, 0.02, PAL.wood, -0.36, 0.05, 0.36);
  b.k.box(0.3, 0.02, 0.015, PAL.wood, -0.21, 0.12, 0.36);
  b.height = 0.85;
}

function townhouse(b: Builder, v: number) {
  const roof = ROOF_VARIANTS[v];
  const wall = WALL_VARIANTS[(v + 2) % 5];
  b.plinth(0.86, 0.86, PAL.stone, 0.06);
  b.k.box(0.66, 0.34, 0.56, PAL.stoneLight, 0, 0.06, -0.04);
  b.k.box(0.72, 0.36, 0.62, wall, 0, 0.4, -0.04);
  b.frame(0.72, 0.62, 0.4, 0.36);
  // diagonal braces
  b.k.box(0.03, 0.4, 0.03, PAL.timber, -0.2, 0.42, 0.28, { rz: 0.6 });
  b.k.box(0.03, 0.4, 0.03, PAL.timber, 0.2, 0.42, 0.28, { rz: -0.6 });
  b.k.slabRoof(0.82, 0.78, 0.38, 0.07, roof, 0, 0.76, -0.04, { fill: wall, fw: 0.72, fd: 0.62 });
  // dormer
  b.k.box(0.18, 0.16, 0.16, wall, 0.12, 0.84, 0.16);
  b.k.slabRoof(0.22, 0.24, 0.1, 0.04, roof, 0.12, 1.0, 0.16, { ry: Math.PI / 2, fill: wall, fw: 0.16, fd: 0.18 });
  b.g.box(0.1, 0.1, 0.03, PAL.glass, 0.12, 0.87, 0.25);
  b.door(-0.15, 0.25, 0.06, 0.16, 0.26);
  b.win(0.15, 0.17, 0.25, 'z');
  b.win(-0.18, 0.5, 0.27, 'z');
  b.win(0.18, 0.5, 0.27, 'z');
  b.win(0.36, 0.5, -0.04, 'x');
  // flower box
  b.k.box(0.2, 0.05, 0.06, PAL.wood, 0.18, 0.44, 0.31);
  b.k.box(0.18, 0.04, 0.05, PAL.flagRed, 0.18, 0.49, 0.31);
  b.chimney(-0.22, 0.85, -0.2, 0.35);
  b.height = 1.25;
}

function manor(b: Builder, v: number) {
  const roof = [PAL.slate, PAL.roofBlue, PAL.roofTeal, PAL.slate, PAL.roofPlum][v];
  b.plinth(0.92, 0.92, PAL.stoneDark, 0.07);
  b.k.box(0.76, 0.44, 0.62, PAL.stoneLight, 0, 0.07, -0.05);
  b.k.box(0.8, 0.04, 0.66, PAL.stoneDark, 0, 0.5, -0.05);
  b.k.box(0.76, 0.42, 0.62, WALL_VARIANTS[v], 0, 0.54, -0.05);
  b.k.slabRoof(0.86, 0.8, 0.42, 0.08, roof, 0, 0.94, -0.05, { fill: WALL_VARIANTS[v], fw: 0.76, fd: 0.62 });
  // turret
  b.k.cyl(0.15, 0.15, 1.12, PAL.stoneLight, 0.36, 0.07, 0.24, 8);
  b.k.cone(0.2, 0.42, roof, 0.36, 1.18, 0.24, 8);
  b.k.sphere(0.03, PAL.gold, 0.36, 1.62, 0.24);
  b.g.box(0.08, 0.14, 0.03, PAL.glass, 0.36, 0.75, 0.39);
  // balcony
  b.k.box(0.36, 0.04, 0.14, PAL.stoneDark, -0.12, 0.52, 0.3);
  for (let i = 0; i < 5; i++) b.k.box(0.02, 0.12, 0.02, PAL.metalDark, -0.28 + i * 0.08, 0.56, 0.36);
  b.k.box(0.36, 0.02, 0.02, PAL.metalDark, -0.12, 0.68, 0.36);
  b.door(-0.12, 0.27, 0.07, 0.18, 0.3);
  b.win(-0.12, 0.62, 0.27, 'z', 0.15, 0.2);
  b.win(0.16, 0.24, 0.27, 'z');
  b.win(0.39, 0.62, -0.2, 'x');
  b.win(0.39, 0.24, -0.2, 'x');
  b.chimney(-0.28, 1.05, -0.25, 0.3);
  b.k.sphere(0.1, PAL.leafDark, -0.38, 0.12, 0.38);
  b.height = 1.65;
}

// ------------------------------------------------------------------ town buildings
function hall(b: Builder, milestone: number) {
  b.plinth(2.86, 2.86, PAL.stone, 0.1);
  // plaza in front
  b.k.box(2.7, 0.03, 0.95, PAL.cobble, 0, 0.1, 0.9);
  for (let i = 0; i < 18; i++) {
    const x = -1.25 + ((i * 37) % 25) / 10, z = 0.5 + ((i * 53) % 8) / 10;
    b.k.box(0.12, 0.02, 0.1, i % 2 ? PAL.stoneLight : PAL.stoneDark, x, 0.13, z);
  }
  // fountain
  b.k.cyl(0.32, 0.36, 0.14, PAL.stoneLight, 0, 0.13, 0.95, 10);
  b.k.cyl(0.27, 0.27, 0.02, PAL.water, 0, 0.26, 0.95, 10);
  b.k.cyl(0.05, 0.07, 0.32, PAL.stone, 0, 0.26, 0.95, 6);
  b.k.cyl(0.12, 0.08, 0.05, PAL.stone, 0, 0.56, 0.95, 8);
  // main body
  const y0 = 0.1;
  b.k.box(2.3, 0.18, 1.5, PAL.stoneDark, 0, y0, -0.45);
  b.k.box(2.2, 0.62, 1.4, PAL.wallCream, 0, y0 + 0.18, -0.45);
  b.k.box(2.34, 0.06, 1.54, PAL.timber, 0, y0 + 0.8, -0.45);
  b.k.box(2.3, 0.5, 1.5, PAL.wallWhite, 0, y0 + 0.86, -0.45);
  b.frame(2.3, 1.5, y0 + 0.86, 0.5);
  b.k.slabRoof(2.5, 1.8, 0.75, 0.1, PAL.slate, 0, y0 + 1.36, -0.45, { fill: PAL.wallWhite, fw: 2.3, fd: 1.5 });
  // front gable with clock
  b.k.box(0.8, 1.2, 0.2, PAL.wallCream, 0, y0 + 0.18, 0.34);
  b.k.slabRoof(0.95, 0.5, 0.35, 0.08, PAL.slate, 0, y0 + 1.38, 0.34, { ry: Math.PI / 2, fill: PAL.wallCream, fw: 0.2, fd: 0.8 });
  b.k.box(0.36, 0.5, 0.06, PAL.door, 0, y0 + 0.18, 0.44);
  b.k.box(0.44, 0.06, 0.08, PAL.brass, 0, y0 + 0.68, 0.44);
  b.k.box(0.6, 0.05, 0.3, PAL.stoneLight, 0, y0, 0.6);
  b.anims.push({ geom: b.gear(0.2, 10, 0.05, PAL.brass, 'z'), pos: [0, y0 + 1.05, 0.47], axis: 'z', speed: 0.4 });
  for (const x of [-0.75, -0.4, 0.4, 0.75]) {
    b.win(x, y0 + 0.4, 0.27, 'z', 0.16, 0.24);
    b.win(x, y0 + 1.0, 0.27, 'z', 0.14, 0.2);
  }
  b.win(1.11, y0 + 0.4, -0.45, 'x', 0.2, 0.24);
  b.win(-1.11, y0 + 0.4, -0.45, 'x', 0.2, 0.24);
  b.chimney(-0.8, y0 + 1.5, -0.8, 0.4);
  // flag
  b.k.cyl(0.025, 0.03, 0.8, PAL.darkWood, 0.85, y0 + 1.6, -0.45, 6);
  b.k.box(0.36, 0.22, 0.02, PAL.flagRed, 1.03, y0 + 2.1, -0.45);
  b.k.box(0.1, 0.1, 0.025, PAL.gold, 1.03, y0 + 2.16, -0.45);
  b.height = 2.2;
  if (milestone >= 1) {
    // clock tower
    const tx = 0, tz = -0.55, ty = y0 + 1.4;
    b.k.box(0.62, 1.1, 0.62, PAL.stoneLight, tx, ty, tz);
    b.k.box(0.7, 0.08, 0.7, PAL.stoneDark, tx, ty + 1.1, tz);
    b.k.box(0.58, 0.45, 0.58, PAL.wallCream, tx, ty + 1.18, tz);
    for (const [dx, dz, ry] of [[0, 0.3, 0], [0.3, 0, Math.PI / 2], [0, -0.3, Math.PI], [-0.3, 0, -Math.PI / 2]] as const) {
      b.k.cyl(0.17, 0.17, 0.03, PAL.wallWhite, tx + dx, ty + 1.4, tz + dz, 14, { rx: Math.PI / 2, ry });
      b.k.box(0.02, 0.12, 0.02, PAL.darkWood, tx + dx * 1.07, ty + 1.38, tz + dz * 1.07, { ry });
    }
    b.k.pyramid(0.8, 0.8, 0.7, milestone >= 3 ? PAL.gold : PAL.slate, tx, ty + 1.63, tz);
    b.k.cyl(0.02, 0.02, 0.3, PAL.brass, tx, ty + 2.3, tz, 4);
    b.height = 4;
  }
  if (milestone >= 2) {
    for (const [x, z] of [[-1.3, 1.3], [1.3, 1.3], [-1.3, 0.45], [1.3, 0.45]]) {
      b.k.cyl(0.025, 0.035, 0.6, PAL.metalDark, x, 0.1, z, 6);
      b.g.box(0.09, 0.11, 0.09, PAL.gold, x, 0.7, z);
      b.k.pyramid(0.13, 0.13, 0.06, PAL.metalDark, x, 0.81, z);
    }
    // banners
    b.k.box(0.18, 0.4, 0.02, PAL.flagBlue, -0.75, y0 + 0.86, 0.3);
    b.k.box(0.18, 0.4, 0.02, PAL.flagBlue, 0.75, y0 + 0.86, 0.3);
    b.k.box(0.08, 0.08, 0.025, PAL.gold, -0.75, y0 + 1.12, 0.31);
    b.k.box(0.08, 0.08, 0.025, PAL.gold, 0.75, y0 + 1.12, 0.31);
  }
  if (milestone >= 3) {
    b.k.sphere(0.07, PAL.gold, 0, 0.62, 0.95, 1);
    b.k.box(2.4, 0.05, 1.6, PAL.gold, 0, y0 + 1.36, -0.45);
  }
}

function market(b: Builder) {
  b.plinth(1.9, 1.9, PAL.cobble, 0.05);
  for (let i = 0; i < 30; i++) {
    const x = -0.85 + ((i * 37) % 17) / 10, z = -0.85 + ((i * 53) % 17) / 10;
    b.k.box(0.1, 0.02, 0.09, i % 3 ? PAL.stoneLight : PAL.stoneDark, x, 0.05, z);
  }
  const stall = (x: number, z: number, ry: number, c: number, goods: number[]) => {
    const s = new Kit();
    s.box(0.62, 0.22, 0.32, PAL.wood, 0, 0.05, 0);
    s.box(0.66, 0.03, 0.36, PAL.lightWood, 0, 0.27, 0);
    for (const px of [-0.3, 0.3]) for (const pz of [-0.16, 0.16]) s.box(0.03, pz < 0 ? 0.62 : 0.52, 0.03, PAL.darkWood, px, 0.05, pz);
    for (let i = 0; i < 5; i++) s.box(0.14, 0.03, 0.46, i % 2 ? PAL.awningB : c, -0.28 + i * 0.14, 0.6, 0.02, { rx: -0.3 });
    goods.forEach((g, i) => s.box(0.12, 0.08, 0.12, g, -0.2 + i * 0.2, 0.3, 0));
    b.k.merge(s, x, 0, z, ry);
  };
  stall(-0.45, -0.45, 0, PAL.awningA, [PAL.wheat, PAL.flagRed, PAL.leafLight]);
  stall(0.48, -0.45, 0, PAL.awningC, [PAL.lightWood, PAL.stoneLight, PAL.wheat]);
  stall(-0.5, 0.45, Math.PI / 2, PAL.awningC, [PAL.brick, PAL.wheat, PAL.cloth]);
  // barrels & crates
  b.k.cyl(0.09, 0.08, 0.2, PAL.wood, 0.4, 0.05, 0.45, 8);
  b.k.cyl(0.09, 0.08, 0.2, PAL.wood, 0.58, 0.05, 0.6, 8);
  b.k.box(0.16, 0.14, 0.16, PAL.lightWood, 0.3, 0.05, 0.75);
  // central sign post
  b.k.cyl(0.03, 0.03, 0.9, PAL.darkWood, 0.1, 0.05, 0.25, 6);
  b.k.box(0.32, 0.18, 0.04, PAL.wallCream, 0.1, 0.8, 0.25);
  b.k.box(0.12, 0.1, 0.05, PAL.awningA, 0.1, 0.84, 0.25);
  b.height = 1;
}

function warehouse(b: Builder) {
  b.plinth(1.9, 1.9, PAL.stone, 0.08);
  b.k.box(1.6, 0.85, 1.3, PAL.brick, 0, 0.08, -0.15);
  for (let i = 0; i < 6; i++) b.k.box(0.03, 0.85, 0.02, PAL.brickDark, -0.75 + i * 0.3, 0.08, 0.51);
  b.k.slabRoof(1.75, 1.5, 0.55, 0.09, PAL.slate, 0, 0.93, -0.15, { fill: PAL.brick, fw: 1.6, fd: 1.3 });
  b.k.box(0.6, 0.6, 0.05, PAL.wood, 0, 0.08, 0.52);
  b.k.box(0.6, 0.04, 0.06, PAL.darkWood, 0, 0.4, 0.54, { rz: 0.78 });
  b.k.box(0.6, 0.04, 0.06, PAL.darkWood, 0, 0.4, 0.54, { rz: -0.78 });
  b.k.box(0.7, 0.05, 0.08, PAL.darkWood, 0, 0.68, 0.54);
  b.win(-0.55, 0.55, 0.51, 'z');
  b.win(0.55, 0.55, 0.51, 'z');
  b.g.box(0.18, 0.18, 0.03, PAL.glass, 0, 1.12, 0.52);
  // crates & sacks
  b.k.box(0.22, 0.2, 0.22, PAL.lightWood, -0.6, 0.08, 0.72);
  b.k.box(0.18, 0.16, 0.18, PAL.plankWood, -0.38, 0.08, 0.76);
  b.k.box(0.17, 0.15, 0.17, PAL.lightWood, -0.58, 0.28, 0.72, { ry: 0.3 });
  b.k.sphere(0.1, PAL.cloth, 0.6, 0.15, 0.74, 0, { sy: 0.8 });
  b.k.cyl(0.08, 0.08, 0.22, PAL.wood, 0.8, 0.08, 0.5, 8);
  b.height = 1.6;
}

function trade(b: Builder, level: number) {
  b.plinth(1.9, 1.9, PAL.stone, 0.06);
  b.k.box(1.2, 0.62, 0.9, PAL.wallOchre, -0.2, 0.06, -0.35);
  b.frame(1.2, 0.9, 0.06, 0.62);
  b.k.slabRoof(1.35, 1.1, 0.45, 0.08, PAL.roofTeal, -0.2, 0.68, -0.35, { fill: PAL.wallOchre, fw: 1.2, fd: 0.9 });
  b.door(-0.2, 0.11, 0.06, 0.2, 0.32);
  b.win(-0.55, 0.32, 0.1, 'z');
  b.win(0.15, 0.32, 0.1, 'z');
  // awning porch
  for (let i = 0; i < 6; i++) b.k.box(0.2, 0.03, 0.4, i % 2 ? PAL.awningB : PAL.awningC, -0.7 + i * 0.2, 0.62, 0.32, { rx: -0.35 });
  b.k.box(0.03, 0.6, 0.03, PAL.darkWood, -0.78, 0.06, 0.5);
  b.k.box(0.03, 0.6, 0.03, PAL.darkWood, 0.38, 0.06, 0.5);
  // coin sign
  b.k.cyl(0.025, 0.03, 1.2, PAL.darkWood, 0.7, 0.06, 0.2, 6);
  b.k.box(0.3, 0.025, 0.025, PAL.darkWood, 0.82, 1.15, 0.2);
  b.k.cyl(0.13, 0.13, 0.04, PAL.gold, 0.9, 0.98, 0.2, 12, { rx: Math.PI / 2 });
  // goods
  b.k.box(0.22, 0.2, 0.22, PAL.lightWood, 0.55, 0.06, 0.7);
  b.k.box(0.2, 0.18, 0.2, PAL.plankWood, 0.75, 0.06, 0.65, { ry: 0.4 });
  b.k.cyl(0.09, 0.09, 0.22, PAL.wood, 0.75, 0.06, -0.6, 8);
  b.k.cyl(0.09, 0.09, 0.22, PAL.wood, 0.55, 0.06, -0.7, 8);
  // cart
  b.k.box(0.42, 0.12, 0.26, PAL.wood, -0.6, 0.16, 0.75);
  b.k.cyl(0.08, 0.08, 0.03, PAL.darkWood, -0.6, 0.16, 0.9, 8, { rx: Math.PI / 2 });
  b.k.cyl(0.08, 0.08, 0.03, PAL.darkWood, -0.6, 0.16, 0.6, 8, { rx: Math.PI / 2 });
  b.k.box(0.1, 0.1, 0.1, PAL.wheat, -0.65, 0.28, 0.75);
  b.levelDeco(level, -0.85, -0.85);
  b.height = 1.3;
}

// ------------------------------------------------------------------ resource buildings
function lumber(b: Builder, level: number) {
  b.plinth(1.9, 1.9, PAL.soil, 0.04);
  // log cabin
  const cx = -0.3, cz = -0.3;
  for (let i = 0; i < 5; i++) {
    b.k.cyl(0.055, 0.055, 1.0, i % 2 ? PAL.wood : PAL.trunk, cx, 0.09 + i * 0.1, cz + 0.36, 6, { rz: Math.PI / 2 });
    b.k.cyl(0.055, 0.055, 1.0, i % 2 ? PAL.trunk : PAL.wood, cx, 0.09 + i * 0.1, cz - 0.36, 6, { rz: Math.PI / 2 });
    b.k.cyl(0.055, 0.055, 0.8, i % 2 ? PAL.trunk : PAL.wood, cx + 0.44, 0.09 + i * 0.1, cz, 6, { rx: Math.PI / 2 });
    b.k.cyl(0.055, 0.055, 0.8, i % 2 ? PAL.wood : PAL.trunk, cx - 0.44, 0.09 + i * 0.1, cz, 6, { rx: Math.PI / 2 });
  }
  b.k.box(0.82, 0.48, 0.66, PAL.lightWood, cx, 0.04, cz);
  b.k.slabRoof(1.15, 1.0, 0.4, 0.07, PAL.roofRed, cx, 0.55, cz, { fill: PAL.wood, fw: 0.9, fd: 0.74 });
  b.door(cx - 0.1, cz + 0.42, 0.04, 0.16, 0.3);
  b.win(cx + 0.22, 0.28, cz + 0.42, 'z');
  b.chimney(cx + 0.3, 0.6, cz - 0.2, 0.3, PAL.stoneDark);
  // log pile
  for (let r = 0; r < 3; r++)
    for (let i = 0; i < 4 - r; i++)
      b.k.cyl(0.07, 0.07, 0.7, i % 2 ? PAL.trunk : PAL.wood, 0.55, 0.11 + r * 0.12, -0.55 + i * 0.15 + r * 0.075, 7, { rz: Math.PI / 2 });
  // chopping block with axe
  b.k.cyl(0.12, 0.13, 0.16, PAL.wood, 0.45, 0.04, 0.5, 8);
  b.k.cyl(0.11, 0.11, 0.01, PAL.plankWood, 0.45, 0.2, 0.5, 8);
  b.k.box(0.03, 0.3, 0.03, PAL.lightWood, 0.47, 0.22, 0.5, { rz: -0.4 });
  b.k.box(0.1, 0.06, 0.02, PAL.metal, 0.43, 0.22, 0.5);
  // stumps
  b.k.cyl(0.08, 0.1, 0.08, PAL.trunk, -0.6, 0.04, 0.6, 7);
  b.k.cyl(0.07, 0.09, 0.07, PAL.trunk, 0.0, 0.04, 0.72, 7);
  // grindstone (animated)
  const gs = new Kit();
  gs.cyl(0.14, 0.14, 0.06, PAL.stoneLight, 0, -0.03, 0, 10);
  const g = gs.build();
  g.rotateX(Math.PI / 2);
  b.k.box(0.04, 0.2, 0.04, PAL.darkWood, -0.05, 0.04, 0.3 - 0.06);
  b.k.box(0.04, 0.2, 0.04, PAL.darkWood, -0.05, 0.04, 0.3 + 0.06);
  b.anims.push({ geom: g, pos: [-0.05, 0.24, 0.3], axis: 'z', speed: 4 });
  b.levelDeco(level, 0.85, 0.85);
  b.height = 1.2;
}

/** Wheat stalk rows used as the farm's growing crop */
function cropGeom(w: number, d: number): THREE.BufferGeometry {
  const k = new Kit();
  k.jitter = 0.12;
  for (let r = 0; r < 6; r++) {
    for (let i = 0; i < 9; i++) {
      const x = -w / 2 + 0.08 + (i / 8) * (w - 0.16);
      const z = -d / 2 + 0.1 + (r / 5) * (d - 0.2);
      k.cone(0.045, 0.3, (r + i) % 3 ? PAL.wheat : 0xd9ad3c, x + ((r * 7 + i * 3) % 5) * 0.01, 0, z, 4);
    }
  }
  return k.build();
}

function farm(b: Builder, level: number) {
  b.plinth(2.9, 2.9, PAL.soilDark, 0.03);
  // soil rows
  const fw = 2.6, fd = 1.65;
  for (let r = 0; r < 6; r++)
    b.k.box(fw, 0.06, 0.18, r % 2 ? PAL.soil : PAL.soilDark, 0, 0.03, 0.42 - fd / 2 + 0.1 + (r / 5) * (fd - 0.2));
  b.anims.push({ geom: cropGeom(fw, fd), pos: [0, 0.09, 0.42], axis: 'y', speed: 0, kind: 'crop' });
  // barn
  const bx = -0.7, bz = -0.85;
  b.k.box(1.1, 0.6, 0.85, PAL.brick, bx, 0.03, bz);
  b.k.box(1.12, 0.05, 0.87, PAL.wallWhite, bx, 0.33, bz);
  b.k.slabRoof(1.2, 1.05, 0.48, 0.07, PAL.slate, bx, 0.62, bz, { ry: Math.PI / 2, fill: PAL.brick, fw: 0.85, fd: 1.1 });
  b.k.box(0.36, 0.42, 0.04, PAL.wallWhite, bx, 0.03, bz + 0.44);
  b.k.box(0.3, 0.36, 0.05, PAL.brickDark, bx, 0.03, bz + 0.45);
  b.k.box(0.36, 0.03, 0.06, PAL.wallWhite, bx, 0.2, bz + 0.46, { rz: 0.85 });
  b.k.box(0.36, 0.03, 0.06, PAL.wallWhite, bx, 0.2, bz + 0.46, { rz: -0.85 });
  b.g.box(0.14, 0.14, 0.03, PAL.glass, bx, 0.75, bz + 0.44);
  // silo
  b.k.cyl(0.24, 0.24, 1.15, PAL.stoneLight, 0.25, 0.03, -0.95, 10);
  b.k.cyl(0.26, 0.26, 0.04, PAL.metal, 0.25, 0.6, -0.95, 10);
  b.k.sphere(0.25, PAL.metal, 0.25, 1.18, -0.95, 1, { sy: 0.6 });
  // hay bales
  b.k.cyl(0.13, 0.13, 0.2, PAL.thatch, 0.75, 0.16, -0.75, 8, { rz: Math.PI / 2 });
  b.k.cyl(0.13, 0.13, 0.2, PAL.thatch, 0.95, 0.16, -0.95, 8, { rx: Math.PI / 2 });
  // fence
  for (let i = 0; i < 12; i++) b.k.box(0.03, 0.16, 0.03, PAL.wood, -1.38 + i * 0.25, 0.03, 1.38);
  b.k.box(2.8, 0.025, 0.02, PAL.lightWood, 0, 0.14, 1.38);
  for (let i = 0; i < 7; i++) b.k.box(0.03, 0.16, 0.03, PAL.wood, 1.38, 0.03, 1.38 - i * 0.25);
  b.k.box(0.02, 0.025, 1.5, PAL.lightWood, 1.38, 0.14, 0.63);
  // scarecrow
  b.k.box(0.03, 0.42, 0.03, PAL.wood, 1.0, 0.09, 0.0);
  b.k.box(0.3, 0.03, 0.03, PAL.wood, 1.0, 0.38, 0.0);
  b.k.box(0.12, 0.16, 0.08, PAL.flagBlue, 1.0, 0.27, 0.0);
  b.k.sphere(0.06, PAL.thatch, 1.0, 0.5, 0.0);
  b.k.cone(0.09, 0.08, PAL.thatchDark, 1.0, 0.53, 0.0, 6);
  b.levelDeco(level, 1.3, -1.3);
  b.height = 1.4;
}

function quarry(b: Builder, level: number) {
  b.plinth(1.9, 1.9, PAL.stoneDark, 0.04);
  // stepped cut terraces
  b.k.box(1.5, 0.35, 0.6, PAL.stone, -0.1, 0.04, -0.55);
  b.k.box(1.5, 0.2, 0.45, PAL.stoneLight, -0.1, 0.04, -0.05);
  b.k.box(0.6, 0.55, 0.55, PAL.stone, -0.55, 0.04, -0.6);
  b.k.box(0.3, 0.12, 0.3, PAL.stoneLight, -0.5, 0.59, -0.65, { ry: 0.3 });
  // cut blocks
  for (let i = 0; i < 4; i++) b.k.box(0.2, 0.16, 0.2, i % 2 ? PAL.stoneLight : PAL.stone, 0.3 + (i % 2) * 0.24, 0.04 + Math.floor(i / 2) * 0.16, 0.55);
  b.k.box(0.2, 0.16, 0.2, PAL.stoneLight, 0.75, 0.04, 0.3, { ry: 0.2 });
  // crane
  b.k.box(0.08, 1.1, 0.08, PAL.wood, 0.55, 0.04, -0.25);
  b.k.box(0.22, 0.06, 0.22, PAL.darkWood, 0.55, 0.04, -0.25);
  const arm = new Kit();
  arm.box(0.9, 0.06, 0.06, PAL.lightWood, -0.3, 0, 0);
  arm.box(0.015, 0.4, 0.015, PAL.metalDark, -0.7, -0.4, 0);
  arm.box(0.16, 0.12, 0.16, PAL.stoneLight, -0.7, -0.52, 0);
  arm.box(0.03, 0.4, 0.03, PAL.wood, -0.05, -0.32, 0, { rz: -0.6 });
  b.anims.push({ geom: arm.build(), pos: [0.55, 1.1, -0.25], axis: 'y', speed: 0.5, kind: 'swing' });
  // tools
  b.k.box(0.03, 0.32, 0.03, PAL.lightWood, -0.8, 0.04, 0.5, { rz: 0.4 });
  b.k.box(0.12, 0.03, 0.04, PAL.metal, -0.86, 0.33, 0.5);
  b.k.box(0.3, 0.12, 0.2, PAL.wood, -0.4, 0.04, 0.7);
  b.k.box(0.26, 0.06, 0.16, PAL.stoneLight, -0.4, 0.16, 0.7);
  b.levelDeco(level, 0.85, 0.85);
  b.height = 1.3;
}

function mine(b: Builder, level: number) {
  b.plinth(1.9, 1.9, PAL.stoneDark, 0.04);
  // rocky mound
  b.k.dodeca(0.55, PAL.stoneDark, -0.35, 0.3, -0.45, { sy: 0.85 });
  b.k.dodeca(0.4, PAL.stone, 0.25, 0.25, -0.6, { sy: 0.8 });
  b.k.dodeca(0.3, PAL.stoneDark, -0.75, 0.2, 0.0);
  // ore glints
  for (const [x, y, z] of [[-0.1, 0.55, -0.2], [0.35, 0.45, -0.35], [-0.65, 0.4, 0.15], [-0.5, 0.7, -0.4]])
    b.f.box(0.06, 0.06, 0.06, 0xd8743a, x, y, z, { ry: x * 3 });
  // tunnel entrance
  b.k.box(0.5, 0.48, 0.12, 0x2a2420, -0.3, 0.04, 0.02);
  b.k.box(0.08, 0.52, 0.1, PAL.wood, -0.58, 0.04, 0.06);
  b.k.box(0.08, 0.52, 0.1, PAL.wood, -0.02, 0.04, 0.06);
  b.k.box(0.66, 0.08, 0.12, PAL.wood, -0.3, 0.54, 0.06);
  // rails
  for (let i = 0; i < 6; i++) b.k.box(0.32, 0.025, 0.05, PAL.darkWood, -0.3, 0.04, 0.15 + i * 0.13);
  b.k.box(0.025, 0.03, 0.75, PAL.metal, -0.4, 0.065, 0.45);
  b.k.box(0.025, 0.03, 0.75, PAL.metal, -0.2, 0.065, 0.45);
  // cart with ore
  b.k.box(0.3, 0.14, 0.36, PAL.metalDark, -0.3, 0.1, 0.55);
  b.k.dodeca(0.1, 0x6a4a3a, -0.33, 0.27, 0.5);
  b.k.dodeca(0.09, 0x7a4a32, -0.25, 0.27, 0.6);
  // headframe tower with wheel
  b.k.box(0.06, 1.15, 0.06, PAL.wood, 0.45, 0.04, 0.15, { rz: 0.12 });
  b.k.box(0.06, 1.15, 0.06, PAL.wood, 0.75, 0.04, 0.15, { rz: -0.12 });
  b.k.box(0.4, 0.05, 0.06, PAL.darkWood, 0.6, 0.6, 0.15);
  b.k.box(0.4, 0.06, 0.08, PAL.darkWood, 0.6, 1.14, 0.15);
  const wheel = new Kit();
  wheel.torus(0.2, 0.025, PAL.metalDark, 0, 0, 0);
  for (let i = 0; i < 4; i++) wheel.box(0.4, 0.02, 0.02, PAL.metal, 0, -0.01, 0, { rz: (i * Math.PI) / 4 });
  b.anims.push({ geom: wheel.build(), pos: [0.6, 1.32, 0.15], axis: 'z', speed: 2.2 });
  // ore pile
  b.k.dodeca(0.16, 0x6b4636, 0.55, 0.1, 0.65);
  b.k.dodeca(0.12, 0x7f4f35, 0.75, 0.08, 0.55);
  b.k.dodeca(0.1, 0x5e3d30, 0.65, 0.2, 0.6);
  b.g.box(0.06, 0.08, 0.06, PAL.gold, -0.3, 0.45, 0.1);
  b.levelDeco(level, -0.85, 0.85);
  b.height = 1.5;
}

// ------------------------------------------------------------------ industry
function sawmill(b: Builder, level: number) {
  b.plinth(1.9, 1.9, PAL.stone, 0.05);
  // main shed (enclosed half)
  b.k.box(0.85, 0.7, 1.4, PAL.lightWood, -0.45, 0.05, -0.1);
  for (let i = 0; i < 7; i++) b.k.box(0.86, 0.02, 0.02, PAL.wood, -0.45, 0.12 + i * 0.1, 0.61);
  b.k.slabRoof(1.0, 1.6, 0.45, 0.07, PAL.roofRed, -0.45, 0.75, -0.1, { ry: Math.PI / 2, fill: PAL.lightWood, fw: 1.4, fd: 0.85 });
  b.win(-0.45, 0.4, 0.61, 'z', 0.2, 0.2);
  // open saw floor
  b.k.box(0.85, 0.05, 1.3, PAL.plankWood, 0.42, 0.05, -0.1);
  for (const [x, z] of [[0.05, -0.7], [0.82, -0.7], [0.05, 0.5], [0.82, 0.5]]) b.k.box(0.06, 0.75, 0.06, PAL.darkWood, x, 0.05, z);
  b.k.box(0.95, 0.06, 1.4, PAL.darkWood, 0.42, 0.8, -0.1);
  b.k.slabRoof(0.98, 1.45, 0.2, 0.05, PAL.roofRed, 0.42, 0.84, -0.1, { ry: Math.PI / 2 });
  // saw bench with log
  b.k.box(0.3, 0.25, 1.0, PAL.wood, 0.42, 0.1, -0.1);
  b.k.cyl(0.08, 0.08, 0.55, PAL.trunk, 0.42, 0.42, -0.45, 7, { rx: Math.PI / 2 });
  const blade = new Kit();
  blade.jitter = 0;
  blade.cyl(0.22, 0.22, 0.02, 0xd9dde0, 0, -0.01, 0, 14);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    blade.box(0.05, 0.02, 0.05, 0xb8bec4, Math.cos(a) * 0.23, -0.01, Math.sin(a) * 0.23, { ry: -a + 0.6 });
  }
  blade.cyl(0.04, 0.04, 0.05, PAL.brass, 0, -0.025, 0, 6);
  const bg = blade.build();
  bg.rotateZ(Math.PI / 2);
  b.anims.push({ geom: bg, pos: [0.42, 0.42, 0.0], axis: 'x', speed: 14 });
  // plank stacks
  for (let i = 0; i < 4; i++) b.k.box(0.5, 0.04, 0.12, i % 2 ? PAL.plankWood : PAL.lightWood, 0.45, 0.05 + i * 0.045, 0.75);
  for (let i = 0; i < 3; i++) b.k.box(0.5, 0.04, 0.12, PAL.plankWood, -0.2, 0.05 + i * 0.045, 0.8);
  // steam engine chimney
  b.chimney(-0.75, 0.7, -0.55, 0.55, PAL.metalDark);
  b.levelDeco(level, 0.85, -0.85);
  b.height = 1.4;
}

function windmill(b: Builder, level: number) {
  b.plinth(1.9, 1.9, PAL.stone, 0.06);
  // shed
  b.k.box(0.7, 0.42, 0.6, PAL.wallCream, 0.45, 0.06, 0.4);
  b.frame(0.7, 0.6, 0.06, 0.42);
  b.k.slabRoof(0.8, 0.75, 0.3, 0.06, PAL.roofOrange, 0.45, 0.48, 0.4, { fill: PAL.wallCream, fw: 0.7, fd: 0.6 });
  b.door(0.45, 0.71, 0.06, 0.14, 0.24);
  // tower
  b.k.cyl(0.42, 0.6, 1.6, PAL.wallWhite, -0.25, 0.06, -0.2, 8);
  b.k.cyl(0.62, 0.62, 0.08, PAL.stoneDark, -0.25, 0.06, -0.2, 8);
  b.k.cyl(0.47, 0.47, 0.06, PAL.timber, -0.25, 0.8, -0.2, 8);
  b.k.cone(0.5, 0.55, PAL.roofRed, -0.25, 1.66, -0.2, 8);
  b.k.sphere(0.05, PAL.brass, -0.25, 2.24, -0.2);
  b.door(-0.25, 0.37, 0.06, 0.18, 0.32);
  b.win(-0.25, 1.05, 0.29, 'z', 0.13, 0.17);
  b.win(-0.25, 0.55, 0.37, 'z', 0.12, 0.14);
  // balcony ring
  b.k.cyl(0.6, 0.6, 0.04, PAL.wood, -0.25, 0.86, -0.2, 8);
  // sails
  const sails = new Kit();
  sails.cyl(0.07, 0.07, 0.16, PAL.darkWood, 0, -0.08, 0, 6, { rx: Math.PI / 2 });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + 0.3;
    const s = new Kit();
    s.box(0.05, 1.05, 0.04, PAL.darkWood, 0, 0.02, 0);
    s.box(0.26, 0.82, 0.015, PAL.cloth, 0.16, 0.22, 0.01);
    for (let j = 0; j < 4; j++) s.box(0.3, 0.02, 0.025, PAL.wood, 0.14, 0.25 + j * 0.2, 0.0);
    for (const p of s.parts) {
      p.rotateZ(a);
      sails.parts.push(p);
    }
  }
  b.anims.push({ geom: sails.build(), pos: [-0.25, 1.52, 0.27], axis: 'z', speed: 1.4 });
  // sacks
  b.k.sphere(0.1, PAL.cloth, 0.8, 0.15, 0.85, 0, { sy: 0.8 });
  b.k.sphere(0.09, PAL.cloth, 0.62, 0.14, 0.88, 0, { sy: 0.8 });
  b.levelDeco(level, 0.85, -0.85);
  b.height = 2.6;
}

function bakery(b: Builder, level: number) {
  b.plinth(1.9, 1.9, PAL.stone, 0.06);
  b.k.box(1.25, 0.62, 0.9, PAL.wallPink, -0.2, 0.06, -0.3);
  b.k.box(1.27, 0.18, 0.92, PAL.brick, -0.2, 0.06, -0.3);
  b.frame(1.25, 0.9, 0.06, 0.62);
  b.k.slabRoof(1.4, 1.1, 0.45, 0.08, PAL.roofRed, -0.2, 0.68, -0.3, { fill: PAL.wallPink, fw: 1.25, fd: 0.9 });
  b.door(-0.45, 0.16, 0.06, 0.18, 0.3);
  b.win(-0.05, 0.36, 0.16, 'z', 0.22, 0.2);
  b.win(0.25, 0.36, 0.16, 'z', 0.14, 0.2);
  // striped awning
  for (let i = 0; i < 5; i++) b.k.box(0.12, 0.025, 0.28, i % 2 ? PAL.awningB : PAL.awningA, -0.12 + i * 0.12, 0.6, 0.27, { rx: -0.4 });
  // bread sign
  b.k.box(0.025, 0.025, 0.25, PAL.metalDark, -0.75, 0.6, 0.25);
  b.k.sphere(0.1, 0xc98a45, -0.75, 0.5, 0.35, 0, { sx: 1.4, sy: 0.7 });
  // round oven
  b.k.cyl(0.36, 0.38, 0.12, PAL.stoneDark, 0.55, 0.06, 0.45, 10);
  b.k.sphere(0.34, PAL.brick, 0.55, 0.18, 0.45, 1, { sy: 0.85 });
  b.k.box(0.2, 0.2, 0.1, 0x2a1d17, 0.55, 0.15, 0.75);
  b.f.box(0.14, 0.1, 0.04, PAL.fire, 0.55, 0.16, 0.8);
  b.chimney(0.55, 0.45, 0.35, 0.4, PAL.brickDark);
  b.chimney(-0.6, 0.95, -0.5, 0.3);
  // flour sacks & wood
  b.k.sphere(0.1, PAL.cloth, 0.7, 0.14, -0.5, 0, { sy: 0.85 });
  for (let i = 0; i < 3; i++) b.k.cyl(0.05, 0.05, 0.35, PAL.trunk, 0.25 + i * 0.1, 0.11, -0.7, 6, { rx: Math.PI / 2 });
  b.levelDeco(level, 0.85, -0.85);
  b.height = 1.4;
}

function smelter(b: Builder, level: number) {
  b.plinth(1.9, 1.9, PAL.stoneDark, 0.06);
  // furnace (tapered stone)
  b.k.cyl(0.42, 0.62, 1.0, PAL.stone, -0.25, 0.06, -0.15, 8);
  b.k.cyl(0.46, 0.46, 0.1, PAL.stoneDark, -0.25, 1.06, -0.15, 8);
  for (let i = 0; i < 3; i++) b.k.cyl(0.6 - i * 0.06, 0.62 - i * 0.06, 0.04, PAL.metalDark, -0.25, 0.25 + i * 0.3, -0.15, 8);
  b.k.box(0.36, 0.3, 0.2, 0x2a1d17, -0.25, 0.1, 0.38);
  b.f.box(0.28, 0.22, 0.05, PAL.fire, -0.25, 0.12, 0.47);
  b.f.box(0.2, 0.06, 0.05, 0xffd060, -0.25, 0.14, 0.49);
  // tall chimney
  b.k.box(0.28, 1.7, 0.28, PAL.brick, 0.55, 0.06, -0.6);
  for (let i = 0; i < 4; i++) b.k.box(0.3, 0.04, 0.3, PAL.brickDark, 0.55, 0.4 + i * 0.4, -0.6);
  b.k.box(0.34, 0.08, 0.34, PAL.stoneDark, 0.55, 1.76, -0.6);
  b.smoke.push([0.55, 1.9, -0.6]);
  b.smoke.push([-0.25, 1.2, -0.15]);
  // bellows shed
  b.k.box(0.6, 0.45, 0.55, PAL.wood, 0.5, 0.06, 0.3);
  b.k.slabRoof(0.7, 0.7, 0.25, 0.05, PAL.metal, 0.5, 0.51, 0.3, { fill: PAL.wood, fw: 0.6, fd: 0.55 });
  b.win(0.5, 0.25, 0.58, 'z');
  // ore pile & ingots
  b.k.dodeca(0.15, 0x6b4636, -0.75, 0.1, 0.6);
  b.k.dodeca(0.11, 0x7f4f35, -0.6, 0.08, 0.75);
  for (let i = 0; i < 3; i++) b.k.box(0.18, 0.06, 0.08, 0x8d99a3, 0.3 + i * 0.03, 0.06 + i * 0.06, 0.78, { ry: i * 0.5 });
  b.levelDeco(level, -0.85, -0.85);
  b.height = 1.9;
}

function workshop(b: Builder, level: number) {
  b.plinth(1.9, 1.9, PAL.stone, 0.06);
  b.k.box(1.35, 0.4, 1.0, PAL.stoneLight, -0.1, 0.06, -0.3);
  b.k.box(1.4, 0.45, 1.05, PAL.wallOchre, -0.1, 0.46, -0.3);
  b.frame(1.4, 1.05, 0.46, 0.45);
  b.k.slabRoof(1.55, 1.25, 0.5, 0.08, PAL.roofBlue, -0.1, 0.91, -0.3, { fill: PAL.wallOchre, fw: 1.4, fd: 1.05 });
  b.door(-0.4, 0.21, 0.06, 0.24, 0.34);
  b.win(0.1, 0.3, 0.21, 'z', 0.18, 0.18);
  b.win(-0.45, 0.68, 0.23, 'z');
  b.win(0.25, 0.68, 0.23, 'z');
  // big gear on gable wall
  b.anims.push({ geom: b.gear(0.32, 12, 0.06, PAL.brass, 'x'), pos: [0.63, 0.65, -0.3], axis: 'x', speed: 1.2 });
  b.anims.push({ geom: b.gear(0.18, 8, 0.06, PAL.metal, 'x'), pos: [0.63, 0.97, 0.0], axis: 'x', speed: -2.1 });
  // anvil
  b.k.box(0.12, 0.14, 0.12, PAL.wood, 0.45, 0.06, 0.55);
  b.k.box(0.26, 0.08, 0.12, PAL.metalDark, 0.45, 0.2, 0.55);
  b.k.cone(0.06, 0.12, PAL.metalDark, 0.6, 0.24, 0.55, 4, { rz: -Math.PI / 2 });
  // tool rack
  b.k.box(0.5, 0.35, 0.04, PAL.wood, -0.45, 0.06, 0.68);
  b.k.box(0.03, 0.22, 0.03, PAL.lightWood, -0.6, 0.12, 0.71);
  b.k.box(0.1, 0.05, 0.04, PAL.metal, -0.6, 0.33, 0.71);
  b.k.box(0.03, 0.22, 0.03, PAL.lightWood, -0.45, 0.12, 0.71);
  b.k.box(0.08, 0.08, 0.04, PAL.metal, -0.45, 0.32, 0.71);
  b.k.box(0.03, 0.22, 0.03, PAL.lightWood, -0.3, 0.12, 0.71);
  b.chimney(-0.55, 1.0, -0.55, 0.4);
  b.levelDeco(level, 0.85, 0.85);
  b.height = 1.5;
}

function splitter(b: Builder) {
  b.k.box(0.8, 0.16, 0.8, PAL.metalDark, 0, 0, 0);
  b.k.box(0.84, 0.04, 0.84, PAL.brass, 0, 0.16, 0);
  const top = new Kit();
  top.cyl(0.3, 0.3, 0.06, PAL.metal, 0, 0, 0, 12);
  for (let i = 0; i < 3; i++) top.box(0.24, 0.03, 0.06, PAL.gold, 0.12, 0.06, 0, { ry: (i * Math.PI * 2) / 3 });
  b.anims.push({ geom: top.build(), pos: [0, 0.2, 0], axis: 'y', speed: 3 });
  for (let i = 0; i < 4; i++) b.k.box(0.06, 0.06, 0.06, PAL.brass, Math.cos((i * Math.PI) / 2) * 0.34, 0.2, Math.sin((i * Math.PI) / 2) * 0.34);
  b.height = 0.4;
}

// ------------------------------------------------------------------ public
const cache = new Map<string, Model>();

export function getModel(type: BuildingId, level = 1, variant = 0, tier = 0, milestone = 0): Model {
  const key = `${type}:${level}:${variant}:${tier}:${milestone}`;
  let m = cache.get(key);
  if (m) return m;
  const b = new Builder();
  switch (type) {
    case 'hall': hall(b, milestone); break;
    case 'house': (tier === 0 ? cottage : tier === 1 ? townhouse : manor)(b, variant); break;
    case 'market': market(b); break;
    case 'warehouse': warehouse(b); break;
    case 'trade': trade(b, level); break;
    case 'lumber': lumber(b, level); break;
    case 'farm': farm(b, level); break;
    case 'quarry': quarry(b, level); break;
    case 'mine': mine(b, level); break;
    case 'sawmill': sawmill(b, level); break;
    case 'mill': windmill(b, level); break;
    case 'bakery': bakery(b, level); break;
    case 'smelter': smelter(b, level); break;
    case 'workshop': workshop(b, level); break;
    case 'splitter': splitter(b); break;
    default: break;
  }
  m = b.done();
  cache.set(key, m);
  return m;
}
