// Development helpers used by automated browser tests and the demo recording.
// They only call the same public World APIs the player's input uses (place / remove / research).

import { BRIDGE_MAX_LEN, BUILDINGS, BuildingId } from '../sim/data';
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
          if (w.inBounds(xx, yy) && !w.tileEnt[w.idx(xx, yy)] && w.heightAt(xx, yy) >= 0 && Math.abs(w.heightAt(xx, yy) - w.heightAt(x, y)) <= 1) ringFree++;
        }
      if (ringFree < ringTotal) continue;
      const d = Math.hypot(x + fw / 2 - near.x, y + fh / 2 - near.y);
      const score = (c.eff ?? 1) * 10 - d * 0.6 - c.clearsTrees * 0.15;
      if (!best || score > best.score) best = { x, y, eff: c.eff ?? 1, score };
    }
  return best ? { x: best.x, y: best.y, eff: best.eff } : null;
}

/** Lay a belt from building `from` (output side) into building `to`. Returns the number of belts placed or -1. */
export function route(w: World, fromId: number, toId: number, opts: { placed?: number[]; dry?: { x: number; y: number; dir: number }[]; blocked?: Set<number> } = {}): number {
  const blocked = opts.blocked ?? new Set<number>();
  const from = w.entities.get(fromId)!, to = w.entities.get(toId)!;
  const free = (x: number, y: number) => w.inBounds(x, y) && !w.tileEnt[w.idx(x, y)] && w.heightAt(x, y) >= 0 && !blocked.has(y * w.W + x);
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
  const touchesBelt = (x: number, y: number) => {
    for (let d = 0; d < 4; d++) if (w.entAt(x + DX[d], y + DY[d])?.type === 'belt') return true;
    return false;
  };
  // goal tiles → direction of the final belt (into the target, or merging into a belt that leads there)
  const goal = new Map<number, number>();
  for (const s of perim(to))
    if (free(s.x, s.y) && Math.abs(w.heightAt(s.x, s.y) - w.heightAt(to.x, to.y)) <= 1) goal.set(key(s.x, s.y), opposite(s.d));
  const leadsTo = (b: Entity) => {
    let cur: Entity | undefined = b;
    for (let i = 0; i < 300 && cur && cur.type === 'belt'; i++) cur = w.entAt(cur.x + DX[cur.dir], cur.y + DY[cur.dir]);
    return cur?.id === toId;
  };
  // merging into another line is only safe when the target takes everything (a mixed line into a
  // crafter jams as soon as one input is full)
  const takesAll = ['hall', 'storage', 'trade'].includes(BUILDINGS[to.type].kind);
  for (const b of w.entities.values()) {
    if (!takesAll) break;
    if (b.type !== 'belt' || !leadsTo(b)) continue;
    for (let d = 0; d < 4; d++) {
      if (d === b.dir) continue; // never in front of it
      const x = b.x + DX[d], y = b.y + DY[d];
      if (!free(x, y) || Math.abs(w.heightAt(x, y) - w.heightAt(b.x, b.y)) > 1) continue;
      if (d === opposite(b.dir)) {
        // feeding from behind only if nothing feeds it already
        const back = w.entAt(x, y);
        if (back) continue;
      }
      const k = key(x, y);
      if (!goal.has(k)) goal.set(k, opposite(d));
    }
  }
  // Dijkstra over (tile, heading) with a small turn penalty for tidy lines
  const N = w.W * w.H;
  const dist = new Float32Array(N * 4).fill(Infinity);
  const prev = new Int32Array(N * 4).fill(-2);
  const jump = new Uint8Array(N * 4); // >0: reached by a bridge of this length
  const crossable = (x: number, y: number, d: number) => {
    const o = w.entAt(x, y);
    return !!o && (o.type === 'road' || (o.type === 'belt' && (o.len ?? 1) === 1 && o.dir !== d && o.dir !== opposite(d)));
  };
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
      if (opts.dry) {
        opts.dry.push({ x: s.x, y: s.y, dir: s.d });
        return 1;
      }
      const r = w.place('belt', s.x, s.y, s.d);
      if (typeof r !== 'string') opts.placed?.push(r.id);
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
      // a belt pointing away from another producer would pick up that producer's output
      const back = w.entAt(x - DX[d], y - DY[d]);
      if (back && back.id !== fromId && w.isOutputter(back)) continue;
      const nx = x + DX[d], ny = y + DY[d];
      if (!free(nx, ny)) continue;
      if (Math.abs(w.heightAt(nx, ny) - w.heightAt(x, y)) > 1) continue;
      const nk = key(nx, ny);
      const ns = nk * 4 + d;
      const nc = c + 1 + (d !== hd ? 0.6 : 0) + (touchesOther(nx, ny) && !goal.has(nk) ? 6 : 0) + (w.terrain.tree[nk] ? 0.3 : 0) + (touchesBelt(nx, ny) && !goal.has(nk) ? 2 : 0);
      if (nc < dist[ns]) {
        dist[ns] = nc;
        prev[ns] = st;
        jump[ns] = 0;
        push(nc, ns);
      }
    }
    // bridge over a run of crossing belts / roads, continuing straight on
    const h0 = w.heightAt(x, y);
    for (let L = 3; L <= BRIDGE_MAX_LEN; L++) {
      const cx = x + DX[hd] * (L - 2), cy = y + DY[hd] * (L - 2);
      if (!(crossable(cx, cy, hd) || (L > 3 && free(cx, cy))) || w.heightAt(cx, cy) > h0) break;
      const ex = x + DX[hd] * (L - 1), ey = y + DY[hd] * (L - 1);
      const ax = ex + DX[hd], ay = ey + DY[hd];
      if (!free(ex, ey) || w.heightAt(ex, ey) !== h0 || !free(ax, ay) || Math.abs(w.heightAt(ax, ay) - h0) > 1) continue;
      const ns = key(ax, ay) * 4 + hd;
      const nc = c + L + 4;
      if (nc < dist[ns]) {
        dist[ns] = nc;
        prev[ns] = st;
        jump[ns] = L;
        push(nc, ns);
      }
    }
  }
  if (endState < 0) return -1;
  const path: number[] = [];
  let st = endState;
  for (;;) {
    path.push(st >> 2);
    if (jump[st]) {
      const k = st >> 2, d = st & 3;
      const ax = k % w.W, ay = Math.floor(k / w.W);
      for (let i = 1; i < jump[st]; i++) path.push(key(ax - DX[d] * i, ay - DY[d] * i));
    }
    if (prev[st] === -1) {
      path.push(startState.get(st)!);
      break;
    }
    st = prev[st];
  }
  path.reverse();
  // a path may revisit a tile it already crossed with a bridge: forbid those tiles and search again
  const seen = new Set<number>();
  const dup = path.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
  if (dup.length) {
    if (blocked.size > 40) return -1;
    for (const k of dup) blocked.add(k);
    return route(w, fromId, toId, { ...opts, blocked });
  }
  const pts = path.map((k) => ({ x: k % w.W, y: Math.floor(k / w.W) }));
  // last tile points into the target (or the belt it merges into)
  const lp = pts[pts.length - 1];
  const lastDir = goal.get(key(lp.x, lp.y)) ?? 0;
  const dirs = pts.map((p, i) => {
    if (i === pts.length - 1) return lastDir;
    const q = pts[i + 1];
    for (let d = 0; d < 4; d++) if (p.x + DX[d] === q.x && p.y + DY[d] === q.y) return d;
    return lastDir;
  });
  if (opts.dry) {
    opts.dry.push(...pts.map((p, i) => ({ ...p, dir: dirs[i] })));
    return pts.length;
  }
  const { ids } = w.placeBeltSteps(w.planBelt(pts.map((p, i) => ({ ...p, dir: dirs[i] }))));
  opts.placed?.push(...ids);
  return ids.length;
}

/**
 * Branch an existing output line of `from` into `to`: walk along the line, swap one belt for a
 * splitter and lay a belt from it. Falls back to this when a direct route is impossible.
 */
export function tap(w: World, fromId: number, toId: number, opts: { placed?: number[]; undo?: (() => void)[] } = {}): number {
  const direct = route(w, fromId, toId, opts);
  if (direct > 0) return direct;
  if (!w.research.has('logistics')) return -1;
  for (const startId of w.outputsOf(fromId)) {
    const line: Entity[] = [];
    let cur = w.entities.get(startId);
    while (cur && cur.type === 'belt' && (cur.len ?? 1) === 1 && line.length < 200) {
      line.push(cur);
      cur = w.entAt(cur.x + DX[cur.dir], cur.y + DY[cur.dir]);
    }
    for (let i = 1; i < line.length - 1; i++) {
      const b = line[i];
      if (b.shape !== 0 || line[i - 1].dir !== b.dir) continue;
      const { x, y, dir } = b;
      w.remove(b.id);
      const sp = w.place('splitter', x, y, 0);
      if (typeof sp !== 'string') {
        const n = route(w, sp.id, toId, opts);
        if (n > 0) {
          opts.placed?.push(sp.id);
          opts.undo?.push(() => w.place('belt', x, y, dir)); // put the original belt back after the splitter is removed
          return n + 1;
        }
        w.remove(sp.id);
      }
      w.place('belt', x, y, dir);
    }
  }
  return -1;
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



/** Build a representative mid-game town using the regular placement APIs (for screenshots / demo). */
export function showcase(w: World, opts: { cheat?: boolean } = {}) {
  const hc = hallCenter(w);
  const log: string[] = [];
  if (opts.cheat) {
    w.coins = 20000;
    const hall = w.entities.get(w.hallId)!;
    Object.assign(hall.inv, { log: 120, plank: 120, stone: 120, iron: 60, tools: 30, bread: 40 });
    for (const r of ['food', 'stonework', 'logistics', 'housing2', 'improve1', 'metallurgy', 'tools', 'fastbelt', 'housing3', 'improve2'] as const) w.research.add(r);
  }
  const b = (t: BuildingId, near = hc, o: Parameters<typeof findSpot>[3] = {}) => {
    const e = build(w, t, near, o);
    log.push(`${t}:${e ? e.x + ',' + e.y : 'FAIL'}`);
    return e;
  };
  const r = (a: Entity | null, c: Entity | null) => {
    if (!a || !c) return;
    log.push(`route ${a.type}->${c.type}:${route(w, a.id, c.id)}`);
  };
  const hall = w.entities.get(w.hallId)!;
  const l1 = b('lumber', hc, { minEff: 0.9 });
  r(l1, hall);
  const l2 = b('lumber', hc, { minEff: 0.9 });
  const saw = b('sawmill', l2 ? { x: l2.x, y: l2.y } : hc);
  r(l2, saw);
  r(saw, hall);
  const farm = b('farm', hc);
  const mill = b('mill', farm ? { x: farm.x + 1, y: farm.y + 1 } : hc);
  r(farm, mill);
  const bak = b('bakery', mill ? { x: mill.x, y: mill.y } : hc);
  r(mill, bak);
  r(bak, hall);
  // streets
  street(w, hc.x - 6, hc.y + 7, 10);
  street(w, hc.x - 6, hc.y + 10, 10);
  for (let y = hc.y + 3; y <= hc.y + 10; y++) w.place('road', hc.x - 7, y, 0);
  const quarry = b('quarry', hc, { maxDist: 18 });
  r(quarry, hall);
  const mine = b('mine', hc, { maxDist: 22 });
  const smelter = mine ? b('smelter', { x: mine.x, y: mine.y }) : null;
  r(mine, smelter);
  const l3 = smelter ? b('lumber', { x: smelter.x, y: smelter.y }, { minEff: 0.6 }) : null;
  r(l3, smelter);
  const ws = smelter ? b('workshop', { x: smelter.x, y: smelter.y }) : null;
  r(smelter, ws);
  r(ws, hall);
  b('trade', hc);
  log.push(`entities:${w.entities.size}`);
  return log;
}
export const dev = { findSpot, route, tap, build, street, hallCenter, showcase, BUILDINGS };
