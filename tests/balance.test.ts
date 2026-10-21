// A scripted "bot" plays the real game rules without cheats to check pacing and that progression is achievable.
import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { BuildingId, ResearchId } from '../src/sim/data';
import { build, hallCenter, route, tap } from '../src/dev/autoplay';
import { updateQuests } from '../src/sim/quests';

function bot(minutes: number, verbose = false) {
  let w = new World();
  let hall = w.entities.get(w.hallId)!;
  const hc = hallCenter(w);
  const timeline: string[] = [];
  const has = (t: BuildingId) => [...w.entities.values()].filter((e) => e.type === t);
  const note = (s: string) => timeline.push(`${(w.time / 60).toFixed(1)}m ${s}`);
  let stage = 0;
  let streetN = 0;
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
  let lastMilestone = 0;
  const failed = new Set<string>();
  for (let t = 0; t < minutes * 60 * 10; t++) {
    w.tick();
    updateQuests(w);
    if (w.milestone !== lastMilestone) {
      lastMilestone = w.milestone;
      note(`MILESTONE ${w.milestone} pop=${w.pop}`);
    }
    if (t % 50 !== 0) continue; // act every 5s
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
      if (l && s && route(w, l.id, s.id) > 0 && route(w, s.id, hall.id) > 0) {
        stage = 2;
        note('lumber→sawmill→hall');
      }
    } else if (stage >= 2) {
      if (has('house').length < 8 + stage * 3) tryHouse();
      // a growing town eats more bread: add another bread line when stocks run dry
      if (stage >= 4 && has('bakery').length < 3 && w.stock('bread') < 5 && w.coins > 400 && w.stock('plank') >= 35 && t % 600 === 0) {
        const f = build(w, 'farm', hc, { maxDist: 20 });
        const m = f && build(w, 'mill', { x: f.x + 1, y: f.y + 1 });
        const b = m && build(w, 'bakery', { x: m.x, y: m.y });
        const placed: number[] = [];
        if (f && m && b && route(w, f.id, m.id, { placed }) > 0 && route(w, m.id, b.id, { placed }) > 0 && route(w, b.id, hall.id, { placed }) > 0) note('extra bread line');
        else {
          for (const id of placed) w.remove(id);
          for (const e of [f, m, b]) if (e) w.remove(e.id);
        }
      }
      if (stage === 2) {
        tryResearch('food');
        if (w.research.has('food') && w.coins > 150 && w.stock('plank') >= 35 && w.stock('log') >= 5) {
          const f = build(w, 'farm', hc);
          const m = f && build(w, 'mill', { x: f.x + 1, y: f.y + 1 });
          const b = m && build(w, 'bakery', { x: m.x, y: m.y });
          const placed: number[] = [];
          if (f && m && b && route(w, f.id, m.id, { placed }) > 0 && route(w, m.id, b.id, { placed }) > 0 && route(w, b.id, hall.id, { placed }) > 0) {
            stage = 3;
            note('bread line');
          } else {
            const why = !f ? 'farm' : !m ? 'mill' : !b ? 'bakery' : 'route';
            for (const id of placed) w.remove(id);
            for (const e of [f, m, b]) if (e) w.remove(e.id);
            note('bread line failed ' + why + ' ' + w.canAfford({ coins: 0, items: { plank: 35 } }) + ' logs ' + w.stock('log'));
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
        if (w.research.has('improve1'))
          for (const e of w.entities.values()) if (e.level === 1 && w.canUpgrade(e).ok) {
            w.upgrade(e.id);
            note(`upgrade ${e.type}`);
          }
        if (w.research.has('metallurgy') && w.coins > 250 && w.stock('stone') >= 30) {
          const m = build(w, 'mine', hc, { maxDist: 22 });
          const s = m && build(w, 'smelter', { x: m.x, y: m.y });
          const l = s && build(w, 'lumber', { x: s.x, y: s.y }, { minEff: 0.5 });
          if (m && s && l && route(w, m.id, s.id) > 0 && route(w, l.id, s.id) > 0 && route(w, s.id, hall.id) > 0) {
            stage = 5;
            note('iron line');
          } else {
            for (const e of [m, s, l]) if (e) w.remove(e.id);
            note('iron line failed');
          }
        }
      } else if (stage === 5) {
        tryResearch('tools');
        if (w.research.has('tools') && w.coins > 200 && w.stock('iron') >= 12 && w.stock('plank') >= 20) {
          // a workshop next to the smelter (iron first, the hardest connection), then its own lumber → sawmill pair
          const placed: number[] = [];
          const snap = w.serialize();
          const sm = has('smelter')[0];
          const ws = build(w, 'workshop', hc, { maxDist: 20, avoid: (x, y) => failed.has(`w${x},${y}`) });
          if (!ws) failed.clear();
          else failed.add(`w${ws.x},${ws.y}`);
          let step = 'ws';
          let s2: ReturnType<typeof build> = null, l: ReturnType<typeof build> = null;
          const ok =
            ws &&
            ((step = 'sm-ws'), tap(w, sm.id, ws.id, { placed }) > 0) &&
            ((step = 'ws-hall'), route(w, ws.id, hall.id, { placed }) > 0) &&
            ((step = 'saw'), (s2 = build(w, 'sawmill', { x: ws.x, y: ws.y }))) &&
            ((step = 'lumber'), (l = build(w, 'lumber', { x: s2.x, y: s2.y }, { minEff: 0.6 }))) &&
            ((step = 's2-ws'), route(w, s2.id, ws.id, { placed }) > 0) &&
            ((step = 'l-s2'), route(w, l.id, s2.id, { placed }) > 0);
          if (ok) {
            stage = 6;
            note('tools line');
          } else {
            // undo the whole attempt (including any line that was tapped with a splitter)
            w = World.deserialize(snap);
            hall = w.entities.get(w.hallId)!;
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
    if (verbose && t % 3000 === 0) note(`coins=${Math.floor(w.coins)} pop=${w.pop} wf=${w.workforce.toFixed(2)} stock log=${w.stock('log')} plank=${w.stock('plank')} bread=${w.stock('bread')} stone=${w.stock('stone')} iron=${w.stock('iron')} tools=${w.stock('tools')}`);
  }
  return { w, timeline };
}

describe('balance', () => {
  it('a straightforward strategy reaches 村, 町 and 都市 within an hour without cheats', () => {
    const { w, timeline } = bot(60, false);
    console.log(timeline.filter((l) => !l.includes('coins=')).join('\n'));
    console.log('quests done:', [...w.questsDone].join(','));
    const at = (m: number) => timeline.find((l) => l.includes(`MILESTONE ${m}`));
    expect(at(1)).toBeTruthy();
    expect(at(2)).toBeTruthy();
    expect(at(3)).toBeTruthy();
    expect(parseFloat(at(1)!)).toBeGreaterThan(0.5); // not instant
    expect(w.questsDone.size).toBeGreaterThanOrEqual(15);
  }, 120000);
});
