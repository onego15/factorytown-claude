// Renders the in-game 3D models into small images so UI icons share the world's art style.

import * as THREE from 'three';
import { BuildingId, ITEM_IDS, ItemId } from '../sim/data';
import { itemGeom } from '../render/itemModels';
import { getModel } from '../render/models';
import { Kit } from '../render/kit';
import { PAL } from '../render/palette';

export const itemIcons = {} as Record<ItemId, string>;
export const buildingIcons = {} as Record<string, string>;

function beltIconGeom() {
  const k = new Kit();
  k.box(1.4, 0.08, 0.62, PAL.darkWood, 0, 0, 0);
  k.box(1.4, 0.09, 0.06, PAL.brass, 0, 0.04, 0.29);
  k.box(1.4, 0.09, 0.06, PAL.brass, 0, 0.04, -0.29);
  k.box(1.4, 0.02, 0.5, 0x4a4650, 0, 0.08, 0);
  for (const x of [-0.45, 0.05, 0.55]) {
    k.box(0.2, 0.025, 0.05, 0xe9c46a, x - 0.08, 0.09, 0.08, { ry: 0.6 });
    k.box(0.2, 0.025, 0.05, 0xe9c46a, x - 0.08, 0.09, -0.08, { ry: -0.6 });
  }
  k.box(0.22, 0.14, 0.15, PAL.plankWood, -0.2, 0.1, 0);
  k.cyl(0.07, 0.07, 0.22, PAL.trunk, 0.35, 0.17, 0, 7, { rz: Math.PI / 2 });
  return k.build();
}

function roadIconGeom() {
  const k = new Kit();
  k.box(1.6, 0.06, 1.0, 0x9c9384, 0, 0, 0);
  const cols = [0xb3ab9c, 0xa69e8f, 0xc0b8a8, 0x958d7f];
  let n = 0;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 6; j++) k.box(0.22, 0.04, 0.2, cols[n++ % 4], -0.65 + j * 0.26 + (i % 2) * 0.1, 0.05, -0.37 + i * 0.245);
  return k.build();
}

export function renderIcons() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return;
  }
  renderer.setSize(size, size, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x8a7a5c, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, flatShading: true });
  const shoot = (geoms: THREE.BufferGeometry[], dist: number, yaw = 0.7, pitch = 0.55, ry = 0) => {
    const g = new THREE.Group();
    for (const geom of geoms) g.add(new THREE.Mesh(geom, mat));
    g.rotation.y = ry;
    scene.add(g);
    const box = new THREE.Box3().setFromObject(g);
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2;
    const d = (r / Math.sin((cam.fov * Math.PI) / 360)) * dist;
    cam.position.set(c.x + Math.sin(yaw) * Math.cos(pitch) * d, c.y + Math.sin(pitch) * d, c.z + Math.cos(yaw) * Math.cos(pitch) * d);
    cam.lookAt(c);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, cam);
    scene.remove(g);
    return canvas.toDataURL('image/png');
  };
  for (const id of ITEM_IDS) itemIcons[id] = shoot([itemGeom(id)], 0.82, 0.6, 0.6, -0.3);
  const types: BuildingId[] = ['lumber', 'farm', 'quarry', 'mine', 'sawmill', 'mill', 'bakery', 'smelter', 'workshop', 'house', 'market', 'warehouse', 'trade', 'splitter', 'hall'];
  for (const t of types) {
    const m = getModel(t, 1, 1, 0, 0);
    const geoms = [m.base, ...(m.glow ? [m.glow] : []), ...(m.fire ? [m.fire] : [])];
    const anims = m.anims.map((a) => {
      const g = a.geom.clone();
      g.translate(...a.pos);
      return g;
    });
    buildingIcons[t] = shoot([...geoms, ...anims], 0.8, 0.75, 0.6);
  }
  buildingIcons.belt = shoot([beltIconGeom()], 0.75, 0.9, 0.7);
  buildingIcons.road = shoot([roadIconGeom()], 0.75, 0.9, 0.7);
  // houses by tier
  for (let tier = 0; tier < 3; tier++) {
    const m = getModel('house', 1, 1, tier, 0);
    buildingIcons['house' + tier] = shoot([m.base, ...(m.glow ? [m.glow] : [])], 0.8, 0.75, 0.55);
  }
  renderer.dispose();
  renderer.forceContextLoss();
}

export function itemImg(id: ItemId, cls = 'ico') {
  return `<img class="${cls}" src="${itemIcons[id] ?? ''}" alt="">`;
}
