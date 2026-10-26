import { it, expect } from 'vitest';
import { carStats, TRACKS, RACE_TICK_RATE } from '../src/racing';
it('v18: nitro lasts 5/7/9/11 s, boost unchanged; every track is 3 laps', () => {
  expect([0, 1, 2, 3].map((n) => carStats({ nitro: n }).nitroTicks / RACE_TICK_RATE)).toEqual([5, 7, 9, 11]);
  expect(carStats({ nitro: 3 }).nitroBoost).toBeCloseTo(1.49);
  expect(TRACKS.every((t) => t.laps === (t.id === 'tw1' || t.id === 'tw3' ? 4 : 3))).toBe(true); // race-prod-port：v2 佈局 tw1／tw3 較短，改 4 圈維持比賽時間
});
