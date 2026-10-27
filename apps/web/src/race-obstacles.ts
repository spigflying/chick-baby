/**
 * race-demo-obstacles：路障像素圖（Game Boy 4 綠：0 最亮…3 最暗，'.' 透明；外框 1 格最暗）與畫面尺寸。
 * 寬度＝引擎的 w（半路寬單位）× 那個深度的半路寬 px —— 與碰撞盒同寬；高度照圖的比例。
 */
import type { ObstacleKind } from '@chick/engine';

/** 紙箱堆：下面兩箱、上面一箱，封箱膠帶 */
const BOXES = [
  '....33333333....',
  '....31111113....',
  '....31033013....',
  '....31000013....',
  '....31111113....',
  '3333333333333333',
  '3111111331111113',
  '3103301331033013',
  '3100001331000013',
  '3100001331000013',
  '3111111331111113',
  '3222222332222223',
  '3333333333333333',
];
/** 輪胎堆：兩疊、每疊三個輪胎（黑胎＋亮邊） */
const TYRES = [
  '.333333..333333.',
  '3222222333222223',
  '3211112332111123',
  '3333333333333333',
  '3222222332222223',
  '3211112332111123',
  '3333333333333333',
  '3222222332222223',
  '3211112332111123',
  '.333333..333333.',
];
/** 一排三角錐（5 個，反光條），擋半邊路 */
const CONE = ['...3...', '..303..', '..313..', '.30003.', '.31113.', '3000003', '3333333'];
const CONES = CONE.map((r) => [r, r, r, r, r].join('......'));
export const OBST_ART: Record<ObstacleKind, string[]> = { boxes: BOXES, tyres: TYRES, cones: CONES };

/** 畫面尺寸：w＝引擎寬 × 半路寬 px（不取整，呼叫端再取整）；h 依圖比例 */
export function obstacleDims(kind: ObstacleKind, wUnits: number, lat: number) {
  const a = OBST_ART[kind], w = wUnits * lat; return { w, h: w * a.length / a[0].length };
}
/** 已經過了車頭：從底線往下滑出畫面（0＝貼底線，1＝完全出去），連續不跳 */
export function obstacleSlide(dz: number, playerDz: number) { const a = playerDz + 0.75, b = 0.5; return Math.max(0, Math.min(1, (a - dz) / (a - b))); }
