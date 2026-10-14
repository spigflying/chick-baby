import { describe, expect, it } from 'vitest';
import { formatCountdown } from '../src/sleep';

describe('formatCountdown', () => {
  it('formats hours, minutes, seconds and days', () => {
    expect(formatCountdown(0)).toBe('00:00:00');
    expect(formatCountdown(-5000)).toBe('00:00:00');
    expect(formatCountdown((3 * 3600 + 4 * 60 + 5) * 1000 + 999)).toBe('03:04:05');
    expect(formatCountdown((2 * 86400 + 13 * 3600) * 1000)).toBe('2 天 13:00:00');
  });
});
