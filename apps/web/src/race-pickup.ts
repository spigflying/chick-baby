/** 路上氮氣道具的畫面尺寸：跟車／路邊物同一套透視——寬度與「畫在那一列」的半路寬 lat 成正比。
 *  在玩家車那一列（lat＝gw）時＝車寬的 PICKUP_CAR_FRAC。沒有上限，越近越大（近到底線以下就貼底線那一列，不會再變小）。 */
/** v26：再放大（0.5→0.9 車寬），遠處最小 6px 寬（仍單調變大）→ 很遠就看得到 */
export const PICKUP_CAR_FRAC = 0.9, PICKUP_MIN_W = 6, PICKUP_ART_W = 14, PICKUP_ART_H = 18;
export function pickupDims(lat: number, gw: number, carW: number) {
  const w = Math.max(PICKUP_MIN_W, carW * PICKUP_CAR_FRAC * lat / gw);
  return { w, h: w * PICKUP_ART_H / PICKUP_ART_W };
}
