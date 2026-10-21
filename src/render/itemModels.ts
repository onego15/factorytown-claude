// Small models for the goods that travel on belts (about 0.22 units long, base at y=0, facing +x).

import * as THREE from 'three';
import { ItemId } from '../sim/data';
import { Kit } from './kit';
import { PAL } from './palette';

export const ITEM_COLORS: Record<ItemId, number> = {
  log: 0x8a5a36,
  plank: 0xdcae6c,
  wheat: 0xe8c14a,
  flour: 0xf1ebdc,
  bread: 0xc98a45,
  stone: 0xc4beb2,
  ore: 0x8a5038,
  iron: 0x98a6b2,
  tools: 0xc74a3a,
};

function build(id: ItemId): THREE.BufferGeometry {
  const k = new Kit();
  k.jitter = 0.02;
  switch (id) {
    case 'log':
      k.cyl(0.075, 0.075, 0.26, PAL.trunk, 0, 0.075, 0, 7, { rz: Math.PI / 2 });
      k.cyl(0.062, 0.062, 0.265, PAL.plankWood, 0, 0.075, 0, 7, { rz: Math.PI / 2 });
      k.box(0.05, 0.03, 0.03, PAL.leaf, 0.04, 0.14, 0.02);
      break;
    case 'plank':
      k.box(0.26, 0.035, 0.09, PAL.plankWood, 0, 0, -0.05);
      k.box(0.26, 0.035, 0.09, 0xe6bd7f, 0, 0, 0.05);
      k.box(0.26, 0.035, 0.09, PAL.plankWood, 0, 0.035, 0);
      k.box(0.03, 0.075, 0.2, PAL.wood, 0, 0.0, 0, { sy: 1 });
      break;
    case 'wheat':
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        k.box(0.025, 0.24, 0.025, PAL.wheat, Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04, { rx: Math.sin(a) * 0.25, rz: -Math.cos(a) * 0.25 });
        k.sphere(0.03, 0xf2d067, Math.cos(a) * 0.07, 0.24, Math.sin(a) * 0.07, 0, { sy: 1.6 });
      }
      k.box(0.1, 0.03, 0.1, PAL.wood, 0, 0.08, 0);
      break;
    case 'flour':
      k.sphere(0.1, PAL.cloth, 0, 0.09, 0, 1, { sx: 1.0, sy: 0.9, sz: 0.85 });
      k.cyl(0.035, 0.05, 0.06, PAL.cloth, 0, 0.17, 0, 6);
      k.cyl(0.04, 0.04, 0.02, PAL.wood, 0, 0.18, 0, 6);
      k.box(0.08, 0.06, 0.01, 0x9fb7d8, 0, 0.07, 0.085);
      break;
    case 'bread':
      k.sphere(0.1, PAL.wheat, 0, 0.06, 0, 1, { sx: 1.35, sy: 0.65, sz: 0.85 });
      k.sphere(0.1, 0xb87634, 0, 0.075, 0, 1, { sx: 1.28, sy: 0.62, sz: 0.8 });
      for (let i = 0; i < 3; i++) k.box(0.015, 0.02, 0.1, 0xe8c27a, -0.05 + i * 0.05, 0.13, 0, { ry: 0.5 });
      break;
    case 'stone':
      k.box(0.2, 0.12, 0.15, PAL.stoneLight, 0, 0, 0);
      k.box(0.205, 0.02, 0.155, PAL.stone, 0, 0.06, 0);
      break;
    case 'ore':
      k.dodeca(0.09, 0x5f4537, 0, 0.08, 0);
      k.dodeca(0.06, 0x7a4a33, 0.06, 0.06, 0.04);
      k.box(0.04, 0.04, 0.04, 0xe07a3a, -0.03, 0.15, 0.03, { ry: 0.5 });
      k.box(0.035, 0.035, 0.035, 0xe07a3a, 0.07, 0.1, -0.04, { ry: 0.2 });
      break;
    case 'iron': {
      const g = new THREE.CylinderGeometry(0.07, 0.1, 0.22, 4, 1);
      g.rotateY(Math.PI / 4);
      g.rotateZ(Math.PI / 2);
      g.scale(1, 0.55, 0.9);
      g.translate(0, 0.05, 0);
      k.add(g, 0x9eacb8);
      k.box(0.16, 0.012, 0.06, 0xc8d3dc, 0, 0.098, 0);
      break;
    }
    case 'tools':
      k.box(0.24, 0.1, 0.13, 0xc74a3a, 0, 0, 0);
      k.box(0.25, 0.02, 0.14, 0x8e3027, 0, 0.1, 0);
      k.box(0.12, 0.05, 0.02, PAL.metalDark, 0, 0.12, 0);
      k.box(0.03, 0.03, 0.14, PAL.brass, 0.06, 0.05, 0);
      break;
  }
  return k.build();
}

const cache = new Map<ItemId, THREE.BufferGeometry>();
export function itemGeom(id: ItemId) {
  let g = cache.get(id);
  if (!g) {
    g = build(id);
    cache.set(id, g);
  }
  return g;
}
