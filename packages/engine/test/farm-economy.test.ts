import { describe, expect, it } from 'vitest';
import { simulateFarm } from '../scripts/sim-farm';

const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

describe('farm economy (spec: 一天上線 4 次淨賺 ◎150–250，每 15 分鐘看一次 ≤ ◎400)', () => {
  it('model A (4 sessions a day) nets ◎150–250 per day on days 3–5', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const r = simulateFarm({ days: 5, sessions: 'A', seed });
      const a = avg(r.netPerDay.slice(2));
      expect(a, `seed ${seed}: ${r.netPerDay.join(',')}`).toBeGreaterThanOrEqual(150);
      expect(a, `seed ${seed}: ${r.netPerDay.join(',')}`).toBeLessThanOrEqual(250);
    }
  });
  // 單日會因為「今天買種子、明天交訂單」上下跳，所以上限看平均：第 2–5 天平均 ≤ 400、任何一天 ≤ 500
  it('model B (every 15 minutes) averages at most ◎400 a day and never exceeds ◎500', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const r = simulateFarm({ days: 5, sessions: 'B', seed });
      expect(avg(r.netPerDay.slice(1)), `seed ${seed}: ${r.netPerDay.join(',')}`).toBeLessThanOrEqual(400);
      for (const n of r.netPerDay) expect(n, `seed ${seed}: ${r.netPerDay.join(',')}`).toBeLessThanOrEqual(500);
    }
  });
  it('doing nothing after the first morning earns nothing', () => {
    const r = simulateFarm({ days: 5, sessions: 'none', seed: 1 });
    for (const n of r.netPerDay.slice(1)) expect(n).toBeLessThanOrEqual(0);
  });
});
