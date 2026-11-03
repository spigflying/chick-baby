// 小雞農場（docs/superpowers/specs/2026-11-03-farm-design.md）：數值由 scripts/sim-farm.ts 的經濟模擬調過（test/farm-economy.test.ts）。
// 整座農場是一個 FarmState，這裡全部是純函式。
// 伺服器、經濟模擬與測試共用同一套規則；所有計時只算開放時間（clock.addOpen / clock.elapsed）。
import type { Clock } from './hours';
import { createRng, nextInt } from './rng';

export type CropId = 'wheat' | 'carrot' | 'strawberry' | 'pumpkin';
export type FarmItemId = CropId | 'wool' | 'egg' | 'apple' | 'bread' | 'jam';
export type AnimalStation = 'hutch' | 'coop';
export type CraftStation = 'bakery' | 'jamhouse';
export type RecipeId = 'bread' | 'jam';
export type FarmReason = 'farm_seed' | 'farm_sell' | 'farm_order' | 'farm_upgrade' | 'farm_level' | 'farm_rescue';
export interface Stack { item: FarmItemId; qty: number }
export interface Field { crop: CropId | null; start: number; ready: number; wateredBy: string | null }
export interface Animal { start: number; ready: number | null }
export interface Job { recipe: RecipeId; ready: number }
export interface Order { items: Stack[]; coins: number; xp: number }
export interface HelpNote { by: string; name: string; kind: 'water' | 'rescue'; at: number }
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
}
export type FarmAction =
  | { type: 'plant'; idx: number; crop: CropId } | { type: 'harvest'; idx: number } | { type: 'collectAll' }
  | { type: 'feed'; station: AnimalStation; i: number } | { type: 'collect'; station: AnimalStation; i: number }
  | { type: 'tree' } | { type: 'rescue' }
  | { type: 'craft'; recipe: RecipeId } | { type: 'collectJobs'; station: CraftStation }
  | { type: 'deliver'; slot: number } | { type: 'discard'; slot: number } | { type: 'sell'; item: FarmItemId; qty: number }
  | { type: 'upgradeBarn' } | { type: 'upgradeQueue'; station: CraftStation } | { type: 'barnBonus' } | { type: 'ackHelp' };
export type HelpAction = { kind: 'water'; idx: number } | { kind: 'rescue' };
export interface FarmOutcome { ledger: { reason: FarmReason; delta: number }[]; leveled: number[] }
export type FarmErrorCode = 'BAD_REQUEST' | 'NOT_UNLOCKED' | 'SLOT_BUSY' | 'NOT_READY' | 'BARN_FULL' | 'NOT_ENOUGH_ITEMS'
  | 'QUEUE_FULL' | 'WITHERED' | 'NOT_WITHERED' | 'ALREADY_WATERED' | 'NOT_GROWING' | 'MAX_LEVEL' | 'NOT_ENOUGH_FRIEND_POINTS' | 'NO_ORDER';
export const FARM_ERROR_CODES: FarmErrorCode[] = ['BAD_REQUEST', 'NOT_UNLOCKED', 'SLOT_BUSY', 'NOT_READY', 'BARN_FULL', 'NOT_ENOUGH_ITEMS',
  'QUEUE_FULL', 'WITHERED', 'NOT_WITHERED', 'ALREADY_WATERED', 'NOT_GROWING', 'MAX_LEVEL', 'NOT_ENOUGH_FRIEND_POINTS', 'NO_ORDER'];
export class FarmError extends Error { constructor(public code: FarmErrorCode) { super(code); } }

const MIN = 60_000, HOUR = 60 * MIN;

export const FARM = {
  fieldCount: 12,
  /** 第 i 格田在幾級解鎖（Lv1 開 6 格，Lv2/3/5/6/8/10 各多 1 格） */
  fieldUnlock: [1, 1, 1, 1, 1, 1, 2, 3, 5, 6, 8, 10],
  maxLevel: 20,
  xpPerLevel: 30,          // 升到下一級需要 xpPerLevel × level
  levelRewardPerLevel: 2,  // 升級獎勵 ◎ 2 × 新等級
  animalsPerStation: 2,
  tree: { ms: 120 * MIN, out: { item: 'apple', qty: 3 } as Stack, witherMs: 8 * HOUR, rescueCoins: 30 },
  orders: { maxSlots: 6, slotsByLevel: [[8, 6], [5, 5], [3, 4], [1, 3]] as [number, number][], maxKinds: 3, maxQty: 3, coinMult: 1.8, xpMult: 2, discardWaitMs: 10 * MIN, deliverWaitMs: 90 * MIN },
  barn: { base: 50, step: 25, maxLevel: 6, costBase: 100, bonusSlots: 5, bonusCostStep: 10 },
  queue: { base: 2, max: 4, costs: [80, 160] },
  help: { waterCut: 0.2, perDay: 10, perFarm: 5, friendPoints: 1, logMax: 20 },
};

export const FARM_ITEMS: Record<FarmItemId, { name: string; sell: number; xp: number }> = {
  wheat: { name: '小麥', sell: 1, xp: 1 }, carrot: { name: '胡蘿蔔', sell: 3, xp: 2 }, strawberry: { name: '草莓', sell: 6, xp: 4 },
  pumpkin: { name: '愛心南瓜', sell: 12, xp: 6 }, wool: { name: '毛線球', sell: 4, xp: 3 }, egg: { name: '蛋', sell: 3, xp: 3 },
  apple: { name: '蘋果', sell: 3, xp: 3 }, bread: { name: '麵包', sell: 6, xp: 5 }, jam: { name: '草莓果醬', sell: 20, xp: 8 },
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
};
export const RECIPES: Record<RecipeId, { name: string; station: CraftStation; level: number; ms: number; in: Stack[]; out: Stack }> = {
  bread: { name: '麵包', station: 'bakery', level: 4, ms: 60 * MIN, in: [{ item: 'wheat', qty: 2 }, { item: 'egg', qty: 1 }], out: { item: 'bread', qty: 1 } },
  jam: { name: '草莓果醬', station: 'jamhouse', level: 6, ms: 120 * MIN, in: [{ item: 'strawberry', qty: 3 }], out: { item: 'jam', qty: 1 } },
};
export const CRAFT_STATIONS: Record<CraftStation, { name: string; level: number }> = {
  bakery: { name: '烘焙屋', level: 4 }, jamhouse: { name: '果醬工坊', level: 6 },
};
const ANIMAL_IDS = Object.keys(ANIMALS) as AnimalStation[];
const STATION_IDS = Object.keys(CRAFT_STATIONS) as CraftStation[];

// ---------- 小工具 ----------
const fail = (c: FarmErrorCode): never => { throw new FarmError(c); };
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const has = <T extends string>(rec: Record<T, unknown>, k: unknown): k is T => typeof k === 'string' && Object.prototype.hasOwnProperty.call(rec, k);
const emptyField = (): Field => ({ crop: null, start: 0, ready: 0, wateredBy: null });

export function fieldsUnlocked(level: number) { return FARM.fieldUnlock.filter((l) => l <= level).length; }
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
  };
  refreshOrders(s, now);
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
    fields: pad(j.fields, FARM.fieldCount, emptyField),
    animals, jobs, queueSlots,
    tree: j.tree ?? d.tree,
    inv: { ...(j.inv ?? {}) },
    orders: pad(j.orders ?? d.orders, FARM.orders.maxSlots, () => null),
    orderWait: pad(j.orderWait, FARM.orders.maxSlots, () => 0),
    helpLog: Array.isArray(j.helpLog) ? j.helpLog : [],
  } as FarmState;
  // 等待時間已過的訂單格直接補上（genOrder 是決定性的，沒存檔也不會跟下一次動作算出來的不一樣）
  refreshOrders(s, now);
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
    items.push({ item: i, qty: 1 + nextInt(rng, FARM.orders.maxQty) });
  }
  const value = items.reduce((a, it) => a + FARM_ITEMS[it.item].sell * it.qty, 0);
  const xp = items.reduce((a, it) => a + FARM_ITEMS[it.item].xp * it.qty, 0) * FARM.orders.xpMult;
  return { items, coins: Math.round(value * FARM.orders.coinMult), xp };
}
export function refreshOrders(s: FarmState, now: number) {
  for (let i = 0; i < orderSlots(s.level); i++) if (!s.orders[i] && now >= s.orderWait[i]) s.orders[i] = genOrder(s.seed, s.orderSeq++, s.level);
}

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
const tryDo = (f: () => void) => { try { f(); } catch (e) { if (!(e instanceof FarmError)) throw e; } };

export function applyFarm(s: FarmState, a: FarmAction, now: number, clock: Clock): FarmOutcome {
  const out: FarmOutcome = { ledger: [], leveled: [] };
  refreshOrders(s, now);
  switch (a?.type) {
    case 'plant': {
      const f = fieldAt(s, a.idx);
      if ((a.idx as number) >= fieldsUnlocked(s.level)) fail('NOT_UNLOCKED');
      if (!has(CROPS, a.crop)) fail('BAD_REQUEST');
      const c = CROPS[a.crop];
      if (s.level < c.level) fail('NOT_UNLOCKED');
      if (f.crop) fail('SLOT_BUSY');
      if (s.friendPts < c.seedFriendPts) fail('NOT_ENOUGH_FRIEND_POINTS');
      s.friendPts -= c.seedFriendPts;
      Object.assign(f, { crop: a.crop, start: now, ready: clock.addOpen(now, c.growMs), wateredBy: null });
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
      s.orders[i] = null; s.orderWait[i] = clock.addOpen(now, FARM.orders.deliverWaitMs);
      break;
    }
    case 'discard': {
      const i = slotAt(a.slot);
      if (!s.orders[i]) fail('NO_ORDER');
      s.orders[i] = null; s.orderWait[i] = clock.addOpen(now, FARM.orders.discardWaitMs);
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
    default: fail('BAD_REQUEST');
  }
  refreshOrders(s, now); // 這個動作升級多出來的訂單格也馬上補
  return out;
}

// ---------- 好友幫忙 ----------
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
}
export function describeFarm(s: FarmState, now: number, clock: Clock): FarmDerived {
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
    orders.push(o ? { order: o, canDeliver: haveAll(s, o.items) } : { waitMs: remain(s.orderWait[i]) });
  }
  return {
    fields: s.fields.map((f, i) => ({ stage: f.crop ? stageOf(f.start, f.ready, now, clock) : null, remainMs: f.crop ? remain(f.ready) : 0, locked: i >= fieldsUnlocked(s.level), unlockLevel: FARM.fieldUnlock[i] })),
    animals, jobs, orders,
    tree: { state: withered ? 'withered' : now >= s.tree.ready ? 'ready' : 'growing', remainMs: remain(s.tree.ready) },
    barn: { used: invCount(s), cap: barnCap(s) },
    xpToNext: FARM.xpPerLevel * s.level,
    needsHelp: withered || s.fields.some((f) => f.crop && now < f.ready && !f.wateredBy),
  };
}
