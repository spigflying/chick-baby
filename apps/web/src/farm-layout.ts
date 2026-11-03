// 小雞農場主畫面的固定版面（960×600 的 SVG 場景座標，左上角＋寬高）。
// 位置固定、新內容只往後加（spec：farm_slots 的編號固定對應這些位置）。
export interface Box { x: number; y: number; w: number; h: number }
export const SCENE = { w: 960, h: 600, hudH: 70 };

const FW = 96, FH = 64;
const COLS = [24, 132, 240, 348], ROWS = [120, 214, 308];

export const LAYOUT = {
  /** 12 格田：左半邊 4 × 3，由上到下、由左到右編號（前 6 格是 Lv1 就有的上面兩排…依 FARM.fieldUnlock） */
  fields: ROWS.flatMap((y) => COLS.map((x) => ({ x, y, w: FW, h: FH }))) as Box[],
  hutch: { x: 528, y: 112, w: 190, h: 118 },
  coop: { x: 738, y: 112, w: 196, h: 118 },
  bakery: { x: 528, y: 252, w: 190, h: 138 },
  jamhouse: { x: 738, y: 252, w: 196, h: 138 },
  tree: { x: 36, y: 456, w: 150, h: 136 },
  board: { x: 214, y: 466, w: 120, h: 110 },
  barn: { x: 758, y: 452, w: 184, h: 140 },
  /** 小路（建築與田都不能壓到） */
  path: [
    { x: 456, y: 80, w: 56, h: 315 },
    { x: 0, y: 396, w: 960, h: 50 },
    { x: 456, y: 446, w: 56, h: 154 },
  ] as Box[],
  /** 池塘（裝飾）與小雞起點 */
  pond: { x: 540, y: 490, w: 180, h: 70 },
  chick: { x: 484, y: 380 },
};
