// Development helpers used by automated browser tests and the demo recording.
// They only call the same public World APIs the player's input uses (place / remove / research).

import { BUILDINGS, BuildingId } from '../sim/data';
import { DX, DY, opposite } from '../sim/geom';
import { Entity, World } from '../sim/world';

export function findSpot(
  w: World,
  type: BuildingId,
  near: { x: number; y: number },
  opts: { maxDist?: number; minEff?: number; rot?: number; avoid?: (x: number, y: number) => boolean; margin?: number } = {},
): { x: number; y: number; eff: number } | null {
  const rot = opts.rot ?? 0;
  const [fw, fh] = w.footprint(type, rot);
  let best: { x: number; y: number; eff: number; score: number } | null = null;
  const md = opts.maxDist ?? 16;
  const margin = opts.margin ?? 1;
  for (let y = Math.max(0, near.y - md); y <= Math.min(w.H - fh, near.y + md); y++)
    for (let x = Math.max(0, near.x - md); x <= Math.min(w.W - fw, near.x + md); x++) {
      const c = w.checkPlace(type, x, y, rot, true);
      if (!c.ok) continue;
      if ((c.eff ?? 1) < (opts.minEff ?? 0)) continue;
      if (opts.avoid && opts.avoid(x, y)) continue;
      // keep a free ring around the footprint so belts can reach it
      let ringFree = 0, ringTotal = 0;
      for (let yy = y - margin; yy < y + fh + margin; yy++)
        for (let xx = x - margin; xx < x + fw + margin; xx++) {
          if (xx >= x && yy >= y && xx < x + fw && yy < y + fh) continue;
          ringTotal++;
          if (w.inBounds(xx, yy) && !w.tileEnt[w.idx(xx, yy)] && w.heightAt(xx, yy) >= 0) ringFree++;
        }
      if (ringFree < ringTotal * 0.75) continue;
      const d = Math.hypot(x + fw / 2 - near.x, y + fh / 2 - near.y);
      const score = (c.eff ?? 1) * 10 - d * 0.6 - c.clearsTrees * 0.15;
      if (!best || score > best.score) best = { x, y, eff: c.eff ?? 1, score };
    }
  return best ? { x: best.x, y: best.y, eff: best.eff } : null;
}

/** Lay a belt from building `from` (output side) into building `to`. Returns the number of belts placed or -1. */
export function route(w: World, fromId: number, toId: number, opts: { avoidNear?: Entity[] } = {}): number {
  const from = w.entities.get(fromId)!, to = w.entities.get(toId)!;
  const free = (x: number, y: number) => w.inBounds(x, y) && !w.tileEnt[w.idx(x, y)] && w.heightAt(x, y) >= 0;
  const key = (x: number, y: number) => y * w.W + x;
  const perim = (e: Entity) => {
    const out: { x: number; y: number; d: number }[] = []; // d: direction pointing away from e
    for (let x = e.x; x < e.x + e.w; x++) {
      out.push({ x, y: e.y - 1, d: 3 });
      out.push({ x, y: e.y + e.h, d: 1 });
    }
    for (let y = e.y; y < e.y + e.h; y++) {
      out.push({ x: e.x - 1, y, d: 2 });
      out.push({ x: e.x + e.w, y, d: 0 });
    }
    return out;
  };
  const touchesOther = (x: number, y: number) => {
    for (let d = 0; d < 4; d++) {
      const n = w.entAt(x + DX[d], y + DY[d]);
      if (n && n.id !== fromId && n.id !== toId && n.type !== 'belt' && n.type !== 'road') return true;
    }
    return false;
  };
  const goal = new Set<number>();
  for (const s of perim(to)) if (free(s.x, s.y) && Math.abs(w.heightAt(s.x, s.y) - w.heightAt(to.x, to.y)) <= 1) goal.add(key(s.x, s.y));
  // Dijkstra over (tile, heading) with a small turn penalty for tidy lines
  const N = w.W * w.H;
  const dist = new Float32Array(N * 4).fill(Infinity);
  const prev = new Int32Array(N * 4).fill(-2);
  const heap: [number, number][] = [];
  const push = (c: number, s: number) => {
    heap.push([c, s]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const startState = new Map<number, number>();
  for (const s of perim(from)) {
    if (!free(s.x, s.y)) continue;
    if (Math.abs(w.heightAt(s.x, s.y) - w.heightAt(from.x, from.y)) > 1) continue;
    const nx = s.x + DX[s.d], ny = s.y + DY[s.d];
    if (w.entAt(nx, ny)?.id === toId) {
      w.place('belt', s.x, s.y, s.d);
      return 1;
    }
    if (!free(nx, ny) || Math.abs(w.heightAt(nx, ny) - w.heightAt(s.x, s.y)) > 1) continue;
    const st = key(nx, ny) * 4 + s.d;
    const c = 2 + (touchesOther(s.x, s.y) ? 6 : 0);
    if (c < dist[st]) {
      dist[st] = c;
      prev[st] = -1;
      startState.set(st, key(s.x, s.y));
      push(c, st);
    }
  }
  let endState = -1;
  while (heap.length) {
    const [c, st] = pop();
    if (c > dist[st]) continue;
    const k = st >> 2, hd = st & 3;
    const x = k % w.W, y = Math.floor(k / w.W);
    if (goal.has(k)) {
      endState = st;
      break;
    }
    for (let d = 0; d < 4; d++) {
      if (d === opposite(hd)) continue;
      const nx = x + DX[d], ny = y + DY[d];
      if (!free(nx, ny)) continue;
      if (Math.abs(w.heightAt(nx, ny) - w.heightAt(x, y)) > 1) continue;
      const nk = key(nx, ny);
      const ns = nk * 4 + d;
      const nc = c + 1 + (d !== hd ? 0.6 : 0) + (touchesOther(nx, ny) && !goal.has(nk) ? 6 : 0) + (w.terrain.tree[nk] ? 0.3 : 0);
      if (nc < dist[ns]) {
        dist[ns] = nc;
        prev[ns] = st;
        push(nc, ns);
      }
    }
  }
  if (endState < 0) return -1;
  const path: number[] = [];
  let st = endState;
  for (;;) {
    path.push(st >> 2);
    if (prev[st] === -1) {
      path.push(startState.get(st)!);
      break;
    }
    st = prev[st];
  }
  path.reverse();
  const pts = path.map((k) => ({ x: k % w.W, y: Math.floor(k / w.W) }));
  // last tile points into the target
  let lastDir = 0;
  const lp = pts[pts.length - 1];
  for (let d = 0; d < 4; d++) if (w.entAt(lp.x + DX[d], lp.y + DY[d])?.id === toId) lastDir = d;
  let n = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    let dir = lastDir;
    if (i < pts.length - 1) {
      const q = pts[i + 1];
      for (let d = 0; d < 4; d++) if (p.x + DX[d] === q.x && p.y + DY[d] === q.y) dir = d;
    }
    const r = w.place('belt', p.x, p.y, dir);
    if (typeof r !== 'string') n++;
  }
  return n;
}

export function build(w: World, type: BuildingId, near: { x: number; y: number }, opts: Parameters<typeof findSpot>[3] = {}): Entity | null {
  const s = findSpot(w, type, near, opts);
  if (!s) return null;
  const r = w.place(type, s.x, s.y, opts.rot ?? 0);
  return typeof r === 'string' ? null : r;
}

export function hallCenter(w: World) {
  const h = w.entities.get(w.hallId)!;
  return { x: h.x + 1, y: h.y + 1 };
}

/** Houses along a new street: a road row with houses on both sides. */
export function street(w: World, x0: number, y0: number, len: number, houses = true): number {
  let placed = 0;
  for (let i = 0; i < len; i++) {
    const r = w.place('road', x0 + i, y0, 0);
    if (typeof r !== 'string') placed++;
  }
  if (houses)
    for (let i = 0; i < len; i++) {
      for (const dy of [-1, 1]) {
        const r = w.place('house', x0 + i, y0 + dy, 0);
        if (typeof r !== 'string') placed++;
      }
    }
  return placed;
}

export const dev = { findSpot, route, build, street, hallCenter, BUILDINGS };
