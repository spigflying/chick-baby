import { describe, expect, it } from 'vitest';
import { pickupDims } from '../src/race-pickup';
// 與 race-gfx 相同的投影：半路寬 px = ROAD_W × DEPTH×6/(dz+4) × W/2；比底線近的就貼底線那一列
const ROAD_W = 2.4, DEPTH = 0.9, W = 240, PLAYER_DZ = 2.75, CAR_W = 52;
const lat = (dz: number) => ROAD_W * (DEPTH * 6 / (dz + 4)) * (W / 2);
describe('nitro pickup sprite size', () => {
  it('grows monotonically as it approaches, ~1/2 car width at the car row', () => {
    const gw = lat(PLAYER_DZ); let prev = 0;
    for (let dz = 300; dz >= 0.5; dz -= 0.5) { const { w, h } = pickupDims(Math.min(lat(dz), gw * 1.0001) , gw, CAR_W); expect(w).toBeGreaterThanOrEqual(prev); expect(h).toBeGreaterThan(w); prev = w; }
    expect(pickupDims(gw, gw, CAR_W).w).toBeCloseTo(CAR_W / 2);
    for (const [a, b] of [[150, 100], [100, 60], [60, 30], [30, 10]]) expect(pickupDims(lat(b), gw, CAR_W).w).toBeGreaterThan(pickupDims(lat(a), gw, CAR_W).w);
  });
});
