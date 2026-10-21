// HUD, build bar, inspector, modals, toasts and tooltips.

import {
  BUILDINGS, BUILD_MENU, BuildingDef, BuildingId, Category, Cost, HOUSE_CONSUME_INTERVAL, HOUSE_TIERS, HOUSE_UPGRADE_TIME, ITEMS, ITEM_IDS,
  ItemId, LEVEL_SPEED, MILESTONES, RESEARCH, RESEARCH_IDS, ResearchId,
} from '../sim/data';
import { QUESTS, activeQuests } from '../sim/quests';
import { Entity, Status, World } from '../sim/world';
import { audio } from '../audio/audio';
import { buildingIcons, itemImg } from './icons';
import { SVG } from './svg';

export type Tool = { kind: 'select' } | { kind: 'build'; type: BuildingId } | { kind: 'remove' };

export interface GameApi {
  world: World;
  tool: Tool;
  speed: number;
  selected: number | null;
  setTool(t: Tool): void;
  setSpeed(s: number): void;
  select(id: number | null): void;
  save(manual?: boolean): void;
  load(): boolean;
  newGame(): void;
  hasSave(): boolean;
  startPlaying(cont: boolean): void;
  settings: { post: boolean; shadows: boolean };
  applySettings(): void;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const fmt = (n: number) => (n >= 10000 ? (n / 1000).toFixed(1) + 'k' : Math.floor(n).toLocaleString('ja-JP'));
const fmt1 = (n: number) => (Math.abs(n) >= 10 ? Math.round(n).toString() : n.toFixed(1));

export const STATUS_TEXT: Record<Status, [string, string]> = {
  idle: ['待機中', '#9c917c'],
  working: ['稼働中', '#4f9a45'],
  noInput: ['材料待ち', '#e8913a'],
  outputFull: ['出力が詰まっています', '#d4523f'],
  noWorkers: ['労働者が足りません', '#8a63c9'],
  noResource: ['資源がありません', '#7d7468'],
  noCustomer: ['待機中', '#9c917c'],
};

function costHtml(cost: Cost, w?: World) {
  const parts: string[] = [];
  if (cost.coins) parts.push(`<span class="costline ${w && w.coins < cost.coins ? 'no' : ''}">${SVG.coin.replace('<svg', '<svg class="ico sm"')}${cost.coins}</span>`);
  for (const [k, v] of Object.entries(cost.items ?? {})) {
    const no = w && w.stock(k as ItemId) < (v as number);
    parts.push(`<span class="costline ${no ? 'no' : ''}">${itemImg(k as ItemId, 'ico sm')}${v}</span>`);
  }
  return parts.join(' ');
}

export class UI {
  root = $('#ui');
  private cat: Category = 'resource';
  private lastQuestKey = '';
  private inspectorId: number | null = null;
  private tipEl!: HTMLElement;
  private t = 0;
  private questsCollapsed = false;

  constructor(private g: GameApi) {
    this.root.innerHTML = `
      <div id="top">
        <div id="town" class="card">
          <div class="crest">${SVG.crestGear}</div>
          <div style="flex:1">
            <div class="name">ギアヴェイル</div>
            <div class="rank" id="rank"></div>
            <div class="bar gold"><i id="rankbar"></i></div>
          </div>
        </div>
        <div id="stats" class="card">
          <div class="stat" data-tip="コイン：建設・研究に使います。住宅の税収と交易所の売上で増えます。">${SVG.coin}<div><div class="v" id="coins"></div><div class="d" id="coinrate"></div></div></div>
          <div class="sep"></div>
          <div class="stat" data-tip="人口：住宅に物資が届くと増えます。町役場にも6人が暮らしています。">${SVG.people}<div><div class="v" id="pop"></div><div class="d">人口</div></div></div>
          <div class="sep"></div>
          <div class="stat" data-tip="労働力：生産設備が必要とする労働者数と人口の比率。100%未満だと全設備の生産速度が落ちます。">${SVG.worker}<div><div class="v" id="work"></div><div class="d" id="workd"></div></div></div>
        </div>
        <div id="right-tools">
          <div class="seg card" id="speed">
            <button class="btn" data-speed="0" title="一時停止 (Space)">${SVG.pause}</button>
            <button class="btn" data-speed="1" title="通常速度 (1)">${SVG.play1}</button>
            <button class="btn" data-speed="2" title="2倍速">${SVG.play2}</button>
            <button class="btn" data-speed="3" title="3倍速">${SVG.play3}</button>
          </div>
          <div class="seg card">
            <button class="btn" id="btn-research" title="研究 (T)">${SVG.flask}研究<span id="rs-dot"></span></button>
            <button class="btn" id="btn-stats" title="生産統計 (G)">${SVG.chart}統計</button>
            <button class="btn" id="btn-menu" title="メニュー (Esc)">${SVG.menu}</button>
          </div>
        </div>
      </div>
      <div id="stock" class="card"></div>
      <div id="quests" class="card"></div>
      <div id="inspector" class="card"></div>
      <div id="build" class="card">
        <div class="tabs"></div>
        <div class="tools"></div>
      </div>
      <div id="toasts"></div>
      <div id="floaters"></div>
      <div id="paused" class="card">一時停止中 — Space で再開</div>
      <div id="celebrate"><div class="big"></div><div class="small"></div></div>
      <div id="tip" class="card"></div>
      <div class="modal-bg" id="m-research"><div class="modal card"></div></div>
      <div class="modal-bg" id="m-stats"><div class="modal card"></div></div>
      <div class="modal-bg" id="m-menu"><div class="modal card" style="width:min(640px,calc(100vw - 40px))"></div></div>
      <div id="title">
        <div class="logo">
          <div class="jp">ギアヴェイル</div>
          <div class="en">GEARVALE</div>
          <div class="tag">歯車の谷に、小さな工房街をつくろう。</div>
        </div>
        <div class="menu">
          <button class="btn primary" id="t-continue">つづきから</button>
          <button class="btn primary" id="t-new">はじめから</button>
          <button class="btn ghost" id="t-help">操作方法</button>
        </div>
        <div class="foot">右ドラッグ: 回転 ・ ホイール: ズーム ・ 左ドラッグ/WASD: 移動</div>
      </div>
    `;
    this.tipEl = $('#tip');
    this.root.classList.add('title-mode');
    this.buildTabs();
    this.bindTop();
    this.bindTitle();
    this.bindTips();
    for (const bg of document.querySelectorAll<HTMLElement>('.modal-bg'))
      bg.addEventListener('mousedown', (e) => {
        if (e.target === bg) this.closeModals();
      });
  }

  // ---------------------------------------------------------------- title
  private bindTitle() {
    const cont = $('#t-continue');
    if (!this.g.hasSave()) cont.style.display = 'none';
    cont.onclick = () => {
      audio.init();
      audio.play('open');
      this.g.startPlaying(true);
    };
    $('#t-new').onclick = () => {
      audio.init();
      audio.play('open');
      this.g.startPlaying(false);
    };
    $('#t-help').onclick = () => {
      audio.init();
      this.openMenu(true);
    };
  }
  hideTitle() {
    this.root.classList.remove('title-mode');
    $('#title').classList.add('hide');
    setTimeout(() => ($('#title').style.display = 'none'), 700);
  }

  // ---------------------------------------------------------------- top bar
  private bindTop() {
    for (const b of document.querySelectorAll<HTMLElement>('#speed .btn'))
      b.onclick = () => {
        audio.play('click');
        this.g.setSpeed(+b.dataset.speed!);
      };
    $('#btn-research').onclick = () => this.openResearch();
    $('#btn-stats').onclick = () => this.openStats();
    $('#btn-menu').onclick = () => this.openMenu();
  }

  private bindTips() {
    this.root.addEventListener('mouseover', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (el) this.showTip(`<div>${el.dataset.tip}</div>`, el.getBoundingClientRect().left, el.getBoundingClientRect().bottom + 8);
    });
    this.root.addEventListener('mouseout', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (el) this.hideTip();
    });
  }

  // ---------------------------------------------------------------- build bar
  private buildTabs() {
    const tabs = $('#build .tabs');
    tabs.innerHTML = BUILD_MENU.map((m) => `<button class="tab" data-cat="${m.cat}">${m.name}</button>`).join('');
    for (const t of tabs.querySelectorAll<HTMLElement>('.tab'))
      t.onclick = () => {
        audio.play('click');
        this.cat = t.dataset.cat as Category;
        this.renderTools();
      };
    this.renderTools();
  }

  renderTools() {
    const w = this.g.world;
    for (const t of document.querySelectorAll<HTMLElement>('#build .tab')) t.classList.toggle('on', t.dataset.cat === this.cat);
    const menu = BUILD_MENU.find((m) => m.cat === this.cat)!;
    const tool = this.g.tool;
    const html = menu.items
      .map((id) => {
        const d = BUILDINGS[id];
        const locked = !w.isUnlocked(id);
        const cant = !locked && !!w.canAfford(d.cost);
        const on = tool.kind === 'build' && tool.type === id;
        return `<button class="tool ${locked ? 'locked' : ''} ${cant ? 'cant' : ''} ${on ? 'on' : ''}" data-b="${id}">
          ${d.hotkey ? `<span class="kbd hk">${d.hotkey}</span>` : ''}
          <img class="pic" src="${buildingIcons[id] ?? ''}" alt="">
          <div class="nm">${d.name}</div>
          <div class="cost">${costHtml(d.cost)}</div>
        </button>`;
      })
      .join('');
    const tools = $('#build .tools');
    tools.innerHTML = html + `<div id="mode-tools">
        <button class="tool mode ${tool.kind === 'select' ? 'on' : ''}" data-mode="select">${SVG.cursor}<div class="nm">選択</div><span class="kbd hk">Esc</span></button>
        <button class="tool mode ${tool.kind === 'remove' ? 'on' : ''}" data-mode="remove">${SVG.bulldoze}<div class="nm">撤去</div><span class="kbd hk">X</span></button>
      </div>`;
    for (const b of tools.querySelectorAll<HTMLElement>('.tool[data-b]')) {
      const id = b.dataset.b as BuildingId;
      b.onclick = () => {
        if (!w.isUnlocked(id)) {
          audio.play('error');
          const r = BUILDINGS[id].unlock!;
          this.toast(`研究「${RESEARCH[r].name}」で解放されます`, true);
          return;
        }
        audio.play('click');
        this.g.setTool({ kind: 'build', type: id });
      };
      b.onmouseenter = () => {
        const d = BUILDINGS[id];
        const r = b.getBoundingClientRect();
        this.showTip(this.buildingTip(d), r.left, r.top - 8, true);
      };
      b.onmouseleave = () => this.hideTip();
    }
    for (const b of tools.querySelectorAll<HTMLElement>('.tool[data-mode]'))
      b.onclick = () => {
        audio.play('click');
        this.g.setTool(b.dataset.mode === 'remove' ? { kind: 'remove' } : { kind: 'select' });
      };
  }

  private buildingTip(d: BuildingDef) {
    const w = this.g.world;
    let s = `<div class="n">${d.name}</div><div class="hint" style="margin-top:3px">${d.desc}</div>`;
    if (d.recipe && d.kind !== 'trade') s += `<div class="c">${this.recipeHtml(d, 1)}</div>`;
    if (d.workers) s += `<div class="c" style="font-size:12px">${SVG.worker.replace('<svg', '<svg class="ico sm"')} 労働者 ${d.workers}人</div>`;
    if (!w.isUnlocked(d.id)) s += `<div class="bad">研究「${RESEARCH[d.unlock!].name}」で解放</div>`;
    else {
      const c = w.canAfford(d.cost);
      if (c) s += `<div class="bad">${c}</div>`;
    }
    return s;
  }

  recipeHtml(d: BuildingDef, level: number) {
    const r = d.recipe!;
    const ins = Object.entries(r.in).map(([k, v]) => `<span class="it">${itemImg(k as ItemId, 'ico sm')}×${v}</span>`);
    const outs = Object.entries(r.out).map(([k, v]) => `<span class="it">${itemImg(k as ItemId, 'ico sm')}×${v}</span>`);
    const t = r.time / LEVEL_SPEED[level];
    return `<div class="recipe">${ins.join('')}${ins.length ? '<span class="arrow">→</span>' : ''}${outs.join('')}<span class="time">${t.toFixed(1)}秒</span></div>`;
  }

  // ---------------------------------------------------------------- per-frame refresh
  update(dt: number) {
    this.t += dt;
    if (this.t < 0.2) return;
    this.t = 0;
    const w = this.g.world;
    const rates = w.rates();
    $('#coins').textContent = fmt(w.coins);
    const cr = $('#coinrate');
    cr.textContent = `${rates.coins >= 0 ? '+' : ''}${fmt1(rates.coins)}/分`;
    cr.className = 'd ' + (rates.coins > 0 ? 'pos' : '');
    $('#pop').textContent = String(w.pop);
    const wf = Math.round(w.workforce * 100);
    $('#work').textContent = `${wf}%`;
    $('#work').style.color = wf < 100 ? (wf < 70 ? 'var(--red)' : 'var(--orange)') : '';
    $('#workd').textContent = `労働者 ${w.workersNeeded}/${w.pop}`;
    const m = MILESTONES[w.milestone], next = MILESTONES[w.milestone + 1];
    $('#rank').textContent = next ? `${m.name} — 次の「${next.name}」まで 人口 ${w.pop}/${next.pop}` : `${m.name} — 最高ランク達成！`;
    $('#rankbar').style.width = next ? `${Math.min(100, ((w.pop - m.pop) / (next.pop - m.pop)) * 100)}%` : '100%';
    for (const b of document.querySelectorAll<HTMLElement>('#speed .btn')) b.classList.toggle('on', +b.dataset.speed! === this.g.speed);
    $('#paused').classList.toggle('show', this.g.speed === 0 && $('#title').style.display === 'none');
    $('#rs-dot').innerHTML = w.activeResearch ? `<span class="badge-dot" title="研究中"></span>` : '';
    this.renderStock();
    this.renderQuests();
    if (this.inspectorId !== null) this.renderInspector();
    // tool affordability
    for (const b of document.querySelectorAll<HTMLElement>('.tool[data-b]')) {
      const id = b.dataset.b as BuildingId;
      const locked = !w.isUnlocked(id);
      b.classList.toggle('locked', locked);
      b.classList.toggle('cant', !locked && !!w.canAfford(BUILDINGS[id].cost));
    }
    if ($('#m-stats').classList.contains('show')) this.renderStats();
    if ($('#m-research').classList.contains('show')) this.renderResearch();
  }

  private renderStock() {
    const w = this.g.world;
    const chips: string[] = [];
    let cap = 0;
    for (const e of w.entities.values()) if (w.isStorage(e)) cap += BUILDINGS[e.type].storageCap ?? 0;
    for (const id of ITEM_IDS) {
      const n = w.stock(id);
      if (n === 0 && !(w.received[id] ?? 0)) continue;
      chips.push(`<div class="chip ${n === 0 ? 'zero' : ''} ${n >= cap ? 'full' : ''}" data-tip="${ITEMS[id].name}（倉庫在庫 ${n} / 容量 ${cap}）">${itemImg(id)}${fmt(n)}</div>`);
    }
    const html = chips.join('');
    const el = $('#stock');
    if (el.dataset.h !== html) {
      el.innerHTML = html;
      el.dataset.h = html;
    }
  }

  private renderQuests() {
    const w = this.g.world;
    const qs = activeQuests(w, 3);
    const key = qs.map((q) => q.id + (q.progress ? q.progress(w).join('/') : '')).join('|') + this.questsCollapsed;
    if (key === this.lastQuestKey) return;
    this.lastQuestKey = key;
    const el = $('#quests');
    el.classList.toggle('collapsed', this.questsCollapsed);
    if (!qs.length) {
      el.innerHTML = `<h3>目標</h3><div class="quest first"><div class="t">すべての目標を達成しました！</div><div class="h">自由に街を広げ、生産ラインを磨き上げましょう。</div></div>`;
      return;
    }
    const doneN = w.questsDone.size;
    el.innerHTML =
      `<h3>目標 <span style="font-weight:500">${doneN}/${QUESTS.length}</span><button class="btn" id="q-toggle">${this.questsCollapsed ? '開く' : 'たたむ'}</button></h3>` +
      qs
        .map((q, i) => {
          const p = q.progress?.(w);
          const bar = p ? `<div class="bar"><i style="width:${Math.min(100, (p[0] / p[1]) * 100)}%"></i></div>` : '';
          return `<div class="quest ${i === 0 ? 'first' : ''}"><div class="t"><span class="box"></span><span>${q.title}${p ? ` <span style="color:var(--ink-soft);font-weight:500">(${Math.min(p[0], p[1])}/${p[1]})</span>` : ''}</span>${q.reward ? `<span class="r">+${q.reward}</span>` : ''}</div>${i === 0 ? `<div class="h">${q.hint}</div>` : ''}${bar}</div>`;
        })
        .join('');
    $('#q-toggle').onclick = () => {
      this.questsCollapsed = !this.questsCollapsed;
      this.lastQuestKey = '';
      this.renderQuests();
    };
  }

  // ---------------------------------------------------------------- inspector
  showInspector(id: number | null) {
    this.inspectorId = id;
    const el = $('#inspector');
    if (id === null) {
      el.classList.remove('show');
      el.innerHTML = '';
      return;
    }
    el.classList.add('show');
    el.dataset.h = '';
    this.renderInspector();
  }

  private renderInspector() {
    const w = this.g.world;
    const e = this.inspectorId !== null ? w.entities.get(this.inspectorId) : undefined;
    const el = $('#inspector');
    if (!e) {
      this.showInspector(null);
      return;
    }
    const d = BUILDINGS[e.type];
    let icon = buildingIcons[e.type] ?? '';
    if (e.type === 'house') icon = buildingIcons['house' + e.tier] ?? icon;
    let name = d.name;
    if (e.type === 'house') name = HOUSE_TIERS[e.tier!].name;
    const lvl = d.upgradable ? `<span class="lvl">${[1, 2, 3].map((l) => `<i class="${l <= e.level ? 'on' : ''}"></i>`).join('')}</span>` : '';
    const sub = d.upgradable ? `Lv${e.level}` : e.type === 'house' ? `住宅 · ${['Ⅰ', 'Ⅱ', 'Ⅲ'][e.tier!]}` : d.kind === 'belt' ? '物流' : '';
    let body = '';
    const sec = (title: string, inner: string) => `<div class="sec"><h4>${title}</h4>${inner}</div>`;
    if (d.kind === 'gatherer' || d.kind === 'crafter') {
      const [txt, col] = STATUS_TEXT[e.status];
      body += sec('状態', `<div class="status"><span class="dot" style="background:${col}"></span>${txt}</div>
        <div class="bar" style="margin-top:7px"><i style="width:${Math.round(e.progress * 100)}%"></i></div>`);
      body += sec('レシピ', this.recipeHtml(d, e.level));
      const out = Object.keys(d.recipe!.out)[0] as ItemId;
      const maxR = w.maxRate(e) * (d.recipe!.out[out] ?? 1);
      const act = w.actualRate(e) * (d.recipe!.out[out] ?? 1);
      let perf = `<div class="kv"><span>実績</span><b>${fmt1(act)} ${ITEMS[out].name}/分</b></div>
        <div class="kv"><span>最大</span><b>${fmt1(maxR)} /分</b></div>`;
      if (d.kind === 'gatherer' && d.needs) perf += `<div class="kv"><span>${d.needs === 'trees' ? '周囲の木による効率' : '鉱床による効率'}</span><b>${Math.round(e.eff * 100)}%</b></div>`;
      perf += `<div class="kv"><span>労働力</span><b>${Math.round(w.workforce * 100)}% （${d.workers}人）</b></div>`;
      body += sec('生産量', perf);
      const bufs: string[] = [];
      for (const k of Object.keys(d.recipe!.in) as ItemId[]) {
        const n = e.inv[k] ?? 0;
        bufs.push(`<div class="buf ${n < (d.recipe!.in[k] ?? 0) ? 'low' : ''}" title="入力">${itemImg(k, 'ico sm')}${n}</div>`);
      }
      const outs = Object.keys(d.recipe!.out) as ItemId[];
      for (const k of outs) bufs.push(`<div class="buf" title="出力">${itemImg(k, 'ico sm')}${e.out[k] ?? 0}<span style="font-size:10px;color:var(--ink-soft);margin-left:2px">出</span></div>`);
      body += sec('在庫（入力 / 出力）', `<div class="buffers">${bufs.join('')}</div>`);
      const outsN = w.outputsOf(e.id).length;
      if (outsN === 0) body += `<div class="sec hint" style="color:var(--red)">⚠ 出力先のベルトがありません。建物から外向きにベルトを敷きましょう。</div>`;
      const jam = d.kind === 'crafter' ? w.jamOf(e) : null;
      if (jam && !w.wants(e, jam.item))
        body += `<div class="sec warnbox">${itemImg(jam.item, 'ico sm')}${ITEMS[jam.item].name}はこの建物では使えないため、ベルトが止まっています。</div>`;
      else if (jam && jam.behind)
        body += `<div class="sec warnbox">${itemImg(jam.item, 'ico sm')}${ITEMS[jam.item].name}が満杯でベルトが詰まり、後ろの${ITEMS[jam.behind].name}が届きません。材料ごとに別のベルトで搬入しましょう。</div>`;
      else if (e.status === 'noInput') body += `<div class="sec hint">材料をベルトでこの建物に向けて運び込みましょう。</div>`;
      else if (e.status === 'outputFull') body += `<div class="sec hint">運び出したベルトの先が詰まっています。行き先（町役場・倉庫・交易所など）につながっているか確認しましょう。</div>`;
    } else if (e.type === 'house') {
      const tier = HOUSE_TIERS[e.tier!];
      const pop = e.happy ? tier.popHappy : tier.popUnhappy;
      const needs = tier.needs
        .map((n) => {
          const s = e.supply![n] ?? 0;
          return `<div class="need">${itemImg(n, 'ico sm')}${ITEMS[n].name}<span class="pips">${[0, 1].map((i) => `<i class="${i < s ? 'on' : ''}"></i>`).join('')}</span><span class="ok" style="color:${s > 0 ? 'var(--green)' : 'var(--red)'}">${s > 0 ? '届いています' : '不足'}</span></div>`;
        })
        .join('');
      body += sec('状態', `<div class="status"><span class="dot" style="background:${e.happy ? '#4f9a45' : '#d4523f'}"></span>${e.happy ? '満足しています' : e.covered ? '物資が足りません' : '配達範囲の外です'}</div>`);
      body += sec(`必要な物資（${HOUSE_CONSUME_INTERVAL}秒ごとに1つずつ消費）`, `<div class="needs">${needs}</div>`);
      body += sec('暮らし', `<div class="kv"><span>住民</span><b>${pop}人</b></div><div class="kv"><span>税収</span><b>${e.happy ? (tier.tax * 60).toFixed(0) : 0} コイン/分</b></div>`);
      const next = HOUSE_TIERS[e.tier! + 1];
      if (next) {
        const ok = (b: boolean) => `<span style="color:${b ? 'var(--green)' : 'var(--red)'};font-weight:800">${b ? '✓' : '✗'}</span>`;
        const res = !next.requires || w.research.has(next.requires);
        const items = next.needs.map((n) => ITEMS[n].name).join('・');
        body += sec(`「${next.name}」への発展`, `
          <div class="kv"><span>研究「${next.requires ? RESEARCH[next.requires].name : ''}」</span>${ok(res)}</div>
          <div class="kv"><span>道に面している</span>${ok(!!e.roadAdj)}</div>
          <div class="kv"><span>物資が満たされている</span>${ok(!!e.happy)}</div>
          <div class="kv"><span>近くの市場に ${items}</span>${ok(next.needs.every((n) => (e.supply![n] ?? 0) > 0 || w.coverageOf(e.id).some((m) => (w.entities.get(m)!.inv[n] ?? 0) > 0)))}</div>
          <div class="bar" style="margin-top:6px"><i style="width:${Math.min(100, ((e.happyT ?? 0) / HOUSE_UPGRADE_TIME) * 100)}%"></i></div>`);
      }
    } else if (d.kind === 'hall' || d.kind === 'storage') {
      const cap = d.storageCap!;
      const bufs = ITEM_IDS.filter((k) => (e.inv[k] ?? 0) > 0).map((k) => `<div class="buf">${itemImg(k, 'ico sm')}${e.inv[k]}</div>`);
      body += sec(`貯蔵（各 ${cap} まで）`, bufs.length ? `<div class="buffers">${bufs.join('')}</div>` : `<div class="hint">まだ何もありません。ベルトでこの建物に向けて資源を運び込みましょう。</div>`);
      if (d.radius) {
        let n = 0;
        for (const h of w.entities.values()) if (h.type === 'house' && w.coverageOf(h.id).includes(e.id)) n++;
        body += sec('配達', `<div class="kv"><span>配達範囲</span><b>半径 ${d.radius} マス</b></div><div class="kv"><span>範囲内の住宅</span><b>${n}軒</b></div>`);
      }
      if (e.type === 'hall') body += sec('町役場', `<div class="hint">町の中心。ここに届いた資源は建設や研究の材料になります。範囲内の住宅へ物資を配達します。</div>`);
    } else if (d.kind === 'trade') {
      const bufs = ITEM_IDS.filter((k) => (e.inv[k] ?? 0) > 0).map((k) => `<div class="buf">${itemImg(k, 'ico sm')}${e.inv[k]}</div>`);
      body += sec('売却', `<div class="kv"><span>売却速度</span><b>${fmt1((60 / d.recipe!.time) * LEVEL_SPEED[e.level] * w.workforce)} 個/分</b></div>
        <div class="kv"><span>直近1分の売却</span><b>${e.cycles.length} 個</b></div>`);
      body += sec('売却待ち', bufs.length ? `<div class="buffers">${bufs.join('')}</div>` : '<div class="hint">ベルトで品物を運び込むと売却されます。</div>');
      body += sec('相場', `<div class="buffers">${ITEM_IDS.map((k) => `<div class="buf">${itemImg(k, 'ico sm')}${ITEMS[k].value}</div>`).join('')}</div>`);
    } else if (e.type === 'belt') {
      const items = e.items!.map((i) => itemImg(i.item, 'ico sm')).join('');
      body += sec('ベルト', `<div class="kv"><span>速度</span><b>${w.beltSpeed().toFixed(2)} マス/秒</b></div><div class="kv"><span>搬送中</span><span>${items || '—'}</span></div>`);
      body += `<div class="sec hint">R キーまたは下のボタンで向きを変更できます。</div>`;
    } else if (e.type === 'splitter') {
      body += sec('分配器', `<div class="hint">入ってきた資源を、分配器から外向きに伸びるベルトへ順番に振り分けます。</div>`);
    } else if (e.type === 'road') {
      body += sec('道', `<div class="hint">${d.desc}</div>`);
    }
    let actions = '';
    if (d.upgradable) {
      const u = w.canUpgrade(e);
      if (e.level < 3)
        actions += `<button class="btn primary" id="i-up" ${u.ok ? '' : 'disabled'} data-tip="${u.reason ?? '生産速度が上がります'}">${SVG.up}改良 ${u.cost ? costHtml(u.cost, w) : ''}</button>`;
    }
    if (e.type === 'belt') actions += `<button class="btn" id="i-rot">${SVG.rotate}回転</button>`;
    if (e.type !== 'hall') actions += `<button class="btn danger" id="i-del">${SVG.trash}撤去</button>`;
    const html = `<div class="head"><img src="${icon}" alt=""><div><div class="ttl">${name}${lvl}</div><div class="sub">${sub}</div></div>
      <button class="btn close" id="i-close">${SVG.close}</button></div>${body}${actions ? `<div class="actions">${actions}</div>` : ''}`;
    if (el.dataset.h === html) return;
    el.dataset.h = html;
    // patch the body and the action row separately so a button is never swapped out mid-click
    const parts = html.split('<div class="actions">');
    const bodyHtml = parts[0], actHtml = parts[1] ? '<div class="actions">' + parts[1] : '';
    let bodyEl = el.querySelector<HTMLElement>(':scope > .ibody');
    let actEl = el.querySelector<HTMLElement>(':scope > .iact');
    if (!bodyEl || !actEl) {
      el.innerHTML = '<div class="ibody"></div><div class="iact"></div>';
      bodyEl = el.querySelector<HTMLElement>(':scope > .ibody')!;
      actEl = el.querySelector<HTMLElement>(':scope > .iact')!;
      el.onclick = (ev) => this.inspectorAction((ev.target as HTMLElement).closest('button')?.id ?? '');
    }
    if (bodyEl.dataset.h !== bodyHtml) {
      bodyEl.dataset.h = bodyHtml;
      bodyEl.innerHTML = bodyHtml;
    }
    if (actEl.dataset.h !== actHtml) {
      actEl.dataset.h = actHtml;
      actEl.innerHTML = actHtml;
    }
  }

  private inspectorAction(id: string) {
    const w = this.g.world;
    const e = this.inspectorId !== null ? w.entities.get(this.inspectorId) : undefined;
    if (!e) return;
    const d = BUILDINGS[e.type];
    if (id === 'i-close') {
      audio.play('click');
      this.g.select(null);
    } else if (id === 'i-up') {
      if (w.upgrade(e.id)) {
        audio.play('upgrade');
        this.toast(`${d.name}を Lv${e.level} に改良しました`);
      } else audio.play('error');
    } else if (id === 'i-rot') {
      w.rotateBelt(e.id);
      audio.play('rotate');
    } else if (id === 'i-del') {
      if (w.remove(e.id)) {
        audio.play('remove');
        this.g.select(null);
      }
    }
  }

  // ---------------------------------------------------------------- tooltip
  showTip(html: string, x: number, y: number, above = false) {
    const t = this.tipEl;
    t.innerHTML = html;
    t.classList.add('show');
    const r = t.getBoundingClientRect();
    let px = x, py = above ? y - r.height : y;
    px = Math.min(window.innerWidth - r.width - 8, Math.max(8, px));
    py = Math.min(window.innerHeight - r.height - 8, Math.max(8, py));
    t.style.left = px + 'px';
    t.style.top = py + 'px';
  }
  hideTip() {
    this.tipEl.classList.remove('show');
  }

  // ---------------------------------------------------------------- toasts & floaters
  toast(msg: string, err = false, icon = '') {
    const el = document.createElement('div');
    el.className = 'toast card' + (err ? ' err' : '');
    el.innerHTML = `${icon}<span>${msg}</span>`;
    const box = $('#toasts');
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild!.remove();
    setTimeout(() => el.remove(), 3900);
  }

  floater(html: string, x: number, y: number) {
    const el = document.createElement('div');
    el.className = 'floater';
    el.innerHTML = html;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    $('#floaters').appendChild(el);
    el.animate([{ transform: 'translate(-50%,-50%)', opacity: 0 }, { transform: 'translate(-50%,-90%)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%,-260%)', opacity: 0 }], { duration: 1500, easing: 'ease-out' }).onfinish = () => el.remove();
  }

  celebrate(big: string, small: string) {
    const el = $('#celebrate');
    $('.big', el).textContent = big;
    $('.small', el).textContent = small;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // ---------------------------------------------------------------- modals
  closeModals() {
    let any = false;
    for (const m of document.querySelectorAll('.modal-bg.show')) {
      m.classList.remove('show');
      any = true;
    }
    return any;
  }
  anyModal() {
    return !!document.querySelector('.modal-bg.show');
  }

  openResearch() {
    audio.play('open');
    this.closeModals();
    $('#m-research').classList.add('show');
    $('#m-research .modal').dataset.h = '';
    this.renderResearch();
  }

  private renderResearch() {
    const w = this.g.world;
    const el = $('#m-research .modal');
    const active = w.activeResearch;
    const nodes = RESEARCH_IDS.map((id) => {
      const r = RESEARCH[id];
      const done = w.research.has(id);
      const prereqOk = r.prereq.every((p) => w.research.has(p));
      const isActive = active === id;
      const cls = done ? 'done' : isActive ? 'active' : prereqOk ? '' : 'locked';
      let btn = '';
      if (isActive) btn = `<div class="bar gold"><i style="width:${Math.round(w.researchProgress * 100)}%"></i></div><div class="hint">研究中… ${Math.round(w.researchProgress * 100)}%</div>`;
      else if (!done) {
        const why = w.canResearch(id);
        btn = `<button class="btn primary" data-r="${id}" ${why ? 'disabled' : ''} title="${why ?? ''}">研究する</button>${why && prereqOk && !active ? `<div class="hint" style="color:var(--red)">${why}</div>` : ''}`;
      }
      return `<div class="rnode ${cls}" data-id="${id}" style="grid-column:${r.col + 1};grid-row:${r.row + 1}">
        <div class="nm">${r.name}</div><div class="ds">${r.desc}</div>
        ${done ? '' : `<div class="cs">${costHtml(r.cost, w)}<span style="color:var(--ink-soft);font-weight:500">${r.time}秒</span></div>`}
        ${btn}</div>`;
    }).join('');
    const html = `<button class="btn x" id="r-x">${SVG.close}</button>
      <h2>研究</h2><p class="lead">コインと、町役場・倉庫に貯めた資源を使って新しい技術を解放します。研究は一度にひとつずつ進みます。</p>
      <div class="tree"><svg class="links"></svg>${nodes}</div>`;
    if (el.dataset.h === html) return;
    el.dataset.h = html;
    el.innerHTML = html;
    $('#r-x', el).onclick = () => this.closeModals();
    for (const b of el.querySelectorAll<HTMLElement>('[data-r]'))
      b.onclick = () => {
        const id = b.dataset.r as ResearchId;
        if (w.startResearch(id)) {
          audio.play('upgrade');
          this.toast(`研究「${RESEARCH[id].name}」を開始しました`);
        } else audio.play('error');
        this.renderResearch();
      };
    // draw prerequisite links
    requestAnimationFrame(() => {
      const svg = el.querySelector('svg.links') as SVGElement | null;
      const tree = el.querySelector('.tree') as HTMLElement | null;
      if (!svg || !tree) return;
      const tb = tree.getBoundingClientRect();
      let paths = '';
      for (const id of RESEARCH_IDS) {
        const to = tree.querySelector<HTMLElement>(`[data-id="${id}"]`)!.getBoundingClientRect();
        for (const p of RESEARCH[id].prereq) {
          const from = tree.querySelector<HTMLElement>(`[data-id="${p}"]`)!.getBoundingClientRect();
          const x1 = from.right - tb.left, y1 = from.top + from.height / 2 - tb.top;
          const x2 = to.left - tb.left, y2 = to.top + to.height / 2 - tb.top;
          const mx = (x1 + x2) / 2;
          const done = w.research.has(p);
          paths += `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="${done ? '#8cc58a' : '#d9c9a6'}" stroke-width="3" stroke-linecap="round"/>`;
        }
      }
      svg.innerHTML = paths;
    });
  }

  openStats() {
    audio.play('open');
    this.closeModals();
    $('#m-stats').classList.add('show');
    this.renderStats();
  }

  private renderStats() {
    const w = this.g.world;
    const el = $('#m-stats .modal');
    const r = w.rates();
    let maxV = 1;
    for (const id of ITEM_IDS) maxV = Math.max(maxV, r.prod[id], r.cons[id]);
    const rows = ITEM_IDS.filter((id) => r.prod[id] > 0 || r.cons[id] > 0 || w.stock(id) > 0 || (w.received[id] ?? 0) > 0)
      .map((id) => {
        const net = r.prod[id] - r.cons[id];
        return `<tr><td>${itemImg(id)} ${ITEMS[id].name}</td><td class="n">${w.stock(id)}</td>
        <td class="n">${fmt1(r.prod[id])}</td><td class="n">${fmt1(r.cons[id])}</td>
        <td class="n net ${net > 0.05 ? 'pos' : net < -0.05 ? 'neg' : ''}">${net > 0 ? '+' : ''}${fmt1(net)}</td>
        <td class="flow"><div class="flowbar"><i class="p" style="width:${(r.prod[id] / maxV) * 100}%"></i><i class="c" style="width:${(r.cons[id] / maxV) * 100}%"></i></div></td></tr>`;
      })
      .join('');
    const counts = new Map<BuildingId, { n: number; working: number }>();
    for (const e of w.entities.values()) {
      const k = BUILDINGS[e.type].kind;
      if (k !== 'gatherer' && k !== 'crafter' && k !== 'trade') continue;
      const c = counts.get(e.type) ?? { n: 0, working: 0 };
      c.n++;
      if (e.status === 'working') c.working++;
      counts.set(e.type, c);
    }
    const bl = [...counts.entries()].map(([t, c]) => `<div class="buf"><img class="ico" src="${buildingIcons[t]}">${BUILDINGS[t].name} ${c.working}/${c.n}</div>`).join('');
    const houses = [0, 0, 0];
    let happy = 0, hn = 0;
    for (const e of w.entities.values())
      if (e.type === 'house') {
        houses[e.tier!]++;
        hn++;
        if (e.happy) happy++;
      }
    el.innerHTML = `<button class="btn x" id="s-x">${SVG.close}</button>
      <h2>生産統計</h2><p class="lead">直近1分間の資源の流れ（個/分）。生産が消費を下回る資源はラインの増強が必要です。</p>
      <table class="stats-table"><tr><th>資源</th><th style="text-align:right">倉庫</th><th style="text-align:right">生産</th><th style="text-align:right">消費</th><th style="text-align:right">収支</th><th>流れ（緑=生産 / 橙=消費）</th></tr>${rows || '<tr><td colspan="6" class="hint">まだ生産がありません。</td></tr>'}</table>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:16px">
        <div><h4 style="margin:0 0 8px;font-size:12px;color:var(--ink-soft)">稼働中の設備</h4><div class="buffers" style="grid-template-columns:1fr 1fr">${bl || '<span class="hint">なし</span>'}</div></div>
        <div><h4 style="margin:0 0 8px;font-size:12px;color:var(--ink-soft)">町</h4>
          <div class="kv"><span>収入</span><b>${fmt1(r.coins)} コイン/分</b></div>
          <div class="kv"><span>住宅（小屋/民家/邸宅）</span><b>${houses.join(' / ')}</b></div>
          <div class="kv"><span>満足している家</span><b>${happy}/${hn}</b></div>
          <div class="kv"><span>労働力</span><b>${w.workersNeeded} 必要 / ${w.pop} 人口</b></div>
        </div>
      </div>`;
    $('#s-x', el).onclick = () => this.closeModals();
  }

  openMenu(helpOnly = false) {
    audio.play('open');
    this.closeModals();
    const el = $('#m-menu .modal');
    const v = audio.volumes;
    el.innerHTML = `<button class="btn x" id="mm-x">${SVG.close}</button>
      <h2>${helpOnly ? '操作方法' : 'メニュー'}</h2>
      ${helpOnly ? '' : `<div style="display:flex;gap:8px;margin:10px 0 16px;flex-wrap:wrap">
        <button class="btn primary" id="mm-save">保存する</button>
        <button class="btn primary" id="mm-load" ${this.g.hasSave() ? '' : 'disabled'}>保存データを読み込む</button>
        <button class="btn" id="mm-new" style="margin-left:auto">新しく始める</button>
      </div>
      <div class="settings">
        <div>
          <label>全体の音量 <input type="range" min="0" max="1" step="0.05" value="${v.master}" data-v="master"></label>
          <label>音楽 <input type="range" min="0" max="1" step="0.05" value="${v.music}" data-v="music"></label>
          <label>効果音 <input type="range" min="0" max="1" step="0.05" value="${v.sfx}" data-v="sfx"></label>
        </div>
        <div>
          <label>ミニチュア風ぼかし・色調 <input type="checkbox" id="opt-post" ${this.g.settings.post ? 'checked' : ''}></label>
          <label>影 <input type="checkbox" id="opt-shadow" ${this.g.settings.shadows ? 'checked' : ''}></label>
          <div class="hint">動作が重いときはオフにしてください。進行状況は30秒ごとに自動保存されます。</div>
        </div>
      </div><h3 style="margin:18px 0 8px;font-size:15px">操作方法</h3>`}
      <div class="help-grid">
        <span class="kbd">左クリック</span><span>建物を選択 / 建設</span>
        <span class="kbd">左ドラッグ</span><span>地面をつかんで移動（選択中）／ベルト・道を連続して敷く（建設中）</span>
        <span class="kbd">右ドラッグ / Q・E</span><span>カメラを回転（上下ドラッグで傾き）</span>
        <span class="kbd">ホイール</span><span>ズーム</span>
        <span class="kbd">WASD / 矢印</span><span>カメラを移動</span>
        <span class="kbd">R</span><span>建設する向きを回転・選択中のベルトを回転</span>
        <span class="kbd">右クリック / Esc</span><span>建設をやめる・選択を解除</span>
        <span class="kbd">X / Delete</span><span>撤去モード（ドラッグで範囲撤去）。撤去すると建設費は全額戻ります</span>
        <span class="kbd">B / V / H</span><span>ベルト / 道 / 住宅</span>
        <span class="kbd">Space / 1 2 3</span><span>一時停止 / ゲーム速度（建設中の 1〜3 は建物のショートカット）</span>
        <span class="kbd">T / G</span><span>研究 / 統計</span>
      </div>
      <h3 style="margin:16px 0 6px;font-size:15px">遊び方</h3>
      <div class="hint" style="font-size:13px">
        資源を生産する建物から<b>外向き</b>にベルトを敷くと、生産物がベルトに流れ出します。ベルトを加工設備や町役場に<b>向けて</b>つなぐと、資源が運び込まれます。
        町役場・市場の配達範囲にある住宅には、そこに貯まった物資が自動で届けられ、住民が増えて税収が生まれます。
        研究で新しい設備を解放し、建物を改良して生産ラインを効率化しながら、人口150人の「都市」を目指しましょう。
      </div>`;
    $('#m-menu').classList.add('show');
    $('#mm-x', el).onclick = () => this.closeModals();
    if (helpOnly) return;
    $('#mm-save', el).onclick = () => {
      this.g.save(true);
      audio.play('coin');
    };
    $('#mm-load', el).onclick = () => {
      if (this.g.load()) {
        this.toast('保存データを読み込みました');
        this.closeModals();
      }
    };
    $('#mm-new', el).onclick = () => {
      if (confirm('現在の街を破棄して新しく始めますか？（保存データは上書きされます）')) {
        this.g.newGame();
        this.closeModals();
      }
    };
    for (const r of el.querySelectorAll<HTMLInputElement>('input[data-v]'))
      r.oninput = () => {
        (audio.volumes as any)[r.dataset.v!] = +r.value;
        audio.applyVolumes();
        try {
          localStorage.setItem('gearvale.volumes', JSON.stringify(audio.volumes));
        } catch {}
      };
    $('#opt-post', el).onchange = (ev) => {
      this.g.settings.post = (ev.target as HTMLInputElement).checked;
      this.g.applySettings();
    };
    $('#opt-shadow', el).onchange = (ev) => {
      this.g.settings.shadows = (ev.target as HTMLInputElement).checked;
      this.g.applySettings();
    };
  }

  isEntityStorage(e: Entity) {
    return this.g.world.isStorage(e);
  }
}
