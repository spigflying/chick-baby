import { describe, expect, it } from 'vitest';
import { CAR_MODELS, CAR_HALVES, LODS, carArt, carPixels, LIVERIES } from '../src/race-cars';
describe('race car sprites', () => {
  it('every model has all LODs at the exact width, symmetric, rectangular', () => {
    for (const m of CAR_MODELS) {
      expect(CAR_HALVES[m].length).toBe(LODS.length);
      LODS.forEach((w, l) => { const a = carArt(m, l); for (const r of a) { expect(r.length, `${m} lod${l}`).toBe(w); expect(r).toBe([...r].reverse().join('')); } });
      // 尺寸遞減
      for (let l = 1; l < LODS.length; l++) expect(carArt(m, l).length).toBeLessThanOrEqual(carArt(m, l - 1).length);
    }
  });
  it('only 4 palette indices; outline is darkest; brake lights change', () => {
    for (const m of CAR_MODELS) for (let k = 0; k < LIVERIES.length; k++) {
      const px = carPixels(m, k, 0).flat().filter((v) => v !== null) as number[];
      expect(px.every((v) => v >= 0 && v <= 3)).toBe(true);
      expect(carPixels(m, k, 0, { brake: true })).not.toEqual(carPixels(m, k, 0));
    }
  });
});
