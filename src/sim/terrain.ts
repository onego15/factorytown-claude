// Procedural island terrain: terraced heights, forests, rock & ore deposits.

export const MAP_W = 48;
export const MAP_H = 48;

export const GROUND_GRASS = 0;
export const GROUND_SAND = 1;
export const GROUND_ROCK = 2;
export const GROUND_ORE = 3;
export const GROUND_MEADOW = 4; // grass with flowers, purely visual

export interface Terrain {
  w: number;
  h: number;
  seed: number;
  height: Int8Array; // -1 = sea
  ground: Uint8Array;
  tree: Uint8Array; // 0 none, 1 conifer, 2 broadleaf
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, y: number, seed: number, oct = 4) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += valueNoise(x * f, y * f, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm;
}

export function generateTerrain(seed: number): Terrain {
  const w = MAP_W, h = MAP_H;
  const height = new Int8Array(w * h);
  const ground = new Uint8Array(w * h);
  const tree = new Uint8Array(w * h);
  const rnd = mulberry32(seed);
  const cx = w / 2, cy = h / 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dx = (x + 0.5 - cx) / (w / 2), dy = (y + 0.5 - cy) / (h / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const coast = fbm(x * 0.12, y * 0.12, seed + 7, 3) * 0.35;
      const island = 1 - d - coast + 0.12;
      const n = fbm(x * 0.07, y * 0.07, seed, 4);
      let lvl: number;
      if (island < 0.05) lvl = -1;
      else if (island < 0.13) lvl = 0;
      else {
        const e = n * 1.15 + island * 0.9;
        lvl = e < 0.78 ? 1 : e < 0.98 ? 2 : e < 1.14 ? 3 : 4;
      }
      height[i] = lvl;
      ground[i] = lvl === 0 ? GROUND_SAND : GROUND_GRASS;
    }
  }

  // Flatten the town center
  const flat = (x0: number, y0: number, r: number, lvl: number) => {
    for (let y = y0 - r; y <= y0 + r; y++)
      for (let x = x0 - r; x <= x0 + r; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        height[y * w + x] = lvl;
        ground[y * w + x] = GROUND_GRASS;
      }
  };
  flat(Math.floor(cx), Math.floor(cy), 6, 1);

  // Smooth single-tile spikes/pits so terraces read cleanly
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (height[i] < 1) continue;
        const ns = [height[i - 1], height[i + 1], height[i - w], height[i + w]];
        const higher = ns.filter((v) => v > height[i]).length;
        const lower = ns.filter((v) => v < height[i]).length;
        if (higher >= 3) height[i] = Math.min(...ns.filter((v) => v > height[i]));
        else if (lower >= 3 && height[i] > 1) height[i] = Math.max(...ns.filter((v) => v < height[i]));
      }
  }

  const dist = (x: number, y: number) => Math.hypot(x - cx, y - cy);

  // Deposits: clusters placed by angle around the center.
  const placeCluster = (type: number, minD: number, maxD: number, size: number, angle: number) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const a = angle + (rnd() - 0.5) * 1.2;
      const r = minD + rnd() * (maxD - minD);
      const x0 = Math.round(cx + Math.cos(a) * r), y0 = Math.round(cy + Math.sin(a) * r);
      if (x0 < 3 || y0 < 3 || x0 >= w - 3 || y0 >= h - 3) continue;
      if (height[y0 * w + x0] < 1) continue;
      const lvl = height[y0 * w + x0];
      // flatten a 4x4 plateau so a 2x2 building always fits
      for (let y = y0 - 1; y <= y0 + 2; y++)
        for (let x = x0 - 1; x <= x0 + 2; x++) height[y * w + x] = lvl;
      let placed = 0;
      for (let y = y0 - 2; y <= y0 + 3 && placed < size; y++)
        for (let x = x0 - 2; x <= x0 + 3 && placed < size; x++) {
          const i = y * w + x;
          if (height[i] !== lvl) continue;
          const inner = x >= x0 - 1 && x <= x0 + 2 && y >= y0 - 1 && y <= y0 + 2;
          if (inner || rnd() < 0.35) {
            ground[i] = type;
            placed++;
          }
        }
      return true;
    }
    return false;
  };
  const baseA = rnd() * Math.PI * 2;
  placeCluster(GROUND_ROCK, 9, 13, 14, baseA);
  placeCluster(GROUND_ROCK, 13, 18, 12, baseA + 2.4);
  placeCluster(GROUND_ORE, 12, 17, 12, baseA + 1.2);
  placeCluster(GROUND_ORE, 14, 19, 10, baseA + 3.8);

  // Forests
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (height[i] < 1 || ground[i] !== GROUND_GRASS) continue;
      const dc = dist(x + 0.5, y + 0.5);
      if (dc < 5.5) continue;
      const f = fbm(x * 0.13 + 40, y * 0.13 + 40, seed + 3, 3);
      const thr = height[i] >= 3 ? 0.5 : 0.56;
      if (f > thr && rnd() < 0.85) tree[i] = height[i] >= 3 || rnd() < 0.35 ? 1 : 2;
      else if (rnd() < 0.025) tree[i] = rnd() < 0.5 ? 1 : 2;
      else if (fbm(x * 0.2 + 9, y * 0.2 + 9, seed + 5, 2) > 0.62) ground[i] = GROUND_MEADOW;
    }

  // Guarantee a forest close to town
  {
    const a = baseA + Math.PI * 1.1;
    const fx = Math.round(cx + Math.cos(a) * 8), fy = Math.round(cy + Math.sin(a) * 8);
    for (let y = fy - 3; y <= fy + 3; y++)
      for (let x = fx - 3; x <= fx + 3; x++) {
        const i = y * w + x;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (height[i] >= 1 && ground[i] !== GROUND_ROCK && ground[i] !== GROUND_ORE && dist(x, y) > 6 && rnd() < 0.75)
          tree[i] = rnd() < 0.4 ? 1 : 2;
      }
  }
  return { w, h, seed, height, ground, tree };
}
