import { describe, expect, it } from 'vitest';
import {
  ALWAYS_OPEN, makeClock, parseOpenHours,
  newFarm, loadFarm, applyFarm, applyHelp, describeFarm, stageOf, treeWithered, genOrder, refreshOrders, barnCap, invCount,
  fieldsUnlocked, orderSlots, FarmError, FARM, FARM_ITEMS, CROPS, ANIMALS, RECIPES, type FarmState, type FarmItemId,
} from '../src';

const tpe = (s: string) => Date.parse(`${s}+08:00`);
const M = 60_000, H = 60 * M;
const TPE = makeClock(parseOpenHours('mon-fri 09:00-20:00 Asia/Taipei'));
const C = ALWAYS_OPEN;
const T0 = tpe('2026-11-02T10:00:00'); // 星期一

const fresh = (level = 1) => { const s = newFarm(42, T0, C); s.level = level; return s; };
const code = (f: () => unknown) => { try { f(); } catch (e) { if (e instanceof FarmError) return e.code; throw e; } return null; };
const give = (s: FarmState, item: FarmItemId, qty: number) => { s.inv[item] = (s.inv[item] ?? 0) + qty; };

/** 等級 → 已解鎖的品項（用來檢查訂單） */
function itemLevel(item: FarmItemId): number {
  for (const c of Object.values(CROPS)) if (c.out.item === item) return c.level;
  for (const a of Object.values(ANIMALS)) if (a.out.item === item) return a.level;
  for (const r of Object.values(RECIPES)) if (r.out.item === item) return r.level;
  if (item === FARM.tree.out.item) return 1;
  throw new Error(`no source for ${item}`);
}

describe('newFarm', () => {
  it('starts at Lv1 with 6 usable fields, 3 orders and an empty 50-slot barn', () => {
    const s = fresh();
    const d = describeFarm(s, T0, C);
    expect(s.level).toBe(1); expect(s.seed).toBe(42);
    expect(s.fields).toHaveLength(18); // 第二階段：12–17 是東邊新地要買的田
    expect(d.fields.filter((f) => !f.locked)).toHaveLength(6);
    expect(d.orders.filter((o) => 'order' in o)).toHaveLength(3);
    expect(d.barn).toEqual({ used: 0, cap: 50 });
  });
  it('unlock tables', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20].map(fieldsUnlocked)).toEqual([6, 7, 8, 8, 9, 10, 10, 11, 11, 12, 12]);
    expect([1, 2, 3, 4, 5, 7, 8, 20].map(orderSlots)).toEqual([3, 3, 4, 4, 5, 5, 6, 6]);
  });
});

describe('fields', () => {
  it('plant wheat costs ◎2 through farm_seed; busy/locked/level checks', () => {
    const s = fresh();
    expect(applyFarm(s, { type: 'plant', idx: 0, crop: 'wheat' }, T0, C).ledger).toEqual([{ reason: 'farm_seed', delta: -2 }]);
    expect(code(() => applyFarm(s, { type: 'plant', idx: 0, crop: 'wheat' }, T0, C))).toBe('SLOT_BUSY');
    expect(code(() => applyFarm(s, { type: 'plant', idx: 6, crop: 'wheat' }, T0, C))).toBe('NOT_UNLOCKED');
    expect(code(() => applyFarm(s, { type: 'plant', idx: 1, crop: 'strawberry' }, T0, C))).toBe('NOT_UNLOCKED');
    expect(code(() => applyFarm(s, { type: 'plant', idx: 99, crop: 'wheat' }, T0, C))).toBe('BAD_REQUEST');
    expect(code(() => applyFarm(s, { type: 'plant', idx: 1, crop: 'nope' as any }, T0, C))).toBe('BAD_REQUEST');
  });
  it('stage goes 0 → 1 → 2 → 3 over the 2-minute wheat timer', () => {
    const s = fresh(); applyFarm(s, { type: 'plant', idx: 0, crop: 'wheat' }, T0, C);
    const f = s.fields[0];
    expect([0, 30_000, 90_000, 120_000].map((dt) => stageOf(f.start, f.ready, T0 + dt, C))).toEqual([0, 1, 2, 3]);
  });
  it('plant at 19:59 ripens next open day', () => {
    const t = tpe('2026-11-02T19:59:00');
    const s = newFarm(1, t, TPE); applyFarm(s, { type: 'plant', idx: 0, crop: 'wheat' }, t, TPE);
    expect(s.fields[0].ready).toBe(tpe('2026-11-03T09:01:00'));
    expect(describeFarm(s, tpe('2026-11-02T20:30:00'), TPE).fields[0].remainMs).toBe(60_000);
    const f = tpe('2026-11-06T19:59:00'); // 星期五
    const s2 = newFarm(1, f, TPE); applyFarm(s2, { type: 'plant', idx: 0, crop: 'wheat' }, f, TPE);
    expect(s2.fields[0].ready).toBe(tpe('2026-11-09T09:01:00'));
  });
  it('harvest gives 2 wheat and 1 xp; unripe throws NOT_READY', () => {
    const s = fresh(); applyFarm(s, { type: 'plant', idx: 0, crop: 'wheat' }, T0, C);
    expect(code(() => applyFarm(s, { type: 'harvest', idx: 0 }, T0 + M, C))).toBe('NOT_READY');
    applyFarm(s, { type: 'harvest', idx: 0 }, T0 + 2 * M, C);
    expect(s.inv.wheat).toBe(2); expect(s.xp).toBe(1); expect(s.fields[0].crop).toBeNull();
  });
  it('collectAll stops at barn cap without losing anything', () => {
    const s = fresh();
    for (const i of [0, 1, 2]) applyFarm(s, { type: 'plant', idx: i, crop: 'wheat' }, T0, C);
    give(s, 'carrot', 47); // 47 + 2 = 49 → 第二格 49 + 2 = 51 > 50
    applyFarm(s, { type: 'collectAll' }, T0 + 2 * M, C);
    expect(invCount(s)).toBe(49);
    expect(invCount(s)).toBeLessThanOrEqual(barnCap(s));
    expect(s.fields[0].crop).toBeNull();
    const d = describeFarm(s, T0 + 2 * M, C);
    expect([d.fields[1].stage, d.fields[2].stage]).toEqual([3, 3]);
  });
  it('collectAll takes finished goods before crops when the barn is nearly full', () => {
    const s = fresh(4); give(s, 'wheat', 2); give(s, 'egg', 1);
    applyFarm(s, { type: 'craft', recipe: 'bread' }, T0, C);
    applyFarm(s, { type: 'plant', idx: 0, crop: 'wheat' }, T0, C);
    give(s, 'carrot', 48); // 剩 2 格：先收小麥（2）就收不了麵包
    applyFarm(s, { type: 'collectAll' }, T0 + 60 * M, C);
    expect(s.inv.bread).toBe(1); expect(s.fields[0].crop).toBe('wheat');
  });
  it('harvest into a full barn throws BARN_FULL and keeps the crop', () => {
    const s = fresh(); applyFarm(s, { type: 'plant', idx: 0, crop: 'wheat' }, T0, C); give(s, 'carrot', 49);
    expect(code(() => applyFarm(s, { type: 'harvest', idx: 0 }, T0 + 2 * M, C))).toBe('BARN_FULL');
    expect(s.fields[0].crop).toBe('wheat');
  });
});

describe('animals', () => {
  it('hutch unlocks at Lv2; feeding eats a carrot; collect gives wool after 2 hours', () => {
    const s = fresh(); give(s, 'carrot', 1);
    expect(code(() => applyFarm(s, { type: 'feed', station: 'hutch', i: 0 }, T0, C))).toBe('NOT_UNLOCKED');
    s.level = 2;
    applyFarm(s, { type: 'feed', station: 'hutch', i: 0 }, T0, C);
    expect(s.inv.carrot ?? 0).toBe(0);
    expect(code(() => applyFarm(s, { type: 'feed', station: 'hutch', i: 1 }, T0, C))).toBe('NOT_ENOUGH_ITEMS');
    expect(code(() => applyFarm(s, { type: 'collect', station: 'hutch', i: 0 }, T0 + 119 * M, C))).toBe('NOT_READY');
    applyFarm(s, { type: 'collect', station: 'hutch', i: 0 }, T0 + 120 * M, C);
    expect(s.inv.wool).toBe(1); expect(s.animals.hutch[0].ready).toBeNull();
  });
});

describe('tree', () => {
  it('gives 3 apples after 2 hours, withers 8 open hours after ripening, self-rescue costs ◎30', () => {
    const s = fresh();
    expect(code(() => applyFarm(s, { type: 'tree' }, T0 + 119 * M, C))).toBe('NOT_READY');
    expect(code(() => applyFarm(s, { type: 'rescue' }, T0 + 120 * M, C))).toBe('NOT_WITHERED');
    const s2 = structuredClone(s);
    applyFarm(s, { type: 'tree' }, T0 + 120 * M, C); expect(s.inv.apple).toBe(3);
    const late = T0 + 120 * M + 8 * H;
    expect(treeWithered(s2, late, C)).toBe(true);
    expect(code(() => applyFarm(s2, { type: 'tree' }, late, C))).toBe('WITHERED');
    expect(applyFarm(s2, { type: 'rescue' }, late, C).ledger).toEqual([{ reason: 'farm_rescue', delta: -30 }]);
    expect(treeWithered(s2, late, C)).toBe(false);
    expect(s2.tree.ready).toBe(late + 120 * M);
  });
  it('withering counts open time only', () => {
    const t = tpe('2026-11-02T09:00:00');
    const s = newFarm(1, t, TPE); // 11:00 熟
    expect(treeWithered(s, tpe('2026-11-02T19:59:00'), TPE)).toBe(true); // 11:00 + 8h = 19:00
    const s2 = newFarm(1, tpe('2026-11-02T17:00:00'), TPE); // 19:00 熟
    expect(treeWithered(s2, tpe('2026-11-03T09:30:00'), TPE)).toBe(false); // 只過了 1.5 開放小時
  });
});

describe('crafting', () => {
  it('queues bread sequentially, consumes inputs up front, caps at 2 slots, collects only ready jobs', () => {
    const s = fresh(4); give(s, 'wheat', 6); give(s, 'egg', 3);
    applyFarm(s, { type: 'craft', recipe: 'bread' }, T0, C);
    applyFarm(s, { type: 'craft', recipe: 'bread' }, T0, C);
    expect(s.jobs.bakery.map((j) => j.ready)).toEqual([T0 + 60 * M, T0 + 120 * M]);
    expect([s.inv.wheat, s.inv.egg]).toEqual([2, 1]);
    expect(code(() => applyFarm(s, { type: 'craft', recipe: 'bread' }, T0, C))).toBe('QUEUE_FULL');
    applyFarm(s, { type: 'collectJobs', station: 'bakery' }, T0 + 61 * M, C);
    expect(s.inv.bread).toBe(1); expect(s.jobs.bakery).toHaveLength(1);
    expect(code(() => applyFarm(fresh(1), { type: 'craft', recipe: 'bread' }, T0, C))).toBe('NOT_UNLOCKED');
  });
});

describe('orders', () => {
  it('orders only use unlocked items, sizes and price formula hold, deterministic', () => {
    for (let level = 1; level <= 20; level++) for (let seq = 0; seq < 1000; seq++) {
      const o = genOrder(7, seq, level);
      expect(o.items.length).toBeGreaterThanOrEqual(1); expect(o.items.length).toBeLessThanOrEqual(3);
      for (const it of o.items) {
        expect(itemLevel(it.item)).toBeLessThanOrEqual(level);
        expect(it.qty).toBeGreaterThanOrEqual(1); expect(it.qty).toBeLessThanOrEqual(3);
      }
      expect(new Set(o.items.map((i) => i.item)).size).toBe(o.items.length);
      expect(o.coins).toBe(Math.round(o.items.reduce((a, i) => a + FARM_ITEMS[i.item].sell * i.qty, 0) * 1.8));
    }
    expect(genOrder(7, 3, 5)).toEqual(genOrder(7, 3, 5));
  });
  it('deliver pays farm_order, adds xp, refills after deliverWaitMs; discard waits 10 minutes', () => {
    const s = fresh();
    const o = s.orders[0]!;
    expect(code(() => applyFarm(s, { type: 'deliver', slot: 0 }, T0, C))).toBe('NOT_ENOUGH_ITEMS');
    for (const it of o.items) give(s, it.item, it.qty);
    const seq = s.orderSeq;
    const out = applyFarm(s, { type: 'deliver', slot: 0 }, T0, C);
    expect(out.ledger[0]).toEqual({ reason: 'farm_order', delta: o.coins });
    expect(s.orders[0]).toBeNull(); expect(invCount(s)).toBe(0);
    expect(describeFarm(s, T0, C).orders[0]).toEqual({ waitMs: FARM.orders.deliverWaitMs });
    refreshOrders(s, T0 + FARM.orders.deliverWaitMs);
    expect(s.orders[0]).not.toBeNull(); expect(s.orderSeq).toBe(seq + 1);
    applyFarm(s, { type: 'discard', slot: 1 }, T0, C);
    expect(describeFarm(s, T0 + 9 * M, C).orders[1]).toEqual({ waitMs: M });
    refreshOrders(s, T0 + 10 * M);
    expect(s.orders[1]).not.toBeNull();
    expect(code(() => applyFarm(s, { type: 'deliver', slot: 5 }, T0, C))).toBe('NO_ORDER');
  });
});

describe('order wait counts real time (closed hours included)', () => {
  it('delivering right before closing has a fresh order waiting at next opening', () => {
    const t = tpe('2026-11-02T19:30:00'); // 星期一，20:00 關門
    const s = newFarm(42, t, TPE);
    for (const it of s.orders[0]!.items) give(s, it.item, it.qty);
    applyFarm(s, { type: 'deliver', slot: 0 }, t, TPE);
    expect(s.orderWait[0]).toBe(t + FARM.orders.deliverWaitMs);
    expect(describeFarm(s, t, TPE).orders[0]).toEqual({ waitMs: FARM.orders.deliverWaitMs });
    const nextOpen = tpe('2026-11-03T09:00:00');
    expect(loadFarm(JSON.parse(JSON.stringify(s)), nextOpen, TPE).orders[0]).not.toBeNull();
  });
});

describe('orders refill on read', () => {
  it('loadFarm fills a slot whose wait has passed; a level-up inside an action fills the new slot', () => {
    const s = fresh(); applyFarm(s, { type: 'discard', slot: 0 }, T0, C);
    const later = loadFarm(JSON.parse(JSON.stringify(s)), T0 + FARM.orders.discardWaitMs, C);
    expect(later.orders[0]).not.toBeNull();
    expect(describeFarm(later, T0 + FARM.orders.discardWaitMs, C).orders[0]).toHaveProperty('order');
    const s2 = fresh(2); s2.xp = 59; // 到 Lv3（4 張訂單）
    applyFarm(s2, { type: 'plant', idx: 0, crop: 'wheat' }, T0, C);
    applyFarm(s2, { type: 'harvest', idx: 0 }, T0 + 2 * M, C);
    expect(s2.level).toBe(3); expect(s2.orders[3]).not.toBeNull();
  });
});

describe('levels', () => {
  it('levels up at 30×level xp with ◎2×newLevel reward; can cross two levels at once; stops at Lv20', () => {
    const s = fresh(); s.xp = 29; applyFarm(s, { type: 'plant', idx: 0, crop: 'wheat' }, T0, C);
    const out = applyFarm(s, { type: 'harvest', idx: 0 }, T0 + 2 * M, C);
    expect(s.level).toBe(2); expect(s.xp).toBe(0); expect(out.leveled).toEqual([2]);
    expect(out.ledger).toContainEqual({ reason: 'farm_level', delta: 4 });
    const s2 = fresh(4); s2.xp = 119; s2.inv = {}; // 到 Lv5 要 120、到 Lv6 再 150
    const o = s2.orders[0]!; for (const it of o.items) give(s2, it.item, it.qty);
    s2.orders[0] = { ...o, xp: 200 }; // 319 − 120 − 150 = 49 < 180
    const out2 = applyFarm(s2, { type: 'deliver', slot: 0 }, T0, C);
    expect(out2.leveled).toEqual([5, 6]); expect(s2.level).toBe(6); expect(s2.xp).toBe(49);
    expect(out2.ledger.filter((l) => l.reason === 'farm_level')).toEqual([{ reason: 'farm_level', delta: 10 }, { reason: 'farm_level', delta: 12 }]);
    const s3 = fresh(20); s3.xp = 0; applyFarm(s3, { type: 'plant', idx: 0, crop: 'wheat' }, T0, C);
    s3.xp = 10_000; applyFarm(s3, { type: 'harvest', idx: 0 }, T0 + 2 * M, C);
    expect(s3.level).toBe(20);
  });
});

describe('sell & upgrades', () => {
  it('sell pays farm_sell; bad quantities rejected', () => {
    const s = fresh(); give(s, 'carrot', 3);
    expect(applyFarm(s, { type: 'sell', item: 'carrot', qty: 2 }, T0, C).ledger).toEqual([{ reason: 'farm_sell', delta: 6 }]);
    expect(code(() => applyFarm(s, { type: 'sell', item: 'carrot', qty: 2 }, T0, C))).toBe('NOT_ENOUGH_ITEMS');
    expect(code(() => applyFarm(s, { type: 'sell', item: 'carrot', qty: 0 }, T0, C))).toBe('BAD_REQUEST');
    expect(code(() => applyFarm(s, { type: 'sell', item: 'carrot', qty: 1.5 }, T0, C))).toBe('BAD_REQUEST');
  });
  it('barn upgrade ◎100 → cap 75, max 6 levels; queue +1 for ◎80 then ◎160; friend-point barn bonus', () => {
    const s = fresh();
    expect(applyFarm(s, { type: 'upgradeBarn' }, T0, C).ledger).toEqual([{ reason: 'farm_upgrade', delta: -100 }]);
    expect(barnCap(s)).toBe(75);
    for (let i = 0; i < 5; i++) applyFarm(s, { type: 'upgradeBarn' }, T0, C);
    expect(code(() => applyFarm(s, { type: 'upgradeBarn' }, T0, C))).toBe('MAX_LEVEL');
    expect(applyFarm(s, { type: 'upgradeQueue', station: 'bakery' }, T0, C).ledger).toEqual([{ reason: 'farm_upgrade', delta: -80 }]);
    expect(applyFarm(s, { type: 'upgradeQueue', station: 'bakery' }, T0, C).ledger).toEqual([{ reason: 'farm_upgrade', delta: -160 }]);
    expect(code(() => applyFarm(s, { type: 'upgradeQueue', station: 'bakery' }, T0, C))).toBe('MAX_LEVEL');
    const b = fresh(); const cap = barnCap(b);
    expect(code(() => applyFarm(b, { type: 'barnBonus' }, T0, C))).toBe('NOT_ENOUGH_FRIEND_POINTS');
    b.friendPts = 30;
    expect(applyFarm(b, { type: 'barnBonus' }, T0, C).ledger).toEqual([]);
    expect(barnCap(b)).toBe(cap + 5); expect(b.friendPts).toBe(20);
    applyFarm(b, { type: 'barnBonus' }, T0, C); expect(b.friendPts).toBe(0);
  });
  it('pumpkin costs 3 friend points and no coins', () => {
    const s = fresh(3); s.friendPts = 3;
    expect(applyFarm(s, { type: 'plant', idx: 0, crop: 'pumpkin' }, T0, C).ledger).toEqual([]);
    expect(s.friendPts).toBe(0);
    expect(code(() => applyFarm(s, { type: 'plant', idx: 1, crop: 'pumpkin' }, T0, C))).toBe('NOT_ENOUGH_FRIEND_POINTS');
  });
});

describe('help', () => {
  const bob = { id: 'b0b', name: 'Bob' };
  it('water cuts remaining open time by 20% once; empty or ripe fields reject; log capped at 20; ackHelp clears', () => {
    const s = fresh(); applyFarm(s, { type: 'plant', idx: 0, crop: 'carrot' }, T0, C); // 30 分
    applyHelp(s, { kind: 'water', idx: 0 }, bob, T0 + 5 * M, C);
    expect(s.fields[0].ready).toBe(T0 + 5 * M + 20 * M); // 剩 25 分 × 0.8
    expect(s.fields[0].wateredBy).toBe('b0b');
    expect(s.helpLog).toEqual([{ by: 'b0b', name: 'Bob', kind: 'water', at: T0 + 5 * M }]);
    expect(code(() => applyHelp(s, { kind: 'water', idx: 0 }, bob, T0 + 6 * M, C))).toBe('ALREADY_WATERED');
    expect(code(() => applyHelp(s, { kind: 'water', idx: 1 }, bob, T0, C))).toBe('NOT_GROWING');
    expect(code(() => applyHelp(s, { kind: 'water', idx: 0 }, bob, T0 + 40 * M, C))).toBe('ALREADY_WATERED');
    const r = fresh(); r.barnLevel = 6; applyFarm(r, { type: 'plant', idx: 0, crop: 'wheat' }, T0, C);
    expect(code(() => applyHelp(r, { kind: 'water', idx: 0 }, bob, T0 + 3 * M, C))).toBe('NOT_GROWING');
    for (let i = 0; i < 25; i++) applyFarm(r, { type: 'plant', idx: 1 + (i % 5), crop: 'wheat' }, T0 + i * 10 * M, C), applyHelp(r, { kind: 'water', idx: 1 + (i % 5) }, { id: `h${i}`, name: `H${i}` }, T0 + i * 10 * M, C), applyFarm(r, { type: 'collectAll' }, T0 + i * 10 * M + 5 * M, C);
    expect(r.helpLog).toHaveLength(20); expect(r.helpLog[0].by).toBe('h5');
    applyFarm(r, { type: 'ackHelp' }, T0, C); expect(r.helpLog).toEqual([]);
  });
  it('friends rescue a withered tree for free', () => {
    const s = fresh(); const late = T0 + 120 * M + 8 * H;
    expect(code(() => applyHelp(s, { kind: 'rescue' }, bob, T0, C))).toBe('NOT_WITHERED');
    applyHelp(s, { kind: 'rescue' }, bob, late, C);
    expect(treeWithered(s, late, C)).toBe(false); expect(s.helpLog[0].kind).toBe('rescue');
  });
  it('needsHelp: unwatered growing field or withered tree', () => {
    const s = fresh();
    expect(describeFarm(s, T0, C).needsHelp).toBe(false);
    applyFarm(s, { type: 'plant', idx: 0, crop: 'carrot' }, T0, C);
    expect(describeFarm(s, T0 + M, C).needsHelp).toBe(true);
    applyHelp(s, { kind: 'water', idx: 0 }, bob, T0 + M, C);
    expect(describeFarm(s, T0 + 2 * M, C).needsHelp).toBe(false);
    expect(describeFarm(s, T0 + 120 * M + 8 * H, C).needsHelp).toBe(true); // 樹枯了
  });
});

describe('loadFarm', () => {
  it('fills defaults for missing fields', () => {
    const s: any = fresh();
    delete s.jobs; delete s.queueSlots; delete s.helpLog; s.fields = s.fields.slice(0, 6);
    const l = loadFarm(JSON.parse(JSON.stringify(s)), T0, C);
    expect(l.fields).toHaveLength(18);
    expect(l.jobs).toEqual({ bakery: [], jamhouse: [], dairy: [] });
    expect(l.queueSlots).toEqual({ bakery: 2, jamhouse: 2, dairy: 2 });
    expect(l.helpLog).toEqual([]);
    expect(code(() => loadFarm(null, T0, C))).toBe('BAD_REQUEST');
  });
});
