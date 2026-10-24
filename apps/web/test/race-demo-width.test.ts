import { describe, it, expect } from 'vitest';
import { exactRoadPts, rowAtPts, GROUND_Y, RACE_ROAD_W, RACE_DEPTH, RACE_HORIZON, RACE_CAM_H, CAM_H_EXACT, OLD_GROUND_HALF_W, groundHalfW, W } from '../src/race-gfx';
import { PLAYER_W } from '../src/race-cars';
import { CAR_W } from '../src/race-gfx';

const straight = Array.from({ length: 80 }, () => ({ curve: 0 }));
const gwAt = (camH: number) => rowAtPts(exactRoadPts(straight, 0, 0, () => 0, camH), GROUND_Y)!.w;
// 舊渲染器：底線那一列的半路寬（同一個投影公式、CAM_H 7.5）
const legacyGw = () => { const zRel = RACE_CAM_H * (W / 2) * RACE_DEPTH / (GROUND_Y - RACE_HORIZON); return RACE_ROAD_W * (RACE_DEPTH * 6 / zRel) * (W / 2); };

describe('race-demo road width at the player row', () => {
  it('exact renderer at the old camera height reproduces the old road width in px', () => {
    expect(gwAt(RACE_CAM_H)).toBeCloseTo(legacyGw(), 6);
    expect(OLD_GROUND_HALF_W).toBeCloseTo(legacyGw(), 6);
  });
  it('bottom-row width scales as 1/camH (the 16 m camera halved it — the 2-lane look)', () => {
    expect(gwAt(16) / legacyGw()).toBeCloseTo(7.5 / 16, 6);
    expect(gwAt(CAM_H_EXACT)).toBeCloseTo(groundHalfW(CAM_H_EXACT), 6);
    expect(gwAt(CAM_H_EXACT) / legacyGw()).toBeGreaterThan(0.7); // 10 m：≥ 70% 舊路寬
  });
  it('car-to-road ratio matches physics at every camera height', () => {
    const oldRatio = PLAYER_W / legacyGw(); // 舊版：車寬 / 半路寬
    for (const h of [7.5, 10, 16]) {
      const gw = gwAt(h), carPx = PLAYER_W * gw / OLD_GROUND_HALF_W; // drawRace 的 carK 縮放
      expect(carPx / gw).toBeCloseTo(oldRatio, 6);
      expect(carPx / (2 * gw)).toBeGreaterThan(0.12); expect(carPx / (2 * gw)).toBeLessThan(0.15); // ≈ 車寬/全路寬
    }
    expect(CAR_W).toBeGreaterThan(0);
  });
});
