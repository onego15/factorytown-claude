// A scripted player for balance tests and the demo time-lapse. It only uses the public World API
// (place / remove / research / upgrade), exactly like mouse input does — no cheats.

import { BuildingId, ResearchId } from '../sim/data';
import { World } from '../sim/world';
import { build, hallCenter, route, tap } from './autoplay';

export function createBot(w: World, verbose = false) {
  const hall = w.entities.get(w.hallId)!;
  const hc = hallCenter(w);
  const timeline: string[] = [];
  const has = (t: BuildingId) => [...w.entities.values()].filter((e) => e.type === t);
  const note = (s: string) => timeline.push(`${(w.time / 60).toFixed(1)}m ${s}`);
  let stage = 0;
  let streetN = 0;
  let lastMilestone = w.milestone;
  let actions = 0;
  const failed = new Set<string>();
  const tryResearch = (id: ResearchId) => {
    if (!w.research.has(id) && !w.activeResearch && !w.canResearch(id)) {
      w.startResearch(id);
      note(`research ${id}`);
    }
  };
  const tryHouse = () => {
    // fill streets near the hall: roads first, then houses beside them
    if (w.coins < 30 || w.stock('log') < 8) return;
    const rows = [hc.y + 5, hc.y + 8, hc.y - 5, hc.y + 11];
    const row = rows[Math.min(streetN, rows.length - 1)];
    const x0 = hc.x - 5;
    let placed = false;
    for (let i = 0; i < 10 && !placed; i++) {
      if (w.entAt(x0 + i, row)?.type !== 'road') w.place('road', x0 + i, row, 0);
      for (const dy of [-1, 1]) {
        if (placed) break;
        const r = w.place('house', x0 + i, row + dy, 0);
        if (typeof r !== 'string') placed = true;
      }
    }
    if (!placed) streetN++;
  };
  const undo = (placed: number[], ents: ({ id: number } | null | undefined)[], fns: (() => void)[] = []) => {
    for (const id of placed) w.remove(id);
    for (const e of ents) if (e) w.remove(e.id);
    for (const f of fns) f();
  };

  /** Call after every simulation tick; the bot thinks every 5 game seconds. */
  function afterTick() {
    if (w.milestone !== lastMilestone) {
      lastMilestone = w.milestone;
      note(`MILESTONE ${w.milestone} pop=${w.pop}`);
    }
    if (w.tickNo % 50 !== 0) return;
    actions++;
    const lumbers = has('lumber').length;
    if (stage >= 2 && w.stock('log') < 15 && lumbers < 3 + has('house').length / 5 && w.coins >= 25) {
      const l = build(w, 'lumber', hc, { minEff: 0.9 });
      if (l && route(w, l.id, hall.id) <= 0) w.remove(l.id);
      else if (l) note('extra lumber→hall');
    }
    if (stage === 0 && w.coins >= 25) {
      const l = build(w, 'lumber', hc, { minEff: 0.9 });
      if (l && route(w, l.id, hall.id) > 0) {
        stage = 1;
        note('lumber→hall');
      } else if (l) w.remove(l.id);
    } else if (stage === 1 && w.coins >= 45 && w.stock('log') >= 8) {
      const l = build(w, 'lumber', hc, { minEff: 0.9 });
      const s = l && build(w, 'sawmill', { x: l.x, y: l.y });
      const placed: number[] = [];
      if (l && s && route(w, l.id, s.id, { placed }) > 0 && route(w, s.id, hall.id, { placed }) > 0) {
        stage = 2;
        note('lumber→sawmill→hall');
      } else undo(placed, [l, s]);
    } else if (stage >= 2) {
      if (has('house').length < 8 + stage * 3) tryHouse();
      // a growing town eats more bread: add another bread line when stocks run dry
      if (stage >= 4 && has('bakery').length < 3 && w.stock('bread') < 5 && w.coins > 400 && w.stock('plank') >= 35 && actions % 12 === 0) {
        const f = build(w, 'farm', hc, { maxDist: 20, avoid: (x, y) => failed.has(`f${x},${y}`) });
        if (f) failed.add(`f${f.x},${f.y}`);
        const m = f && build(w, 'mill', { x: f.x + 1, y: f.y + 1 });
        const b = m && build(w, 'bakery', { x: m.x, y: m.y });
        const placed: number[] = [];
        if (f && m && b && route(w, f.id, m.id, { placed }) > 0 && route(w, m.id, b.id, { placed }) > 0 && route(w, b.id, hall.id, { placed }) > 0) note('extra bread line');
        else undo(placed, [f, m, b]);
      }
      // keep improving buildings once the research allows it (Lv3 only after the tools line exists)
      if (stage >= 4 && w.research.has('improve1'))
        for (const e of w.entities.values())
          if ((e.level === 1 || stage >= 6) && w.canUpgrade(e).ok) {
            w.upgrade(e.id);
            note(`upgrade ${e.type} → Lv${e.level}`);
            break;
          }
      if (stage === 2) {
        tryResearch('food');
        if (w.research.has('food') && w.coins > 150 && w.stock('plank') >= 35 && w.stock('log') >= 5) {
          const f = build(w, 'farm', hc, { avoid: (x, y) => failed.has(`f${x},${y}`) });
          if (f) failed.add(`f${f.x},${f.y}`);
          else failed.clear();
          const m = f && build(w, 'mill', { x: f.x + 1, y: f.y + 1 });
          const b = m && build(w, 'bakery', { x: m.x, y: m.y });
          const placed: number[] = [];
          if (f && m && b && route(w, f.id, m.id, { placed }) > 0 && route(w, m.id, b.id, { placed }) > 0 && route(w, b.id, hall.id, { placed }) > 0) {
            stage = 3;
            note('bread line');
          } else {
            undo(placed, [f, m, b]);
            if (verbose) note('bread line failed');
          }
        }
      } else if (stage === 3) {
        tryResearch('housing2');
        if (w.research.has('housing2')) tryResearch('stonework');
        if (w.research.has('stonework') && w.coins > 80 && w.stock('plank') >= 10) {
          const q = build(w, 'quarry', hc, { maxDist: 20 });
          if (q && route(w, q.id, hall.id) > 0) {
            stage = 4;
            note('quarry');
          } else if (q) w.remove(q.id);
        }
        if (lumbers < 4 && w.coins > 100 && stage === 3) {
          const l = build(w, 'lumber', hc, { minEff: 0.9 });
          if (l && route(w, l.id, hall.id) <= 0) w.remove(l.id);
          else if (l) note('extra lumber');
        }
      } else if (stage === 4) {
        tryResearch('metallurgy');
        if (w.research.has('metallurgy')) tryResearch('logistics');
        tryResearch('improve1');
        if (w.research.has('metallurgy') && w.coins > 250 && w.stock('stone') >= 30) {
          const m = build(w, 'mine', hc, { maxDist: 22, avoid: (x, y) => failed.has(`m${x},${y}`) });
          if (m) failed.add(`m${m.x},${m.y}`);
          else failed.clear();
          const s = m && build(w, 'smelter', { x: m.x, y: m.y });
          const l = s && build(w, 'lumber', { x: s.x, y: s.y }, { minEff: 0.5 });
          const placed: number[] = [];
          if (m && s && l && route(w, m.id, s.id, { placed }) > 0 && route(w, l.id, s.id, { placed }) > 0 && route(w, s.id, hall.id, { placed }) > 0) {
            stage = 5;
            note('iron line');
          } else {
            undo(placed, [m, s, l]);
            if (verbose) note('iron line failed');
          }
        }
      } else if (stage === 5) {
        tryResearch('tools');
        if (w.research.has('tools') && w.coins > 200 && w.stock('iron') >= 12 && w.stock('plank') >= 20) {
          // a workshop fed by a branch of the iron line, plus its own lumber → sawmill pair
          const placed: number[] = [];
          const fns: (() => void)[] = [];
          const sm = has('smelter')[0];
          const ws = build(w, 'workshop', hc, { maxDist: 20, avoid: (x, y) => failed.has(`w${x},${y}`) });
          if (!ws) failed.clear();
          else failed.add(`w${ws.x},${ws.y}`);
          let step = 'ws';
          let s2: ReturnType<typeof build> = null, l: ReturnType<typeof build> = null;
          const ok =
            ws &&
            ((step = 'sm-ws'), tap(w, sm.id, ws.id, { placed, undo: fns }) > 0) &&
            ((step = 'ws-hall'), route(w, ws.id, hall.id, { placed }) > 0) &&
            ((step = 'saw'), (s2 = build(w, 'sawmill', { x: ws.x, y: ws.y }))) &&
            ((step = 'lumber'), (l = build(w, 'lumber', { x: s2.x, y: s2.y }, { minEff: 0.6 }))) &&
            ((step = 's2-ws'), route(w, s2.id, ws.id, { placed }) > 0) &&
            ((step = 'l-s2'), route(w, l.id, s2.id, { placed }) > 0);
          if (ok) {
            stage = 6;
            note('tools line');
          } else {
            undo(placed, [ws, l, s2], fns);
            if (verbose) note('tools line failed ' + step);
          }
        }
      } else if (stage === 6) {
        if (w.research.has('housing3') && has('house').length < 30) tryHouse();
        tryResearch('housing3');
        tryResearch('fastbelt');
        tryResearch('improve2');
      }
    }
  }
  return { afterTick, timeline, get stage() { return stage; } };
}
