// Static game data: items, buildings, research, houses.

export type ItemId =
  | 'log'
  | 'plank'
  | 'wheat'
  | 'flour'
  | 'bread'
  | 'stone'
  | 'ore'
  | 'iron'
  | 'tools';

export const ITEM_IDS: ItemId[] = ['log', 'plank', 'wheat', 'flour', 'bread', 'stone', 'ore', 'iron', 'tools'];

export interface ItemDef {
  id: ItemId;
  name: string;
  value: number; // coins when sold at the trading post
}

export const ITEMS: Record<ItemId, ItemDef> = {
  log: { id: 'log', name: '丸太', value: 1 },
  plank: { id: 'plank', name: '板材', value: 3 },
  wheat: { id: 'wheat', name: '小麦', value: 1 },
  flour: { id: 'flour', name: '小麦粉', value: 3 },
  bread: { id: 'bread', name: 'パン', value: 5 },
  stone: { id: 'stone', name: '石材', value: 2 },
  ore: { id: 'ore', name: '鉄鉱石', value: 2 },
  iron: { id: 'iron', name: '鉄', value: 8 },
  tools: { id: 'tools', name: '道具', value: 22 },
};

export type ItemBag = Partial<Record<ItemId, number>>;

export interface Cost {
  coins: number;
  items?: ItemBag;
}

export type BuildingId =
  | 'belt'
  | 'road'
  | 'splitter'
  | 'hall'
  | 'house'
  | 'market'
  | 'warehouse'
  | 'trade'
  | 'lumber'
  | 'farm'
  | 'quarry'
  | 'mine'
  | 'sawmill'
  | 'mill'
  | 'bakery'
  | 'smelter'
  | 'workshop';

export type BuildingKind = 'belt' | 'road' | 'splitter' | 'hall' | 'house' | 'storage' | 'trade' | 'gatherer' | 'crafter';

export type Category = 'logistics' | 'resource' | 'industry' | 'town';

export interface Recipe {
  in: ItemBag;
  out: ItemBag;
  time: number; // seconds per cycle at Lv1 with full workforce
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  desc: string;
  kind: BuildingKind;
  category: Category;
  size: [number, number];
  cost: Cost;
  workers: number;
  recipe?: Recipe;
  /** Gatherers: what they need nearby / underneath */
  needs?: 'trees' | 'rock' | 'ore';
  /** market / hall coverage radius */
  radius?: number;
  /** per-item storage capacity */
  storageCap?: number;
  unlock?: ResearchId;
  upgradable?: boolean;
  hotkey?: string;
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  belt: {
    id: 'belt', name: 'ベルトコンベア', desc: '資源を運ぶ。ドラッグで連続して敷設できます。',
    kind: 'belt', category: 'logistics', size: [1, 1], cost: { coins: 1 }, workers: 0, hotkey: 'B',
  },
  splitter: {
    id: 'splitter', name: '分配器', desc: '流れてきた資源を、外向きのベルトへ順番に振り分けます。',
    kind: 'splitter', category: 'logistics', size: [1, 1], cost: { coins: 10 }, workers: 0, unlock: 'logistics',
  },
  road: {
    id: 'road', name: '石畳の道', desc: '住民が歩く道。民家・邸宅へ発展するには道に面している必要があります。',
    kind: 'road', category: 'town', size: [1, 1], cost: { coins: 1 }, workers: 0, hotkey: 'V',
  },
  hall: {
    id: 'hall', name: '町役場', desc: '町の中心。資源を貯蔵し、周囲の家へ物資を配ります。',
    kind: 'hall', category: 'town', size: [3, 3], cost: { coins: 0 }, workers: 0, radius: 7, storageCap: 120,
  },
  house: {
    id: 'house', name: '住宅', desc: '住民が暮らす家。物資が届くと人口と税収が増え、条件を満たすと発展します。',
    kind: 'house', category: 'town', size: [1, 1], cost: { coins: 15, items: { log: 4 } }, workers: 0, hotkey: 'H',
  },
  market: {
    id: 'market', name: '市場', desc: 'ベルトで届いた物資を貯え、周囲の家へ配ります。',
    kind: 'storage', category: 'town', size: [2, 2], cost: { coins: 60, items: { plank: 10 } }, workers: 1, radius: 6, storageCap: 50,
  },
  warehouse: {
    id: 'warehouse', name: '倉庫', desc: '大量の資源を貯えます。貯えた資源は建設や研究に使えます。',
    kind: 'storage', category: 'town', size: [2, 2], cost: { coins: 60, items: { plank: 20 } }, workers: 1, storageCap: 250, unlock: 'stonework',
  },
  trade: {
    id: 'trade', name: '交易所', desc: '運び込まれた品物を売却してコインに換えます。',
    kind: 'trade', category: 'town', size: [2, 2], cost: { coins: 50, items: { log: 10 } }, workers: 1, storageCap: 10,
    recipe: { in: {}, out: {}, time: 1.2 }, upgradable: true,
  },
  lumber: {
    id: 'lumber', name: '伐採小屋', desc: '周囲の木を伐って丸太を生産します。近くに木が多いほど効率が上がります。',
    kind: 'gatherer', category: 'resource', size: [2, 2], cost: { coins: 25 }, workers: 2, needs: 'trees', radius: 3,
    recipe: { in: {}, out: { log: 1 }, time: 3.5 }, upgradable: true, hotkey: '1',
  },
  farm: {
    id: 'farm', name: '小麦農場', desc: '畑で小麦を育てて収穫します。',
    kind: 'gatherer', category: 'resource', size: [3, 3], cost: { coins: 40, items: { log: 5 } }, workers: 3,
    recipe: { in: {}, out: { wheat: 1 }, time: 3.5 }, upgradable: true, hotkey: '2',
  },
  quarry: {
    id: 'quarry', name: '採石場', desc: '岩場の上に建てて石材を切り出します。',
    kind: 'gatherer', category: 'resource', size: [2, 2], cost: { coins: 50, items: { plank: 10 } }, workers: 2, needs: 'rock',
    recipe: { in: {}, out: { stone: 1 }, time: 4 }, upgradable: true, unlock: 'stonework',
  },
  mine: {
    id: 'mine', name: '鉄鉱山', desc: '鉄鉱脈の上に建てて鉄鉱石を掘り出します。',
    kind: 'gatherer', category: 'resource', size: [2, 2], cost: { coins: 90, items: { plank: 20, stone: 10 } }, workers: 3, needs: 'ore',
    recipe: { in: {}, out: { ore: 1 }, time: 4.5 }, upgradable: true, unlock: 'metallurgy',
  },
  sawmill: {
    id: 'sawmill', name: '製材所', desc: '丸太を板材に加工します。',
    kind: 'crafter', category: 'industry', size: [2, 2], cost: { coins: 40, items: { log: 8 } }, workers: 2,
    recipe: { in: { log: 1 }, out: { plank: 1 }, time: 3 }, upgradable: true, hotkey: '3',
  },
  mill: {
    id: 'mill', name: '風車小屋', desc: '小麦を挽いて小麦粉にします。',
    kind: 'crafter', category: 'industry', size: [2, 2], cost: { coins: 60, items: { plank: 15 } }, workers: 2,
    recipe: { in: { wheat: 2 }, out: { flour: 1 }, time: 4 }, upgradable: true, unlock: 'food',
  },
  bakery: {
    id: 'bakery', name: 'パン工房', desc: '小麦粉からパンを焼き上げます。',
    kind: 'crafter', category: 'industry', size: [2, 2], cost: { coins: 70, items: { plank: 20 } }, workers: 2,
    recipe: { in: { flour: 1 }, out: { bread: 2 }, time: 5 }, upgradable: true, unlock: 'food',
  },
  smelter: {
    id: 'smelter', name: '製錬炉', desc: '鉄鉱石を丸太の火で溶かし、鉄をつくります。',
    kind: 'crafter', category: 'industry', size: [2, 2], cost: { coins: 100, items: { stone: 20, plank: 10 } }, workers: 3,
    recipe: { in: { ore: 2, log: 1 }, out: { iron: 1 }, time: 5 }, upgradable: true, unlock: 'metallurgy',
  },
  workshop: {
    id: 'workshop', name: '道具工房', desc: '板材と鉄から道具をつくります。',
    kind: 'crafter', category: 'industry', size: [2, 2], cost: { coins: 120, items: { plank: 20, iron: 10 } }, workers: 3,
    recipe: { in: { plank: 1, iron: 1 }, out: { tools: 1 }, time: 6 }, upgradable: true, unlock: 'tools',
  },
};

export const BUILD_MENU: { cat: Category; name: string; items: BuildingId[] }[] = [
  { cat: 'logistics', name: '物流', items: ['belt', 'splitter'] },
  { cat: 'resource', name: '資源', items: ['lumber', 'farm', 'quarry', 'mine'] },
  { cat: 'industry', name: '加工', items: ['sawmill', 'mill', 'bakery', 'smelter', 'workshop'] },
  { cat: 'town', name: '街', items: ['road', 'house', 'market', 'warehouse', 'trade'] },
];

/** Production speed multiplier per building level */
export const LEVEL_SPEED = [0, 1, 1.6, 2.2];

export const UPGRADE_COST: Record<2 | 3, Cost> = {
  2: { coins: 40, items: { plank: 10, stone: 10 } },
  3: { coins: 120, items: { iron: 10, tools: 4 } },
};

export type ResearchId =
  | 'food'
  | 'stonework'
  | 'logistics'
  | 'housing2'
  | 'improve1'
  | 'metallurgy'
  | 'fastbelt'
  | 'tools'
  | 'housing3'
  | 'improve2';

export interface ResearchDef {
  id: ResearchId;
  name: string;
  desc: string;
  cost: Cost;
  prereq: ResearchId[];
  time: number; // seconds to complete once paid
  col: number;
  row: number;
}

export const RESEARCH: Record<ResearchId, ResearchDef> = {
  logistics: {
    id: 'logistics', name: '物流 I', desc: '分配器を解放。ひとつのラインを複数の工場へ分けられます。',
    cost: { coins: 40, items: { plank: 10 } }, prereq: [], time: 8, col: 0, row: 0,
  },
  food: {
    id: 'food', name: '食料加工', desc: '風車小屋とパン工房を解放。小麦からパンをつくれます。',
    cost: { coins: 60, items: { plank: 15 } }, prereq: [], time: 10, col: 0, row: 1,
  },
  stonework: {
    id: 'stonework', name: '石工術', desc: '採石場と倉庫を解放。',
    cost: { coins: 80, items: { plank: 20 } }, prereq: [], time: 10, col: 0, row: 2,
  },
  housing2: {
    id: 'housing2', name: '民家', desc: '住宅が「民家」へ発展できるようになります（丸太＋パン、道に面すること）。',
    cost: { coins: 120, items: { plank: 20, bread: 10 } }, prereq: ['food'], time: 15, col: 1, row: 1,
  },
  improve1: {
    id: 'improve1', name: '建物改良 I', desc: '生産設備を Lv2 へ改良可能に（速度 ×1.6）。',
    cost: { coins: 150, items: { plank: 20, stone: 15 } }, prereq: ['stonework'], time: 15, col: 1, row: 2,
  },
  metallurgy: {
    id: 'metallurgy', name: '採掘と製錬', desc: '鉄鉱山と製錬炉を解放。',
    cost: { coins: 200, items: { stone: 30, plank: 20 } }, prereq: ['stonework'], time: 18, col: 1, row: 3,
  },
  fastbelt: {
    id: 'fastbelt', name: '高速ベルト', desc: 'すべてのベルトコンベアの速度が ×1.75 になります。',
    cost: { coins: 150, items: { iron: 10 } }, prereq: ['metallurgy', 'logistics'], time: 15, col: 2, row: 0,
  },
  tools: {
    id: 'tools', name: '道具づくり', desc: '道具工房を解放。',
    cost: { coins: 250, items: { iron: 15, plank: 20 } }, prereq: ['metallurgy'], time: 20, col: 2, row: 3,
  },
  housing3: {
    id: 'housing3', name: '邸宅', desc: '民家が「邸宅」へ発展できるようになります（パン＋板材＋道具）。',
    cost: { coins: 400, items: { tools: 10, bread: 30, stone: 30 } }, prereq: ['housing2', 'tools'], time: 25, col: 3, row: 1,
  },
  improve2: {
    id: 'improve2', name: '建物改良 II', desc: '生産設備を Lv3 へ改良可能に（速度 ×2.2）。',
    cost: { coins: 300, items: { iron: 20, tools: 8 } }, prereq: ['improve1', 'tools'], time: 25, col: 3, row: 2,
  },
};

export const RESEARCH_IDS = Object.keys(RESEARCH) as ResearchId[];

export interface HouseTierDef {
  name: string;
  needs: ItemId[];
  popHappy: number;
  popUnhappy: number;
  tax: number; // coins per second when happy
  requires?: ResearchId;
}

export const HOUSE_TIERS: HouseTierDef[] = [
  { name: '小屋', needs: ['log'], popHappy: 3, popUnhappy: 1, tax: 0.3 },
  { name: '民家', needs: ['log', 'bread'], popHappy: 6, popUnhappy: 2, tax: 0.75, requires: 'housing2' },
  { name: '邸宅', needs: ['bread', 'plank', 'tools'], popHappy: 10, popUnhappy: 3, tax: 1.6, requires: 'housing3' },
];

/** seconds between consuming one unit of each need */
export const HOUSE_CONSUME_INTERVAL = 24;
/** seconds of continuous happiness before upgrading */
export const HOUSE_UPGRADE_TIME = 12;
/** seconds of continuous unhappiness before downgrading */
export const HOUSE_DOWNGRADE_TIME = 60;

export const HALL_WORKERS = 6;

export interface Milestone {
  pop: number;
  name: string;
  reward: number;
  desc: string;
}

export const MILESTONES: Milestone[] = [
  { pop: 0, name: '開拓地', reward: 0, desc: '' },
  { pop: 20, name: '村', reward: 150, desc: '町役場に時計塔が建ちました。' },
  { pop: 50, name: '町', reward: 300, desc: '夜の街路に灯りがともるようになりました。' },
  { pop: 100, name: '都市', reward: 600, desc: 'ギアヴェイルは立派な都市になりました！' },
];

export const BELT_BASE_SPEED = 1.4; // tiles per second
export const BELT_SPACING = 0.25;
export const TICK = 0.1; // simulation step (seconds)
