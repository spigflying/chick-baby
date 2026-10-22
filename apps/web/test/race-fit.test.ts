import { describe, expect, it } from 'vitest';
import { fitScale } from '../src/race-fit';
describe('race canvas integer scaling', () => {
  it('uses whole device-pixel multiples', () => {
    expect(fitScale(356, 3)).toEqual({ k: 4, cssW: 320 });   // iPhone 390 寬
    expect(fitScale(356, 2)).toEqual({ k: 2, cssW: 240 });
    expect(fitScale(800, 1)).toEqual({ k: 3, cssW: 720 });
    expect(fitScale(356, 1)).toEqual({ k: 0, cssW: 356 });   // 退回填滿
    for (const [w, d] of [[356, 3], [412, 2.625], [1000, 1.25]]) { const f = fitScale(w, d); if (f.k) expect(Math.abs(f.cssW * d - f.k * 240)).toBeLessThan(1e-6); }
  });
});
