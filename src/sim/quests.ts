// Guided objectives that teach the production chains and reward progress.

import { MILESTONES } from './data';
import { World } from './world';

export interface Quest {
  id: string;
  title: string;
  hint: string;
  reward: number;
  check: (w: World) => boolean;
  progress?: (w: World) => [number, number];
}

const count = (w: World, pred: (t: string, e: any) => boolean) => {
  let n = 0;
  for (const e of w.entities.values()) if (pred(e.type, e)) n++;
  return n;
};

export const QUESTS: Quest[] = [
  {
    id: 'lumber', title: '森のそばに伐採小屋を建てる', reward: 20,
    hint: '下の「資源」から伐採小屋を選び、木の多い場所に置きます。範囲内の木が多いほど効率が上がります。',
    check: (w) => count(w, (t) => t === 'lumber') > 0,
  },
  {
    id: 'logs', title: 'ベルトで丸太を町役場へ運ぶ', reward: 30,
    hint: 'ベルト（B）を伐採小屋の隣から町役場までドラッグで敷きます。建物から外向きのベルトに資源が流れ出します。',
    check: (w) => (w.received.log ?? 0) >= 10, progress: (w) => [w.received.log ?? 0, 10],
  },
  {
    id: 'planks', title: '製材所で板材をつくって届ける', reward: 40,
    hint: '丸太のベルトを製材所に通し、出てきた板材を町役場へ。板材は多くの建物の材料になります。',
    check: (w) => (w.received.plank ?? 0) >= 10, progress: (w) => [w.received.plank ?? 0, 10],
  },
  {
    id: 'houses', title: '住宅を6軒にする', reward: 40,
    hint: '住宅は町役場（または市場）の配達範囲に建てます。丸太が届くと住民が増え、税収が入ります。',
    check: (w) => count(w, (t) => t === 'house') >= 6, progress: (w) => [count(w, (t) => t === 'house'), 6],
  },
  {
    id: 'trade', title: '交易所で品物を売る', reward: 30,
    hint: '余った資源を交易所へベルトで送るとコインになります。板材は丸太の3倍の値段で売れます。',
    check: (w) => w.soldTotal >= 20, progress: (w) => [Math.floor(w.soldTotal), 20],
  },
  {
    id: 'food', title: '研究「食料加工」を完了する', reward: 40,
    hint: '右上の「研究」から。研究にはコインと倉庫の資源を使います。',
    check: (w) => w.research.has('food'),
  },
  {
    id: 'bread', title: '小麦→小麦粉→パンの生産ラインをつくる', reward: 80,
    hint: '小麦農場 → 風車小屋 → パン工房 とベルトでつなぎ、パンを町役場へ届けます。',
    check: (w) => (w.received.bread ?? 0) >= 10, progress: (w) => [w.received.bread ?? 0, 10],
  },
  {
    id: 'village', title: `人口${MILESTONES[1].pop}人の「村」になる`, reward: 0,
    hint: '住宅に物資を届け続けると住民が増えます。',
    check: (w) => w.milestone >= 1, progress: (w) => [w.pop, MILESTONES[1].pop],
  },
  {
    id: 'house2', title: '民家を3軒に発展させる', reward: 80,
    hint: '研究「民家」の後、道に面した住宅に丸太とパンが届くと民家に発展します。',
    check: (w) => count(w, (t, e) => t === 'house' && e.tier >= 1) >= 3, progress: (w) => [count(w, (t, e) => t === 'house' && e.tier >= 1), 3],
  },
  {
    id: 'stone', title: '採石場で石材を集める', reward: 60,
    hint: '研究「石工術」で採石場を解放。灰色の岩場の上に建てます。',
    check: (w) => (w.received.stone ?? 0) >= 20, progress: (w) => [w.received.stone ?? 0, 20],
  },
  {
    id: 'upgrade', title: '生産設備を Lv2 に改良する', reward: 60,
    hint: '研究「建物改良 I」の後、建物を選択して「改良」。生産速度が1.6倍になります。',
    check: (w) => count(w, (_t, e) => e.level >= 2) > 0,
  },
  {
    id: 'iron', title: '鉄鉱石を製錬して鉄をつくる', reward: 100,
    hint: '鉄鉱山（赤茶色の鉱脈の上）と製錬炉。製錬炉は鉄鉱石2つと丸太1つで鉄をつくります。',
    check: (w) => (w.received.iron ?? 0) >= 10, progress: (w) => [w.received.iron ?? 0, 10],
  },
  {
    id: 'town', title: `人口${MILESTONES[2].pop}人の「町」になる`, reward: 0,
    hint: '民家をどんどん増やしましょう。',
    check: (w) => w.milestone >= 2, progress: (w) => [w.pop, MILESTONES[2].pop],
  },
  {
    id: 'tools', title: '道具をつくって届ける', reward: 120,
    hint: '道具工房は板材と鉄から道具をつくります。2種類の素材を1つのベルトに合流させても大丈夫。',
    check: (w) => (w.received.tools ?? 0) >= 10, progress: (w) => [w.received.tools ?? 0, 10],
  },
  {
    id: 'manor', title: '邸宅を建てる', reward: 150,
    hint: '研究「邸宅」の後、民家にパン・板材・道具が届くと邸宅に発展します。',
    check: (w) => count(w, (t, e) => t === 'house' && e.tier >= 2) > 0,
  },
  {
    id: 'city', title: `人口${MILESTONES[3].pop}人の「都市」になる`, reward: 0,
    hint: 'ギアヴェイルを大きな都市に育てましょう！',
    check: (w) => w.milestone >= 3, progress: (w) => [w.pop, MILESTONES[3].pop],
  },
];

/** Mark newly completed quests (in order). Returns ids completed this call. */
export function updateQuests(w: World): string[] {
  const done: string[] = [];
  for (const q of QUESTS) {
    if (w.questsDone.has(q.id)) continue;
    if (q.check(w)) {
      w.questsDone.add(q.id);
      w.coins += q.reward;
      w.events.push({ t: 'quest', id: q.id, reward: q.reward });
      done.push(q.id);
    }
  }
  return done;
}

export function activeQuests(w: World, n = 3): Quest[] {
  return QUESTS.filter((q) => !w.questsDone.has(q.id)).slice(0, n);
}
