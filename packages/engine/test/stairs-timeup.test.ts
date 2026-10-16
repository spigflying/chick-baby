import { describe, expect, it } from 'vitest';
import { createStairs, stepStairs, stairsTimeUp, STAIRS_PARAMS, applyStairsResult, newPet, GAME } from '../src';

describe('stairs 5-minute cap (bug report: 269 樓就結束)', () => {
  it('a pet that never dies is stopped at matchMaxTicks (per-match limit, past the old 5 minutes) while still alive → time_up, not death', () => {
    const P = { ...STAIRS_PARAMS, hpBase: 1e6, matchMaxTicks: 30 * 60 * 10 }; // 伺服器給的這局上限（例如離 19:59 還有 10 分鐘）
    const s = createStairs(1, [{ petId: 'a', stamina: 30, speed: 30 } as any], P);
    while (!s.over) {
      const p = s.players[0];
      if (p.y > P.height - 20) { const low = [...s.plats].filter((q) => q.brk !== 0).sort((a, b) => b.y - a.y)[0]; p.x = low.x + 6; p.y = low.y - P.boxH; p.vy = 0; p.on = low.id; }
      stepStairs(s);
    }
    expect(s.tick).toBe(P.matchMaxTicks); expect(s.players[0].alive).toBe(true); expect(stairsTimeUp(s)).toBe(true);
    expect(s.players[0].floor).toBeGreaterThan(200);
  });
  it('a pet that falls is not time_up', () => {
    const s = createStairs(2, [{ petId: 'a', stamina: 10, speed: 10 } as any]);
    while (!s.over) stepStairs(s);
    expect(s.players[0].alive).toBe(false); expect(stairsTimeUp(s)).toBe(false);
  });
  it('duration-scaled costs are clamped: a 60-minute run costs at most 30 energy / 18 hunger', () => {
    const run = (ticks: number) => { const p = newPet('chicken', 0) as any; p.energy = 100; p.hunger = 100; applyStairsResult(p, 100, { ...GAME, timeScale: 1 }, ticks); return [100 - p.energy, 100 - p.hunger]; };
    expect(run(30 * 60 * 3)).toEqual([15, 8]);
    expect(run(30 * 60 * 60)).toEqual([30, 18]);
    expect(run(30 * 60 * 600)).toEqual([30, 18]);
  });
});
