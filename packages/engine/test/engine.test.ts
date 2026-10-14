import { describe, expect, it } from 'vitest';
import { createRng, nextFloat, newPet, simulate, GAME, checkFeed, applyFood, foodById, applyOwnerAction, createStairs, stepStairs, setInput, cloneStairs, applyStairsResult, maxHpFor } from '../src';

const H = 3600_000;
describe('rng', () => {
  it('is deterministic', () => {
    const a = createRng(42), b = createRng(42);
    for (let i = 0; i < 100; i++) expect(nextFloat(a)).toBe(nextFloat(b));
  });
});
describe('pet sim', () => {
  it('egg hatches after 60s and does not decay before', () => {
    const p = newPet('chicken', 0); const r = createRng(1);
    simulate(p, 59_000, r); expect(p.status).toBe('egg'); expect(p.hunger).toBe(80);
    const ev = simulate(p, 61_000, r); expect(p.status).toBe('alive'); expect(ev[0].type).toBe('hatch');
  });
  it('neglect death median ≈ 1 day (23–30h)', () => {
    const deaths: number[] = [];
    for (let s = 1; s <= 60; s++) {
      const p = newPet('chicken', 0); const r = createRng(s * 7919);
      simulate(p, 72 * H, r);
      expect(p.status).toBe('dead');
      deaths.push((p.diedAt! - p.hatchedAt!) / H);
    }
    deaths.sort((a, b) => a - b);
    const median = deaths[deaths.length >> 1];
    expect(median).toBeGreaterThan(23); expect(median).toBeLessThan(30);
  });
  it('simulation is independent of how it is chunked only through rng (same chunks → same result)', () => {
    const mk = () => { const p = newPet('duck', 0); simulate(p, 10 * H, createRng(5)); return p; };
    expect(mk()).toEqual(mk());
  });
  it('v1.3: poop only after feeding, ~70% per feed, any hunger, natural max 3, never over time', () => {
    const r = createRng(3);
    let hits = 0;
    for (let i = 0; i < 1000; i++) { const p = newPet('chicken', 0); simulate(p, 61_000, r); p.hunger = 10; p.poop = 0; p.lastPoopAt = 99_999; applyFood(p, { ...foodById('rice')!, hunger: 0 }, 100_000, r); hits += p.poop; }
    expect(hits).toBeGreaterThan(650); expect(hits).toBeLessThan(750);
    const q = newPet('chicken', 0); simulate(q, 61_000, r); q.hunger = 50;
    for (let i = 0; i < 50; i++) applyFood(q, { ...foodById('rice')!, hunger: 0 }, 100_000 + i, r);
    expect(q.poop).toBe(3);
    const z = newPet('chicken', 0); simulate(z, 61_000, r); z.hunger = 95; z.poop = 0;
    simulate(z, 61_000 + 6 * 3_600_000, r);
    expect(z.poop).toBe(0); // 時間經過不會便便
  });
});
describe('feeding rules', () => {
  const alive = () => { const p = newPet('chicken', 0); simulate(p, 61_000, createRng(1)); return p; };
  const owner = { isOwner: true, visitorCountPet: 0, visitorCountMine: 0, balance: 100 };
  const visitor = { ...owner, isOwner: false };
  it('fullness', () => {
    const p = alive(); p.hunger = 92;
    expect(checkFeed(p, foodById('rice'), owner)).toBe('SNACK_ONLY');
    expect(checkFeed(p, foodById('candy'), owner)).toBeNull();
    p.hunger = 100; expect(checkFeed(p, foodById('candy'), owner)).toBe('TOO_FULL');
  });
  it('visitor rules', () => {
    const p = alive(); p.hunger = 50;
    expect(checkFeed(p, foodById('rice'), visitor)).toBe('VISITOR_FREE_FOOD');
    expect(checkFeed(p, foodById('worm'), { ...visitor, visitorCountMine: 5 })).toBe('DAILY_CAP');
    expect(checkFeed(p, foodById('worm'), { ...visitor, visitorCountPet: 20 })).toBe('DAILY_CAP');
    p.health = 20; expect(checkFeed(p, foodById('cake'), visitor)).toBe('LOW_HEALTH_SNACK');
    expect(checkFeed(p, foodById('corn'), { ...visitor, balance: 3 })).toBe('INSUFFICIENT_COINS');
    expect(checkFeed(p, foodById('worm'), { ...owner, visitorCountMine: 99 })).toBeNull();
  });
  it('feeding does not reduce cleanliness; sleeping blocks', () => {
    const p = alive(); p.hunger = 10; const c0 = p.cleanliness; applyFood(p, foodById('rice')!, 70_000, createRng(1)); expect(p.cleanliness).toBe(c0);
    applyOwnerAction(p, 'sleep'); expect(checkFeed(p, foodById('rice'), owner)).toBe('PET_SLEEPING');
    expect(applyOwnerAction(p, 'clean')).toBe('PET_SLEEPING'); expect(applyOwnerAction(p, 'wake')).toBeNull();
  });
  it('species growth multiplier', () => {
    const d = newPet('dino', 0); simulate(d, 61_000, createRng(1)); d.hunger = 0;
    applyFood(d, foodById('worm')!, 70_000, createRng(1)); expect(d.strength).toBeCloseTo(14 + 4 * 1.3);
  });
});
describe('stairs engine', () => {
  const run = (seed: number, inputs: (t: number) => [boolean, boolean]) => {
    const s = createStairs(seed, [{ petId: 'a', speed: 12, stamina: 15 }]);
    while (!s.over && s.tick < 3000) { const [l, r] = inputs(s.tick); setInput(s, 'a', l, r); stepStairs(s); }
    return s;
  };
  it('same seed + same inputs → same result', () => {
    const f = (t: number): [boolean, boolean] => [t % 90 < 30, t % 90 > 60];
    expect(run(9, f)).toEqual(run(9, f));
    expect(run(9, f)).not.toEqual(run(10, f));
  });
  it('clone + replay matches', () => {
    const s = createStairs(4, [{ petId: 'a', speed: 10, stamina: 10 }]);
    for (let i = 0; i < 100; i++) stepStairs(s);
    const c = cloneStairs(s);
    for (let i = 0; i < 100; i++) { setInput(s, 'a', true, false); stepStairs(s); setInput(c, 'a', true, false); stepStairs(c); }
    expect(c).toEqual(s);
  });
  it('idle player eventually dies; hp formula', () => {
    const s = run(1, () => [false, false]); expect(s.over).toBe(true);
    expect(maxHpFor(15)).toBe(11); expect(maxHpFor(40)).toBe(14);
  });
  it('stairs settlement uses timeScale', () => {
    const p = newPet('chicken', 0); simulate(p, 61_000, createRng(1));
    const e = p.energy; const coins = applyStairsResult(p, 12);
    expect(coins).toBe(12); expect(e - p.energy).toBeCloseTo(15 * GAME.timeScale);
  });
});

describe('rose tea (v1.3)', () => {
  it('costs 500, is a visitor-buyable drink, and adds exactly 20 poops (capped at POOP_HARD_MAX)', async () => {
    const { POOP_HARD_MAX } = await import('../src');
    const f = foodById('rosetea')!;
    expect(f).toMatchObject({ price: 500, drink: true, visitorAllowed: true, snack: true, poop: 20 });
    const p = newPet('chicken', 0); const r = createRng(9); simulate(p, 61_000, r); p.hunger = 50; p.poop = 1;
    expect(checkFeed(p, f, { isOwner: true, visitorCountPet: 0, visitorCountMine: 0, balance: 499 })).toBe('INSUFFICIENT_COINS');
    expect(checkFeed(p, f, { isOwner: false, visitorCountPet: 0, visitorCountMine: 0, balance: 500 })).toBeNull();
    const ev = applyFood(p, f, 100_000, r);
    expect(p.poop).toBe(21);
    expect(ev).toEqual([{ type: 'poop', at: 100_000, payload: { count: 20, food: 'rosetea' } }]);
    p.hunger = 50; applyFood(p, f, 100_001, r);
    expect(p.poop).toBe(POOP_HARD_MAX);
  });
});

describe('sleep energy (v1.4)', () => {
  it('sleeping pet goes 0 → 100 in about 1 real minute at timeScale 1/12', () => {
    expect(GAME.sleepEnergyGain).toBe(1200);
    const p = newPet('chicken', 0); const r = createRng(4); simulate(p, 61_000, r);
    Object.assign(p, { energy: 0, sleeping: true, hunger: 100, health: 100 });
    simulate(p, 61_000 + 30_000, r); expect(p.energy).toBeCloseTo(50, 0); expect(p.sleeping).toBe(true);
    simulate(p, 61_000 + 60_000, r); expect(p.energy).toBe(100);
  });

});
