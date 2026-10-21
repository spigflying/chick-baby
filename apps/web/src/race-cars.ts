/**
 * 賽車車款 v3（原創，從車尾看）：用「48×30 設計座標」的向量圖元描述，每個 LOD 寬度直接點陣化，
 * 所以遠處的小車是在小尺寸重新畫的（不是把大圖縮小），外框一律 1px 最暗色。
 * 色碼：0 最亮 … 3 最暗（Game Boy 四階綠）。
 */
export const LODS = [48, 32, 20, 12, 8] as const;
export const DESIGN_W = 48, DESIGN_H = 30;
type C = 'b' | 's' | 'h' | 'g' | 'r' | 'l' | 'L' | 'd' | 'm' | 'a' | 'k';
// b 車身 s 車身陰影 h 車身亮面 g 玻璃 r 玻璃反光 l 尾燈 L 尾燈中心 d 最暗 m 中暗 a 配色 k 強制透明
type Op =
  | ['rect', number, number, number, number, C, number?]                 // x0 y0 x1 y1 色 最小寬度
  | ['trap', number, number, number, number, number, number, C, number?] // y0 y1 上x0 上x1 下x0 下x1
  | ['ell', number, number, number, number, C, number?]                  // cx cy rx ry
  | ['fins', number, number, number, number, number, C, number?]         // 直條紋：x0 y0 x1 y1 間距
  | ['tread', number, number, number, number, number?];                  // 輪胎紋
const tyres = (x0: number, w: number, y0: number): Op[] => [['rect', x0, y0, x0 + w, 30, 'd'], ['tread', x0 + 1, y0 + 1, x0 + w - 1, 29, 24], ['tread', 48 - x0 - w + 1, y0 + 1, 48 - x0 - 1, 29, 24], ['rect', 48 - x0 - w, y0, 48 - x0, 30, 'd']];
export const CAR_SPECS: Record<string, { name: string; ops: Op[] }> = {
  // 隼 GT：GT3 賽車——大尾翼＋端板、寬輪拱、雙圓尾燈、中央單出排氣、大擴散器
  falcon: { name: '隼 GT', ops: [
    ...tyres(1, 8, 21),
    ['trap', 7, 16, 15, 33, 9, 39, 'b'],            // 車頂／C 柱
    ['trap', 8, 15, 17, 31, 12, 36, 'g'],           // 後窗
    ['trap', 9, 11, 22, 25, 18, 21, 'r', 32], ['trap', 11, 14, 19, 21, 16, 18, 'r', 32], // 反光
    ['trap', 15, 20, 5, 43, 1, 47, 'b'],            // 寬肩（後輪拱）
    ['rect', 4, 15, 44, 16, 'h', 20],               // 肩線亮面
    ['rect', 2, 20, 46, 25, 'b'],                   // 車尾面板
    ['rect', 2, 24, 46, 25, 's', 20],
    ['ell', 8.5, 20, 4.5, 2.6, 'd'], ['ell', 8.5, 20, 3.5, 1.7, 'l'], ['ell', 8.5, 20, 1.5, 0.8, 'L', 32],
    ['ell', 39.5, 20, 4.5, 2.6, 'd'], ['ell', 39.5, 20, 3.5, 1.7, 'l'], ['ell', 39.5, 20, 1.5, 0.8, 'L', 32],
    ['rect', 19, 20, 29, 23, 'h', 32], ['rect', 19, 20, 29, 21, 's', 32], // 車牌
    ['rect', 8, 25, 40, 30, 'd'], ['fins', 10, 26, 38, 30, 3, 'm', 20],   // 擴散器
    ['ell', 24, 26.5, 2.6, 2, 'm', 20], ['ell', 24, 26.5, 1.4, 1, 'd', 20], // 排氣
    ['rect', 2, 0, 46, 3, 'a'], ['rect', 2, 3, 46, 4, 's', 20],           // 尾翼
    ['rect', 1, 0, 3, 7, 'd'], ['rect', 45, 0, 47, 7, 'd'],               // 端板
    ['rect', 16, 4, 18, 8, 'd'], ['rect', 30, 4, 32, 8, 'd'],             // 支架
  ] },
  // 箭 RS：楔形中置超跑——極低極寬、細長 Y 形燈、百葉後窗、中央六角四出排氣
  arrow: { name: '箭 RS', ops: [
    ...tyres(0, 9, 20),
    ['trap', 10, 17, 17, 31, 7, 41, 'b'],
    ['trap', 11, 16, 19, 29, 10, 38, 'g'],
    ['fins', 12, 12, 36, 16, 3, 'd', 32],           // 引擎百葉
    ['trap', 16, 21, 3, 45, 0, 48, 'b'],
    ['rect', 2, 16, 46, 17, 'h', 20],
    ['rect', 1, 21, 47, 25, 'b'], ['rect', 1, 24, 47, 25, 's', 20],
    ['trap', 18, 21, 3, 15, 1, 12, 'd'], ['trap', 19, 20, 4, 14, 3, 12, 'l'],    // 左 Y 燈
    ['trap', 18, 21, 33, 45, 36, 47, 'd'], ['trap', 19, 20, 34, 44, 36, 45, 'l'],
    ['rect', 13, 21, 35, 23, 'd', 20], ['rect', 14, 21, 34, 22, 'L', 32],        // 中央燈條
    ['rect', 9, 25, 39, 30, 'd'], ['fins', 11, 26, 37, 30, 2, 'm', 32],
    ['trap', 24, 29, 19, 29, 17, 31, 'm', 12], ['ell', 21, 26.5, 1.4, 1.2, 'd', 20], ['ell', 27, 26.5, 1.4, 1.2, 'd', 20], // 六角排氣框＋兩出
    ['rect', 6, 9, 42, 10, 'a', 20],                // 小鴨尾
  ] },
  // 犀 R：四驅性能跑車（GT-R 系的輪廓但原創）——四顆圓燈、四出排氣、鴨尾＋小尾翼、較高車身
  rhino: { name: '犀 R', ops: [
    ...tyres(1, 8, 21),
    ['trap', 4, 14, 14, 34, 9, 39, 'b'],
    ['trap', 5, 13, 16, 32, 12, 36, 'g'],
    ['trap', 6, 8, 21, 24, 18, 21, 'r', 32], ['trap', 8, 12, 18, 20, 15, 17, 'r', 32],
    ['trap', 13, 19, 4, 44, 1, 47, 'b'],
    ['rect', 3, 13, 45, 14, 'h', 20],
    ['rect', 2, 19, 46, 25, 'b'], ['rect', 2, 24, 46, 25, 's', 20],
    ['ell', 6.5, 18.5, 2.6, 2.4, 'd'], ['ell', 6.5, 18.5, 1.6, 1.4, 'l'],
    ['ell', 12.5, 18.5, 2.6, 2.4, 'd'], ['ell', 12.5, 18.5, 1.6, 1.4, 'l'],
    ['ell', 35.5, 18.5, 2.6, 2.4, 'd'], ['ell', 35.5, 18.5, 1.6, 1.4, 'l'],
    ['ell', 41.5, 18.5, 2.6, 2.4, 'd'], ['ell', 41.5, 18.5, 1.6, 1.4, 'l'],
    ['rect', 18, 19, 30, 22, 'h', 32], ['rect', 18, 19, 30, 20, 's', 32],
    ['rect', 7, 25, 41, 30, 'd'], ['fins', 15, 26, 33, 30, 3, 'm', 32],
    ['ell', 9, 26.5, 1.8, 1.5, 'm', 20], ['ell', 13, 26.5, 1.8, 1.5, 'm', 20], ['ell', 35, 26.5, 1.8, 1.5, 'm', 20], ['ell', 39, 26.5, 1.8, 1.5, 'm', 20],
    ['rect', 5, 11, 43, 13, 'a'], ['rect', 12, 13, 14, 14, 'd', 32], ['rect', 34, 13, 36, 14, 'd', 32], // 尾翼
  ] },
  // 彗星 Z：後置引擎經典跑車（911 系的圓潤輪廓但原創）——全寬燈條、百葉格柵、升降小尾翼、中央雙出
  comet: { name: '彗星 Z', ops: [
    ...tyres(2, 8, 21),
    ['ell', 24, 13, 13, 8, 'b'],                    // 圓潤車頂
    ['rect', 0, 0, 48, 6, 'k'],
    ['ell', 24, 13.5, 10, 6, 'g'], ['rect', 12, 15, 36, 22, 'k'],
    ['trap', 8, 10, 21, 24, 19, 22, 'r', 32], ['trap', 10, 13, 18, 20, 16, 18, 'r', 32],
    ['trap', 14, 20, 6, 42, 2, 46, 'b'],
    ['rect', 5, 14, 43, 15, 'h', 20],
    ['fins', 14, 15, 34, 18, 2, 's', 32],           // 引擎蓋百葉
    ['rect', 3, 20, 45, 25, 'b'], ['rect', 3, 24, 45, 25, 's', 20],
    ['rect', 3, 19, 45, 22, 'd'], ['rect', 4, 20, 44, 21, 'l'], ['rect', 8, 20, 11, 21, 'L', 32], ['rect', 37, 20, 40, 21, 'L', 32], // 全寬燈條
    ['rect', 9, 25, 39, 30, 'd'], ['fins', 12, 26, 36, 30, 3, 'm', 32],
    ['ell', 21, 26.5, 1.6, 1.3, 'm', 20], ['ell', 27, 26.5, 1.6, 1.3, 'm', 20],
    ['rect', 13, 13, 35, 14, 'a', 20],              // 升起的尾翼
  ] },
};
export const CAR_MODELS = Object.keys(CAR_SPECS);
/** 塗裝（四階綠）：[車身, 配色] */
export const LIVERIES: [number, number][] = [[0, 2], [1, 3], [2, 0], [0, 3], [1, 0], [2, 1]];
export const LIVERY_NAMES = ['白／墨', '淺綠／黑', '墨綠／白', '白／黑', '淺綠／白', '墨綠／淺'];
export interface CarLook { brake?: boolean; nitro?: boolean; hit?: boolean; frame?: number }

const cache = new Map<string, (number | null)[][]>();
/** 點陣化：回傳 [列][行] 的色碼（null = 透明）。高度 = 寬 × 30/48。 */
export function carPixels(model: string, livery: number, lod: number, look: CarLook = {}): (number | null)[][] {
  const key = `${model}:${livery}:${lod}:${+!!look.brake}:${+!!look.nitro}:${+!!look.hit}:${(look.frame ?? 0) & 1}`;
  const hit = cache.get(key); if (hit) return hit.map((r) => r.slice());
  const W = LODS[lod], k = (W - 2) / DESIGN_W, H = Math.round(DESIGN_H * k) + 2;
  const [body, accent] = LIVERIES[livery % LIVERIES.length];
  const flash = look.hit && (look.frame ?? 0) % 2 === 1;
  const b = flash ? (body === 0 ? 2 : 0) : body;
  const col: Record<C, number | null> = {
    b, s: Math.min(3, b + 1) === 3 && b === 2 ? 3 : Math.min(3, b + 1), h: Math.max(0, b - 1) === b ? (b === 0 ? 0 : b - 1) : b - 1,
    g: 3, r: 1, l: look.brake ? 0 : (b === 0 ? 2 : b === 1 ? 2 : 1), L: look.brake ? 0 : 1, d: 3, m: 2, a: accent, k: null,
  };
  const g: (number | null)[][] = Array.from({ length: H }, () => Array(W).fill(null));
  const X = (x: number) => 1 + Math.round(x * k), Y = (y: number) => 1 + Math.round(y * k);
  const put = (x: number, y: number, c: C) => { if (y >= 0 && y < H && x >= 0 && x < W) g[y][x] = col[c]; };
  for (const op of CAR_SPECS[model]?.ops ?? CAR_SPECS.falcon.ops) {
    const minW = (op[0] === 'rect' || op[0] === 'ell') ? op[6] : op[0] === 'trap' ? op[8] : op[0] === 'fins' ? op[7] : op[5];
    if (minW && W < minW) continue;
    if (op[0] === 'rect') { const [, x0, y0, x1, y1, c] = op; for (let y = Y(y0); y < Math.max(Y(y0) + 1, Y(y1)); y++) for (let x = X(x0); x < Math.max(X(x0) + 1, X(x1)); x++) put(x, y, c); }
    else if (op[0] === 'trap') { const [, y0, y1, a0, a1, b0, b1, c] = op; const ya = Y(y0), yb = Math.max(ya + 1, Y(y1));
      for (let y = ya; y < yb; y++) { const t = yb - ya <= 1 ? 0 : (y - ya) / (yb - ya - 1); const l = X(a0 + (b0 - a0) * t), r = X(a1 + (b1 - a1) * t); for (let x = l; x < Math.max(l + 1, r); x++) put(x, y, c); } }
    else if (op[0] === 'ell') { const [, cx, cy, rx, ry, c] = op; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = ((x - 0.5) / k - cx) / rx, dy = ((y - 0.5) / k - cy) / ry; if (dx * dx + dy * dy <= 1) put(x, y, c); } }
    else if (op[0] === 'fins') { const [, x0, y0, x1, y1, step, c] = op; const st = Math.max(2, Math.round(step * k)); for (let x = X(x0); x < X(x1); x += st) for (let y = Y(y0); y < Y(y1); y++) put(x, y, c); }
    else if (op[0] === 'tread') { const [, x0, y0, x1, y1] = op; const st = Math.max(2, Math.round(2 * k)), off = (look.frame ?? 0) & 1; for (let y = Y(y0) + off; y < Y(y1); y += st) for (let x = X(x0); x < X(x1); x++) put(x, y, 'm'); }
  }
  // 1px 外框：透明格子旁邊有實心 → 最暗色
  const out = g.map((r) => r.slice());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] === null && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx] != null)) out[y][x] = 3;
  if (look.nitro && lod <= 2) { // 排氣火焰（往下噴、閃動）
    const len = Math.round((lod === 0 ? 14 : lod === 1 ? 9 : 5) + ((look.frame ?? 0) & 1) * k * 3), fw = Math.max(1, Math.round(4 * k));
    const xs = model === 'falcon' ? [X(24) - (fw >> 1)] : model === 'rhino' ? [X(11) - (fw >> 1), X(37) - (fw >> 1)] : [X(21) - (fw >> 1), X(27) - (fw >> 1)];
    const top = Y(27);
    for (let j = 0; j < len; j++) { const y = top + j; if (y >= out.length) out.push(Array(W).fill(null)); const c = j < len * 0.5 ? 0 : j < len * 0.8 ? 1 : 2; const shrink = j > len * 0.6 ? 1 : 0;
      for (const x0 of xs) for (let d = shrink; d < fw - shrink || d === shrink && d < fw; d++) out[y][x0 + d] = c; }
  }
  cache.set(key, out); return out.map((r) => r.slice());
}
/** 車身高度（不含火焰），用來對齊地面 */
export const carBodyH = (lod: number) => Math.round(DESIGN_H * (LODS[lod] - 2) / DESIGN_W) + 2;
