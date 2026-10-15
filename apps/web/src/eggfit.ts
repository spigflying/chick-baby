/** 畫面寬度（佔 LCD 寬的比例）的上下限。 */
export const FIT_MAX = 1, FIT_MIN = 0.6;
/** 二分搜尋：fits(w) 隨 w 單調（越窄越容易放進蛋裡），回傳能放進去的最大寬度；全都放不進去時回傳最小值。 */
export function fitWidth(fits: (w: number) => boolean, max = FIT_MAX, min = FIT_MIN, steps = 9): number {
  if (fits(max)) return max;
  let lo = min, hi = max;
  if (!fits(lo)) return lo;
  for (let i = 0; i < steps; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
  return lo;
}
/**
 * 把 .lcd（頂部列＋遊戲畫面）放進外殼照片的 LCD（.inner）：放得下就用全寬；太高就二分搜尋縮窄（置中），
 * 還不行就加 .fit2（頂部列的字縮小）再試。外殼本身的比例由 CSS 固定，這裡不改。
 */
export function fitIntoLcd(dev: HTMLElement) {
  const inner = dev.querySelector('.inner') as HTMLElement | null, lcd = dev.querySelector('.lcd') as HTMLElement | null;
  if (!inner || !lcd || !inner.clientHeight) return;
  dev.classList.remove('fit2');
  const fits = (w: number) => { lcd.style.width = `${(w * 100).toFixed(2)}%`; return lcd.offsetHeight <= inner.clientHeight + 0.5; };
  let w = fitWidth(fits);
  if (!fits(w)) { dev.classList.add('fit2'); w = fitWidth(fits, FIT_MAX, 0.4); fits(w); }
}
