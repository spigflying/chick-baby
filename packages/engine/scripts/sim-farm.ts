/**
 * 小雞農場經濟模擬（spec「經濟護欄」）：固定策略的玩家，從星期一 09:00 開新農場，每天記淨賺金幣。
 * 模型 A：09:30、12:30、15:30、19:00 各上線 5 分鐘（上線時做一輪，5 分鐘後再做一輪）。
 * 模型 B：09:00 起每 15 分鐘上線一次。模型 none：只在第一天 09:30 種滿田。
 * 第二階段：會買東邊新地的田、用熱氣球；netPerDay 不扣買田和裝飾（自願花的錢，扣了會把收入藏起來），花掉的另外記在 stats.spentExpand。
 * 用法：npx tsx scripts/sim-farm.ts [days] [seed]
 */
import {
  makeClock, parseOpenHours, newFarm, applyFarm, describeFarm, invCount, barnCap, fieldOpen, FARM,
  CROPS, ANIMALS, RECIPES, FARM_ITEMS, FarmError,
  type FarmState, type FarmAction, type CropId, type FarmItemId, type Stack,
} from '../src';

const clock = makeClock(parseOpenHours('mon-fri 09:00-20:00 Asia/Taipei'));
const MIN = 60_000, DAY = 24 * 60 * MIN;
const MONDAY_9 = Date.parse('2026-11-02T09:00:00+08:00');
const START_COINS = 200;

export function simulateFarm(opts: { days: number; sessions: 'A' | 'B' | 'none'; seed: number; trace?: (s: FarmState, now: number) => void }): { netPerDay: number[]; level: number; stats: Record<string, number> } {
  const s = newFarm(opts.seed, MONDAY_9, clock);
  let coins = START_COINS;
  const netPerDay: number[] = Array(opts.days).fill(0);
  let day = 0;
  const stats: Record<string, number> = {};

  /** 套用一個動作；錢不夠或規則不允許就放棄（狀態不變）。 */
  const tryAct = (a: FarmAction, now: number) => {
    const snap = structuredClone(s);
    try {
      const out = applyFarm(s, a, now, clock);
      const delta = out.ledger.reduce((x, l) => x + l.delta, 0);
      const spend = out.ledger.filter((l) => l.delta < 0).reduce((x, l) => x + l.delta, 0);
      if (coins + spend < 0) { Object.assign(s, snap); return false; }
      coins += delta;
      netPerDay[day] += out.ledger.filter((l) => l.reason !== 'farm_expand' && l.reason !== 'farm_deco').reduce((x, l) => x + l.delta, 0);
      stats[a.type] = (stats[a.type] ?? 0) + 1;
      for (const l of out.ledger) stats[l.reason] = (stats[l.reason] ?? 0) + l.delta;
      return true;
    } catch (e) { if (e instanceof FarmError) { Object.assign(s, snap); return false; } throw e; }
  };

  const sessionTimes = (d: number): { at: number; nextGap: number }[] => {
    const base = MONDAY_9 + d * DAY;
    if (opts.sessions === 'none') return d === 0 ? [{ at: base + 30 * MIN, nextGap: Infinity }] : [];
    if (opts.sessions === 'A') {
      const ms = [30, 210, 390, 600];
      return ms.flatMap((m, i) => [{ at: base + m * MIN, nextGap: 5 * MIN }, { at: base + (m + 5) * MIN, nextGap: ((ms[i + 1] ?? 30 + 24 * 60) - m - 5) * MIN }]);
    }
    return Array.from({ length: 44 }, (_, i) => ({ at: base + i * 15 * MIN, nextGap: 15 * MIN }));
  };

  for (day = 0; day < opts.days; day++) {
    for (const { at, nextGap } of sessionTimes(day)) step(at, nextGap);
  }
  stats.inv = invCount(s); stats.coins = coins;
  return { netPerDay, level: s.level, stats };

  function step(now: number, nextGap: number) {
    try { stepInner(now, nextGap); } finally { opts.trace?.(s, now); }
  }
  function stepInner(now: number, nextGap: number) {
    tryAct({ type: 'collectAll' }, now);
    // 交得出的訂單全交
    for (let i = 0; i < s.orders.length; i++) if (s.orders[i]) tryAct({ type: 'deliver', slot: i }, now);
    // 熱氣球：倉庫有、訂單不需要的就裝；全裝滿就出發
    if (s.balloon.crates.length && now < s.balloon.leave) {
      const keep = orderNeeds(s);
      s.balloon.crates.forEach((c, i) => { if (!c.filled && (s.inv[c.item] ?? 0) - (keep[c.item] ?? 0) >= c.qty) tryAct({ type: 'fillCrate', i }, now); });
      if (s.balloon.crates.every((c) => c.filled)) tryAct({ type: 'sendBalloon' }, now);
    }
    // 買東邊新地的田（留 ◎100 週轉）
    if (s.expand < FARM.expand.costs.length && s.level >= FARM.expand.levels[s.expand] && coins >= FARM.expand.costs[s.expand] + 100) tryAct({ type: 'expand' }, now);
    // 加工：原料夠就做（訂單要的優先）
    for (const id of Object.keys(RECIPES) as (keyof typeof RECIPES)[]) while (tryAct({ type: 'craft', recipe: id }, now));
    // 動物：能餵就餵
    for (const st of Object.keys(ANIMALS) as (keyof typeof ANIMALS)[]) s.animals[st].forEach((_, i) => tryAct({ type: 'feed', station: st, i }, now));
    // 種田：先種訂單和飼料要的作物，再種「下次上線前會熟、利潤最高」的
    const need = cropNeeds(s);
    const unlockedCrops = (Object.keys(CROPS) as CropId[]).filter((c) => CROPS[c].level <= s.level && CROPS[c].seedFriendPts === 0);
    const best = unlockedCrops
      .filter((c) => CROPS[c].growMs <= Math.max(nextGap, 2 * MIN))
      .sort((a, b) => profit(b) - profit(a))[0] ?? 'wheat';
    for (let i = 0; i < FARM.fieldCount; i++) {
      if (!fieldOpen(s, i) || s.fields[i].crop) continue;
      const want = unlockedCrops.find((c) => (need[c] ?? 0) > 0);
      if (!want && invCount(s) >= Math.min(barnCap(s) * 0.5, 25)) continue; // 放大倉庫後仍照原本庫存量決定是否補種
      const crop = want ?? best;
      if (tryAct({ type: 'plant', idx: i, crop }, now) && want) need[want]! -= CROPS[want].out.qty;
    }
    // 交不出、缺的東西也沒在產的訂單丟掉
    const pipe = pipeline(s);
    for (let i = 0; i < s.orders.length; i++) {
      const o = s.orders[i]; if (!o) continue;
      if (o.items.some((it) => (s.inv[it.item] ?? 0) + (pipe[it.item] ?? 0) < it.qty)) tryAct({ type: 'discard', slot: i }, now);
    }
    // 庫存超過原本的 25 格：從最便宜的賣到 20 格（訂單要的先留著）
    if (invCount(s) > Math.min(barnCap(s) * 0.5, 25)) {
      const keep = allNeeds(s);
      const items = (Object.keys(s.inv) as FarmItemId[]).sort((a, b) => FARM_ITEMS[a].sell - FARM_ITEMS[b].sell);
      for (const it of items) {
        while (invCount(s) > Math.min(barnCap(s) * 0.4, 20) && (s.inv[it] ?? 0) > (keep[it] ?? 0)) if (!tryAct({ type: 'sell', item: it, qty: 1 }, now)) break;
      }
    }
  }
}

const profit = (c: CropId) => CROPS[c].out.qty * FARM_ITEMS[CROPS[c].out.item].sell - CROPS[c].seedCoins;
function orderNeeds(s: FarmState) {
  const need: Partial<Record<FarmItemId, number>> = {};
  for (const o of s.orders) if (o) for (const it of o.items) need[it.item] = (need[it.item] ?? 0) + it.qty;
  return need;
}
/** 訂單＋還沒裝的熱氣球貨箱（種田、加工時一起算）。 */
function allNeeds(s: FarmState) {
  const need = orderNeeds(s);
  for (const c of s.balloon.crates) if (!c.filled) need[c.item] = (need[c.item] ?? 0) + c.qty;
  return need;
}
/** 正在長／正在做、之後會進倉庫的東西。 */
function pipeline(s: FarmState) {
  const p: Partial<Record<FarmItemId, number>> = {};
  const add = (st: Stack) => { p[st.item] = (p[st.item] ?? 0) + st.qty; };
  for (const f of s.fields) if (f.crop) add(CROPS[f.crop].out);
  for (const st of Object.keys(ANIMALS) as (keyof typeof ANIMALS)[]) for (const a of s.animals[st]) if (a.ready !== null) add(ANIMALS[st].out);
  for (const q of Object.values(s.jobs)) for (const j of q) add(RECIPES[j.recipe].out);
  add({ item: 'apple', qty: 3 });
  // 可以靠加工或動物補上的也算（原料之後會種）
  for (const r of Object.values(RECIPES)) if (r.level <= s.level) p[r.out.item] = (p[r.out.item] ?? 0) + 2;
  for (const a of Object.values(ANIMALS)) if (a.level <= s.level) p[a.out.item] = (p[a.out.item] ?? 0) + 2;
  return p;
}
/** 訂單、加工、飼料還缺多少作物。 */
function cropNeeds(s: FarmState) {
  const need: Partial<Record<FarmItemId, number>> = {};
  const add = (st: Stack, k = 1) => { need[st.item] = (need[st.item] ?? 0) + st.qty * k; };
  for (const [item, qty] of Object.entries(allNeeds(s)) as [FarmItemId, number][]) {
    const r = Object.values(RECIPES).find((x) => x.out.item === item && x.level <= s.level);
    const a = Object.values(ANIMALS).find((x) => x.out.item === item && x.level <= s.level);
    if (r) r.in.forEach((st) => add(st, qty)); else if (a) a.feed.forEach((st) => add(st, qty)); else add({ item, qty });
  }
  for (const a of Object.values(ANIMALS)) if (a.level <= s.level) a.feed.forEach((st) => add(st, 2));
  const pipe = pipeline(s);
  for (const k of Object.keys(need) as FarmItemId[]) need[k] = (need[k] ?? 0) - (s.inv[k] ?? 0) - (pipe[k] ?? 0);
  return need as Partial<Record<CropId, number>>;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const days = Number(process.argv[2] ?? 5), seed = Number(process.argv[3] ?? 1);
  for (const m of ['A', 'B', 'none'] as const) {
    const r = simulateFarm({ days, sessions: m, seed });
    console.log(m, 'net/day', r.netPerDay.join(' '), 'level', r.level, JSON.stringify(r.stats));
  }
  void describeFarm;
}
