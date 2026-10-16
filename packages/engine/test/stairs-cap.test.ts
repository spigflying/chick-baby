import { describe, expect, it } from 'vitest';
import { createStairs, stepStairs, STAIRS_PARAMS } from '../src';

describe('stairs match duration cap (review follow-up)', () => {
  it('no fixed 5-minute limit: the default cap is a 60-minute safety net; closing time is applied per match by the server', () => {
    expect(STAIRS_PARAMS.matchMaxTicks / STAIRS_PARAMS.tickRate).toBe(60 * 60);
  });
  it('the match is over at the cap even if the player is still alive', () => {
    const s = createStairs(1, [{ petId: 'a', speed: 10, stamina: 10 }]);
    s.tick = STAIRS_PARAMS.matchMaxTicks - 1;
    s.players[0].hp = 99; s.players[0].alive = true;
    stepStairs(s);
    expect(s.players[0].alive).toBe(true);
    expect(s.over).toBe(true);
  });
});
