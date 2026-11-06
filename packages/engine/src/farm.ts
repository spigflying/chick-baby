// 小雞農場（docs/superpowers/specs/2026-11-03-farm-design.md）：數值由 scripts/sim-farm.ts 的經濟模擬調過（test/farm-economy.test.ts）。
// 整座農場是一個 FarmState，這裡全部是純函式。
// 伺服器、經濟模擬與測試共用同一套規則；計時只算開放時間（clock.addOpen / clock.elapsed），唯一例外是訂單補單等待照真實時間算。
// 第二階段（2026-11-04-farm-phase2-design.md）：東邊新地、加買田、蜂箱／牛棚／起司小屋、熱氣球、裝飾、小攤、農場食物、小雞澆水。
import type { Clock } from './hours';
import type { Food } from './foods';
import { createRng, nextInt } from './rng';

export type CropId = 'wheat' | 'carrot' | 'strawberry' | 'pumpkin';
export type FarmItemId = CropId | 'wool' | 'egg' | 'apple' | 'bread' | 'jam' | 'honey' | 'milk' | 'honeycake' | 'cheese';
export type AnimalStation = 'hutch' | 'coop' | 'beehive' | 'cowshed';
export type CraftStation = 'bakery' | 'jamhouse' | 'dairy';
export type RecipeId = 'bread' | 'jam' | 'honeycake' | 'cheese';
export type DecoId = 'flowerbed' | 'scarecrow' | 'bench' | 'mushroom' | 'fountain' | 'arch' | 'heartballoon' | 'statue';
export type FarmReason = 'farm_seed' | 'farm_sell' | 'farm_order' | 'farm_upgrade' | 'farm_level' | 'farm_rescue'
  | 'farm_expand' | 'farm_deco' | 'farm_balloon' | 'farm_stall_buy' | 'farm_stall_sale';
export interface Stack { item: FarmItemId; qty: number }
/** chick：自己的小雞澆過（跟好友澆水 wateredBy 分開算） */
export interface Field { crop: CropId | null; start: number; ready: number; wateredBy: string | null; chick: boolean }
export interface Animal { start: number; ready: number | null }
export interface Job { recipe: RecipeId; ready: number }
export interface Order { items: Stack[]; coins: number; xp: number }
export interface HelpNote { by: string; name: string; kind: 'water' | 'rescue' | 'collect'; at: number; item?: FarmItemId; qty?: number }
export interface Crate { item: FarmItemId; qty: number; filled: boolean }
/** 熱氣球：crates 有東西＝停在農場（到 leave 為止）；空的＝飛走了，arrive 時再來（arrive 0＝還沒排過班）。 */
export interface Balloon { seq: number; arrive: number; leave: number; crates: Crate[] }
export interface StallSlot { item: FarmItemId; qty: number; price: number }
export interface SaleNote { by: string; name: string; item: FarmItemId; qty: number; price: number; at: number }
export interface FarmState {
  v: 1; seed: number; level: number; xp: number; friendPts: number;
  barnLevel: number; barnBonus: number; barnBonusBought: number;
  fields: Field[];
  animals: Record<AnimalStation, Animal[]>;
  tree: { start: number; ready: number };
  jobs: Record<CraftStation, Job[]>; queueSlots: Record<CraftStation, number>;
  inv: Partial<Record<FarmItemId, number>>;
  orders: (Order | null)[]; orderWait: number[]; orderSeq: number;
  helpLog: HelpNote[];
  /** 第二階段 */
  expand: number; decos: (DecoId | null)[]; decoBag: DecoId[]; chickWater: { day: string; used: number };
  balloon: Balloon; stall: (StallSlot | null)[]; saleLog: SaleNote[];
  /** 今天（台北日期）拜訪過、已經拿過友情點數的好友農場 */
  visitHearts: { day: string; owners: string[] };
}
export type FarmAction =
  | { type: 'plant'; idx: number; crop: CropId } | { type: 'harvest'; idx: number } | { type: 'collectAll' }
  | { type: 'feed'; station: AnimalStation; i: number } | { type: 'collect'; station: AnimalStation; i: number }
  | { type: 'tree' } | { type: 'rescue' }
  | { type: 'craft'; recipe: RecipeId } | { type: 'collectJob'; station: CraftStation; i: number } | { type: 'collectJobs'; station: CraftStation }
  | { type: 'deliver'; slot: number } | { type: 'discard'; slot: number } | { type: 'sell'; item: FarmItemId; qty: number }
  | { type: 'upgradeBarn' } | { type: 'upgradeQueue'; station: CraftStation } | { type: 'barnBonus' } | { type: 'ackHelp' }
  | { type: 'expand' } | { type: 'chickWater'; idx: number }
  | { type: 'buyDeco'; deco: DecoId } | { type: 'placeDeco'; deco: DecoId; slot: number } | { type: 'storeDeco'; slot: number }
  | { type: 'fillCrate'; i: number } | { type: 'sendBalloon' }
  | { type: 'stallList'; slot: number; item: FarmItemId; qty: number; price: number } | { type: 'stallCancel'; slot: number } | { type: 'ackSales' };
/** 伺服器給的外部狀態：今天的台北日期、主人目前的寵物（小雞澆水用）。 */
export interface FarmCtx { day?: string; pet?: { alive: boolean; stamina: number } }
export type HelpAction = { kind: 'water'; idx: number } | { kind: 'rescue' };
export type VisitCollectAction = { kind: 'field'; idx: number } | { kind: 'tree' }
  | { kind: 'animal'; station: AnimalStation; i: number } | { kind: 'job'; station: CraftStation };
export interface FarmOutcome { ledger: { reason: FarmReason; delta: number }[]; leveled: number[] }
export type FarmErrorCode = 'BAD_REQUEST' | 'NOT_UNLOCKED' | 'SLOT_BUSY' | 'NOT_READY' | 'BARN_FULL' | 'NOT_ENOUGH_ITEMS'
  | 'QUEUE_FULL' | 'WITHERED' | 'NOT_WITHERED' | 'ALREADY_WATERED' | 'NOT_GROWING' | 'MAX_LEVEL' | 'NOT_ENOUGH_FRIEND_POINTS' | 'NO_ORDER'
  | 'NO_PET' | 'CHICK_TIRED' | 'NO_BALLOON' | 'CRATE_DONE' | 'NO_LISTING' | 'BAD_PRICE' | 'NOT_EDIBLE';
export const FARM_ERROR_CODES: FarmErrorCode[] = ['BAD_REQUEST', 'NOT_UNLOCKED', 'SLOT_BUSY', 'NOT_READY', 'BARN_FULL', 'NOT_ENOUGH_ITEMS',
  'QUEUE_FULL', 'WITHERED', 'NOT_WITHERED', 'ALREADY_WATERED', 'NOT_GROWING', 'MAX_LEVEL', 'NOT_ENOUGH_FRIEND_POINTS', 'NO_ORDER',
  'NO_PET', 'CHICK_TIRED', 'NO_BALLOON', 'CRATE_DONE', 'NO_LISTING', 'BAD_PRICE', 'NOT_EDIBLE'];
export class FarmError extends Error { constructor(public code: FarmErrorCode) { super(code); } }

const MIN = 60_000, HOUR = 60 * MIN;

export const FARM = {
  /** 0–11 主畫面（依等級解鎖），12–17 東邊新地（用金幣照順序買） */
  fieldCount: 18,
  baseFields: 12,
  /** 第 i 格田在幾級解鎖（Lv1 開 6 格，Lv2/3/5/6/8/10 各多 1 格） */
  fieldUnlock: [1, 1, 1, 1, 1, 1, 2, 3, 5, 6, 8, 10],
  expand: { levels: [7, 9, 11, 13, 15, 17], costs: [120, 200, 300, 450, 650, 900] },
  eastLevel: 5,
  decoSlots: 6,
  chickWater: { cut: 0.2, staminaSteps: [30, 60] },
  balloon: { level: 7, crates: 4, minQty: 3, maxQty: 6, stayMs: 6 * HOUR, gapMs: 3 * HOUR, coinMult: 1.5, bonusCoins: 20, bonusXp: 30 },
  stall: { level: 5, slots: 4, maxQty: 10, maxMult: 3, buysPerDay: 10, logMax: 20 },
  maxLevel: 20,
  xpPerLevel: 30,          // 升到下一級需要 xpPerLevel × level
  levelRewardPerLevel: 2,  // 升級獎勵 ◎ 2 × 新等級
  animalsPerStation: 2,
  tree: { ms: 120 * MIN, out: { item: 'apple', qty: 3 } as Stack, witherMs: 8 * HOUR, rescueCoins: 30 },
  orders: { maxSlots: 6, slotsByLevel: [[8, 6], [5, 5], [3, 4], [1, 3]] as [number, number][], maxKinds: 3, maxQty: 3, priceyAt: 14, priceyMaxQty: 2, coinMult: 1.8, xpMult: 2, discardWaitMs: 10 * MIN, deliverWaitMs: 90 * MIN },
  barn: { base: 200, step: 50, maxLevel: 6, costBase: 100, bonusSlots: 10, bonusCostStep: 10 },
  queue: { base: 2, max: 4, costs: [80, 160] },
  help: { waterCut: 0.2, perDay: 10, perFarm: 5, friendPoints: 1, logMax: 20 },
  /** 每天第一次拜訪某位好友的農場送友情點數（好友沒種東西也拿得到） */
  visit: { friendPoints: 1, perDay: 3 },
};

export const FARM_ITEMS: Record<FarmItemId, { name: string; sell: number; xp: number }> = {
  wheat: { name: '小麥', sell: 1, xp: 1 }, carrot: { name: '胡蘿蔔', sell: 3, xp: 2 }, strawberry: { name: '草莓', sell: 6, xp: 4 },
  pumpkin: { name: '愛心南瓜', sell: 12, xp: 6 }, wool: { name: '毛線球', sell: 4, xp: 3 }, egg: { name: '蛋', sell: 3, xp: 3 },
  apple: { name: '蘋果', sell: 3, xp: 3 }, bread: { name: '麵包', sell: 6, xp: 5 }, jam: { name: '草莓果醬', sell: 20, xp: 8 },
  honey: { name: '蜂蜜', sell: 9, xp: 5 }, milk: { name: '牛奶', sell: 5, xp: 4 }, honeycake: { name: '蜂蜜蛋糕', sell: 18, xp: 9 }, cheese: { name: '起司', sell: 14, xp: 8 },
};
export const CROPS: Record<CropId, { name: string; level: number; growMs: number; seedCoins: number; seedFriendPts: number; out: Stack }> = {
  wheat: { name: '小麥', level: 1, growMs: 2 * MIN, seedCoins: 2, seedFriendPts: 0, out: { item: 'wheat', qty: 2 } },
  carrot: { name: '胡蘿蔔', level: 1, growMs: 30 * MIN, seedCoins: 6, seedFriendPts: 0, out: { item: 'carrot', qty: 2 } },
  strawberry: { name: '草莓', level: 3, growMs: 120 * MIN, seedCoins: 12, seedFriendPts: 0, out: { item: 'strawberry', qty: 2 } },
  pumpkin: { name: '愛心南瓜', level: 3, growMs: 60 * MIN, seedCoins: 0, seedFriendPts: 3, out: { item: 'pumpkin', qty: 2 } },
};
export const ANIMALS: Record<AnimalStation, { name: string; animal: string; level: number; ms: number; feed: Stack[]; out: Stack }> = {
  hutch: { name: '兔兔窩', animal: '兔兔', level: 2, ms: 120 * MIN, feed: [{ item: 'carrot', qty: 1 }], out: { item: 'wool', qty: 1 } },
  coop: { name: '雞舍', animal: '母雞', level: 4, ms: 90 * MIN, feed: [{ item: 'wheat', qty: 2 }], out: { item: 'egg', qty: 1 } },
  beehive: { name: '蜂箱', animal: '蜜蜂', level: 8, ms: 180 * MIN, feed: [{ item: 'strawberry', qty: 1 }], out: { item: 'honey', qty: 1 } },
  cowshed: { name: '牛棚', animal: '乳牛', level: 10, ms: 120 * MIN, feed: [{ item: 'wheat', qty: 3 }], out: { item: 'milk', qty: 1 } },
};
export const RECIPES: Record<RecipeId, { name: string; station: CraftStation; level: number; ms: number; in: Stack[]; out: Stack }> = {
  bread: { name: '麵包', station: 'bakery', level: 4, ms: 60 * MIN, in: [{ item: 'wheat', qty: 2 }, { item: 'egg', qty: 1 }], out: { item: 'bread', qty: 1 } },
  jam: { name: '草莓果醬', station: 'jamhouse', level: 6, ms: 120 * MIN, in: [{ item: 'strawberry', qty: 3 }], out: { item: 'jam', qty: 1 } },
  honeycake: { name: '蜂蜜蛋糕', station: 'bakery', level: 9, ms: 90 * MIN, in: [{ item: 'wheat', qty: 2 }, { item: 'egg', qty: 1 }, { item: 'honey', qty: 1 }], out: { item: 'honeycake', qty: 1 } },
  cheese: { name: '起司', station: 'dairy', level: 12, ms: 120 * MIN, in: [{ item: 'milk', qty: 2 }], out: { item: 'cheese', qty: 1 } },
};
export const CRAFT_STATIONS: Record<CraftStation, { name: string; level: number }> = {
  bakery: { name: '烘焙屋', level: 4 }, jamhouse: { name: '果醬工坊', level: 6 }, dairy: { name: '起司小屋', level: 12 },
};
export const DECOS: Record<DecoId, { name: string; coins: number; friendPts: number }> = {
  flowerbed: { name: '花圃', coins: 40, friendPts: 0 }, scarecrow: { name: '稻草人', coins: 50, friendPts: 0 },
  bench: { name: '木頭長椅', coins: 60, friendPts: 0 }, mushroom: { name: '蘑菇燈', coins: 80, friendPts: 0 },
  fountain: { name: '小噴泉', coins: 150, friendPts: 0 }, arch: { name: '彩虹拱門', coins: 200, friendPts: 0 },
  heartballoon: { name: '愛心氣球', coins: 0, friendPts: 15 }, statue: { name: '小雞雕像', coins: 0, friendPts: 30 },
};
/** 拿農場的東西餵自己的寵物（spec 第二階段 §8）：價格 0、訪客不能用。小麥、蛋、毛線球不能吃。 */
const food = (item: FarmItemId, snack: boolean, hunger: number, happiness: number, health: number, weight: number, strength: number, speed: number, stamina: number): Food =>
  ({ id: `farm:${item}` as Food['id'], name: '', price: 0, snack, visitorAllowed: false, hunger, happiness, health, weight, strength, speed, stamina });
export const FARM_FOODS: Partial<Record<FarmItemId, Food>> = {
  carrot: food('carrot', false, 15, 4, 2, 1, 1, 2, 1), strawberry: food('strawberry', true, 5, 15, 1, 1, 0, 1, 0),
  pumpkin: food('pumpkin', false, 25, 10, 3, 2, 1, 1, 2), apple: food('apple', false, 15, 5, 4, 1, 0, 1, 1),
  bread: food('bread', false, 30, 6, 2, 2, 2, 1, 3), jam: food('jam', true, 5, 30, -2, 3, 0, 0, 1),
  honey: food('honey', true, 5, 20, 3, 1, 0, 1, 1), milk: food('milk', false, 15, 5, 5, 1, 1, 0, 2),
  honeycake: food('honeycake', true, 15, 35, -3, 4, 2, 0, 2), cheese: food('cheese', false, 30, 6, 3, 3, 4, 0, 2),
};
for (const [k, f] of Object.entries(FARM_FOODS)) f!.name = FARM_ITEMS[k as FarmItemId].name;
const ANIMAL_IDS = Object.keys(ANIMALS) as AnimalStation[];
const STATION_IDS = Object.keys(CRAFT_STATIONS) as CraftStation[];

// ---------- 小工具 ----------
const fail = (c: FarmErrorCode): never => { throw new FarmError(c); };
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const has = <T extends string>(rec: Record<T, unknown>, k: unknown): k is T => typeof k === 'string' && Object.prototype.hasOwnProperty.call(rec, k);
const emptyField = (): Field => ({ crop: null, start: 0, ready: 0, wateredBy: null, chick: false });
const emptyBalloon = (): Balloon => ({ seq: 0, arrive: 0, leave: 0, crates: [] });

/** 主畫面依等級解鎖的田數（0–11）。 */
export function fieldsUnlocked(level: number) { return FARM.fieldUnlock.filter((l) => l <= level).length; }
/** 第 idx 格田能不能用：主畫面看等級，東邊新地看買了幾格。 */
export function fieldOpen(s: FarmState, idx: number) {
  return idx < FARM.baseFields ? idx < fieldsUnlocked(s.level) : idx - FARM.baseFields < s.expand;
}
export function chickWaterLimit(stamina: number) { return 1 + FARM.chickWater.staminaSteps.filter((t) => stamina >= t).length; }
export function orderSlots(level: number) { return FARM.orders.slotsByLevel.find(([l]) => level >= l)?.[1] ?? 3; }
export function barnCap(s: FarmState) { return FARM.barn.base + FARM.barn.step * s.barnLevel + s.barnBonus; }
export function invCount(s: FarmState) { return Object.values(s.inv).reduce((a, n) => a + (n ?? 0), 0); }
const haveAll = (s: FarmState, need: Stack[]) => need.every((n) => (s.inv[n.item] ?? 0) >= n.qty);
const take = (s: FarmState, need: Stack[]) => { for (const n of need) { s.inv[n.item] = (s.inv[n.item] ?? 0) - n.qty; if (!s.inv[n.item]) delete s.inv[n.item]; } };
const fits = (s: FarmState, qty: number) => invCount(s) + qty <= barnCap(s);
const put = (s: FarmState, st: Stack) => { s.inv[st.item] = (s.inv[st.item] ?? 0) + st.qty; };

/** 這個品項最早幾級拿得到（作物、動物、果樹、配方）。 */
function itemUnlockLevel(item: FarmItemId): number {
  const lv = [
    ...Object.values(CROPS).filter((c) => c.out.item === item).map((c) => c.level),
    ...Object.values(ANIMALS).filter((a) => a.out.item === item).map((a) => a.level),
    ...Object.values(RECIPES).filter((r) => r.out.item === item).map((r) => r.level),
    ...(FARM.tree.out.item === item ? [1] : []),
  ];
  return lv.length ? Math.min(...lv) : Infinity;
}

// ---------- 建立與讀取 ----------
export function newFarm(seed: number, now: number, clock: Clock): FarmState {
  const s: FarmState = {
    v: 1, seed: seed >>> 0, level: 1, xp: 0, friendPts: 0, barnLevel: 0, barnBonus: 0, barnBonusBought: 0,
    fields: Array.from({ length: FARM.fieldCount }, emptyField),
    animals: Object.fromEntries(ANIMAL_IDS.map((a) => [a, Array.from({ length: FARM.animalsPerStation }, () => ({ start: 0, ready: null }))])) as FarmState['animals'],
    tree: { start: now, ready: clock.addOpen(now, FARM.tree.ms) },
    jobs: Object.fromEntries(STATION_IDS.map((k) => [k, []])) as unknown as FarmState['jobs'],
    queueSlots: Object.fromEntries(STATION_IDS.map((k) => [k, FARM.queue.base])) as FarmState['queueSlots'],
    inv: {}, orders: Array(FARM.orders.maxSlots).fill(null), orderWait: Array(FARM.orders.maxSlots).fill(0), orderSeq: 0, helpLog: [],
    expand: 0, decos: Array(FARM.decoSlots).fill(null), decoBag: [], chickWater: { day: '', used: 0 },
    balloon: emptyBalloon(), stall: Array(FARM.stall.slots).fill(null), saleLog: [], visitHearts: { day: '', owners: [] },
  };
  refreshOrders(s, now); refreshBalloon(s, now, clock);
  return s;
}

/** 讀資料庫的 JSON：缺的欄位補預設值（之後加新內容時舊存檔不會壞）。 */
export function loadFarm(json: unknown, now: number, clock: Clock): FarmState {
  if (!json || typeof json !== 'object' || Array.isArray(json)) fail('BAD_REQUEST');
  const j = json as Partial<FarmState>;
  const d = newFarm(isInt(j.seed) ? j.seed : 0, now, clock);
  const pad = <T>(arr: unknown, n: number, mk: () => T): T[] => { const a = Array.isArray(arr) ? arr.slice(0, n) : []; while (a.length < n) a.push(mk()); return a as T[]; };
  const animals = { ...d.animals };
  for (const a of ANIMAL_IDS) animals[a] = pad(j.animals?.[a], FARM.animalsPerStation, () => ({ start: 0, ready: null }));
  const jobs = { ...d.jobs }; const queueSlots = { ...d.queueSlots };
  for (const k of STATION_IDS) { if (Array.isArray(j.jobs?.[k])) jobs[k] = j.jobs![k]; if (isInt(j.queueSlots?.[k])) queueSlots[k] = j.queueSlots![k]; }
  const s = {
    ...d, ...j, v: 1,
    fields: pad<Field>(j.fields, FARM.fieldCount, emptyField).map((f) => ({ ...emptyField(), ...f })),
    animals, jobs, queueSlots,
    tree: j.tree ?? d.tree,
    inv: { ...(j.inv ?? {}) },
    orders: pad(j.orders ?? d.orders, FARM.orders.maxSlots, () => null),
    orderWait: pad(j.orderWait, FARM.orders.maxSlots, () => 0),
    helpLog: Array.isArray(j.helpLog) ? j.helpLog : [],
    expand: isInt(j.expand) ? j.expand : 0,
    decos: pad(j.decos, FARM.decoSlots, () => null), decoBag: Array.isArray(j.decoBag) ? j.decoBag : [],
    chickWater: j.chickWater && typeof j.chickWater.day === 'string' ? j.chickWater : { day: '', used: 0 },
    balloon: j.balloon && Array.isArray(j.balloon.crates) ? j.balloon : emptyBalloon(),
    stall: pad(j.stall, FARM.stall.slots, () => null), saleLog: Array.isArray(j.saleLog) ? j.saleLog : [],
    visitHearts: j.visitHearts && typeof j.visitHearts.day === 'string' && Array.isArray(j.visitHearts.owners) ? j.visitHearts : { day: '', owners: [] },
  } as FarmState;
  // 等待時間已過的訂單格直接補上（genOrder 是決定性的，沒存檔也不會跟下一次動作算出來的不一樣）；熱氣球也照班次走
  refreshOrders(s, now); refreshBalloon(s, now, clock);
  return s;
}

// ---------- 訂單 ----------
export function genOrder(seed: number, seq: number, level: number): Order {
  const rng = createRng((seed ^ Math.imul(seq + 1, 0x9e3779b1)) >>> 0);
  const pool = (Object.keys(FARM_ITEMS) as FarmItemId[]).filter((i) => itemUnlockLevel(i) <= level);
  const kinds = 1 + nextInt(rng, Math.min(FARM.orders.maxKinds, pool.length));
  const items: Stack[] = [];
  for (let k = 0; k < kinds; k++) {
    const i = pool.splice(nextInt(rng, pool.length), 1)[0];
    items.push({ item: i, qty: 1 + nextInt(rng, FARM_ITEMS[i].sell >= FARM.orders.priceyAt ? FARM.orders.priceyMaxQty : FARM.orders.maxQty) });
  }
  const value = items.reduce((a, it) => a + FARM_ITEMS[it.item].sell * it.qty, 0);
  const xp = items.reduce((a, it) => a + FARM_ITEMS[it.item].xp * it.qty, 0) * FARM.orders.xpMult;
  return { items, coins: Math.round(value * FARM.orders.coinMult), xp };
}
export function refreshOrders(s: FarmState, now: number) {
  for (let i = 0; i < orderSlots(s.level); i++) if (!s.orders[i] && now >= s.orderWait[i]) s.orders[i] = genOrder(s.seed, s.orderSeq++, s.level);
}

// ---------- 熱氣球 ----------
/** 第 seq 班熱氣球的 4 個貨箱：這個等級做得出來、不用友情點數的東西，各不相同，每箱 3–6 個。 */
export function genBalloon(seed: number, seq: number, level: number): Crate[] {
  const rng = createRng((seed ^ Math.imul(seq + 1, 0x85ebca6b) ^ 0x5bd1e995) >>> 0);
  const pool = (Object.keys(FARM_ITEMS) as FarmItemId[]).filter((i) => itemUnlockLevel(i) <= level && !Object.values(CROPS).some((c) => c.out.item === i && c.seedFriendPts));
  const out: Crate[] = [];
  for (let k = 0; k < FARM.balloon.crates && pool.length; k++) {
    const item = pool.splice(nextInt(rng, pool.length), 1)[0];
    out.push({ item, qty: FARM.balloon.minQty + nextInt(rng, FARM.balloon.maxQty - FARM.balloon.minQty + 1), filled: false });
  }
  return out;
}
/** 照班次推進：到站、停留 stayMs、飛走 gapMs 後再來。很久沒上線也只是一班一班往後排（都只算開放時間）。 */
export function refreshBalloon(s: FarmState, now: number, clock: Clock) {
  if (s.level < FARM.balloon.level) return;
  const b = s.balloon;
  if (!b.arrive) b.arrive = now;
  for (let guard = 0; guard < 10_000; guard++) {
    if (!b.crates.length) {
      if (now < b.arrive) return;
      b.crates = genBalloon(s.seed, b.seq, s.level); b.leave = clock.addOpen(b.arrive, FARM.balloon.stayMs);
    } else {
      if (now < b.leave) return;
      b.arrive = clock.addOpen(b.leave, FARM.balloon.gapMs); b.crates = []; b.seq++;
    }
  }
}
const balloonHere = (s: FarmState, now: number) => s.level >= FARM.balloon.level && s.balloon.crates.length > 0 && now < s.balloon.leave;

// ---------- 計時與狀態 ----------
export type Stage = 0 | 1 | 2 | 3;
export function stageOf(start: number, ready: number, now: number, clock: Clock): Stage {
  if (now >= ready) return 3;
  const total = clock.elapsed(start, ready), done = clock.elapsed(start, now);
  if (done <= 0 || total <= 0) return 0;
  return done / total < 0.5 ? 1 : 2;
}
export function treeWithered(s: FarmState, now: number, clock: Clock) { return now >= s.tree.ready && clock.elapsed(s.tree.ready, now) >= FARM.tree.witherMs; }

function gainXp(s: FarmState, d: number, out: FarmOutcome) {
  if (s.level >= FARM.maxLevel) return;
  s.xp += d;
  while (s.level < FARM.maxLevel && s.xp >= FARM.xpPerLevel * s.level) {
    s.xp -= FARM.xpPerLevel * s.level; s.level++;
    out.leveled.push(s.level);
    out.ledger.push({ reason: 'farm_level', delta: FARM.levelRewardPerLevel * s.level });
  }
  if (s.level >= FARM.maxLevel) s.xp = 0;
}

// ---------- 主人的動作 ----------
const fieldAt = (s: FarmState, idx: unknown) => { if (!isInt(idx) || idx < 0 || idx >= FARM.fieldCount) fail('BAD_REQUEST'); return s.fields[idx as number]; };
const slotAt = (slot: unknown) => { if (!isInt(slot) || slot < 0 || slot >= FARM.orders.maxSlots) fail('BAD_REQUEST'); return slot as number; };
const decoSlotAt = (slot: unknown) => { if (!isInt(slot) || slot < 0 || slot >= FARM.decoSlots) fail('BAD_REQUEST'); return slot as number; };
const stallSlotAt = (slot: unknown) => { if (!isInt(slot) || slot < 0 || slot >= FARM.stall.slots) fail('BAD_REQUEST'); return slot as number; };
const animalAt = (s: FarmState, st: unknown, i: unknown) => {
  if (!has(ANIMALS, st) || !isInt(i) || i < 0 || i >= FARM.animalsPerStation) fail('BAD_REQUEST');
  if (s.level < ANIMALS[st as AnimalStation].level) fail('NOT_UNLOCKED');
  return s.animals[st as AnimalStation][i as number];
};

function harvestField(s: FarmState, f: Field, now: number, out: FarmOutcome) {
  if (!f.crop || now < f.ready) fail('NOT_READY');
  const c = CROPS[f.crop!];
  if (!fits(s, c.out.qty)) fail('BARN_FULL');
  put(s, c.out); gainXp(s, FARM_ITEMS[c.out.item].xp, out);
  Object.assign(f, emptyField());
}
function collectAnimal(s: FarmState, st: AnimalStation, a: Animal, now: number, out: FarmOutcome) {
  if (a.ready === null || now < a.ready) fail('NOT_READY');
  const def = ANIMALS[st];
  if (!fits(s, def.out.qty)) fail('BARN_FULL');
  put(s, def.out); gainXp(s, FARM_ITEMS[def.out.item].xp * def.out.qty, out);
  a.ready = null; a.start = 0;
}
function harvestTree(s: FarmState, now: number, clock: Clock, out: FarmOutcome) {
  if (treeWithered(s, now, clock)) fail('WITHERED');
  if (now < s.tree.ready) fail('NOT_READY');
  if (!fits(s, FARM.tree.out.qty)) fail('BARN_FULL');
  put(s, FARM.tree.out); gainXp(s, FARM_ITEMS[FARM.tree.out.item].xp, out);
  s.tree = { start: now, ready: clock.addOpen(now, FARM.tree.ms) };
}
function collectJobs(s: FarmState, st: CraftStation, now: number, out: FarmOutcome) {
  const q = s.jobs[st];
  while (q.length && q[0].ready <= now) {
    const r = RECIPES[q[0].recipe];
    if (!fits(s, r.out.qty)) return;
    put(s, r.out); gainXp(s, FARM_ITEMS[r.out.item].xp * r.out.qty, out); q.shift();
  }
}
function collectJob(s: FarmState, st: CraftStation, i: number, now: number, out: FarmOutcome) {
  if (!has(CRAFT_STATIONS, st) || !isInt(i) || i < 0) fail('BAD_REQUEST');
  const q = s.jobs[st], job = q[i];
  if (!job || job.ready > now) fail('NOT_READY');
  const r = RECIPES[job.recipe];
  if (!fits(s, r.out.qty)) fail('BARN_FULL');
  put(s, r.out); gainXp(s, FARM_ITEMS[r.out.item].xp * r.out.qty, out);
  q.splice(i, 1);
}
const tryDo = (f: () => void) => { try { f(); } catch (e) { if (!(e instanceof FarmError)) throw e; } };

export function applyFarm(s: FarmState, a: FarmAction, now: number, clock: Clock, ctx: FarmCtx = {}): FarmOutcome {
  const out: FarmOutcome = { ledger: [], leveled: [] };
  refreshOrders(s, now); refreshBalloon(s, now, clock);
  switch (a?.type) {
    case 'plant': {
      const f = fieldAt(s, a.idx);
      if (!fieldOpen(s, a.idx)) fail('NOT_UNLOCKED');
      if (!has(CROPS, a.crop)) fail('BAD_REQUEST');
      const c = CROPS[a.crop];
      if (s.level < c.level) fail('NOT_UNLOCKED');
      if (f.crop) fail('SLOT_BUSY');
      if (s.friendPts < c.seedFriendPts) fail('NOT_ENOUGH_FRIEND_POINTS');
      s.friendPts -= c.seedFriendPts;
      Object.assign(f, { crop: a.crop, start: now, ready: clock.addOpen(now, c.growMs), wateredBy: null, chick: false });
      if (c.seedCoins) out.ledger.push({ reason: 'farm_seed', delta: -c.seedCoins });
      break;
    }
    case 'harvest': harvestField(s, fieldAt(s, a.idx), now, out); break;
    case 'collectAll': {
      // 值錢的先收（成品 → 動物產物 → 果樹 → 田），倉庫快滿時不會被便宜的作物塞爆
      for (const st of STATION_IDS) collectJobs(s, st, now, out);
      for (const st of ANIMAL_IDS) if (s.level >= ANIMALS[st].level) for (const an of s.animals[st]) if (an.ready !== null && now >= an.ready) tryDo(() => collectAnimal(s, st, an, now, out));
      if (now >= s.tree.ready && !treeWithered(s, now, clock)) tryDo(() => harvestTree(s, now, clock, out));
      s.fields.forEach((f) => { if (f.crop && now >= f.ready) tryDo(() => harvestField(s, f, now, out)); });
      break;
    }
    case 'feed': {
      const an = animalAt(s, a.station, a.i), def = ANIMALS[a.station];
      if (an.ready !== null) fail('SLOT_BUSY');
      if (!haveAll(s, def.feed)) fail('NOT_ENOUGH_ITEMS');
      take(s, def.feed); an.start = now; an.ready = clock.addOpen(now, def.ms);
      break;
    }
    case 'collect': collectAnimal(s, a.station, animalAt(s, a.station, a.i), now, out); break;
    case 'tree': harvestTree(s, now, clock, out); break;
    case 'rescue': {
      if (!treeWithered(s, now, clock)) fail('NOT_WITHERED');
      s.tree = { start: now, ready: clock.addOpen(now, FARM.tree.ms) };
      out.ledger.push({ reason: 'farm_rescue', delta: -FARM.tree.rescueCoins });
      break;
    }
    case 'craft': {
      if (!has(RECIPES, a.recipe)) fail('BAD_REQUEST');
      const r = RECIPES[a.recipe], q = s.jobs[r.station];
      if (s.level < r.level) fail('NOT_UNLOCKED');
      if (q.length >= s.queueSlots[r.station]) fail('QUEUE_FULL');
      if (!haveAll(s, r.in)) fail('NOT_ENOUGH_ITEMS');
      take(s, r.in);
      const from = Math.max(now, q.length ? q[q.length - 1].ready : now);
      q.push({ recipe: a.recipe, ready: clock.addOpen(from, r.ms) });
      break;
    }
    case 'collectJob': collectJob(s, a.station, a.i, now, out); break;
    case 'collectJobs': {
      if (!has(CRAFT_STATIONS, a.station)) fail('BAD_REQUEST');
      collectJobs(s, a.station, now, out); break;
    }
    case 'deliver': {
      const i = slotAt(a.slot), o = s.orders[i];
      if (!o) fail('NO_ORDER');
      if (!haveAll(s, o!.items)) fail('NOT_ENOUGH_ITEMS');
      take(s, o!.items);
      out.ledger.push({ reason: 'farm_order', delta: o!.coins });
      gainXp(s, o!.xp, out);
      s.orders[i] = null; s.orderWait[i] = now + FARM.orders.deliverWaitMs; // 訂單等待照真實時間算：停機時段也算，隔天開門就有新單
      break;
    }
    case 'discard': {
      const i = slotAt(a.slot);
      if (!s.orders[i]) fail('NO_ORDER');
      s.orders[i] = null; s.orderWait[i] = now + FARM.orders.discardWaitMs;
      break;
    }
    case 'sell': {
      if (!has(FARM_ITEMS, a.item) || !isInt(a.qty) || a.qty <= 0) fail('BAD_REQUEST');
      if ((s.inv[a.item] ?? 0) < a.qty) fail('NOT_ENOUGH_ITEMS');
      take(s, [{ item: a.item, qty: a.qty }]);
      out.ledger.push({ reason: 'farm_sell', delta: FARM_ITEMS[a.item].sell * a.qty });
      break;
    }
    case 'upgradeBarn': {
      if (s.barnLevel >= FARM.barn.maxLevel) fail('MAX_LEVEL');
      out.ledger.push({ reason: 'farm_upgrade', delta: -FARM.barn.costBase * 2 ** s.barnLevel });
      s.barnLevel++;
      break;
    }
    case 'upgradeQueue': {
      if (!has(CRAFT_STATIONS, a.station)) fail('BAD_REQUEST');
      const n = s.queueSlots[a.station];
      if (n >= FARM.queue.max) fail('MAX_LEVEL');
      out.ledger.push({ reason: 'farm_upgrade', delta: -FARM.queue.costs[n - FARM.queue.base] });
      s.queueSlots[a.station] = n + 1;
      break;
    }
    case 'barnBonus': {
      const cost = FARM.barn.bonusCostStep * (s.barnBonusBought + 1);
      if (s.friendPts < cost) fail('NOT_ENOUGH_FRIEND_POINTS');
      s.friendPts -= cost; s.barnBonusBought++; s.barnBonus += FARM.barn.bonusSlots;
      break;
    }
    case 'ackHelp': s.helpLog = []; break;
    // ---------- 第二階段 ----------
    case 'expand': {
      const n = s.expand;
      if (n >= FARM.expand.costs.length) fail('MAX_LEVEL');
      if (s.level < FARM.expand.levels[n]) fail('NOT_UNLOCKED');
      out.ledger.push({ reason: 'farm_expand', delta: -FARM.expand.costs[n] });
      s.expand = n + 1;
      break;
    }
    case 'chickWater': {
      const f = fieldAt(s, a.idx);
      if (!ctx.pet?.alive) fail('NO_PET');
      if (!f.crop || now >= f.ready) fail('NOT_GROWING');
      if (f.chick) fail('ALREADY_WATERED');
      const day = ctx.day ?? '';
      const used = s.chickWater.day === day ? s.chickWater.used : 0;
      if (used >= chickWaterLimit(ctx.pet!.stamina)) fail('CHICK_TIRED');
      f.ready = clock.addOpen(now, Math.round(clock.elapsed(now, f.ready) * (1 - FARM.chickWater.cut)));
      f.chick = true;
      s.chickWater = { day, used: used + 1 };
      break;
    }
    case 'buyDeco': {
      if (!has(DECOS, a.deco)) fail('BAD_REQUEST');
      if (s.level < FARM.eastLevel) fail('NOT_UNLOCKED');
      const d = DECOS[a.deco];
      if (s.friendPts < d.friendPts) fail('NOT_ENOUGH_FRIEND_POINTS');
      s.friendPts -= d.friendPts;
      if (d.coins) out.ledger.push({ reason: 'farm_deco', delta: -d.coins });
      s.decoBag.push(a.deco);
      break;
    }
    case 'placeDeco': {
      const i = decoSlotAt(a.slot);
      if (!has(DECOS, a.deco)) fail('BAD_REQUEST');
      const k = s.decoBag.indexOf(a.deco);
      if (k < 0) fail('NOT_ENOUGH_ITEMS');
      s.decoBag.splice(k, 1);
      if (s.decos[i]) s.decoBag.push(s.decos[i]!);
      s.decos[i] = a.deco;
      break;
    }
    case 'storeDeco': {
      const i = decoSlotAt(a.slot);
      if (!s.decos[i]) fail('BAD_REQUEST');
      s.decoBag.push(s.decos[i]!); s.decos[i] = null;
      break;
    }
    case 'fillCrate': {
      if (!balloonHere(s, now)) fail('NO_BALLOON');
      if (!isInt(a.i) || a.i < 0 || a.i >= s.balloon.crates.length) fail('BAD_REQUEST');
      const c = s.balloon.crates[a.i];
      if (c.filled) fail('CRATE_DONE');
      if (!haveAll(s, [c])) fail('NOT_ENOUGH_ITEMS');
      take(s, [c]); c.filled = true;
      out.ledger.push({ reason: 'farm_balloon', delta: Math.round(FARM_ITEMS[c.item].sell * c.qty * FARM.balloon.coinMult) });
      gainXp(s, FARM_ITEMS[c.item].xp * c.qty, out);
      break;
    }
    case 'sendBalloon': {
      if (!balloonHere(s, now)) fail('NO_BALLOON');
      if (!s.balloon.crates.every((c) => c.filled)) fail('NOT_READY');
      out.ledger.push({ reason: 'farm_balloon', delta: FARM.balloon.bonusCoins });
      gainXp(s, FARM.balloon.bonusXp, out);
      s.balloon = { seq: s.balloon.seq + 1, arrive: clock.addOpen(now, FARM.balloon.gapMs), leave: 0, crates: [] };
      break;
    }
    case 'stallList': {
      if (s.level < FARM.stall.level) fail('NOT_UNLOCKED');
      const i = stallSlotAt(a.slot);
      if (!has(FARM_ITEMS, a.item) || !isInt(a.qty) || a.qty < 1 || a.qty > FARM.stall.maxQty || !isInt(a.price)) fail('BAD_REQUEST');
      if (s.stall[i]) fail('SLOT_BUSY');
      const [lo, hi] = stallPriceRange(a.item, a.qty);
      if (a.price < lo || a.price > hi) fail('BAD_PRICE');
      if ((s.inv[a.item] ?? 0) < a.qty) fail('NOT_ENOUGH_ITEMS');
      take(s, [{ item: a.item, qty: a.qty }]);
      s.stall[i] = { item: a.item, qty: a.qty, price: a.price };
      break;
    }
    case 'stallCancel': {
      const i = stallSlotAt(a.slot), l = s.stall[i];
      if (!l) fail('NO_LISTING');
      if (!fits(s, l!.qty)) fail('BARN_FULL');
      put(s, l!); s.stall[i] = null;
      break;
    }
    case 'ackSales': s.saleLog = []; break;
    default: fail('BAD_REQUEST');
  }
  refreshOrders(s, now); refreshBalloon(s, now, clock); // 這個動作升級多出來的訂單格、熱氣球也馬上補
  return out;
}

/** 小攤價格範圍：賣價 × 數量 到 3 倍。 */
export function stallPriceRange(item: FarmItemId, qty: number): [number, number] {
  const v = FARM_ITEMS[item].sell * qty; return [v, v * FARM.stall.maxMult];
}
/** 訪客買小攤第 slot 格：東西從主人的小攤進買的人倉庫，回傳價格（金幣由伺服器轉）。 */
export function stallBuy(seller: FarmState, buyer: FarmState, slot: number, by: { id: string; name: string }, now: number) {
  const i = stallSlotAt(slot), l = seller.stall[i];
  if (!l) fail('NO_LISTING');
  if (!fits(buyer, l!.qty)) fail('BARN_FULL');
  put(buyer, l!); seller.stall[i] = null;
  seller.saleLog.push({ by: by.id, name: by.name, item: l!.item, qty: l!.qty, price: l!.price, at: now });
  if (seller.saleLog.length > FARM.stall.logMax) seller.saleLog.splice(0, seller.saleLog.length - FARM.stall.logMax);
  return { item: l!.item, qty: l!.qty, price: l!.price };
}
/** 訪客採收：成熟資源從主人的生產格直接進訪客倉庫；經驗與升級獎勵歸採收者。 */
export function visitCollect(owner: FarmState, visitor: FarmState, a: VisitCollectAction, now: number, clock: Clock) {
  let stack: Stack;
  if (a?.kind === 'field') {
    const f = fieldAt(owner, a.idx);
    const crop = f.crop;
    if (!crop || now < f.ready) fail('NOT_READY');
    stack = CROPS[crop!].out;
    if (!fits(visitor, stack.qty)) fail('BARN_FULL');
    Object.assign(f, emptyField());
  } else if (a?.kind === 'tree') {
    if (treeWithered(owner, now, clock)) fail('WITHERED');
    if (now < owner.tree.ready) fail('NOT_READY');
    stack = FARM.tree.out;
    if (!fits(visitor, stack.qty)) fail('BARN_FULL');
    owner.tree = { start: now, ready: clock.addOpen(now, FARM.tree.ms) };
  } else if (a?.kind === 'animal') {
    const animal = animalAt(owner, a.station, a.i);
    if (animal.ready === null || now < animal.ready) fail('NOT_READY');
    stack = ANIMALS[a.station].out;
    if (!fits(visitor, stack.qty)) fail('BARN_FULL');
    animal.ready = null; animal.start = 0;
  } else if (a?.kind === 'job') {
    if (!has(CRAFT_STATIONS, a.station)) fail('BAD_REQUEST');
    if (owner.level < CRAFT_STATIONS[a.station].level) fail('NOT_UNLOCKED');
    const q = owner.jobs[a.station];
    if (!q.length || now < q[0].ready) fail('NOT_READY');
    stack = RECIPES[q[0].recipe].out;
    if (!fits(visitor, stack.qty)) fail('BARN_FULL');
    q.shift();
  } else return fail('BAD_REQUEST');
  put(visitor, stack);
  const out: FarmOutcome = { ledger: [], leveled: [] };
  gainXp(visitor, FARM_ITEMS[stack.item].xp * (a.kind === 'field' || a.kind === 'tree' ? 1 : stack.qty), out);
  refreshOrders(visitor, now);
  return { ...stack, ...out };
}
/** 拿倉庫的東西給寵物吃：回傳要套用的食物（伺服器先檢查寵物能不能吃，再呼叫這個扣東西）。 */
export function takeFarmFood(s: FarmState, item: unknown): Food {
  if (!has(FARM_ITEMS, item)) fail('BAD_REQUEST');
  const f = FARM_FOODS[item as FarmItemId];
  if (!f) fail('NOT_EDIBLE');
  if ((s.inv[item as FarmItemId] ?? 0) < 1) fail('NOT_ENOUGH_ITEMS');
  take(s, [{ item: item as FarmItemId, qty: 1 }]);
  return f!;
}

// ---------- 好友幫忙 ----------
/** 拜訪好友農場：每天每位好友第一次 +友情點數，每天最多 FARM.visit.perDay 位。回傳這次拿到幾點（0＝今天拿過或到上限）。 */
export function visitHeart(s: FarmState, ownerId: string, day: string): number {
  if (s.visitHearts.day !== day) s.visitHearts = { day, owners: [] };
  const v = s.visitHearts;
  if (v.owners.includes(ownerId) || v.owners.length >= FARM.visit.perDay) return 0;
  v.owners.push(ownerId);
  s.friendPts += FARM.visit.friendPoints;
  return FARM.visit.friendPoints;
}
export function applyHelp(s: FarmState, a: HelpAction, helper: { id: string; name: string }, now: number, clock: Clock) {
  if (a?.kind === 'water') {
    const f = fieldAt(s, a.idx);
    if (f.crop && f.wateredBy) fail('ALREADY_WATERED');
    if (!f.crop || now >= f.ready) fail('NOT_GROWING');
    const remain = clock.elapsed(now, f.ready);
    f.ready = clock.addOpen(now, Math.round(remain * (1 - FARM.help.waterCut)));
    f.wateredBy = helper.id;
  } else if (a?.kind === 'rescue') {
    if (!treeWithered(s, now, clock)) fail('NOT_WITHERED');
    s.tree = { start: now, ready: clock.addOpen(now, FARM.tree.ms) };
  } else fail('BAD_REQUEST');
  s.helpLog.push({ by: helper.id, name: helper.name, kind: a.kind, at: now });
  if (s.helpLog.length > FARM.help.logMax) s.helpLog.splice(0, s.helpLog.length - FARM.help.logMax);
}

// ---------- 給畫面用的衍生資料 ----------
export interface FarmDerived {
  fields: { stage: Stage | null; remainMs: number; locked: boolean; unlockLevel: number }[];
  animals: Record<AnimalStation, { locked: boolean; items: { state: 'hungry' | 'growing' | 'ready'; remainMs: number }[] }>;
  tree: { state: 'growing' | 'ready' | 'withered'; remainMs: number };
  jobs: Record<CraftStation, { locked: boolean; items: { recipe: RecipeId; remainMs: number }[] }>;
  orders: ({ order: Order; canDeliver: boolean } | { waitMs: number })[];
  barn: { used: number; cap: number }; xpToNext: number; needsHelp: boolean;
  east: { locked: boolean }; expand: { next: { level: number; cost: number } | null };
  balloon: { state: 'locked' } | { state: 'away'; remainMs: number } | { state: 'here'; remainMs: number; crates: (Crate & { canFill: boolean })[] };
  chickWater: { left: number; limit: number };
}
export function describeFarm(s: FarmState, now: number, clock: Clock, ctx: FarmCtx = {}): FarmDerived {
  const remain = (t: number) => (now >= t ? 0 : clock.elapsed(now, t));
  const withered = treeWithered(s, now, clock);
  const animals = {} as FarmDerived['animals'];
  for (const st of ANIMAL_IDS) animals[st] = {
    locked: s.level < ANIMALS[st].level,
    items: s.animals[st].map((a) => ({ state: a.ready === null ? 'hungry' : now >= a.ready ? 'ready' : 'growing', remainMs: a.ready === null ? 0 : remain(a.ready) })),
  };
  const jobs = {} as FarmDerived['jobs'];
  for (const st of STATION_IDS) jobs[st] = { locked: s.level < CRAFT_STATIONS[st].level, items: s.jobs[st].map((j) => ({ recipe: j.recipe, remainMs: remain(j.ready) })) };
  const orders: FarmDerived['orders'] = [];
  for (let i = 0; i < orderSlots(s.level); i++) {
    const o = s.orders[i];
    orders.push(o ? { order: o, canDeliver: haveAll(s, o.items) } : { waitMs: Math.max(0, s.orderWait[i] - now) });
  }
  return {
    fields: s.fields.map((f, i) => ({ stage: f.crop ? stageOf(f.start, f.ready, now, clock) : null, remainMs: f.crop ? remain(f.ready) : 0, locked: !fieldOpen(s, i),
      unlockLevel: i < FARM.baseFields ? FARM.fieldUnlock[i] : FARM.expand.levels[i - FARM.baseFields] })),
    animals, jobs, orders,
    tree: { state: withered ? 'withered' : now >= s.tree.ready ? 'ready' : 'growing', remainMs: remain(s.tree.ready) },
    barn: { used: invCount(s), cap: barnCap(s) },
    xpToNext: FARM.xpPerLevel * s.level,
    needsHelp: withered || s.fields.some((f) => f.crop && now < f.ready && !f.wateredBy),
    east: { locked: s.level < FARM.eastLevel },
    expand: { next: s.expand < FARM.expand.costs.length ? { level: FARM.expand.levels[s.expand], cost: FARM.expand.costs[s.expand] } : null },
    balloon: s.level < FARM.balloon.level ? { state: 'locked' }
      : balloonHere(s, now) ? { state: 'here', remainMs: remain(s.balloon.leave), crates: s.balloon.crates.map((c) => ({ ...c, canFill: !c.filled && haveAll(s, [c]) })) }
        : { state: 'away', remainMs: remain(s.balloon.arrive) },
    chickWater: (() => {
      if (!ctx.pet?.alive) return { left: 0, limit: 0 };
      const limit = chickWaterLimit(ctx.pet.stamina), used = s.chickWater.day === (ctx.day ?? '') ? s.chickWater.used : 0;
      return { left: Math.max(0, limit - used), limit };
    })(),
  };
}
