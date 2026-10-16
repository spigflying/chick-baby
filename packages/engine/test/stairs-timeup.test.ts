import { describe, expect, it } from 'vitest';
import { createStairs, stepStairs, stairsTimeUp, STAIRS_PARAMS } from '../src';

describe('stairs 5-minute cap (bug report: 269 樓就結束)', () => {
  it('a pet that never dies is stopped at matchMaxTicks (5 min) while still alive → time_up, not death', () => {
    const P = { ...STAIRS_PARAMS, hpBase: 1e6 };
    const s = createStairs(1, [{ petId: 'a', stamina: 30, speed: 30 } as any], P);
    while (!s.over) {
      const p = s.players[0];
      if (p.y > P.height - 20) { const low = [...s.plats].filter((q) => q.brk !== 0).sort((a, b) => b.y - a.y)[0]; p.x = low.x + 6; p.y = low.y - P.boxH; p.vy = 0; p.on = low.id; }
      stepStairs(s);
    }
    expect(s.tick).toBe(P.matchMaxTicks); expect(s.players[0].alive).toBe(true); expect(stairsTimeUp(s)).toBe(true);
    expect(s.players[0].floor).toBeGreaterThan(150);
  });
  it('a pet that falls is not time_up', () => {
    const s = createStairs(2, [{ petId: 'a', stamina: 10, speed: 10 } as any]);
    while (!s.over) stepStairs(s);
    expect(s.players[0].alive).toBe(false); expect(stairsTimeUp(s)).toBe(false);
  });
});
