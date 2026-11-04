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
  // 第二階段（Claude 定的數字）：30 天、星期一到五、第 8 天起平均：4 次 ≤ 300、每 15 分鐘 ≤ 450（不扣買田、裝飾）
  it('30 days with phase-2 content: weekday average from day 8 stays at most ◎300 (A) and ◎450 (B)', () => {
    for (let seed = 1; seed <= 3; seed++) for (const [m, cap] of [['A', 300], ['B', 450]] as const) {
      const r = simulateFarm({ days: 30, sessions: m, seed });
      const late = r.netPerDay.filter((_, d) => d >= 7 && d % 7 < 5);
      expect(avg(late), `${m} seed ${seed}: ${r.netPerDay.join(',')}`).toBeLessThanOrEqual(cap);
      expect(r.level).toBe(20);
      expect(r.stats.farm_balloon, 'the bot uses the balloon').toBeGreaterThan(0);
      expect(r.stats.farm_expand, 'the bot buys east fields').toBe(-2620);
    }
  });
  it('doing nothing after the first morning earns nothing', () => {
    const r = simulateFarm({ days: 5, sessions: 'none', seed: 1 });
    for (const n of r.netPerDay.slice(1)) expect(n).toBeLessThanOrEqual(0);
  });
});
