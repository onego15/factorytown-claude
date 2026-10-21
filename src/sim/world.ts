// The simulation: world state, construction, logistics, production, town and research.

import {
  BELT_BASE_SPEED, BELT_SPACING, BUILDINGS, BuildingId, Cost, HALL_WORKERS, HOUSE_CONSUME_INTERVAL,
  HOUSE_DOWNGRADE_TIME, HOUSE_TIERS, HOUSE_UPGRADE_TIME, ITEMS, ITEM_IDS, ItemBag, ItemId, LEVEL_SPEED, MILESTONES,
  RESEARCH, ResearchId, TICK, UPGRADE_COST,
} from './data';
import { BELT_Y, BeltGeom, DX, DY, LEVEL_H, V3, beltPoint, leftOf, opposite, rightOf } from './geom';
import { GROUND_ORE, GROUND_ROCK, Terrain, generateTerrain } from './terrain';

export type Status = 'idle' | 'working' | 'noInput' | 'outputFull' | 'noWorkers' | 'noResource' | 'noCustomer';

export interface BeltItem {
  id: number;
  stamp?: number;
  item: ItemId;
  pos: number;
  // world position at the previous tick (for render interpolation)
  px: number;
  py: number;
  pz: number;
}

export interface Entity {
  id: number;
  type: BuildingId;
  x: number;
  y: number;
  w: number;
  h: number;
  dir: number;
  level: number;
  built: number;
  inv: ItemBag;
  out: ItemBag;
  progress: number;
  crafting: boolean;
  status: Status;
  eff: number;
  rr: number;
  cycles: number[];
  // belts
  items?: BeltItem[];
  shape?: number;
  yIn?: number;
  yOut?: number;
  // houses
  tier?: number;
  supply?: ItemBag;
  happy?: boolean;
  happyT?: number;
  unhappyT?: number;
  consumeT?: number;
  refillT?: number;
  roadAdj?: boolean;
  covered?: boolean;
  variant?: number;
}

export type GameEvent =
  | { t: 'built'; id: number }
  | { t: 'removed'; ent: Entity }
  | { t: 'changed'; id: number }
  | { t: 'produced'; id: number; item: ItemId }
  | { t: 'deliver'; from: number; to: number; item: ItemId }
  | { t: 'sold'; id: number; item: ItemId; coins: number }
  | { t: 'houseTier'; id: number; tier: number; up: boolean }
  | { t: 'research'; id: ResearchId }
  | { t: 'milestone'; index: number }
  | { t: 'upgraded'; id: number };

export interface PlaceCheck {
  ok: boolean;
  reason?: string;
  warn?: string;
  eff?: number;
  badTiles: number[]; // tile indices that are invalid
  clearsTrees: number;
}

const STAT_SECONDS = 60;

export class World {
  terrain: Terrain;
  W: number;
  H: number;
  time = 0;
  coins = 250;
  entities = new Map<number, Entity>();
  tileEnt: Int32Array;
  nextId = 1;
  nextItemId = 1;
  research = new Set<ResearchId>();
  activeResearch: ResearchId | null = null;
  researchProgress = 0;
  milestone = 0;
  events: GameEvent[] = [];
  topoDirty = true;
  hallId = 0;
  pop = 0;
  workersNeeded = 0;
  workforce = 1;
  // rolling statistics: [second][item]
  statProd: Float32Array[] = [];
  statCons: Float32Array[] = [];
  statCoins: Float32Array = new Float32Array(STAT_SECONDS);
  statSecond = 0;
  private outputs = new Map<number, number[]>(); // building id -> belt ids it can push into
  private coverage = new Map<number, number[]>(); // house id -> distributor ids by distance
  private tmp: V3 = { x: 0, y: 0, z: 0 };
  private tickAcc = 0;
  private tickNo = 0;

  constructor(seed = 20261021, opts: { empty?: boolean } = {}) {
    this.terrain = generateTerrain(seed);
    this.W = this.terrain.w;
    this.H = this.terrain.h;
    this.tileEnt = new Int32Array(this.W * this.H);
    for (let i = 0; i < STAT_SECONDS; i++) {
      this.statProd.push(new Float32Array(ITEM_IDS.length));
      this.statCons.push(new Float32Array(ITEM_IDS.length));
    }
    if (!opts.empty) this.setupStart();
  }

  // ---------------------------------------------------------------- setup
  private setupStart() {
    const cx = Math.floor(this.W / 2) - 1, cy = Math.floor(this.H / 2) - 1;
    const hall = this.addEntity('hall', cx, cy, 0);
    this.hallId = hall.id;
    hall.inv = { log: 30, plank: 10 };
    // A little lane of road and three starting cottages
    for (let x = cx - 3; x <= cx + 5; x++) this.addEntity('road', x, cy + 3, 0);
    this.addEntity('house', cx - 2, cy + 4, 0);
    this.addEntity('house', cx - 1, cy + 4, 0);
    this.addEntity('house', cx + 3, cy + 4, 0);
    for (const e of this.entities.values()) if (e.type === 'house') e.supply = { log: 2 };
    this.recount();
  }

  // ---------------------------------------------------------------- helpers
  idx(x: number, y: number) {
    return y * this.W + x;
  }
  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.W && y < this.H;
  }
  heightAt(x: number, y: number) {
    return this.inBounds(x, y) ? this.terrain.height[this.idx(x, y)] : -1;
  }
  entAt(x: number, y: number): Entity | undefined {
    if (!this.inBounds(x, y)) return undefined;
    const id = this.tileEnt[this.idx(x, y)];
    return id ? this.entities.get(id) : undefined;
  }
  footprint(type: BuildingId, rot: number): [number, number] {
    const [w, h] = BUILDINGS[type].size;
    return rot % 2 === 0 ? [w, h] : [h, w];
  }
  isUnlocked(type: BuildingId) {
    const u = BUILDINGS[type].unlock;
    return !u || this.research.has(u);
  }
  contains(e: Entity, x: number, y: number) {
    return x >= e.x && y >= e.y && x < e.x + e.w && y < e.y + e.h;
  }
  center(e: Entity) {
    return { x: e.x + e.w / 2, y: e.y + e.h / 2 };
  }

  /** Total stock of an item across storage buildings */
  stock(item: ItemId) {
    let s = 0;
    for (const e of this.entities.values()) if (this.isStorage(e)) s += e.inv[item] ?? 0;
    return s;
  }
  isStorage(e: Entity) {
    const k = BUILDINGS[e.type].kind;
    return k === 'hall' || k === 'storage';
  }
  isDistributor(e: Entity) {
    return e.type === 'hall' || e.type === 'market';
  }
  canAfford(cost: Cost): string | null {
    if (this.coins < cost.coins) return 'コインが足りません';
    for (const [k, v] of Object.entries(cost.items ?? {})) {
      if (this.stock(k as ItemId) < (v as number)) return `${ITEMS[k as ItemId].name}が足りません（倉庫に${v}必要）`;
    }
    return null;
  }
  pay(cost: Cost) {
    this.coins -= cost.coins;
    for (const [k, v] of Object.entries(cost.items ?? {})) this.takeFromStorage(k as ItemId, v as number);
  }
  private storagesByPriority(): Entity[] {
    const arr = [...this.entities.values()].filter((e) => this.isStorage(e));
    // hall & warehouses first, markets last (keep markets stocked for houses)
    arr.sort((a, b) => (a.type === 'market' ? 1 : 0) - (b.type === 'market' ? 1 : 0));
    return arr;
  }
  takeFromStorage(item: ItemId, n: number) {
    for (const e of this.storagesByPriority()) {
      if (n <= 0) break;
      const have = e.inv[item] ?? 0;
      const t = Math.min(have, n);
      if (t > 0) {
        e.inv[item] = have - t;
        n -= t;
      }
    }
  }
  giveToStorage(item: ItemId, n: number) {
    for (const e of this.storagesByPriority()) {
      if (n <= 0) break;
      const cap = BUILDINGS[e.type].storageCap ?? 0;
      const have = e.inv[item] ?? 0;
      const t = Math.min(cap - have, n);
      if (t > 0) {
        e.inv[item] = have + t;
        n -= t;
      }
    }
  }

  // ---------------------------------------------------------------- entity management
  addEntity(type: BuildingId, x: number, y: number, dir: number): Entity {
    const [w, h] = this.footprint(type, dir);
    const e: Entity = {
      id: this.nextId++, type, x, y, w, h, dir, level: 1, built: this.time,
      inv: {}, out: {}, progress: 0, crafting: false, status: 'idle', eff: 1, rr: 0, cycles: [],
    };
    if (type === 'belt') {
      e.items = [];
      e.shape = 0;
    }
    if (type === 'house') {
      e.tier = 0;
      e.supply = {};
      e.happy = false;
      e.happyT = 0;
      e.unhappyT = 0;
      e.consumeT = 0;
      e.refillT = 0;
      e.variant = (x * 7 + y * 13) % 5;
    }
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        const i = this.idx(xx, yy);
        this.tileEnt[i] = e.id;
        this.terrain.tree[i] = 0;
      }
    this.entities.set(e.id, e);
    this.topoDirty = true;
    this.events.push({ t: 'built', id: e.id });
    return e;
  }

  checkPlace(type: BuildingId, x: number, y: number, rot: number, ignoreCost = false): PlaceCheck {
    const def = BUILDINGS[type];
    const [w, h] = this.footprint(type, rot);
    const res: PlaceCheck = { ok: true, badTiles: [], clearsTrees: 0 };
    const fail = (r: string) => {
      if (res.ok) {
        res.ok = false;
        res.reason = r;
      }
    };
    if (type === 'hall') fail('町役場は建設できません');
    if (!this.isUnlocked(type)) fail('研究で解放されていません');
    let h0: number | null = null;
    let deposits = 0;
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        if (!this.inBounds(xx, yy)) {
          fail('マップの外です');
          continue;
        }
        const i = this.idx(xx, yy);
        const ht = this.terrain.height[i];
        const g = this.terrain.ground[i];
        let bad = false;
        if (ht < 0) {
          fail('水の上には建てられません');
          bad = true;
        }
        if (h0 === null) h0 = ht;
        else if (ht !== h0) {
          fail('平らな土地が必要です');
          bad = true;
        }
        const occ = this.tileEnt[i];
        if (occ) {
          const o = this.entities.get(occ)!;
          // belts may be re-laid over belts (direction change)
          if (!(type === 'belt' && o.type === 'belt')) {
            fail('他の建物と重なっています');
            bad = true;
          }
        }
        const isDeposit = g === GROUND_ROCK || g === GROUND_ORE;
        if (def.needs === 'rock' && g === GROUND_ROCK) deposits++;
        else if (def.needs === 'ore' && g === GROUND_ORE) deposits++;
        else if (isDeposit && def.kind !== 'belt' && def.kind !== 'road' && def.kind !== 'splitter') {
          fail(g === GROUND_ROCK ? '岩場には採石場しか建てられません' : '鉄鉱脈には鉱山しか建てられません');
          bad = true;
        }
        if (this.terrain.tree[i]) res.clearsTrees++;
        if (bad) res.badTiles.push(i);
      }
    if (def.needs === 'rock' || def.needs === 'ore') {
      res.eff = deposits / (w * h);
      if (deposits === 0) fail(def.needs === 'rock' ? '岩場の上に建ててください' : '鉄鉱脈の上に建ててください');
    }
    if (def.needs === 'trees') {
      const n = this.countTrees(x, y, w, h, def.radius ?? 3);
      res.eff = Math.min(1, n / 8);
      if (n === 0) fail('近くに木がありません');
      else if (n < 8) res.warn = `近くの木が少なめです（効率 ${Math.round(res.eff * 100)}%）`;
    }
    if (res.ok && !ignoreCost) {
      const existing = this.entAt(x, y);
      const free = type === 'belt' && existing?.type === 'belt';
      const c = free ? null : this.canAfford(def.cost);
      if (c) fail(c);
    }
    if (res.ok && res.clearsTrees > 0 && !res.warn) res.warn = `木を${res.clearsTrees}本伐採します`;
    return res;
  }

  countTrees(x: number, y: number, w: number, h: number, r: number) {
    let n = 0;
    const cx = x + w / 2, cy = y + h / 2;
    for (let yy = Math.floor(cy - r - 1); yy <= cy + r; yy++)
      for (let xx = Math.floor(cx - r - 1); xx <= cx + r; xx++) {
        if (!this.inBounds(xx, yy)) continue;
        if (xx >= x && yy >= y && xx < x + w && yy < y + h) continue;
        const d = Math.hypot(xx + 0.5 - cx, yy + 0.5 - cy);
        if (d <= r + 0.5 && this.terrain.tree[this.idx(xx, yy)]) n++;
      }
    return n;
  }

  /** Place a building. Returns the entity or a failure reason. */
  place(type: BuildingId, x: number, y: number, rot: number): Entity | string {
    const chk = this.checkPlace(type, x, y, rot);
    if (!chk.ok) return chk.reason!;
    if (type === 'belt') {
      const existing = this.entAt(x, y);
      if (existing && existing.type === 'belt') {
        if (existing.dir !== rot) {
          existing.dir = rot;
          this.topoDirty = true;
          this.events.push({ t: 'changed', id: existing.id });
        }
        return existing;
      }
    }
    this.pay(BUILDINGS[type].cost);
    const e = this.addEntity(type, x, y, rot);
    this.recount();
    return e;
  }

  remove(id: number): boolean {
    const e = this.entities.get(id);
    if (!e || e.type === 'hall') return false;
    for (let yy = e.y; yy < e.y + e.h; yy++)
      for (let xx = e.x; xx < e.x + e.w; xx++) this.tileEnt[this.idx(xx, yy)] = 0;
    this.entities.delete(id);
    const def = BUILDINGS[e.type];
    this.coins += def.cost.coins;
    for (const [k, v] of Object.entries(def.cost.items ?? {})) this.giveToStorage(k as ItemId, v as number);
    this.topoDirty = true;
    this.events.push({ t: 'removed', ent: e });
    this.recount();
    return true;
  }

  rotateBelt(id: number) {
    const e = this.entities.get(id);
    if (!e || (e.type !== 'belt')) return;
    e.dir = (e.dir + 1) & 3;
    this.topoDirty = true;
    this.events.push({ t: 'changed', id });
  }

  canUpgrade(e: Entity): { ok: boolean; reason?: string; cost?: Cost } {
    const def = BUILDINGS[e.type];
    if (!def.upgradable) return { ok: false, reason: 'この建物は改良できません' };
    if (e.level >= 3) return { ok: false, reason: '最大レベルです' };
    const next = (e.level + 1) as 2 | 3;
    const cost = UPGRADE_COST[next];
    const need: ResearchId = next === 2 ? 'improve1' : 'improve2';
    if (!this.research.has(need)) return { ok: false, reason: `研究「${RESEARCH[need].name}」が必要です`, cost };
    const c = this.canAfford(cost);
    if (c) return { ok: false, reason: c, cost };
    return { ok: true, cost };
  }

  upgrade(id: number): boolean {
    const e = this.entities.get(id);
    if (!e) return false;
    const u = this.canUpgrade(e);
    if (!u.ok) return false;
    this.pay(u.cost!);
    e.level++;
    this.events.push({ t: 'upgraded', id });
    return true;
  }

  // ---------------------------------------------------------------- research
  canResearch(id: ResearchId): string | null {
    const r = RESEARCH[id];
    if (this.research.has(id)) return '研究済みです';
    if (this.activeResearch) return '別の研究が進行中です';
    for (const p of r.prereq) if (!this.research.has(p)) return `「${RESEARCH[p].name}」が先に必要です`;
    return this.canAfford(r.cost);
  }
  startResearch(id: ResearchId): boolean {
    if (this.canResearch(id)) return false;
    this.pay(RESEARCH[id].cost);
    this.activeResearch = id;
    this.researchProgress = 0;
    return true;
  }

  // ---------------------------------------------------------------- topology
  private refreshTopology() {
    this.topoDirty = false;
    const W = this.W, H = this.H;
    // belt shapes and heights
    for (const e of this.entities.values()) {
      if (e.type !== 'belt') continue;
      const d = e.dir;
      const hb = this.heightAt(e.x, e.y);
      const back = this.entAt(e.x - DX[d], e.y - DY[d]);
      let backFeeds = false;
      if (back) {
        if (back.type === 'belt') backFeeds = back.dir === d;
        else backFeeds = this.isOutputter(back);
      }
      const sideFeeds = (sd: number) => {
        const s = this.entAt(e.x + DX[sd], e.y + DY[sd]);
        return !!s && s.type === 'belt' && s.dir === opposite(sd) && Math.abs(this.heightAt(s.x, s.y) - hb) <= 1;
      };
      const l = sideFeeds(leftOf(d)), r = sideFeeds(rightOf(d));
      e.shape = !backFeeds && l !== r ? (l ? 1 : 2) : 0;
      const hf = this.heightAt(e.x + DX[d], e.y + DY[d]);
      const hk = this.heightAt(e.x - DX[d], e.y - DY[d]);
      const base = hb * LEVEL_H + BELT_Y;
      e.yIn = base;
      e.yOut = base;
      if (e.shape === 0) {
        if (hf === hb + 1) e.yOut = base + LEVEL_H;
        if (hk === hb + 1 && (back?.type === 'belt' || back === undefined)) e.yIn = base + LEVEL_H;
      }
    }
    // building outputs
    this.outputs.clear();
    for (const e of this.entities.values()) {
      if (!this.isOutputter(e)) continue;
      const list: number[] = [];
      const visit = (x: number, y: number) => {
        const b = this.entAt(x, y);
        if (!b || b.type !== 'belt') return;
        // belt must point away from the building
        if (this.contains(e, b.x - DX[b.dir], b.y - DY[b.dir])) list.push(b.id);
      };
      for (let x = e.x; x < e.x + e.w; x++) {
        visit(x, e.y - 1);
        visit(x, e.y + e.h);
      }
      for (let y = e.y; y < e.y + e.h; y++) {
        visit(e.x - 1, y);
        visit(e.x + e.w, y);
      }
      this.outputs.set(e.id, list);
      const def = BUILDINGS[e.type];
      if (def.needs === 'trees') e.eff = Math.min(1, this.countTrees(e.x, e.y, e.w, e.h, def.radius ?? 3) / 8);
      else if (def.needs === 'rock' || def.needs === 'ore') {
        let n = 0;
        const g = def.needs === 'rock' ? GROUND_ROCK : GROUND_ORE;
        for (let y = e.y; y < e.y + e.h; y++)
          for (let x = e.x; x < e.x + e.w; x++) if (this.terrain.ground[this.idx(x, y)] === g) n++;
        e.eff = n / (e.w * e.h);
      }
    }
    // houses: road adjacency & coverage
    this.coverage.clear();
    const dists = [...this.entities.values()].filter((e) => this.isDistributor(e));
    for (const e of this.entities.values()) {
      if (e.type !== 'house') continue;
      let road = false;
      for (let d = 0; d < 4; d++) if (this.entAt(e.x + DX[d], e.y + DY[d])?.type === 'road') road = true;
      e.roadAdj = road;
      const c = this.center(e);
      const cov = dists
        .map((m) => {
          const mc = this.center(m);
          return { id: m.id, d: Math.hypot(mc.x - c.x, mc.y - c.y), r: BUILDINGS[m.type].radius ?? 0 };
        })
        .filter((o) => o.d <= o.r + 0.5)
        .sort((a, b) => a.d - b.d)
        .map((o) => o.id);
      this.coverage.set(e.id, cov);
      e.covered = cov.length > 0;
    }
    void W;
    void H;
  }

  /** Can this entity push items onto belts? */
  isOutputter(e: Entity) {
    const k = BUILDINGS[e.type].kind;
    return k === 'gatherer' || k === 'crafter' || k === 'splitter';
  }

  outputsOf(id: number) {
    if (this.topoDirty) this.refreshTopology();
    return this.outputs.get(id) ?? [];
  }
  coverageOf(id: number) {
    if (this.topoDirty) this.refreshTopology();
    return this.coverage.get(id) ?? [];
  }
  ensureTopology() {
    if (this.topoDirty) this.refreshTopology();
  }

  /** Can building e take one more unit of item from a belt? */
  accepts(e: Entity, item: ItemId): boolean {
    const def = BUILDINGS[e.type];
    switch (def.kind) {
      case 'crafter': {
        const need = def.recipe!.in[item];
        if (!need) return false;
        return (e.inv[item] ?? 0) < Math.max(4, need * 3);
      }
      case 'hall':
      case 'storage':
        return (e.inv[item] ?? 0) < (def.storageCap ?? 0);
      case 'trade': {
        let tot = 0;
        for (const v of Object.values(e.inv)) tot += v as number;
        return tot < (def.storageCap ?? 10);
      }
      case 'splitter': {
        let tot = 0;
        for (const v of Object.values(e.inv)) tot += v as number;
        return tot < 1;
      }
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------- main loop
  /** Advance by real seconds (accumulates fixed ticks). Returns ticks run. */
  advance(seconds: number, maxTicks = 40): number {
    this.tickAcc += seconds;
    let n = 0;
    while (this.tickAcc >= TICK && n < maxTicks) {
      this.tick();
      this.tickAcc -= TICK;
      n++;
    }
    if (n >= maxTicks) this.tickAcc = 0;
    return n;
  }
  get tickAlpha() {
    return Math.min(1, this.tickAcc / TICK);
  }

  tick() {
    const dt = TICK;
    this.tickNo++;
    if (this.topoDirty) this.refreshTopology();
    const prevSec = Math.floor(this.time);
    this.time += dt;
    const sec = Math.floor(this.time);
    if (sec !== prevSec) this.rollStats(sec);

    this.updateBelts(dt);
    this.updateBuildings(dt);
    this.updateHouses(dt);
    this.updateResearch(dt);
    this.recount();
    this.checkMilestones();
  }

  private rollStats(sec: number) {
    const s = sec % STAT_SECONDS;
    this.statSecond = s;
    this.statProd[s].fill(0);
    this.statCons[s].fill(0);
    this.statCoins[s] = 0;
  }
  private addStat(arr: Float32Array[], item: ItemId, n: number) {
    arr[this.statSecond][ITEM_IDS.indexOf(item)] += n;
  }
  private earn(c: number) {
    this.coins += c;
    this.statCoins[this.statSecond] += c;
  }
  /** Production per minute over the last minute */
  rates(): { prod: Record<ItemId, number>; cons: Record<ItemId, number>; coins: number } {
    const prod = {} as Record<ItemId, number>, cons = {} as Record<ItemId, number>;
    const span = Math.min(STAT_SECONDS, Math.max(1, Math.floor(this.time)));
    const k = 60 / span;
    ITEM_IDS.forEach((it, i) => {
      let p = 0, c = 0;
      for (let s = 0; s < STAT_SECONDS; s++) {
        p += this.statProd[s][i];
        c += this.statCons[s][i];
      }
      prod[it] = p * k;
      cons[it] = c * k;
    });
    let coins = 0;
    for (let s = 0; s < STAT_SECONDS; s++) coins += this.statCoins[s];
    return { prod, cons, coins: coins * k };
  }

  beltSpeed() {
    return BELT_BASE_SPEED * (this.research.has('fastbelt') ? 1.75 : 1);
  }

  private beltGeom(e: Entity): BeltGeom {
    return e as unknown as BeltGeom;
  }

  /** Try to move an item into the entity at tile (x,y) coming from belt `from`. */
  private transfer(from: Entity, item: BeltItem, overflow: number): boolean {
    const tx = from.x + DX[from.dir], ty = from.y + DY[from.dir];
    const t = this.entAt(tx, ty);
    if (!t) return false;
    if (t.type === 'belt') {
      if (t.dir === opposite(from.dir)) return false;
      if (Math.abs(this.heightAt(tx, ty) - this.heightAt(from.x, from.y)) > 1) return false;
      const items = t.items!;
      let p: number;
      if (t.dir === from.dir) p = 0;
      else {
        // side entry: curved belts take it from the start, straight belts in the middle
        const fromLeft = from.dir === rightOf(t.dir); // source sits on target's left side
        if ((t.shape === 1 && fromLeft) || (t.shape === 2 && !fromLeft)) p = 0;
        else p = 0.5;
      }
      if (p === 0) {
        const last = items.length ? items[items.length - 1].pos : 2;
        if (last < BELT_SPACING) return false;
        p = Math.min(overflow, last - BELT_SPACING);
        items.push(item);
        item.pos = Math.max(0, p);
        return true;
      }
      for (const it of items) if (Math.abs(it.pos - p) < BELT_SPACING) return false;
      item.pos = p;
      items.push(item);
      items.sort((a, b) => b.pos - a.pos);
      return true;
    }
    if (t.type === 'road' || t.type === 'house') return false;
    if (Math.abs(this.heightAt(tx, ty) - this.heightAt(from.x, from.y)) > 1) return false;
    if (!this.accepts(t, item.item)) return false;
    t.inv[item.item] = (t.inv[item.item] ?? 0) + 1;
    return true;
  }

  /** How far the front item of a belt may advance (keeps spacing across belt joints) */
  private frontLimit(e: Entity): number {
    const t = this.entAt(e.x + DX[e.dir], e.y + DY[e.dir]);
    if (!t || t.type !== 'belt' || t.dir !== e.dir) return 1;
    const items = t.items!;
    if (!items.length) return 1;
    const last = items[items.length - 1].pos;
    return Math.min(1, 1 + last - BELT_SPACING);
  }

  private updateBelts(dt: number) {
    const step = this.beltSpeed() * dt;
    const W = this.W, H = this.H;
    const tmp = this.tmp;
    for (const e of this.entities.values()) {
      if (e.type !== 'belt') continue;
      const items = e.items!;
      // remember previous world positions for smooth rendering
      for (const it of items) {
        beltPoint(this.beltGeom(e), it.pos, W, H, tmp);
        it.px = tmp.x;
        it.py = tmp.y;
        it.pz = tmp.z;
      }
    }
    for (const e of this.entities.values()) {
      if (e.type !== 'belt') continue;
      const items = e.items!;
      let limit = this.frontLimit(e);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.stamp === this.tickNo) {
          limit = it.pos - BELT_SPACING;
          continue;
        }
        let np = Math.min(it.pos + step, limit);
        if (i === 0 && limit >= 1 && it.pos + step >= 1) {
          if (this.transfer(e, it, it.pos + step - 1)) {
            it.stamp = this.tickNo;
            items.splice(i, 1);
            i--;
            limit = 1;
            continue;
          }
          np = 1;
        }
        if (np > it.pos) it.pos = np;
        limit = it.pos - BELT_SPACING;
      }
    }
  }

  /** Push one item from a building's output buffer onto an adjacent outgoing belt */
  private pushOutput(e: Entity) {
    const outs = this.outputs.get(e.id);
    if (!outs || !outs.length) return;
    const src = BUILDINGS[e.type].kind === 'splitter' ? e.inv : e.out;
    const types = (Object.keys(src) as ItemId[]).filter((k) => (src[k] ?? 0) > 0);
    if (!types.length) return;
    for (let k = 0; k < outs.length; k++) {
      const b = this.entities.get(outs[(e.rr + k) % outs.length]);
      if (!b || !b.items) continue;
      const last = b.items.length ? b.items[b.items.length - 1].pos : 2;
      if (last < BELT_SPACING) continue;
      const item = types[(e.rr + k) % types.length];
      src[item] = (src[item] ?? 0) - 1;
      const it: BeltItem = { id: this.nextItemId++, item, pos: 0, px: 0, py: 0, pz: 0 };
      beltPoint(this.beltGeom(b), 0, this.W, this.H, this.tmp);
      it.px = this.tmp.x;
      it.py = this.tmp.y;
      it.pz = this.tmp.z;
      b.items.push(it);
      e.rr = (e.rr + k + 1) % 9973;
      return;
    }
  }

  private updateBuildings(dt: number) {
    for (const e of this.entities.values()) {
      const def = BUILDINGS[e.type];
      switch (def.kind) {
        case 'gatherer':
        case 'crafter': {
          this.produce(e, dt);
          this.pushOutput(e);
          if (e.cycles.length && e.cycles[0] < this.time - 60) e.cycles.shift();
          break;
        }
        case 'splitter':
          this.pushOutput(e);
          this.pushOutput(e);
          break;
        case 'trade': {
          const r = def.recipe!;
          const types = (Object.keys(e.inv) as ItemId[]).filter((k) => (e.inv[k] ?? 0) > 0);
          if (!types.length) {
            e.status = 'noInput';
            e.progress = 0;
            break;
          }
          e.status = 'working';
          e.progress += (dt * LEVEL_SPEED[e.level] * this.workforce) / r.time;
          if (e.progress >= 1) {
            e.progress = 0;
            const item = types[e.rr++ % types.length];
            e.inv[item]! -= 1;
            const v = ITEMS[item].value;
            this.earn(v);
            this.addStat(this.statCons, item, 1);
            e.cycles.push(this.time);
            this.events.push({ t: 'sold', id: e.id, item, coins: v });
          }
          if (e.cycles.length && e.cycles[0] < this.time - 60) e.cycles.shift();
          break;
        }
      }
    }
  }

  private produce(e: Entity, dt: number) {
    const def = BUILDINGS[e.type];
    const r = def.recipe!;
    let outTotal = 0;
    for (const v of Object.values(e.out)) outTotal += v as number;
    const outCap = def.kind === 'gatherer' ? 4 : 6;
    if (!e.crafting) {
      if (def.kind === 'gatherer') {
        if (e.eff <= 0) {
          e.status = 'noResource';
          return;
        }
        e.crafting = true;
      } else {
        for (const [k, v] of Object.entries(r.in)) {
          if ((e.inv[k as ItemId] ?? 0) < (v as number)) {
            e.status = 'noInput';
            return;
          }
        }
        for (const [k, v] of Object.entries(r.in)) {
          e.inv[k as ItemId]! -= v as number;
          this.addStat(this.statCons, k as ItemId, v as number);
        }
        e.crafting = true;
      }
      e.progress = 0;
    }
    if (e.progress >= 1) {
      if (outTotal >= outCap) {
        e.status = 'outputFull';
        return;
      }
      for (const [k, v] of Object.entries(r.out)) {
        e.out[k as ItemId] = (e.out[k as ItemId] ?? 0) + (v as number);
        this.addStat(this.statProd, k as ItemId, v as number);
        this.events.push({ t: 'produced', id: e.id, item: k as ItemId });
      }
      e.cycles.push(this.time);
      e.crafting = false;
      e.progress = 0;
      e.status = 'working';
      return;
    }
    if (this.workforce <= 0.01) {
      e.status = 'noWorkers';
      return;
    }
    const eff = def.kind === 'gatherer' ? e.eff : 1;
    e.progress = Math.min(1, e.progress + (dt * LEVEL_SPEED[e.level] * this.workforce * eff) / r.time);
    e.status = 'working';
  }

  /** Theoretical output per minute at current conditions */
  maxRate(e: Entity): number {
    const def = BUILDINGS[e.type];
    if (!def.recipe) return 0;
    const eff = def.kind === 'gatherer' ? e.eff : 1;
    return (60 / def.recipe.time) * LEVEL_SPEED[e.level] * this.workforce * eff;
  }
  /** Actual completed cycles per minute over the last minute */
  actualRate(e: Entity): number {
    const age = Math.max(1, Math.min(60, this.time - e.built));
    return (e.cycles.length * 60) / Math.max(age, 10);
  }

  private updateHouses(dt: number) {
    for (const e of this.entities.values()) {
      if (e.type !== 'house') continue;
      const tier = HOUSE_TIERS[e.tier!];
      const supply = e.supply!;
      const cov = this.coverage.get(e.id) ?? [];
      // refill from the nearest distributor that has stock
      e.refillT! += dt;
      if (e.refillT! >= 1) {
        e.refillT = 0;
        for (const need of tier.needs) {
          if ((supply[need] ?? 0) >= 2) continue;
          for (const mid of cov) {
            const m = this.entities.get(mid)!;
            if ((m.inv[need] ?? 0) >= 1) {
              m.inv[need]! -= 1;
              supply[need] = (supply[need] ?? 0) + 1;
              this.events.push({ t: 'deliver', from: m.id, to: e.id, item: need });
              break;
            }
          }
        }
      }
      // consumption
      e.consumeT! += dt;
      if (e.consumeT! >= HOUSE_CONSUME_INTERVAL) {
        e.consumeT = 0;
        for (const need of tier.needs) {
          if ((supply[need] ?? 0) > 0) {
            supply[need]! -= 1;
            this.addStat(this.statCons, need, 1);
          }
        }
      }
      e.happy = tier.needs.every((n) => (supply[n] ?? 0) > 0);
      if (e.happy) {
        this.earn(tier.tax * dt);
        e.unhappyT = 0;
        const next = HOUSE_TIERS[e.tier! + 1];
        const canGrow =
          next && (!next.requires || this.research.has(next.requires)) && e.roadAdj &&
          next.needs.every((n) => (supply[n] ?? 0) > 0 || cov.some((mid) => (this.entities.get(mid)!.inv[n] ?? 0) > 0));
        if (canGrow) {
          e.happyT! += dt;
          if (e.happyT! >= HOUSE_UPGRADE_TIME) {
            e.tier! += 1;
            e.happyT = 0;
            this.events.push({ t: 'houseTier', id: e.id, tier: e.tier!, up: true });
          }
        } else e.happyT = 0;
      } else {
        e.happyT = 0;
        e.unhappyT! += dt;
        if (e.unhappyT! >= HOUSE_DOWNGRADE_TIME && e.tier! > 0) {
          e.tier! -= 1;
          e.unhappyT = 0;
          this.events.push({ t: 'houseTier', id: e.id, tier: e.tier!, up: false });
        }
      }
    }
  }

  private updateResearch(dt: number) {
    if (!this.activeResearch) return;
    const r = RESEARCH[this.activeResearch];
    this.researchProgress += dt / r.time;
    if (this.researchProgress >= 1) {
      this.research.add(r.id);
      this.events.push({ t: 'research', id: r.id });
      this.activeResearch = null;
      this.researchProgress = 0;
      this.topoDirty = true;
    }
  }

  recount() {
    let pop = HALL_WORKERS, need = 0;
    for (const e of this.entities.values()) {
      if (e.type === 'house') {
        const t = HOUSE_TIERS[e.tier!];
        pop += e.happy ? t.popHappy : t.popUnhappy;
      } else need += BUILDINGS[e.type].workers;
    }
    this.pop = pop;
    this.workersNeeded = need;
    this.workforce = need === 0 ? 1 : Math.min(1, pop / need);
  }

  private checkMilestones() {
    const next = MILESTONES[this.milestone + 1];
    if (next && this.pop >= next.pop) {
      this.milestone++;
      this.earn(next.reward);
      this.events.push({ t: 'milestone', index: this.milestone });
    }
  }

  // ---------------------------------------------------------------- persistence
  serialize(): string {
    const ents = [...this.entities.values()].map((e) => {
      const o: any = { ...e };
      if (e.items) o.items = e.items.map((i) => [i.item, i.pos]);
      delete o.yIn;
      delete o.yOut;
      delete o.shape;
      delete o.roadAdj;
      delete o.covered;
      o.cycles = e.cycles.map((c) => c - this.time);
      return o;
    });
    let trees = '', heights = '', ground = '';
    for (let i = 0; i < this.terrain.tree.length; i++) {
      trees += this.terrain.tree[i];
      heights += this.terrain.height[i] + 1;
      ground += this.terrain.ground[i];
    }
    return JSON.stringify({
      v: 1, seed: this.terrain.seed, time: this.time, coins: this.coins, nextId: this.nextId,
      research: [...this.research], activeResearch: this.activeResearch, researchProgress: this.researchProgress,
      milestone: this.milestone, hallId: this.hallId, trees, heights, ground, ents,
    });
  }

  static deserialize(json: string): World {
    const d = JSON.parse(json);
    const w = new World(d.seed, { empty: true });
    w.time = d.time;
    w.coins = d.coins;
    w.nextId = d.nextId;
    w.research = new Set(d.research);
    w.activeResearch = d.activeResearch;
    w.researchProgress = d.researchProgress;
    w.milestone = d.milestone;
    w.hallId = d.hallId;
    for (let i = 0; i < d.trees.length; i++) w.terrain.tree[i] = +d.trees[i];
    if (d.heights) for (let i = 0; i < d.heights.length; i++) w.terrain.height[i] = +d.heights[i] - 1;
    if (d.ground) for (let i = 0; i < d.ground.length; i++) w.terrain.ground[i] = +d.ground[i];
    for (const o of d.ents) {
      const e: Entity = { ...o };
      if (o.items) e.items = o.items.map(([item, pos]: [ItemId, number]) => ({ id: w.nextItemId++, item, pos, px: 0, py: 0, pz: 0 }));
      e.cycles = (o.cycles ?? []).map((c: number) => c + w.time);
      w.entities.set(e.id, e);
      for (let yy = e.y; yy < e.y + e.h; yy++) for (let xx = e.x; xx < e.x + e.w; xx++) w.tileEnt[w.idx(xx, yy)] = e.id;
    }
    w.topoDirty = true;
    w.refreshTopology();
    // initialise interpolation positions
    for (const e of w.entities.values())
      if (e.items)
        for (const it of e.items) {
          beltPoint(e as unknown as BeltGeom, it.pos, w.W, w.H, w.tmp);
          it.px = w.tmp.x;
          it.py = w.tmp.y;
          it.pz = w.tmp.z;
        }
    w.recount();
    return w;
  }
}
