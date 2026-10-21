// Terrain, sea, trees, deposits and ground decoration.

import * as THREE from 'three';
import { LEVEL_H } from '../sim/geom';
import { GROUND_MEADOW, GROUND_ORE, GROUND_ROCK, GROUND_SAND, fbm, mulberry32 } from '../sim/terrain';
import { World } from '../sim/world';
import { Kit } from './kit';
import { PAL } from './palette';

export const SEABED_Y = -0.75;
export const WATER_Y = -0.12;

const C = (h: number) => new THREE.Color(h);

/** Uniforms shared by materials that animate (wind, grid) */
export const shared = {
  time: { value: 0 },
  grid: { value: 0 },
  wind: { value: 1 },
};

function topColor(world: World, i: number, x: number, y: number, out: THREE.Color) {
  const t = world.terrain;
  const g = t.ground[i];
  const h = t.height[i];
  if (h < 0) return out.set(0xcbb98a);
  if (g === GROUND_SAND) return out.set(0xe6d29c);
  if (g === GROUND_ROCK) return out.set(0xa49d8f);
  if (g === GROUND_ORE) return out.set(0x9b7560);
  const n = fbm(x * 0.18, y * 0.18, 77, 3);
  const a = C(0x6ea844), b = C(0x9cc457);
  out.copy(a).lerp(b, THREE.MathUtils.clamp((n - 0.3) * 2.2, 0, 1));
  if (g === GROUND_MEADOW) out.lerp(C(0xb3cc63), 0.45);
  // higher plateaus slightly cooler & lighter
  out.lerp(C(0x8fbf7a), Math.max(0, h - 1) * 0.12);
  return out;
}

export function buildTerrainGeometry(world: World): THREE.BufferGeometry {
  const { w, h, height } = world.terrain;
  const pos: number[] = [];
  const col: number[] = [];
  const ox = -w / 2, oz = -h / 2;
  const c = new THREE.Color(), c2 = new THREE.Color();
  const topY = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return SEABED_Y - 0.6;
    const v = height[y * w + x];
    return v < 0 ? SEABED_Y : v * LEVEL_H;
  };
  const quad = (
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
    ca: THREE.Color, cb: THREE.Color, cc: THREE.Color, cd: THREE.Color,
  ) => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
    for (const k of [ca, cb, cc, ca, cc, cd]) col.push(k.r, k.g, k.b);
  };
  const shade = (base: THREE.Color, x: number, z: number) => {
    const n = fbm(x * 0.9 + 3, z * 0.9 + 3, 11, 2);
    return base.clone().multiplyScalar(0.93 + n * 0.14);
  };
  const soil = C(0x8a6646), soilDeep = C(0x6f5a4a), rock = C(0x8c8478), lip = C(0x5b8f3a), sandWall = C(0xcdb784);

  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const ty = topY(x, y);
      topColor(world, i, x, y, c);
      const x0 = ox + x, x1 = x0 + 1, z0 = oz + y, z1 = z0 + 1;
      quad(x0, ty, z0, x0, ty, z1, x1, ty, z1, x1, ty, z0, shade(c, x0, z0), shade(c, x0, z1), shade(c, x1, z1), shade(c, x1, z0));
      // walls toward lower neighbours
      const nb: [number, number, number, number, number, number][] = [
        [x + 1, y, x1, z1, x1, z0],
        [x - 1, y, x0, z0, x0, z1],
        [x, y + 1, x0, z1, x1, z1],
        [x, y - 1, x1, z0, x0, z0],
      ];
      const isSand = world.terrain.ground[i] === GROUND_SAND || height[i] < 0;
      for (const [nx, ny, ax, az, bx, bz] of nb) {
        const ny2 = topY(nx, ny);
        if (ny2 >= ty) continue;
        // split the wall into bands: a grass lip, then strata
        let yTop = ty;
        const bands: [number, THREE.Color][] = [];
        if (!isSand && height[i] >= 0) bands.push([Math.max(ny2, ty - 0.07), lip]);
        let k = 0;
        let cur = bands.length ? bands[0][0] : ty;
        while (cur > ny2 + 1e-4) {
          const next = Math.max(ny2, cur - 0.25);
          const depth = ty - next;
          let bc = isSand ? sandWall.clone() : soil.clone().lerp(depth > 0.6 ? rock : soilDeep, Math.min(1, depth / 1.2));
          if (k % 2) bc.multiplyScalar(0.93);
          bands.push([next, bc]);
          cur = next;
          k++;
        }
        for (const [yb, bc] of bands) {
          const cTop = bc.clone().multiplyScalar(1.03), cBot = bc.clone().multiplyScalar(0.92);
          quad(ax, yTop, az, ax, yb, az, bx, yb, bz, bx, yTop, bz, cTop, cBot, cBot, cTop);
          yTop = yb;
        }
      }
    }
  void c2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function terrainMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrid = shared.grid;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\nvWNorm = normalize(mat3(modelMatrix) * objectNormal);',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGrid;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (uGrid > 0.0 && vWNorm.y > 0.5) {
          vec2 f = abs(fract(vWPos.xz) - 0.5);
          float d = 0.5 - max(f.x, f.y);
          float line = 1.0 - smoothstep(0.0, 0.035, d);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.98, 0.9), line * 0.35 * uGrid);
        }`,
      );
  };
  return m;
}

// ------------------------------------------------------------------ water
export function buildWater(world: World): THREE.Mesh {
  const { w, h, height } = world.terrain;
  // distance-to-land field for shore foam and depth colour
  const N = 64; // texture covers 64x64 tiles centered on the map
  const data = new Uint8Array(N * N * 4);
  const off = (N - w) / 2;
  const land = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && height[y * w + x] >= 0;
  for (let ty = 0; ty < N; ty++)
    for (let tx = 0; tx < N; tx++) {
      const mx = tx - off, my = ty - off;
      let best = 6;
      for (let dy = -6; dy <= 6; dy++)
        for (let dx = -6; dx <= 6; dx++) {
          if (land(Math.floor(mx + dx), Math.floor(my + dy))) {
            const d = Math.hypot(dx, dy);
            if (d < best) best = d;
          }
        }
      const v = Math.round((best / 6) * 255);
      const j = (ty * N + tx) * 4;
      data[j] = v;
      data[j + 1] = v;
      data[j + 2] = v;
      data[j + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDist: { value: tex },
        uSize: { value: N },
        uShallow: { value: new THREE.Color(0x63d0d6) },
        uDeep: { value: new THREE.Color(0x2c78b0) },
        uSky: { value: new THREE.Color(0xbfe3f2) },
        uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3) },
        uLight: { value: 1 },
      },
    ]),
    vertexShader: `
      varying vec3 vW;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime; uniform sampler2D uDist; uniform float uSize;
      uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSunDir; uniform float uLight;
      varying vec3 vW;
      #include <fog_pars_fragment>
      void main() {
        vec2 uv = (vW.xz + uSize * 0.5) / uSize;
        float d = texture2D(uDist, uv).r * 6.0;
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) d = 6.0;
        float t = uTime;
        float w1 = sin(vW.x * 0.9 + t * 0.8) * cos(vW.z * 0.7 - t * 0.6);
        float w2 = sin((vW.x + vW.z) * 1.7 - t * 1.3);
        vec3 n = normalize(vec3(w1 * 0.08 + w2 * 0.04, 1.0, w2 * 0.06 - w1 * 0.03));
        float depth = smoothstep(0.0, 4.5, d);
        vec3 col = mix(uShallow, uDeep, depth);
        vec3 v = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        col = mix(col, uSky, fres * 0.45);
        vec3 h = normalize(uSunDir + v);
        float spec = pow(max(dot(n, h), 0.0), 90.0);
        col += vec3(1.0, 0.95, 0.85) * spec * 0.6 * uLight;
        // shore foam bands
        float foam = 0.0;
        if (d < 1.4) {
          float band = sin(d * 9.0 - t * 2.2 + w1 * 1.5) * 0.5 + 0.5;
          foam = smoothstep(0.75, 0.95, band) * (1.0 - d / 1.4);
          foam += smoothstep(0.35, 0.0, d);
        }
        col = mix(col, vec3(0.97, 0.98, 1.0), clamp(foam, 0.0, 1.0) * 0.85);
        col *= mix(0.35, 1.0, uLight);
        float alpha = mix(0.62, 0.94, depth);
        alpha = max(alpha, foam);
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
  });
  const geo = new THREE.PlaneGeometry(400, 400, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_Y;
  mesh.renderOrder = 2;
  return mesh;
}

export function buildSeabed(): THREE.Mesh {
  const g = new THREE.PlaneGeometry(400, 400);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xbfae7f, roughness: 1 }));
  m.position.y = SEABED_Y - 0.6;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ vegetation & props
function windMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.uniforms.uWind = shared.wind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float sway = sin(uTime * 1.6 + ip.x * 0.7 + ip.z * 0.5) * 0.035 * uWind;
          transformed.x += sway * max(position.y, 0.0);
          transformed.z += sway * 0.6 * max(position.y, 0.0);
        #endif`,
      );
  };
  return m;
}

function conifer(): THREE.BufferGeometry {
  const k = new Kit();
  k.jitter = 0.06;
  k.cyl(0.05, 0.07, 0.25, PAL.trunk, 0, 0, 0, 5);
  k.cone(0.34, 0.45, PAL.pine, 0, 0.18, 0, 7);
  k.cone(0.27, 0.4, PAL.pineLight, 0, 0.42, 0, 7);
  k.cone(0.18, 0.34, PAL.pine, 0, 0.66, 0, 7);
  return k.build();
}

function broadleaf(): THREE.BufferGeometry {
  const k = new Kit();
  k.jitter = 0.06;
  k.cyl(0.05, 0.075, 0.38, PAL.trunk, 0, 0, 0, 5);
  k.sphere(0.3, PAL.leaf, 0, 0.55, 0, 0);
  k.sphere(0.22, PAL.leafLight, 0.14, 0.7, 0.08, 0);
  k.sphere(0.2, PAL.leafDark, -0.13, 0.48, -0.1, 0);
  return k.build();
}

function boulder(): THREE.BufferGeometry {
  const k = new Kit();
  k.jitter = 0.08;
  k.dodeca(0.22, 0xa39c90, 0, 0.12, 0, { sy: 0.75 });
  k.dodeca(0.13, 0x8f887c, 0.2, 0.06, 0.12, { sy: 0.7 });
  return k.build();
}

function oreRock(): THREE.BufferGeometry {
  const k = new Kit();
  k.jitter = 0.08;
  k.dodeca(0.2, 0x5f514a, 0, 0.11, 0, { sy: 0.8 });
  k.dodeca(0.12, 0x6d5548, 0.18, 0.06, -0.1, { sy: 0.7 });
  k.box(0.06, 0.06, 0.06, 0xe0793a, 0.02, 0.24, 0.04, { ry: 0.6, rx: 0.4 });
  k.box(0.05, 0.05, 0.05, 0xd06a30, -0.12, 0.15, 0.08, { ry: 0.3 });
  k.box(0.045, 0.045, 0.045, 0xe58a45, 0.2, 0.13, -0.1, { ry: 0.9 });
  return k.build();
}

function tuft(): THREE.BufferGeometry {
  const k = new Kit();
  k.jitter = 0.1;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    k.cone(0.03, 0.14, 0x5d9a3c, Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04, 3, { rx: Math.sin(a) * 0.3, rz: -Math.cos(a) * 0.3 });
  }
  return k.build();
}

function flower(): THREE.BufferGeometry {
  const k = new Kit();
  k.jitter = 0;
  k.box(0.012, 0.1, 0.012, 0x4f8a35, 0, 0, 0);
  k.sphere(0.035, 0xffffff, 0, 0.11, 0, 0);
  return k.build();
}

function bush(): THREE.BufferGeometry {
  const k = new Kit();
  k.jitter = 0.08;
  k.sphere(0.16, PAL.leafDark, 0, 0.1, 0, 0, { sy: 0.8 });
  k.sphere(0.12, PAL.leaf, 0.1, 0.12, 0.06, 0, { sy: 0.8 });
  return k.build();
}

const FLOWER_COLORS = [0xf5f0e0, 0xf2c94c, 0xe46b6b, 0xb98ce0, 0x7fb6e8, 0xf29fc5];

export class Vegetation {
  group = new THREE.Group();
  private meshes: Record<string, THREE.InstancedMesh> = {};
  constructor(private world: World) {
    const wm = windMaterial();
    const sm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const mk = (name: string, g: THREE.BufferGeometry, mat: THREE.Material, cap: number, shadow = true) => {
      const m = new THREE.InstancedMesh(g, mat, cap);
      m.castShadow = shadow;
      m.receiveShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      this.meshes[name] = m;
      this.group.add(m);
    };
    const W = world.W * world.H;
    mk('conifer', conifer(), wm, W);
    mk('broadleaf', broadleaf(), wm, W);
    mk('boulder', boulder(), sm, W);
    mk('ore', oreRock(), sm, W);
    mk('tuft', tuft(), wm, W * 2, false);
    mk('flower', flower(), wm, W * 2, false);
    mk('bush', bush(), wm, W, true);
    this.rebuild();
  }

  rebuild() {
    const w = this.world;
    const t = w.terrain;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    const counts: Record<string, number> = {};
    for (const k of Object.keys(this.meshes)) counts[k] = 0;
    const put = (name: string, x: number, y: number, z: number, rot: number, sc: number, sy = sc, color?: THREE.Color) => {
      const mesh = this.meshes[name];
      const n = counts[name]++;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      p.set(x, y, z);
      s.set(sc, sy, sc);
      m4.compose(p, q, s);
      mesh.setMatrixAt(n, m4);
      if (color) mesh.setColorAt(n, color);
    };
    for (let y = 0; y < w.H; y++)
      for (let x = 0; x < w.W; x++) {
        const i = y * w.W + x;
        const h = t.height[i];
        if (h < 0) continue;
        const rnd = mulberry32(i * 7919 + 13);
        const cx = x + 0.5 - w.W / 2, cz = y + 0.5 - w.H / 2, cy = h * LEVEL_H;
        const occupied = w.tileEnt[i] !== 0;
        const g = t.ground[i];
        if (t.tree[i]) {
          const n = 1 + (rnd() < 0.45 ? 1 : 0);
          for (let k = 0; k < n; k++) {
            const ox = n === 1 ? (rnd() - 0.5) * 0.3 : (k === 0 ? -0.2 : 0.2) + (rnd() - 0.5) * 0.12;
            const oz = n === 1 ? (rnd() - 0.5) * 0.3 : (k === 0 ? -0.15 : 0.18) + (rnd() - 0.5) * 0.12;
            const sc = (n === 1 ? 1.05 : 0.8) * (0.8 + rnd() * 0.4);
            const type = t.tree[i] === 1 ? 'conifer' : 'broadleaf';
            col.setHSL(type === 'conifer' ? 0.38 : 0.27 + rnd() * 0.05, 0.25 + rnd() * 0.2, 0.75 + rnd() * 0.3);
            put(type, cx + ox, cy, cz + oz, rnd() * Math.PI * 2, sc, sc * (0.9 + rnd() * 0.3), col.setRGB(0.85 + rnd() * 0.25, 0.85 + rnd() * 0.25, 0.85 + rnd() * 0.2));
          }
          continue;
        }
        if (occupied) {
          // deposits remain visible under belts/roads only
          const e = w.entities.get(w.tileEnt[i])!;
          if (e.type !== 'belt' && e.type !== 'road') continue;
          if (g !== GROUND_ROCK && g !== GROUND_ORE) continue;
        }
        if (g === GROUND_ROCK || g === GROUND_ORE) {
          if (occupied) continue;
          put(g === GROUND_ROCK ? 'boulder' : 'ore', cx + (rnd() - 0.5) * 0.3, cy, cz + (rnd() - 0.5) * 0.3, rnd() * 6.28, 0.9 + rnd() * 0.5, undefined as any, col.setRGB(1, 1, 1));
          if (rnd() < 0.6) put(g === GROUND_ROCK ? 'boulder' : 'ore', cx + (rnd() - 0.5) * 0.6, cy, cz + (rnd() - 0.5) * 0.6, rnd() * 6.28, 0.5 + rnd() * 0.3, undefined as any, col.setRGB(1, 1, 1));
          continue;
        }
        if (g === GROUND_SAND) continue;
        const meadow = g === GROUND_MEADOW;
        const nt = meadow ? 3 : rnd() < 0.55 ? 1 : 0;
        for (let k = 0; k < nt; k++) put('tuft', cx + (rnd() - 0.5) * 0.85, cy, cz + (rnd() - 0.5) * 0.85, rnd() * 6.28, 0.8 + rnd() * 0.6, undefined as any, col.setRGB(0.9 + rnd() * 0.2, 0.9 + rnd() * 0.2, 0.8));
        const nf = meadow ? 2 + Math.floor(rnd() * 3) : rnd() < 0.12 ? 1 : 0;
        for (let k = 0; k < nf; k++) put('flower', cx + (rnd() - 0.5) * 0.85, cy, cz + (rnd() - 0.5) * 0.85, 0, 0.8 + rnd() * 0.5, undefined as any, col.set(FLOWER_COLORS[Math.floor(rnd() * FLOWER_COLORS.length)]));
        if (rnd() < 0.04) put('bush', cx + (rnd() - 0.5) * 0.5, cy, cz + (rnd() - 0.5) * 0.5, rnd() * 6.28, 0.8 + rnd() * 0.5, undefined as any, col.setRGB(1, 1, 1));
      }
    for (const [k, m] of Object.entries(this.meshes)) {
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
