import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { GROUND_GRASS, GROUND_ORE, GROUND_ROCK } from '../src/sim/terrain';
import { BuildingId, ItemId } from '../src/sim/data';

/** A flat, empty test world with a town hall at (20,20). */
function flatWorld(): World {
  const w = new World(1, { empty: true });
  w.terrain.height.fill(1);
  w.terrain.ground.fill(GROUND_GRASS);
  w.terrain.tree.fill(0);
  const hall = w.addEntity('hall', 20, 20, 0);
  w.hallId = hall.id;
  w.coins = 10000;
  hall.inv = { log: 100, plank: 100, stone: 100, iron: 100, tools: 50, bread: 50 };
  w.recount();
  return w;
}

function run(w: World, seconds: number) {
  const n = Math.round(seconds / 0.1);
  for (let i = 0; i < n; i++) w.tick();
}

function belt(w: World, x0: number, y0: number, dir: number, len: number) {
  const dx = [1, 0, -1, 0][dir], dy = [0, 1, 0, -1][dir];
  for (let i = 0; i < len; i++) {
    const r = w.place('belt', x0 + dx * i, y0 + dy * i, dir);
    if (typeof r === 'string') throw new Error(`belt at ${x0 + dx * i},${y0 + dy * i}: ${r}`);
  }
}

function place(w: World, t: BuildingId, x: number, y: number, rot = 0) {
  const r = w.place(t, x, y, rot);
  if (typeof r === 'string') throw new Error(`${t} at ${x},${y}: ${r}`);
  return r;
}

function trees(w: World, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.terrain.tree[w.idx(x, y)] = 1;
}

function itemsOnBelts(w: World, item?: ItemId) {
  let n = 0;
  for (const e of w.entities.values()) if (e.items) n += e.items.filter((i) => !item || i.item === item).length;
  return n;
}

describe('placement', () => {
  it('rejects water, slopes, overlaps and wrong deposits', () => {
    const w = flatWorld();
    w.terrain.height[w.idx(5, 5)] = -1;
    expect(w.checkPlace('house', 5, 5, 0).ok).toBe(false);
    w.terrain.height[w.idx(8, 9)] = 2;
    const c = w.checkPlace('sawmill', 8, 8, 0);
    expect(c.ok).toBe(false);
    expect(c.reason).toContain('平ら');
    expect(w.checkPlace('house', 21, 21, 0).reason).toContain('重な');
    w.terrain.ground[w.idx(12, 12)] = GROUND_ROCK;
    expect(w.checkPlace('house', 12, 12, 0).ok).toBe(false);
    // quarry needs research first
    expect(w.checkPlace('quarry', 12, 12, 0).reason).toContain('研究');
    w.research.add('stonework');
    w.topoDirty = true;
    expect(w.checkPlace('quarry', 12, 12, 0).ok).toBe(true);
    expect(w.checkPlace('quarry', 2, 2, 0).ok).toBe(false);
    // lumber camp needs trees
    expect(w.checkPlace('lumber', 2, 2, 0).reason).toContain('木');
  });

  it('charges and refunds cost', () => {
    const w = flatWorld();
    const c0 = w.coins, l0 = w.stock('log');
    const s = place(w, 'sawmill', 5, 5);
    expect(w.coins).toBe(c0 - 40);
    expect(w.stock('log')).toBe(l0 - 8);
    w.remove(s.id);
    expect(w.coins).toBe(c0);
    expect(w.stock('log')).toBe(l0);
  });

  it('refuses when broke', () => {
    const w = flatWorld();
    w.coins = 5;
    expect(w.checkPlace('lumber', 5, 5, 0).ok).toBe(false);
  });
});

describe('logistics and production', () => {
  it('lumber camp → belt → hall increases hall stock', () => {
    const w = flatWorld();
    trees(w, 5, 16, 9, 23);
    const hall = w.entities.get(w.hallId)!;
    hall.inv.log = 0;
    place(w, 'lumber', 10, 19); // occupies 10..11, 19..20
    belt(w, 12, 20, 0, 8); // x 12..19 → hall at x=20
    run(w, 60);
    expect(hall.inv.log!).toBeGreaterThan(8);
    // conservation: produced = in hall + on belts + in buffer
    const lumber = [...w.entities.values()].find((e) => e.type === 'lumber')!;
    const produced = lumber.cycles.length; // within last 60s == all
    expect(hall.inv.log! + itemsOnBelts(w, 'log') + (lumber.out.log ?? 0)).toBe(produced);
  });

  it('sawmill converts logs to planks and only accepts its inputs', () => {
    const w = flatWorld();
    const hall = w.entities.get(w.hallId)!;
    hall.inv.plank = 0;
    trees(w, 2, 2, 8, 8);
    place(w, 'lumber', 4, 9);
    belt(w, 6, 9, 0, 4); // x6..9
    const saw = place(w, 'sawmill', 10, 9);
    belt(w, 12, 9, 0, 8); // to x 19, hall at 20..22 y20..22 → doesn't touch; route down
    // reroute: belt from (19,9) down to y=20 then right into hall
    belt(w, 19, 9, 1, 11); // 19,9..19,19 (overwrites 19,9 direction)
    belt(w, 19, 20, 0, 1);
    run(w, 90);
    expect(hall.inv.plank!).toBeGreaterThan(5);
    expect(w.accepts(saw, 'wheat')).toBe(false);
    expect(w.accepts(saw, 'log')).toBe(true);
  });

  it('belts stop at dead ends without losing items', () => {
    const w = flatWorld();
    trees(w, 2, 2, 8, 8);
    const lumber = place(w, 'lumber', 4, 9);
    belt(w, 6, 9, 0, 3);
    run(w, 120);
    const onBelt = itemsOnBelts(w);
    expect(onBelt).toBeLessThanOrEqual(15);
    expect(onBelt).toBeGreaterThan(8);
    expect(lumber.status).toBe('outputFull');
    // spacing respected
    for (const e of w.entities.values())
      if (e.items) for (let i = 1; i < e.items.length; i++) expect(e.items[i - 1].pos - e.items[i].pos).toBeGreaterThanOrEqual(0.249);
  });

  it('side-loading merges two lines', () => {
    const w = flatWorld();
    trees(w, 0, 0, 12, 8);
    trees(w, 2, 12, 5, 16);
    place(w, 'lumber', 2, 9); // x2-3, y9-10 → outputs to (4,9)
    place(w, 'lumber', 6, 12); // x6-7, y12-13 → outputs to (8,12)
    belt(w, 4, 9, 0, 6); // x4..9 at y=9
    belt(w, 10, 9, 1, 11); // down x=10, y9..19 (curves in at the top)
    belt(w, 10, 20, 0, 10); // x10..19 → hall
    belt(w, 8, 12, 0, 2); // side-loads into (10,12)
    w.entities.get(w.hallId)!.inv.log = 0;
    run(w, 100);
    expect(w.entAt(10, 9)!.shape).toBe(2);
    expect(w.entAt(10, 12)!.shape).toBe(0);
    const hall = w.entities.get(w.hallId)!;
    const camps = [...w.entities.values()].filter((e) => e.type === 'lumber');
    expect(camps.every((c) => c.cycles.length > 5)).toBe(true);
    expect(hall.inv.log!).toBeGreaterThan(20);
  });

  it('splitter alternates between outputs', () => {
    const w = flatWorld();
    w.research.add('logistics');
    trees(w, 0, 0, 6, 6);
    place(w, 'lumber', 2, 8);
    belt(w, 4, 8, 0, 2);
    place(w, 'splitter', 6, 8);
    belt(w, 6, 7, 3, 3); // up
    belt(w, 6, 9, 1, 3); // down
    run(w, 60);
    const up = [w.entAt(6, 7)!, w.entAt(6, 6)!, w.entAt(6, 5)!].reduce((s, e) => s + e.items!.length, 0);
    const down = [w.entAt(6, 9)!, w.entAt(6, 10)!, w.entAt(6, 11)!].reduce((s, e) => s + e.items!.length, 0);
    expect(up).toBeGreaterThan(3);
    expect(Math.abs(up - down)).toBeLessThanOrEqual(2);
  });

  it('multi-input recipe (smelter) waits for all inputs', () => {
    const w = flatWorld();
    w.research.add('stonework');
    w.research.add('metallurgy');
    const sm = place(w, 'smelter', 5, 5);
    sm.inv.ore = 6;
    run(w, 10);
    expect(sm.status).toBe('noInput');
    expect(sm.out.iron ?? 0).toBe(0);
    sm.inv.log = 3;
    run(w, 16);
    expect(sm.out.iron!).toBe(3);
    expect(sm.inv.ore).toBe(0);
    expect(sm.inv.log).toBe(0);
  });

  it('ramps connect across one terrain level but not two', () => {
    const w = flatWorld();
    for (let y = 0; y < 48; y++) for (let x = 30; x < 48; x++) w.terrain.height[w.idx(x, y)] = 2;
    trees(w, 24, 2, 28, 6);
    place(w, 'lumber', 25, 8);
    belt(w, 27, 8, 0, 6); // crosses from level 1 to 2 at x=30
    run(w, 40);
    expect(w.entAt(32, 8)!.items!.length).toBeGreaterThan(0);
    const b = w.entAt(29, 8)!;
    expect(b.yOut!).toBeGreaterThan(b.yIn!);
  });
});

describe('town', () => {
  it('houses take goods from the hall, pay taxes and grow', () => {
    const w = flatWorld();
    for (let x = 18; x < 26; x++) place(w, 'road', x, 24);
    const h = place(w, 'house', 19, 25);
    const hall = w.entities.get(w.hallId)!;
    const logs0 = hall.inv.log!;
    const coins0 = w.coins;
    run(w, 5);
    expect(h.happy).toBe(true);
    expect(hall.inv.log!).toBeLessThan(logs0);
    run(w, 60);
    expect(w.coins).toBeGreaterThan(coins0);
    expect(h.tier).toBe(0); // needs research
    w.research.add('housing2');
    run(w, 20);
    expect(h.tier).toBe(1);
    expect(w.pop).toBeGreaterThanOrEqual(6 + 6);
  });

  it('houses outside coverage stay unhappy and downgrade', () => {
    const w = flatWorld();
    const h = place(w, 'house', 2, 2);
    h.tier = 1;
    run(w, 70);
    expect(h.happy).toBe(false);
    expect(h.tier).toBe(0);
  });

  it('workforce limits production speed', () => {
    const w = flatWorld();
    trees(w, 0, 0, 40, 1);
    for (let i = 0; i < 12; i++) place(w, 'lumber', 1 + i * 3, 2);
    w.recount();
    expect(w.workforce).toBeLessThan(1);
  });

  it('trading post sells goods for coins', () => {
    const w = flatWorld();
    const t = place(w, 'trade', 5, 5);
    t.inv.plank = 5;
    const c0 = w.coins;
    run(w, 7);
    expect(t.inv.plank).toBe(0);
    expect(w.coins).toBeCloseTo(c0 + 15, 0);
  });
});

describe('research & upgrades', () => {
  it('research costs resources, takes time and unlocks buildings', () => {
    const w = flatWorld();
    const c0 = w.coins, p0 = w.stock('plank');
    expect(w.isUnlocked('mill')).toBe(false);
    expect(w.startResearch('food')).toBe(true);
    expect(w.coins).toBe(c0 - 60);
    expect(w.stock('plank')).toBe(p0 - 15);
    expect(w.startResearch('stonework')).toBe(false); // one at a time
    run(w, 11);
    expect(w.isUnlocked('mill')).toBe(true);
    expect(w.canResearch('housing3')).toContain('先に');
  });

  it('upgrades raise production speed', () => {
    const w = flatWorld();
    const s = place(w, 'sawmill', 5, 5);
    expect(w.canUpgrade(s).ok).toBe(false);
    w.research.add('improve1');
    const r1 = w.maxRate(s);
    expect(w.upgrade(s.id)).toBe(true);
    expect(s.level).toBe(2);
    expect(w.maxRate(s)).toBeCloseTo(r1 * 1.6);
  });
});

describe('save / load', () => {
  it('round-trips the full state and continues simulating identically', () => {
    const w = flatWorld();
    trees(w, 2, 16, 8, 23);
    place(w, 'lumber', 10, 19);
    belt(w, 12, 20, 0, 8);
    place(w, 'house', 19, 25);
    run(w, 20);
    w.startResearch('food');
    run(w, 3.4);
    const json = w.serialize();
    const w2 = World.deserialize(json);
    expect(w2.coins).toBeCloseTo(w.coins);
    expect(w2.entities.size).toBe(w.entities.size);
    expect(itemsOnBelts(w2)).toBe(itemsOnBelts(w));
    expect(w2.activeResearch).toBe('food');
    run(w, 30);
    run(w2, 30);
    const h1 = w.entities.get(w.hallId)!, h2 = w2.entities.get(w2.hallId)!;
    expect(h2.inv.log).toBe(h1.inv.log);
    expect(itemsOnBelts(w2)).toBe(itemsOnBelts(w));
    expect(w2.research.has('food')).toBe(true);
  });

  it('the real generated map has the resources needed', () => {
    const w = new World();
    let rock = 0, ore = 0, trees = 0;
    for (let i = 0; i < w.W * w.H; i++) {
      if (w.terrain.ground[i] === GROUND_ROCK) rock++;
      if (w.terrain.ground[i] === GROUND_ORE) ore++;
      if (w.terrain.tree[i]) trees++;
    }
    expect(rock).toBeGreaterThan(10);
    expect(ore).toBeGreaterThan(10);
    expect(trees).toBeGreaterThan(150);
    expect(w.entities.get(w.hallId)!.type).toBe('hall');
  });
});
