import { describe, expect, it } from 'vitest';
import { ALWAYS_OPEN, applyFood, createRng, foodById, GAME, makeClock, newPet, parseOpenHours, simulate, type PetState } from '../src';

const tpe = (s: string) => Date.parse(`${s}+08:00`);
const clock = makeClock(parseOpenHours('mon-fri 09:00-20:00 Asia/Taipei'));
// 2026-10-12 星期一、10-16 星期五、10-19 星期一
function alivePet(at: number, patch: Partial<PetState> = {}): PetState {
  return { ...newPet('chicken', at - 120_000), status: 'alive', hatchedAt: at - 60_000, lastSimulatedAt: at, hunger: 50, energy: 100, ...patch };
}
const decayKeys = (p: PetState) => ({ hunger: p.hunger, happiness: p.happiness, cleanliness: p.cleanliness, health: p.health });

describe('simulate with open hours', () => {
  it('overnight counts only open time (Mon 19:00 → Tue 10:00 equals 2 hours)', () => {
    const a = alivePet(tpe('2026-10-12T19:00:00'));
    simulate(a, tpe('2026-10-13T10:00:00'), createRng(1), GAME, clock);
    const b = alivePet(tpe('2026-10-12T19:00:00'));
    simulate(b, tpe('2026-10-12T21:00:00'), createRng(1), GAME, ALWAYS_OPEN);
    expect(decayKeys(a)).toEqual(decayKeys(b));
    expect(a.lastSimulatedAt).toBe(tpe('2026-10-13T10:00:00'));
  });
  it('weekend is frozen: Fri 19:30 → Mon 09:30 is one hour of decay', () => {
    const p = alivePet(tpe('2026-10-16T19:30:00'), { hunger: 50 });
    simulate(p, tpe('2026-10-19T09:30:00'), createRng(2), GAME, clock);
    expect(p.hunger).toBeCloseTo(50 - 0.8 * 60 * GAME.timeScale, 6);
    expect(p.status).toBe('alive');
  });
  it('a neglected pet survives the weekend (but would die without open hours)', () => {
    const patch = { hunger: 5, happiness: 5, cleanliness: 5, health: 30 };
    const p = alivePet(tpe('2026-10-16T19:00:00'), patch);
    simulate(p, tpe('2026-10-19T09:00:00'), createRng(3), GAME, clock); // 只過 1 小時開放時間
    expect(p.status).toBe('alive');
    const q = alivePet(tpe('2026-10-16T19:00:00'), patch);
    simulate(q, tpe('2026-10-19T09:00:00'), createRng(3), GAME, ALWAYS_OPEN);
    expect(q.status).toBe('dead');
  });
  it('morning: wakes up with full energy once per opening', () => {
    const p = alivePet(tpe('2026-10-12T19:58:00'), { energy: 30, sleeping: true }); // v1.4：睡 2 分鐘 +20，不會先睡飽自己醒
    const ev = simulate(p, tpe('2026-10-13T09:05:00'), createRng(4), GAME, clock);
    expect(p.sleeping).toBe(false);
    expect(p.energy).toBeCloseTo(100 - 0.5 * 5 * GAME.timeScale, 6);
    expect(ev.filter((e) => e.type === 'wake')).toEqual([{ type: 'wake', at: tpe('2026-10-13T09:00:00'), payload: { reason: 'morning' } }]);
  });
  it('morning is not triggered inside the same open period', () => {
    const p = alivePet(tpe('2026-10-12T10:00:00'), { energy: 30 });
    const ev = simulate(p, tpe('2026-10-12T11:00:00'), createRng(5), GAME, clock);
    expect(ev.some((e) => e.type === 'wake')).toBe(false);
    expect(p.energy).toBeLessThan(30);
  });
  it('morning fires exactly once when a settle ends exactly at 09:00', () => {
    const p = alivePet(tpe('2026-10-12T20:00:00'), { energy: 30 });
    const ev1 = simulate(p, tpe('2026-10-13T09:00:00'), createRng(6), GAME, clock);
    const ev2 = simulate(p, tpe('2026-10-13T10:00:00'), createRng(6), GAME, clock);
    expect([...ev1, ...ev2].filter((e) => e.type === 'wake')).toHaveLength(1);
    expect(ev1.some((e) => e.type === 'wake')).toBe(true);
  });
  it('morningEnergy null keeps energy but still wakes', () => {
    const p = alivePet(tpe('2026-10-12T19:58:00'), { energy: 30, sleeping: true });
    simulate(p, tpe('2026-10-13T09:00:00'), createRng(7), { ...GAME, morningEnergy: null }, clock);
    expect(p.sleeping).toBe(false);
    expect(p.energy).toBeCloseTo(30 + GAME.sleepEnergyGain * 2 * GAME.timeScale, 6);
  });
  it('egg hatches after 60 open seconds, across the night', () => {
    const p = newPet('duck', tpe('2026-10-12T19:59:30'));
    simulate(p, tpe('2026-10-13T09:00:00'), createRng(8), GAME, clock);
    expect(p.status).toBe('egg');
    const ev = simulate(p, tpe('2026-10-13T09:00:31'), createRng(8), GAME, clock);
    expect(p.status).toBe('alive');
    expect(p.hatchedAt).toBe(tpe('2026-10-13T09:00:30'));
    expect(ev.map((e) => e.type)).toEqual(['hatch']);
  });
  it('v1.3: no poop interval — consecutive feeds can poop right away, overnight adds none', () => {
    const cfg = { ...GAME, poop: { ...GAME.poop, afterFeedChance: 1 } };
    const p = alivePet(tpe('2026-10-12T19:58:00'), { hunger: 20, lastPoopAt: tpe('2026-10-12T19:58:00'), poop: 0 });
    const corn = foodById('corn')!;
    simulate(p, tpe('2026-10-13T09:05:00'), createRng(9), cfg, clock);
    expect(p.poop).toBe(0);
    applyFood(p, corn, tpe('2026-10-13T09:05:00'), createRng(9), cfg, clock);
    p.hunger = 20; applyFood(p, corn, tpe('2026-10-13T09:05:01'), createRng(9), cfg, clock);
    expect(p.poop).toBe(2);
  });
  it('dirty-for-30-minutes counts open time only', () => {
    const cfg = { ...GAME, sick: { ...GAME.sick, chancePerMin: 12 } }; // × timeScale = 1 → 一定生病
    const p = alivePet(tpe('2026-10-12T19:50:00'), { hunger: 60, cleanliness: 10, dirtySince: tpe('2026-10-12T19:50:00') });
    simulate(p, tpe('2026-10-13T09:15:00'), createRng(10), cfg, clock); // 10 + 15 = 25 分鐘
    expect(p.sick).toBe(false);
    simulate(p, tpe('2026-10-13T09:21:00'), createRng(10), cfg, clock); // 31 分鐘
    expect(p.sick).toBe(true);
  });
});

describe('morning wake events are capped (review follow-up)', () => {
  it('a pet left alone for two weeks gets one morning wake row, not one per weekday', () => {
    const p = alivePet(tpe('2026-10-12T19:00:00'), { hunger: 50, happiness: 100, cleanliness: 100, health: 100, energy: 40 });
    const noDecay = { ...GAME, decay: { hunger: 0, happiness: 0, energy: 0, cleanliness: 0 } }; // 只看早安事件，不讓牠餓死
    const ev = simulate(p, tpe('2026-10-26T09:30:00'), createRng(11), noDecay, clock);
    expect(p.status).toBe('alive');
    const wakes = ev.filter((e) => e.type === 'wake' && (e.payload as any)?.reason === 'morning');
    expect(wakes).toHaveLength(1);
    expect(wakes[0].at).toBe(tpe('2026-10-26T09:00:00')); // 最後一次開門
    expect((wakes[0].payload as any).days).toBe(10); // 合併了 10 個開門日
  });
});
