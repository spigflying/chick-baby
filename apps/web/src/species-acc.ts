/**
 * 雞以外的物種：正面精靈、配件錨點、少數要改尺寸／位置的配件（以該物種座標直接畫），以及外套的畫法。
 * 色碼同 sprites：0 最亮、1 亮、2 暗、3 輪廓；'.' 透明。
 */
export type Anchor = 'head' | 'eye' | 'neck' | 'back' | 'hand' | 'feet' | 'body';
export type Pts = [number, number, number | string][];
import { BENSON, VIEW_ANCHORS, COAT, type View } from './species-sprites';
export type { View } from './species-sprites';

/** 正面精靈（Benson 的設計，四個物種都有）。 */
export const SPECIES_FRONT: Record<string, string[]> = Object.fromEntries(Object.entries(BENSON).map(([k, v]) => [k, v.front]));
const pick = (view: View) => Object.fromEntries(Object.entries(VIEW_ANCHORS).map(([sp, a]) => {
  const { head, eye, neck, back, hand, feet, body } = a[view];
  return [sp, { head, eye, neck, back, hand, feet, body }];
})) as Record<string, Record<Anchor, [number, number]>>;
/** 側面（含走路兩格）、睡覺、正面的配件錨點：相對於舊版雞配件座標的位移。 */
export const SIDE_ANCHORS = pick('side');
export const SLEEP_ANCHORS = pick('sleep');
export const FRONT_ANCHORS = pick('front');
/** 頭毛到第幾列（戴會蓋住頭毛的帽子時拿掉）；-1 = 沒有頭毛。 */
export const HAIR_ROWS: Record<string, Record<View, number>> = Object.fromEntries(Object.entries(VIEW_ANCHORS).map(([sp, a]) => [sp, { side: a.side.hair, sleep: a.sleep.hair, front: a.front.hair }]));
export const FRONT_HAIR_ROWS: Record<string, number> = Object.fromEntries(Object.entries(HAIR_ROWS).map(([sp, h]) => [sp, h.front]));
/** 從第幾列開始是腳（穿鞋類配件時拿掉）。 */
export const FEET_FROM: Record<string, Record<View, number>> = Object.fromEntries(Object.entries(VIEW_ANCHORS).map(([sp, a]) => [sp, { side: a.side.feetFrom, sleep: a.sleep.feetFrom, front: a.front.feetFrom }]));
/** 個別配件在某物種上的額外位移（側面）。 */
export const SIDE_EXTRA: Record<string, Record<string, [number, number]>> = {};
/** 以物種座標直接畫的替代圖：Benson 版物種都用一般配件＋錨點，不再需要。 */
export const SIDE_ART: Record<string, Record<string, Pts>> = {};
export const FRONT_ART: Record<string, Record<string, Pts>> = {};

/** 外套的身體範圍：[第一列, 最後一列, 前襟 x]（側面面向左，前襟靠左；正面在中間）。 */
/**
 * 外套：把身體那幾列的內部塗滿（實心），上緣是領子、前襟一條開口線＋鈕扣、下擺一條邊。
 * 依底圖輪廓算，所以任何物種都貼著身形。
 */
export function coatPoints(sp: string, rows: string[], front: boolean, dy: number, view: View = front ? 'front' : 'side'): Pts {
  const spec = COAT[sp]?.[view]; if (!spec) return [];
  const [ya, yb, fx] = spec, col = '2', light = '0';
  const out: Pts = [];
  for (let y = ya + dy; y <= yb + dy; y++) {
    const r = rows[y] ?? ''; const xs = [...r].map((c, x) => (c !== '.' ? x : -1)).filter((x) => x >= 0);
    if (xs.length < 3) continue;
    const l = xs[0], rr = xs[xs.length - 1];
    for (let x = l + 1; x < rr; x++) {
      if (r[x] === '.') continue;
      let c = col;
      if (y === yb + dy) c = '3'; // 下擺
      if (front ? (x === fx || x === fx + 1) : x === fx) c = '3'; // 前襟開口
      out.push([x, y, c]);
    }
    if (y > ya + dy && y < yb + dy && (y - ya - dy) % 2 === 1) out.push([front ? fx - 1 : fx + 1, y, light]); // 鈕扣
  }
  // 領子：最上面一列，前襟兩側各一個亮色的翻領
  const y = ya + dy;
  if (front) { out.push([fx - 1, y, light], [fx - 2, y, light], [fx + 2, y, light], [fx + 3, y, light]); }
  else { out.push([fx - 1, y, light], [fx + 1, y, light], [fx + 2, y, light]); }
  return out;
}
