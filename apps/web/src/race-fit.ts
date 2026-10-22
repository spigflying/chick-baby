/** 賽車畫面整數倍縮放：以「裝置像素」取整數倍（240×k），每個遊戲像素一樣寬，移動時不會閃爍。
 *  手機 DPR 2–3 幾乎都能拿到 k≥2；只有 DPR 1 又很窄（k<2）時才退回填滿寬度（非整數倍）。 */
export function fitScale(cssW: number, dpr: number, w = 240): { k: number; cssW: number } {
  const k = Math.floor((cssW * dpr) / w);
  return k >= 2 ? { k, cssW: (k * w) / dpr } : { k: 0, cssW };
}
