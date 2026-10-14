import { describe, expect, it } from 'vitest';
import { IDLE, shouldPause } from '../src/idle';

describe('shouldPause', () => {
  const base = { hiddenSince: null, lastActivity: 0, inMatch: false };
  it('pauses after the tab is hidden for 2 minutes', () => {
    expect(shouldPause({ ...base, hiddenSince: 0 }, IDLE.hiddenMs - 1)).toBe(false);
    expect(shouldPause({ ...base, hiddenSince: 0 }, IDLE.hiddenMs)).toBe(true);
  });
  it('pauses after 10 minutes without activity even when visible', () => {
    expect(shouldPause(base, IDLE.idleMs - 1)).toBe(false);
    expect(shouldPause(base, IDLE.idleMs)).toBe(true);
  });
  it('never pauses during a match', () => {
    expect(shouldPause({ hiddenSince: 0, lastActivity: 0, inMatch: true }, 10 * IDLE.idleMs)).toBe(false);
  });
});
