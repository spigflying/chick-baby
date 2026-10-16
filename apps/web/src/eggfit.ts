/** 畫面寬度（佔蛋寬的比例）的上下限。 */
export const FIT_MAX = 0.56, FIT_MIN = 0.3;
/** 二分搜尋：fits(w) 隨 w 單調（越窄越容易放進蛋裡），回傳能放進去的最大寬度；全都放不進去時回傳最小值。 */
export function fitWidth(fits: (w: number) => boolean, max = FIT_MAX, min = FIT_MIN, steps = 9): number {
  if (fits(max)) return max;
  let lo = min, hi = max;
  if (!fits(lo)) return lo;
  for (let i = 0; i < steps; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
  return lo;
}
