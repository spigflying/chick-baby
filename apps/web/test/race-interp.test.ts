import { describe, it, expect } from 'vitest';
import { SnapClock, bracket, DELAY_MIN, DELAY_MAX } from '../src/race-interp';

describe('race interpolation clock', () => {
  it('uses tick timeline: arrival jitter does not move render time', () => {
    const c = new SnapClock();
    for (let k = 0; k < 20; k++) c.onSnap(k * 2, 1000 + k * 100 + (k % 3) * 7);
    for (let t = 0; t < 5000; t += 16) c.renderTick(t); // 緩衝先穩定
    const a = c.renderTick(5000), b = c.renderTick(5016.7);
    expect(b - a).toBeCloseTo(16.7 / 50, 2); // 時間線性前進
  });
  it('buffer grows to <=150ms when snaps arrive late, stays 100ms when on time', () => {
    const ok = new SnapClock(); for (let k = 0; k < 30; k++) ok.onSnap(k * 2, k * 100);
    for (let t = 0; t < 5000; t += 16) ok.renderTick(t); expect(ok.delay).toBe(DELAY_MIN);
    const bad = new SnapClock(); for (let k = 0; k < 30; k++) bad.onSnap(k * 2, k * 100 + (k % 4 === 0 ? 80 : 0));
    for (let t = 0; t < 5000; t += 16) bad.renderTick(t); expect(bad.delay).toBeGreaterThan(DELAY_MIN + 40); expect(bad.delay).toBeLessThanOrEqual(DELAY_MAX);
  });
  it('bracket clamps and interpolates', () => {
    const s = [{ tick: 2 }, { tick: 4 }, { tick: 6 }];
    expect(bracket(s, 5)).toEqual([s[1], s[2], 0.5]); expect(bracket(s, 9)[2]).toBe(1); expect(bracket(s, 0)[0]).toBe(s[0]);
  });
});
