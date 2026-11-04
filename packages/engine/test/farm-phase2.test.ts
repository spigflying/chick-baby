// 小雞農場第二階段（docs/superpowers/specs/2026-11-04-farm-phase2-design.md）
import { describe, expect, it } from 'vitest';
import {
  genBalloon, stallBuy,
  ALWAYS_OPEN, makeClock, parseOpenHours,
  newFarm, loadFarm, applyFarm, applyHelp, describeFarm, fieldOpen, chickWaterLimit, FarmError, FARM, FARM_ITEMS, DECOS, ANIMALS, RECIPES,
  type FarmState, type FarmItemId,
} from '../src';

const tpe = (s: string) => Date.parse(`${s}+08:00`);
const M = 60_000, H = 60 * M;
const C = ALWAYS_OPEN;
const TPE = makeClock(parseOpenHours('mon-fri 09:00-20:00 Asia/Taipei'));
const T0 = tpe('2026-11-02T10:00:00');
const fresh = (level = 1) => { const s = newFarm(42, T0, C); s.level = level; return s; };
const code = (f: () => unknown) => { try { f(); } catch (e) { if (e instanceof FarmError) return e.code; throw e; } return null; };
const give = (s: FarmState, item: FarmItemId, qty: number) => { s.inv[item] = (s.inv[item] ?? 0) + qty; };
const coins = (o: { ledger: { delta: number }[] }) => o.ledger.reduce((a, l) => a + l.delta, 0);

describe('phase-1 saves', () => {
  it('old phase-1 save loads with new defaults and keeps its state', () => {
    const old = JSON.parse(JSON.stringify(fresh(6))) as Record<string, any>;
    for (const k of ['expand', 'decos', 'decoBag', 'chickWater', 'balloon', 'stall', 'saleLog']) delete old[k];
    old.fields = old.fields.slice(0, 12).map((f: any) => { const { chick, ...rest } = f; return rest; });
    old.fields[0] = { crop: 'wheat', start: T0, ready: T0 + 2 * M, wateredBy: null };
    delete old.animals.beehive; delete old.animals.cowshed; delete old.jobs.dairy; delete old.queueSlots.dairy;
    old.inv = { carrot: 4 };
    const s = loadFarm(old, T0, C);
    expect(s.level).toBe(6); expect(s.inv).toEqual({ carrot: 4 });
    expect(s.fields).toHaveLength(18); expect(s.fields[0]).toMatchObject({ crop: 'wheat', chick: false });
    expect(s.expand).toBe(0); expect(s.decos).toEqual(Array(6).fill(null)); expect(s.decoBag).toEqual([]);
    expect(s.animals.beehive).toHaveLength(2); expect(s.animals.cowshed).toHaveLength(2);
    expect(s.jobs.dairy).toEqual([]); expect(s.queueSlots.dairy).toBe(2);
    expect(s.stall).toEqual(Array(4).fill(null)); expect(s.saleLog).toEqual([]);
    expect(s.chickWater).toEqual({ day: '', used: 0 });
  });
});

describe('expansion fields', () => {
  it('fieldOpen covers base and bought fields', () => {
    const s = fresh(20);
    expect([...Array(18).keys()].filter((i) => fieldOpen(s, i))).toEqual([...Array(12).keys()]);
    s.expand = 2;
    expect(fieldOpen(s, 12)).toBe(true); expect(fieldOpen(s, 13)).toBe(true); expect(fieldOpen(s, 14)).toBe(false);
    expect(fieldOpen(fresh(1), 6)).toBe(false);
  });
  it('expand buys fields in order with level gate and cost', () => {
    const s = fresh(6);
    expect(code(() => applyFarm(s, { type: 'expand' }, T0, C))).toBe('NOT_UNLOCKED');
    s.level = 9;
    expect(applyFarm(s, { type: 'expand' }, T0, C).ledger).toEqual([{ reason: 'farm_expand', delta: -120 }]);
    expect(applyFarm(s, { type: 'expand' }, T0, C).ledger).toEqual([{ reason: 'farm_expand', delta: -200 }]);
    expect(code(() => applyFarm(s, { type: 'expand' }, T0, C))).toBe('NOT_UNLOCKED'); // 第 3 格要 Lv11
    expect(s.expand).toBe(2);
    expect(code(() => applyFarm(s, { type: 'plant', idx: 14, crop: 'wheat' }, T0, C))).toBe('NOT_UNLOCKED');
    applyFarm(s, { type: 'plant', idx: 13, crop: 'wheat' }, T0, C);
    expect(s.fields[13].crop).toBe('wheat');
    s.level = 20; s.expand = 6;
    expect(code(() => applyFarm(s, { type: 'expand' }, T0, C))).toBe('MAX_LEVEL');
    expect(describeFarm(s, T0, C).expand.next).toBeNull();
    s.expand = 3; expect(describeFarm(s, T0, C).expand.next).toEqual({ level: 13, cost: 450 });
  });
  it('describeFarm marks bought-field locks with the level and the east area lock', () => {
    const d = describeFarm(fresh(4), T0, C);
    expect(d.fields).toHaveLength(18); expect(d.fields[12]).toMatchObject({ locked: true, unlockLevel: 7 });
    expect(d.east.locked).toBe(true); expect(describeFarm(fresh(5), T0, C).east.locked).toBe(false);
  });
});

describe('new animals and recipes', () => {
  it('beehive and cowshed feed and collect', () => {
    const s = fresh(10); give(s, 'strawberry', 1); give(s, 'wheat', 3);
    expect(code(() => applyFarm(fresh(7), { type: 'feed', station: 'beehive', i: 0 }, T0, C))).toBe('NOT_UNLOCKED');
    applyFarm(s, { type: 'feed', station: 'beehive', i: 0 }, T0, C);
    applyFarm(s, { type: 'feed', station: 'cowshed', i: 1 }, T0, C);
    expect(s.inv).toEqual({});
    expect(code(() => applyFarm(s, { type: 'collect', station: 'beehive', i: 0 }, T0 + 2 * H, C))).toBe('NOT_READY');
    applyFarm(s, { type: 'collect', station: 'cowshed', i: 1 }, T0 + 2 * H, C);
    applyFarm(s, { type: 'collect', station: 'beehive', i: 0 }, T0 + 3 * H, C);
    expect(s.inv).toEqual({ honey: 1, milk: 1 });
    expect(ANIMALS.beehive).toMatchObject({ level: 8, ms: 3 * H }); expect(ANIMALS.cowshed).toMatchObject({ level: 10, ms: 2 * H });
  });
  it('honeycake and cheese craft at their stations', () => {
    const s = fresh(12); give(s, 'wheat', 2); give(s, 'egg', 1); give(s, 'honey', 1); give(s, 'milk', 2);
    applyFarm(s, { type: 'craft', recipe: 'honeycake' }, T0, C);
    applyFarm(s, { type: 'craft', recipe: 'cheese' }, T0, C);
    expect(s.jobs.bakery.map((j) => j.recipe)).toEqual(['honeycake']); expect(s.jobs.dairy.map((j) => j.recipe)).toEqual(['cheese']);
    applyFarm(s, { type: 'collectAll' }, T0 + 2 * H, C);
    expect(s.inv).toEqual({ honeycake: 1, cheese: 1, apple: 3 }); // 果樹也剛好熟
    expect(RECIPES.honeycake).toMatchObject({ level: 9, ms: 90 * M }); expect(RECIPES.cheese).toMatchObject({ level: 12, station: 'dairy' });
    expect(code(() => applyFarm(fresh(11), { type: 'craft', recipe: 'cheese' }, T0, C))).toBe('NOT_UNLOCKED');
    expect([FARM_ITEMS.honey.sell, FARM_ITEMS.milk.sell, FARM_ITEMS.honeycake.sell, FARM_ITEMS.cheese.sell]).toEqual([9, 5, 18, 14]);
  });
});

describe('decorations', () => {
  it('buy into the bag, place, swap and store', () => {
    const s = fresh(5);
    expect(applyFarm(s, { type: 'buyDeco', deco: 'bench' }, T0, C).ledger).toEqual([{ reason: 'farm_deco', delta: -60 }]);
    applyFarm(s, { type: 'buyDeco', deco: 'flowerbed' }, T0, C);
    expect(s.decoBag).toEqual(['bench', 'flowerbed']);
    applyFarm(s, { type: 'placeDeco', deco: 'bench', slot: 2 }, T0, C);
    expect(s.decos[2]).toBe('bench'); expect(s.decoBag).toEqual(['flowerbed']);
    applyFarm(s, { type: 'placeDeco', deco: 'flowerbed', slot: 2 }, T0, C); // 換掉的回收納
    expect(s.decos[2]).toBe('flowerbed'); expect(s.decoBag).toEqual(['bench']);
    applyFarm(s, { type: 'storeDeco', slot: 2 }, T0, C);
    expect(s.decos[2]).toBeNull(); expect(s.decoBag.sort()).toEqual(['bench', 'flowerbed']);
    expect(code(() => applyFarm(s, { type: 'placeDeco', deco: 'arch', slot: 0 }, T0, C))).toBe('NOT_ENOUGH_ITEMS');
    expect(code(() => applyFarm(s, { type: 'placeDeco', deco: 'bench', slot: 6 }, T0, C))).toBe('BAD_REQUEST');
    expect(code(() => applyFarm(s, { type: 'storeDeco', slot: 0 }, T0, C))).toBe('BAD_REQUEST');
    expect(code(() => applyFarm(fresh(4), { type: 'buyDeco', deco: 'bench' }, T0, C))).toBe('NOT_UNLOCKED');
  });
  it('friend-point decorations cost friend points, not coins', () => {
    const s = fresh(5); s.friendPts = 20;
    expect(applyFarm(s, { type: 'buyDeco', deco: 'heartballoon' }, T0, C).ledger).toEqual([]);
    expect(s.friendPts).toBe(5);
    expect(code(() => applyFarm(s, { type: 'buyDeco', deco: 'statue' }, T0, C))).toBe('NOT_ENOUGH_FRIEND_POINTS');
    expect(Object.keys(DECOS)).toHaveLength(8);
  });
});

describe('chick watering', () => {
  const pet = (stamina: number, alive = true) => ({ alive, stamina });
  it('limit by stamina', () => { expect([10, 29, 30, 59, 60, 400].map(chickWaterLimit)).toEqual([1, 1, 2, 2, 3, 3]); });
  it('needs a live pet, counts per Taipei day, and stacks with friend water', () => {
    const s = fresh(1);
    applyFarm(s, { type: 'plant', idx: 0, crop: 'carrot' }, T0, C);
    const w = { type: 'chickWater' as const, idx: 0 };
    expect(code(() => applyFarm(s, w, T0, C, { day: '2026-11-02' }))).toBe('NO_PET');
    expect(code(() => applyFarm(s, w, T0, C, { day: '2026-11-02', pet: pet(10, false) }))).toBe('NO_PET');
    applyFarm(s, w, T0, C, { day: '2026-11-02', pet: pet(10) });
    expect(s.fields[0].ready).toBe(T0 + 24 * M); expect(s.fields[0].chick).toBe(true);
    expect(s.chickWater).toEqual({ day: '2026-11-02', used: 1 });
    expect(code(() => applyFarm(s, w, T0, C, { day: '2026-11-02', pet: pet(10) }))).toBe('ALREADY_WATERED');
    applyFarm(s, { type: 'plant', idx: 1, crop: 'carrot' }, T0, C);
    expect(code(() => applyFarm(s, { type: 'chickWater', idx: 1 }, T0, C, { day: '2026-11-02', pet: pet(10) }))).toBe('CHICK_TIRED');
    applyFarm(s, { type: 'chickWater', idx: 1 }, T0, C, { day: '2026-11-02', pet: pet(35) }); // 體力 ≥ 30 一天 2 次
    applyHelp(s, { kind: 'water', idx: 0 }, { id: 'f', name: 'F' }, T0, C); // 好友還能再澆
    expect(s.fields[0].wateredBy).toBe('f');
    applyFarm(s, { type: 'plant', idx: 2, crop: 'carrot' }, T0, C);
    applyFarm(s, { type: 'chickWater', idx: 2 }, T0, C, { day: '2026-11-03', pet: pet(10) }); // 隔天重算
    expect(s.chickWater).toEqual({ day: '2026-11-03', used: 1 });
    expect(code(() => applyFarm(s, { type: 'chickWater', idx: 3 }, T0, C, { day: '2026-11-03', pet: pet(99) }))).toBe('NOT_GROWING');
    applyFarm(s, { type: 'harvest', idx: 0 }, T0 + H, C);
    expect(s.fields[0]).toMatchObject({ crop: null, chick: false });
  });
  it('describeFarm reports chick waters left today', () => {
    const s = fresh(1); s.chickWater = { day: '2026-11-02', used: 1 };
    expect(describeFarm(s, T0, C, { day: '2026-11-02', pet: { alive: true, stamina: 40 } }).chickWater).toEqual({ left: 1, limit: 2 });
    expect(describeFarm(s, T0, C, { day: '2026-11-03', pet: { alive: true, stamina: 40 } }).chickWater).toEqual({ left: 2, limit: 2 });
    expect(describeFarm(s, T0, C).chickWater).toEqual({ left: 0, limit: 0 });
  });
});

describe('hot-air balloon', () => {
  it('arrives at Lv7; filling a crate pays 1.5x; send pays the bonus and schedules the next', () => {
    const s0 = fresh(6);
    expect(describeFarm(s0, T0, C).balloon).toEqual({ state: 'locked' });
    expect(code(() => applyFarm(s0, { type: 'fillCrate', i: 0 }, T0, C))).toBe('NO_BALLOON');
    const s = loadFarm(JSON.parse(JSON.stringify({ ...fresh(7) })), T0, C);
    expect(s.balloon.crates).toHaveLength(4);
    expect(s.balloon).toMatchObject({ seq: 0, arrive: T0, leave: T0 + 6 * H });
    for (const c of s.balloon.crates) { expect(c.qty).toBeGreaterThanOrEqual(3); expect(c.qty).toBeLessThanOrEqual(6); expect(c.filled).toBe(false); expect(c.item).not.toBe('pumpkin'); }
    expect(new Set(s.balloon.crates.map((c) => c.item)).size).toBe(4);
    const c0 = s.balloon.crates[0];
    expect(code(() => applyFarm(s, { type: 'fillCrate', i: 0 }, T0, C))).toBe('NOT_ENOUGH_ITEMS');
    for (const c of s.balloon.crates) give(s, c.item, c.qty);
    const xp0 = s.xp;
    const out = applyFarm(s, { type: 'fillCrate', i: 0 }, T0, C);
    expect(out.ledger).toEqual([{ reason: 'farm_balloon', delta: Math.round(FARM_ITEMS[c0.item].sell * c0.qty * 1.5) }]);
    expect(s.xp).toBe(xp0 + FARM_ITEMS[c0.item].xp * c0.qty);
    expect(code(() => applyFarm(s, { type: 'fillCrate', i: 0 }, T0, C))).toBe('CRATE_DONE');
    expect(code(() => applyFarm(s, { type: 'sendBalloon' }, T0, C))).toBe('NOT_READY');
    for (const i of [1, 2, 3]) applyFarm(s, { type: 'fillCrate', i }, T0, C);
    expect(applyFarm(s, { type: 'sendBalloon' }, T0 + H, C).ledger).toEqual([{ reason: 'farm_balloon', delta: 20 }]);
    expect(s.balloon).toMatchObject({ seq: 1, crates: [], arrive: T0 + 4 * H });
    expect(describeFarm(s, T0 + 2 * H, C).balloon).toEqual({ state: 'away', remainMs: 2 * H });
    applyFarm(s, { type: 'ackHelp' }, T0 + 4 * H, C);
    expect(s.balloon).toMatchObject({ seq: 1, arrive: T0 + 4 * H, leave: T0 + 10 * H });
    expect(s.balloon.crates).toEqual(genBalloon(42, 1, 7));
  });
  it('expires while offline (open time only) and returns after the gap; unfilled crates take nothing', () => {
    const t = tpe('2026-11-06T18:00:00'); // 星期五 18:00
    const s = newFarm(7, t, TPE); s.level = 7;
    const s2 = loadFarm(JSON.parse(JSON.stringify(s)), t, TPE);
    expect(s2.balloon.leave).toBe(tpe('2026-11-09T13:00:00')); // 2 小時（五）+ 4 小時（一 09–13）
    give(s2, s2.balloon.crates[0].item, 9);
    const before = { ...s2.inv };
    const s3 = loadFarm(JSON.parse(JSON.stringify(s2)), tpe('2026-11-09T17:30:00'), TPE);
    expect(s3.balloon).toMatchObject({ seq: 1, arrive: tpe('2026-11-09T16:00:00'), leave: tpe('2026-11-10T11:00:00') });
    expect(s3.inv).toEqual(before);
    const far = loadFarm(JSON.parse(JSON.stringify(s2)), tpe('2026-12-31T12:00:00'), TPE); // 很久沒來也只是排到下一班
    expect(far.balloon.crates).toHaveLength(4); expect(far.balloon.leave).toBeGreaterThan(tpe('2026-12-31T12:00:00'));
  });
});

describe('stall', () => {
  it('list takes items within price bounds; cancel returns them', () => {
    const s = fresh(5); give(s, 'strawberry', 5);
    const list = (o: object) => applyFarm(s, { type: 'stallList', slot: 0, item: 'strawberry', qty: 3, price: 18, ...o } as any, T0, C);
    expect(code(() => applyFarm(fresh(4), { type: 'stallList', slot: 0, item: 'wheat', qty: 1, price: 1 }, T0, C))).toBe('NOT_UNLOCKED');
    expect(code(() => list({ price: 17 }))).toBe('BAD_PRICE');
    expect(code(() => list({ price: 55 }))).toBe('BAD_PRICE');
    expect(code(() => list({ qty: 11, price: 66 }))).toBe('BAD_REQUEST');
    expect(code(() => list({ qty: 0 }))).toBe('BAD_REQUEST');
    expect(code(() => list({ slot: 4 }))).toBe('BAD_REQUEST');
    expect(code(() => list({ qty: 6, price: 36 }))).toBe('NOT_ENOUGH_ITEMS');
    list({ price: 54 });
    expect(s.stall[0]).toEqual({ item: 'strawberry', qty: 3, price: 54 }); expect(s.inv).toEqual({ strawberry: 2 });
    expect(code(() => list({ qty: 1, price: 6 }))).toBe('SLOT_BUSY');
    applyFarm(s, { type: 'stallCancel', slot: 0 }, T0, C);
    expect(s.stall[0]).toBeNull(); expect(s.inv).toEqual({ strawberry: 5 });
    expect(code(() => applyFarm(s, { type: 'stallCancel', slot: 0 }, T0, C))).toBe('NO_LISTING');
  });
  it('stallBuy moves the item, logs the sale and returns the price', () => {
    const seller = fresh(5); give(seller, 'jam', 2);
    applyFarm(seller, { type: 'stallList', slot: 1, item: 'jam', qty: 2, price: 50 }, T0, C);
    const buyer = fresh(1); buyer.inv = { wheat: 49 };
    expect(code(() => stallBuy(seller, buyer, 1, { id: 'b', name: 'Bob' }, T0))).toBe('BARN_FULL');
    buyer.inv = {};
    expect(stallBuy(seller, buyer, 1, { id: 'b', name: 'Bob' }, T0)).toEqual({ item: 'jam', qty: 2, price: 50 });
    expect(buyer.inv).toEqual({ jam: 2 }); expect(seller.stall[1]).toBeNull();
    expect(seller.saleLog).toEqual([{ by: 'b', name: 'Bob', item: 'jam', qty: 2, price: 50, at: T0 }]);
    expect(code(() => stallBuy(seller, buyer, 1, { id: 'b', name: 'Bob' }, T0))).toBe('NO_LISTING');
    expect(code(() => stallBuy(seller, buyer, 9, { id: 'b', name: 'Bob' }, T0))).toBe('BAD_REQUEST');
    applyFarm(seller, { type: 'ackSales' }, T0, C); expect(seller.saleLog).toEqual([]);
  });
});

void TPE;
