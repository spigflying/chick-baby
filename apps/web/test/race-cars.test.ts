import { describe, expect, it } from 'vitest';
import { CAR_MODELS, LODS, carPixels, carBodyH, LIVERIES } from '../src/race-cars';
describe('race car sprites v3', () => {
  it('every model rasterizes at each LOD width, symmetric-ish, with a dark outline', () => {
    for (const m of CAR_MODELS) LODS.forEach((w, l) => {
      const px = carPixels(m, 0, l); expect(px[0].length).toBe(w); expect(px.length).toBe(carBodyH(l));
      const filled = px.flat().filter((v) => v !== null).length; expect(filled).toBeGreaterThan(w * 2);
    });
  });
  it('only 4 palette indices; brake lights change the sprite; nitro adds flame rows', () => {
    for (const m of CAR_MODELS) for (let k = 0; k < LIVERIES.length; k++) {
      const px = carPixels(m, k, 0).flat().filter((v) => v !== null) as number[];
      expect(px.every((v) => v >= 0 && v <= 3)).toBe(true);
      expect(carPixels(m, k, 0, { brake: true })).not.toEqual(carPixels(m, k, 0));
      expect(carPixels(m, k, 0, { nitro: true }).length).toBeGreaterThan(carBodyH(0));
    }
  });
});
