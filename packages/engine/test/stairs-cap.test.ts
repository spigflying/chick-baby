import { describe, expect, it } from 'vitest';
import { createStairs, stepStairs, STAIRS_PARAMS } from '../src';

describe('stairs match duration cap (review follow-up)', () => {
  it('matchMaxTicks is 5 minutes so a match started before the 19:55 cutoff ends by 20:00', () => {
    expect(STAIRS_PARAMS.matchMaxTicks / STAIRS_PARAMS.tickRate).toBe(5 * 60);
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
