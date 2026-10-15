import { describe, expect, it } from 'vitest';
import { fitWidth, FIT_MAX, FIT_MIN } from '../src/eggfit';
import { eggE, SHINE } from '../src/shell';

describe('egg frame fit', () => {
  it('keeps the full width when it fits, else the widest width that fits', () => {
    expect(fitWidth(() => true)).toBe(FIT_MAX);
    expect(fitWidth(() => false)).toBe(FIT_MIN);
    const w = fitWidth((x) => x <= 0.47);
    expect(w).toBeLessThanOrEqual(0.47); expect(w).toBeGreaterThan(0.465);
  });
  it('the shine pixels sit inside the shell fill (no white corner on the outline), at any egg height', () => {
    for (const H of [56, 62, 73, 90, 101]) for (const [x, y] of SHINE) {
      const yy = Math.round((y + 0.5) * H / 56 - 0.5);
      expect(eggE((x + 0.5) / 40, (yy + 0.5) / H)).toBeLessThan(0.78);
    }
  });
  it('egg shape: centre inside, corners outside', () => {
    expect(eggE(0.5, 0.54)).toBe(0);
    expect(eggE(0, 0)).toBeGreaterThan(1); expect(eggE(1, 1)).toBeGreaterThan(1);
  });
});
