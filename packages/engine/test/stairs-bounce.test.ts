import { describe, expect, it } from 'vitest';
import { createStairs, stepStairs, STAIRS_PARAMS as P } from '../src';

/** 解析：和 stepStairs 同樣的離散積分（先加重力再移動），平台每 tick 往上捲 scroll。回傳腳底相對於彈跳格的最高點（px）。 */
function relPeak(v0: number, scroll: number) {
  let vy = v0, y = 0, best = 0;
  for (let t = 1; t < 300; t++) { vy = Math.min(P.maxFall, vy + P.gravity); y += vy; const rel = -(y + scroll * t); best = Math.max(best, rel); if (rel < 0) break; }
  return best;
}
const SLOW = P.scrollBase, FAST = P.scrollBase + P.scrollMaxExtra;
const MARGIN = 4;

describe('stairs bouncy platform (彈跳格) never sends the pet back to the floor above', () => {
  it('computed peak (relative to the platforms, which scroll up) stays below the row above with margin, at any scroll speed', () => {
    // 腳底往上最多 relPeak；上一層在 gap 之上 → 必須 relPeak + MARGIN < gap 才不會落回上一層
    for (const s of [SLOW, FAST]) expect(relPeak(P.bounceVy, s) + MARGIN).toBeLessThan(P.gap);
    expect(relPeak(P.bounceVy, SLOW)).toBeCloseTo(8.55, 2);
    expect(relPeak(-3.2, SLOW)).toBeGreaterThan(P.gap); // 舊值 -3.2：20.3px > 16 → 會回到上一層（回歸檢查）
  });
  it('still a noticeable bounce (≥ 8px on screen)', () => {
    expect(relPeak(P.bounceVy, 0)).toBeGreaterThanOrEqual(8);
  });
  it('simulation with the real stepStairs: pet bounces but never lands on the platform directly above', () => {
    for (const floor of [0, 200]) { // 200 樓 → 捲動最快
      const s = createStairs(7, [{ petId: 'a', speed: 10, stamina: 10 }]);
      const base = { dir: 1 as const, brk: -1, counted: true, hurt: false };
      s.plats = [{ id: 9001, x: 30, y: 60, type: 'bouncy', ...base }, { id: 9002, x: 30, y: 60 - P.gap, type: 'normal', ...base }];
      const p = s.players[0]; Object.assign(p, { x: 36, y: 60 - P.boxH - 0.5, vy: 0.5, on: null, floor, hp: 99, inv: 999 });
      let bounced = false, best = 0;
      for (let t = 0; t < 40; t++) {
        stepStairs(s);
        const bouncy = s.plats.find((q) => q.id === 9001)!;
        if (p.vy < 0) bounced = true;
        best = Math.max(best, bouncy.y - (p.y + P.boxH));
        expect(p.on).not.toBe(9002);
      }
      expect(bounced).toBe(true);
      expect(best).toBeGreaterThan(4);
      expect(best + MARGIN).toBeLessThan(P.gap);
    }
  });
});
