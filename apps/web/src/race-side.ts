/**
 * 車庫用的側面車圖（原創）：每款車用參數描述輪廓（80×26 設計格，車頭朝右），2 倍點陣化成 160×52。
 * 只用四階綠；車身套用塗裝（深淺＋花紋，側面的條紋改成水平腰線）。
 */
import { PAINT_LIVERIES } from './race-cars';
import { G } from './race-gfx';

interface Side { belt: number; roofY: number; r0: number; r1: number; bottom: number; nose: number; tail: number; wf: number; wr: number; rad: number; wing?: [number, number, number]; open?: boolean; rack?: boolean; hood?: boolean; fin?: boolean; hatch?: boolean }
// belt 腰線高度、roofY 車頂高度、r0..r1 車頂前後、bottom 車底、nose/tail 車頭車尾高度、wf/wr 前後輪 x、rad 輪半徑、wing [x0,x1,高度]
export const SIDES: Record<string, Side> = {
  falcon: { belt: 13, roofY: 6, r0: 30, r1: 50, bottom: 21, nose: 16, tail: 12, wf: 63, wr: 16, rad: 5, wing: [2, 10, 9] },
  arrow: { belt: 14, roofY: 7, r0: 33, r1: 49, bottom: 21, nose: 17, tail: 13, wf: 64, wr: 15, rad: 5 },
  rhino: { belt: 11, roofY: 3, r0: 18, r1: 52, bottom: 19, nose: 13, tail: 10, wf: 63, wr: 17, rad: 6, hatch: true },
  comet: { belt: 13, roofY: 5, r0: 28, r1: 50, bottom: 21, nose: 16, tail: 11, wf: 63, wr: 16, rad: 5, wing: [2, 8, 11] },
  f1: { belt: 17, roofY: 11, r0: 34, r1: 42, bottom: 21, nose: 19, tail: 15, wf: 66, wr: 13, rad: 6, wing: [1, 9, 6], open: true },
  rally: { belt: 12, roofY: 4, r0: 20, r1: 48, bottom: 20, nose: 15, tail: 10, wf: 62, wr: 17, rad: 5, rack: true, hatch: true, wing: [2, 9, 4] },
  muscle: { belt: 12, roofY: 5, r0: 24, r1: 44, bottom: 21, nose: 13, tail: 12, wf: 64, wr: 16, rad: 6, hood: true },
  lmp: { belt: 15, roofY: 6, r0: 32, r1: 46, bottom: 21, nose: 18, tail: 12, wf: 64, wr: 14, rad: 5, wing: [1, 9, 5], fin: true },
  drift: { belt: 13, roofY: 6, r0: 28, r1: 48, bottom: 21, nose: 16, tail: 12, wf: 63, wr: 16, rad: 5, wing: [1, 10, 5] },
};
export const SIDE_W = 160, SIDE_H = 52;
const S = 2;
function inPoly(px: number, py: number, p: [number, number][]) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c; } return c; }
const cache = new Map<string, HTMLCanvasElement>();
export function sideCanvas(model: string, paint: number): HTMLCanvasElement {
  const key = `${model}:${paint}`; const hit = cache.get(key); if (hit) return hit;
  const s = SIDES[model] ?? SIDES.falcon, lv = PAINT_LIVERIES[paint % PAINT_LIVERIES.length];
  const g: (number | null)[][] = Array.from({ length: SIDE_H }, () => Array(SIDE_W).fill(null));
  const put = (x: number, y: number, c: number) => { if (x >= 0 && y >= 0 && x < SIDE_W && y < SIDE_H) g[y][x] = c; };
  const body: [number, number][] = s.open
    ? [[1, s.bottom], [1, s.tail], [14, s.belt - 1], [30, s.belt - 2], [s.r0, s.roofY + 4], [s.r1, s.roofY + 4], [s.r1 + 6, s.belt], [79, s.nose], [79, s.bottom - 1], [76, s.bottom]]
    : [[1, s.bottom], [1, s.tail], [s.hatch ? s.r0 - 2 : s.r0 - 8, s.hatch ? s.roofY + 2 : s.belt], [s.r0, s.roofY], [s.r1, s.roofY], [s.r1 + 11, s.belt + (s.hood ? -1 : 1)], [s.hood ? 76 : 74, s.nose - (s.hood ? 0 : 1)], [79, s.nose + 1], [79, s.bottom - 2], [77, s.bottom]];
  const win: [number, number][] = [[s.r0 + 2, s.roofY + 1.6], [s.r1 - 0.5, s.roofY + 1.6], [s.r1 + 8.5, s.belt - 0.4], [s.hatch ? s.r0 : s.r0 - 4, s.belt - 0.4]];
  const lvPat = (x: number, y: number) => {
    const b = lv.body, a = lv.accent;
    if (lv.pat === 'stripe') return (y >= (s.belt + 2) * S && y < (s.belt + 3.5) * S) ? a : b;
    if (lv.pat === 'dither') return (x + y) & 1 ? a : b;
    if (lv.pat === 'band') return (x - y * 2 + 400) % 12 < 4 ? a : b;
    return y === Math.round((s.belt + 1) * S) ? a : b;
  };
  const wheels = [s.wr, s.wf];
  for (let y = 0; y < SIDE_H; y++) for (let x = 0; x < SIDE_W; x++) {
    const dx = (x + 0.5) / S, dy = (y + 0.5) / S;
    if (!inPoly(dx, dy, body)) continue;
    if (wheels.some((w) => (dx - w) ** 2 + (dy - (26 - s.rad)) ** 2 < (s.rad + 1.3) ** 2)) continue; // 輪拱
    let c = lvPat(x, y);
    if (dy > s.bottom - 2) c = Math.min(3, Math.max(lv.body, 2));            // 下裙陰影
    else if (dy < s.belt + 1 && !s.open && dy > s.roofY + 0.5 && dx > s.r1 + 8) c = lv.body === 0 ? 0 : lv.body - 1; // 引擎蓋亮面
    if (!s.open && inPoly(dx, dy, win)) c = ((x - y) % 9 === 0 || (x - y) % 9 === 1) && dy < s.belt - 1 ? 1 : 3;     // 玻璃＋反光
    put(x, y, c);
  }
  const X = (v: number) => Math.round(v * S), Y = X;
  if (!s.open) for (let y = Y(s.roofY + 1.6); y < Y(s.belt); y++) put(X((s.r0 + s.r1) / 2 + 2), y, lv.body === 3 ? 2 : 3); // B 柱
  for (let y = Y(s.belt); y < Y(s.bottom - 2); y++) put(X(s.r1 + 3), y, lv.body >= 2 ? 3 : 2);                              // 門縫
  for (let x = X(s.r1 - 4); x < X(s.r1 - 1); x++) put(x, Y(s.belt + 3), 3);                                               // 門把
  for (let y = Y(s.nose); y < Y(s.nose) + 3; y++) for (let x = X(77); x < X(79.4); x++) put(x, y, 0);                       // 頭燈
  for (let y = Y(s.tail); y < Y(s.tail) + 4; y++) for (let x = X(1); x < X(2.6); x++) put(x, y, y & 1 ? 1 : 2);             // 尾燈
  if (!s.open) for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) put(X(s.r1 + 7) + x, Y(s.belt) - 3 + y, lv.body >= 2 ? 2 : 3); // 後照鏡
  if (s.open) { for (let y = Y(s.roofY); y < Y(s.roofY + 4); y++) for (let x = X(s.r0 + 1); x < X(s.r1 - 1); x++) { const r = (x - X((s.r0 + s.r1) / 2)) ** 2 + (y - Y(s.roofY + 2.4)) ** 2; if (r < 30) put(x, y, r < 8 && x > X((s.r0 + s.r1) / 2) ? 3 : 1); } // 安全帽
    for (let x = X(70); x < X(80); x++) for (let y = Y(23); y < Y(24.5); y++) put(x, y, 3); }                                        // 前翼
  if (s.wing) { const [a, b, h] = s.wing; for (let x = X(a); x < X(b); x++) for (let y = Y(h); y < Y(h) + 3; y++) put(x, y, y === Y(h) ? lv.accent : 3); for (let y = Y(h) + 3; y < Y(s.tail); y++) { put(X(a + 3), y, 3); put(X(a + 3) + 1, y, 3); } }
  if (s.fin) for (let x = X(6); x < X(s.r0 - 2); x++) { const top = Y(s.roofY + 2) + Math.round((X(s.r0 - 2) - x) * 0.25); for (let y = top; y < Y(s.belt); y++) put(x, y, lv.body); }
  if (s.rack) for (let x = X(s.r0 + 1); x < X(s.r1 - 1); x++) { put(x, Y(s.roofY) - 2, 3); if (x % 6 === 0) put(x, Y(s.roofY) - 1, 3); }
  if (s.hood) for (let x = X(s.r1 + 13); x < X(s.r1 + 21); x++) put(x, Y(s.belt) - 2, lv.body === 3 ? 2 : 3);           // 引擎蓋進氣
  // 輪胎：最暗胎皮、亮色輪框、輻條、中心
  for (const w of wheels) { const cx = w * S, cy = (26 - s.rad) * S, R = s.rad * S;
    for (let y = cy - R - 1; y <= cy + R; y++) for (let x = cx - R - 1; x <= cx + R; x++) { const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy), ang = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
      if (d > R) continue; put(x, y, d > R * 0.68 ? 3 : d > R * 0.6 ? 2 : d < R * 0.18 ? 3 : (Math.round(ang / (Math.PI / 5) * 2) % 2 === 0 ? 1 : 2)); } }
  // 1px 外框
  const o = g.map((r) => r.slice());
  for (let y = 0; y < SIDE_H; y++) for (let x = 0; x < SIDE_W; x++) if (g[y][x] === null && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => g[y + b]?.[x + a] != null && g[y + b][x + a] !== 3)) o[y][x] = 3;
  const c = document.createElement('canvas'); c.width = SIDE_W; c.height = SIDE_H; const cx = c.getContext('2d')!;
  o.forEach((row, j) => row.forEach((v, i) => { if (v !== null) { cx.fillStyle = G[v]; cx.fillRect(i, j, 1, 1); } }));
  cache.set(key, c); return c;
}
