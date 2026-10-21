/**
 * 改裝店圖示：32×32 點陣（畫面上 2 倍顯示），只用四階綠（0 最亮 … 3 最暗）。
 * 每類一個主題、每一階明顯升級：引擎（進氣 → 渦輪 → 雙渦輪＋火）、變速箱（齒輪數）、氮氣（鋼瓶數＋火焰）、
 * 乾地胎（胎寬、輪框）、雨胎（排水溝紋、雨滴）、前／後／側裝甲（鋼板厚度、鉚釘）、塗裝（實際車身花紋）。
 */
import { G, carCanvas } from './race-gfx';
import { PAINT_LIVERIES } from './race-cars';
import type { PartKind } from '@chick/engine';

export const ICON = 48;
/** 設計格是 32×32，用 1.5 倍在 48×48 重新點陣化（不是放大），細節比較細。 */
const K = ICON / 32;
type Px = (number | null)[][];
class Pen {
  g: Px = Array.from({ length: ICON }, () => Array(ICON).fill(null));
  px(x: number, y: number, c: number) { if (x >= 0 && y >= 0 && x < ICON && y < ICON) this.g[y][x] = c; }
  /** 設計格的一點＝實際 1–2 px 的小方塊 */
  set(x: number, y: number, c: number) { const x0 = Math.round(x * K), y0 = Math.round(y * K), x1 = Math.max(x0 + 1, Math.round((x + 1) * K)), y1 = Math.max(y0 + 1, Math.round((y + 1) * K)); for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) this.px(i, j, c); }
  rect(x0: number, y0: number, x1: number, y1: number, c: number) { const a = Math.round(x0 * K), b = Math.round(y0 * K), e = Math.max(a + 1, Math.round(x1 * K)), f = Math.max(b + 1, Math.round(y1 * K)); for (let y = b; y < f; y++) for (let x = a; x < e; x++) this.px(x, y, c); }
  disc(cx: number, cy: number, r: number, c: number) { const X = (cx + 0.5) * K, Y = (cy + 0.5) * K, R = r * K + 0.35; for (let y = Math.floor(Y - R); y <= Y + R; y++) for (let x = Math.floor(X - R); x <= X + R; x++) if ((x + 0.5 - X) ** 2 + (y + 0.5 - Y) ** 2 <= R * R) this.px(x, y, c); }
  ring(cx: number, cy: number, r0: number, r1: number, c: number) { const X = (cx + 0.5) * K, Y = (cy + 0.5) * K, A = r0 * K - 0.35, B = r1 * K + 0.35; for (let y = Math.floor(Y - B); y <= Y + B; y++) for (let x = Math.floor(X - B); x <= X + B; x++) { const d = (x + 0.5 - X) ** 2 + (y + 0.5 - Y) ** 2; if (d <= B * B && d >= A * A) this.px(x, y, c); } }
  line(x0: number, y0: number, x1: number, y1: number, c: number) { const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * K * 1.5); for (let i = 0; i <= n; i++) { const x = (x0 + (x1 - x0) * i / n + 0.5) * K, y = (y0 + (y1 - y0) * i / n + 0.5) * K; this.px(Math.floor(x), Math.floor(y), c); this.px(Math.floor(x) + 1, Math.floor(y), c); } }
  /** 1px 最暗外框＋右下投影（底色是第 1 階綠，投影用第 2 階） */
  outline() {
    const o = this.g.map((r) => r.slice()), solid = (x: number, y: number) => this.g[y]?.[x] != null;
    for (let y = 0; y < ICON; y++) for (let x = 0; x < ICON; x++) if (!solid(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => solid(x + dx, y + dy) && this.g[y + dy][x + dx] !== 3)) o[y][x] = 3;
    const sh = o.map((r) => r.slice());
    for (let y = 0; y < ICON; y++) for (let x = 0; x < ICON; x++) if (o[y][x] === null && o[y - 2]?.[x - 2] != null) sh[y][x] = 2;
    this.g = sh;
  }
  /** 等級標記：右下角 L 顆亮色寶石（原廠＝一條短線） */
  pips(L: number) { if (!L) { for (let x = 36; x < 46; x++) this.px(x, 45, 3); return; } for (let i = 0; i < L; i++) { const x = 42 - i * 6; for (let j = 0; j < 5; j++) for (let k = 0; k < 5; k++) this.px(x + k, 41 + j, (j === 0 || j === 4 || k === 0 || k === 4) ? 3 : (j === 1 && k === 1) ? 0 : 1); } }
}
// ======== v9：TG2 風格的金屬零件（48px 直接畫，不經 32 格）——3/4 視角、鍍鉻明暗（亮→中→暗→反光） ========
type P = Pen;
const px = (p: P, x: number, y: number, c: number) => p.px(Math.round(x), Math.round(y), c);
const R = (p: P, x0: number, y0: number, x1: number, y1: number, c: number | ((x: number, y: number) => number)) => { for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) p.px(x, y, typeof c === 'number' ? c : c(x, y)); };
/** 鍍鉻漸層：t∈[0,1]（上→下或左→右），亮帶＋暗帶＋底部反光，交界用 2×2 混色 */
const chrome = (t: number, x: number, y: number): number => { const d = (x + y) & 1;
  return t < 0.12 ? 1 : t < 0.3 ? 0 : t < 0.38 ? (d ? 0 : 1) : t < 0.55 ? 1 : t < 0.62 ? (d ? 1 : 2) : t < 0.82 ? 2 : t < 0.9 ? (d ? 2 : 1) : 1; };
/** 3/4 方塊：正面（x0..x1, y0..y1）＋上面＋右側面，往右上退 (dx, dy) */
function box(p: P, x0: number, y0: number, x1: number, y1: number, dx: number, dy: number, front: (t: number, x: number, y: number) => number = chrome) {
  for (let k = 0; k < dy; k++) { const o = Math.round(k * dx / dy); R(p, x0 + o + 1, y0 - k - 1, x1 + o + 1, y0 - k, k === dy - 1 ? 1 : (k & 1) ? 0 : 1); } // 上面（亮）
  for (let x = 0; x < dx; x++) { const o = Math.round(x * dy / dx); R(p, x1 + x, y0 - o, x1 + x + 1, y1 - o, (xx, yy) => ((xx + yy) & 1) && x > dx / 2 ? 3 : 2); } // 側面（暗）
  R(p, x0, y0, x1, y1, (x, y) => front((y - y0) / (y1 - y0), x, y));
}
/** 直立圓柱的明暗（左→右）：輪胎、鋼瓶 */
const cylC = (u: number, x: number, y: number) => { const d = (x + y) & 1; return u < 0.08 ? 3 : u < 0.2 ? 2 : u < 0.3 ? (d ? 1 : 2) : u < 0.42 ? 0 : u < 0.5 ? (d ? 0 : 1) : u < 0.7 ? 1 : u < 0.8 ? (d ? 1 : 2) : u < 0.93 ? 2 : 3; };
function disc(p: P, cx: number, cy: number, r: number, f: (dx: number, dy: number, d: number) => number | null) { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) { const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy); if (d <= r) { const c = f(dx, dy, d / r); if (c !== null) p.px(x, y, c); } } }
/** 皮帶輪／齒輪：外圈亮暗分兩半、中心螺帽 */
function pulley(p: P, cx: number, cy: number, r: number, teeth = 0) {
  disc(p, cx, cy, r + (teeth ? 1.2 : 0), (dx, dy, d) => { if (teeth && d * (r + 1.2) > r) { const a = Math.atan2(dy, dx); return Math.cos(a * teeth) > 0.1 ? (dx + dy < 0 ? 1 : 2) : null; } return d > 0.78 ? (dx + dy < 0 ? 0 : 2) : d > 0.62 ? 3 : d > 0.3 ? (dx + dy < 0 ? 1 : 2) : d > 0.18 ? 3 : 0; });
}
/** 螺栓（TG2 的紅黃螺栓，四階綠用最亮＋最暗框） */
const bolt = (p: P, x: number, y: number, h = 5) => { R(p, x - 1, y, x + 2, y + h, 3); R(p, x, y + 1, x + 1, y + h - 1, 0); };

function engine(p: P, L: number) {
  const big = L >= 2, x0 = 10 - L, x1 = 31 + L, y0 = 24, y1 = 36;
  box(p, x0, y0, x1, y1, 7, 5);                                            // 缸體
  for (let x = x0 + 2; x < x1 - 1; x += 3) R(p, x, y0 + 2, x + 1, y1 - 2, 3); // 缸體散熱鰭
  R(p, x0 + 2, y1, x1 - 2, y1 + 3, (x, y) => ((x + y) & 1 ? 2 : 3));        // 油底殼
  // 汽缸蓋（V 型：兩排）
  const heads = big ? 2 : 1;
  for (let h = 0; h < heads; h++) { const hx = x0 + 2 + h * 5, hy = y0 - 6 - h * 3; box(p, hx, hy, x1 - 3 + h * 2, hy + 5, 4, 3, (t, x, y) => (x % 3 === 0 ? 3 : chrome(t, x, y))); }
  // 進氣歧管（一排進氣管）
  const n = 4 + L * 2, top = big ? y0 - 14 : y0 - 10;
  for (let i = 0; i < n; i++) { const x = x0 + 3 + i * ((x1 - x0 - 4) / n); R(p, x, top, x + 2, top + 5, (xx) => xx === Math.round(x) ? 0 : 2); px(p, x, top - 1, 3); }
  if (L >= 1) { box(p, x0 + 6, top - 5, x1 - 6, top, 4, 2); }              // 進氣集氣室
  if (L >= 3) { box(p, x0 + 9, top - 11, x1 - 9, top - 5, 3, 2, (t, x, y) => (x & 1 ? chrome(t, x, y) : 2)); R(p, x0 + 12, top - 15, x1 - 12, top - 11, (x) => (x & 1 ? 0 : 1)); } // 機械增壓＋進氣口
  pulley(p, x0 + 2, y0 + 6, 4.5); pulley(p, x0 + 3, y0 - 2 - (big ? 3 : 0), 2.8);     // 曲軸／發電機皮帶輪
  for (let y = y0 - 1 - (big ? 3 : 0); y < y0 + 4; y++) { px(p, x0 - 2, y, 3); px(p, x0 + 5, y, 3); } // 皮帶
  if (L >= 2) pulley(p, x1 + 4, y0 + 3, 3);                                 // 水泵
}
function gearbox(p: P, L: number) {
  const w = 18 + L * 3, x0 = 14 - L, y0 = 22, y1 = 36;
  box(p, x0, y0, x0 + w, y1, 6, 4);                                          // 變速箱殼
  // 正面格柵（越高階越細）
  const step = L >= 2 ? 2 : 3; for (let x = x0 + 3; x < x0 + w - 2; x += step) R(p, x, y0 + 3, x + 1, y1 - 2, 3);
  if (L === 0) { for (let i = 0; i < 8; i++) { px(p, x0 + 4 + i * 1.5, y0 + 4 + i, 3); px(p, x0 + w - 4 - i * 1.5, y0 + 4 + i, 3); } } // 交叉補強
  pulley(p, x0 - 1, y0 + 3, 4.5 + (L >= 2 ? 0.8 : 0), 8);                     // 主齒輪
  if (L >= 1) pulley(p, x0 + 2, y0 - 4, 3, 6);                               // 第二顆齒輪
  if (L >= 2) R(p, x0 + w + 2, y0 + 2, x0 + w + 9, y0 + 4, (x) => (x & 1 ? 0 : 1)); // 輸出軸
  R(p, x0 + w / 2, y0 - 10 - L, x0 + w / 2 + 2, y0 - 3, (x, y) => (x === Math.round(x0 + w / 2) ? 0 : 2)); // 排檔桿
  R(p, x0 + w / 2 - 3, y0 - 12 - L, x0 + w / 2 + 5, y0 - 9 - L, (x, y) => (y === Math.round(y0 - 12 - L) ? 0 : 1)); // 排檔頭（T 字）
  if (L >= 3) { R(p, x0 + w - 6, y0 - 8, x0 + w + 6, y0 - 7, 3); R(p, x0 + w - 6, y0 - 7, x0 + w + 6, y0 - 6, 0); } // 序列式拉桿
}
function nitro(p: P, L: number) {
  const tall = L >= 2;
  // 鋼瓶（橫放在後面）
  const by0 = tall ? 16 : 20, bx0 = 12, bx1 = 34;
  for (let y = by0; y < by0 + 9; y++) for (let x = bx0; x < bx1; x++) p.px(x, y, cylC((y - by0) / 9, x, y));
  disc(p, bx0, by0 + 4.5, 4.5, (dx, dy, d) => (d > 0.7 ? 3 : dx + dy < 0 ? 0 : 1));             // 瓶口
  R(p, bx0 - 6, by0 + 3, bx0 - 2, by0 + 6, 2); px(p, bx0 - 7, by0 + 4, 0);                        // 閥
  // 控制盒（前面）
  const cx0 = 16, cy0 = by0 + 7, cx1 = 34 + L, cy1 = 37;
  box(p, cx0, cy0, cx1, cy1, 5, 3);
  if (!tall) { R(p, cx1 - 10, cy0 + 2, cx1 - 2, cy0 + 8, 3); R(p, cx1 - 9, cy0 + 3, cx1 - 3, cy0 + 7, (x) => ((x & 1) ? 0 : 1)); }  // 數位儀表（亮）
  else { for (let x = cx0 + 2; x < cx1 - 2; x += 2) R(p, x, cy0 + 2, x + 1, cy1 - 2, 3); R(p, cx0 + 2, cy0 + 5, cx1 - 2, cy0 + 6, 3); } // 散熱格柵
  if (L === 1) { R(p, cx0 + 1, cy0 + 9, cx1 - 12, cy1 - 1, 0); }                                     // 亮面板
  if (tall) for (let i = 0; i < L; i++) { R(p, cx1 + 5, cy0 + 3 + i * 4, cx1 + 9, cy0 + 4 + i * 4, 0); R(p, cx1 + 10, cy0 + 3 + i * 4, cx1 + 12, cy0 + 4 + i * 4, 1); } // 噴射線
}
/** 輪胎（正面看，像 TG2：直立圓柱＋胎面花紋） */
function tyreFront(p: P, w: number, tread: (u: number, v: number, x: number, y: number) => boolean) {
  const x0 = Math.round(24 - w / 2), x1 = x0 + w, y0 = 12, y1 = 38;
  for (let y = y0; y < y1; y++) { const v = (y - y0) / (y1 - y0), edge = y === y0 || y === y1 - 1 ? 2 : y === y0 + 1 || y === y1 - 2 ? 1 : 0;
    for (let x = x0 + edge; x < x1 - edge; x++) { const u = (x - x0) / w; let c = cylC(u, x, y); if (tread(u, v, x, y)) c = Math.min(3, c + 2); p.px(x, y, c); } }
}
function dry(p: P, L: number) {
  const w = 14 + L * 2;
  tyreFront(p, w, (u, v, x, y) => {
    if (L === 0) return false;                                                   // 光頭胎
    if (L === 1) return Math.abs(u - 0.33) < 0.04 || Math.abs(u - 0.67) < 0.04;    // 2 條溝
    if (L === 2) return Math.abs(u - 0.25) < 0.035 || Math.abs(u - 0.5) < 0.035 || Math.abs(u - 0.75) < 0.035 || (v > 0.55 && (y % 4 === 0) && u > 0.2 && u < 0.8);
    return Math.abs(u - 0.33) < 0.04 || Math.abs(u - 0.67) < 0.04 || (y % 4 === 0 && u > 0.12 && u < 0.88) || (v > 0.5 && (x + (y >> 2)) % 5 === 0); // 塊狀胎紋
  });
}
function wet(p: P, L: number) {
  const w = 14 + L * 2;
  tyreFront(p, w, (u, v, x, y) => {
    const ribs = 3 + L; const k = u * ribs; const groove = Math.abs(k - Math.round(k)) < 0.16 && u > 0.1 && u < 0.9;
    if (L === 0) return groove;
    if (L === 1) return groove || ((y + Math.round(u * 8)) % 5 === 0 && u > 0.15 && u < 0.85);
    if (L === 2) return groove || (Math.round(y - Math.abs(u - 0.5) * 18) % 4 === 0 && u > 0.12 && u < 0.88); // V 形排水
    return (Math.round(y - Math.abs(u - 0.5) * 22) % 3 === 0 && u > 0.1 && u < 0.9) || (groove && (y & 2) > 0);
  });
}
/** 橫桿（側／後裝甲）：圓管明暗 */
function bar(p: P, x0: number, x1: number, y: number, h: number) { for (let j = 0; j < h; j++) R(p, x0, y + j, x1, y + j + 1, (x, yy) => chrome(j / h, x, yy)); R(p, x1, y, x1 + 1, y + h, 2); }
function armorS(p: P, L: number) {
  const len = 22 + L * 4, x0 = 24 - len / 2, h = 3 + (L >= 2 ? 1 : 0);
  bar(p, x0, x0 + len, 20, h); R(p, x0 + 1, 20 + h, x0 + 3, 30, 2); px(p, x0 + 1, 21 + h, 0); // 支架
  if (L >= 1) R(p, x0 + len - 4, 20 + h, x0 + len - 2, 28, 2);
  if (L >= 3) { bar(p, x0 - 2, x0 + len + 2, 27, 4); R(p, x0 - 3, 27, x0 - 1, 31, 1); }    // 雙桿＋端蓋
  if (L >= 2) for (const f of [0.25, 0.75]) { bolt(p, x0 + len * f, 19, h + 2); if (L >= 3) bolt(p, x0 + len * f, 26, 6); }
}
function armorR(p: P, L: number) {
  const len = 22 + L * 3, x0 = 22 - len / 2, h = 3 + (L >= 2 ? 1 : 0);
  bar(p, x0, x0 + len, 20, h);
  R(p, x0 + len, 17, x0 + len + 3, 30, (x, y) => (x === Math.round(x0 + len) ? 0 : 2)); R(p, x0 + len - 2, 28, x0 + len + 3, 30, 1); // 後掛鉤（直角支架）
  if (L >= 3) { bar(p, x0, x0 + len, 26, 4); R(p, x0 - 3, 19, x0, 31, (x, y) => (y & 1 ? 0 : 1)); }
  if (L >= 2) for (const f of [0.1, 0.9]) { bolt(p, x0 + len * f, 19, h + 2); if (L >= 3) bolt(p, x0 + len * f, 25, 6); }
}
function armorF(p: P, L: number) {
  // 前保險桿彎管（3/4 視角的 U 形管＋固定腳）；越高階越大、越多圈
  const s = 1 + L * 0.22, cx = 22, cy = 25;
  const tube = (r: number, th: number) => disc(p, cx, cy, r * s, (dx, dy, d) => { if (dx > 1) return null; return d > 1 - th / (r * s) ? (dy < 0 ? (dx < -r * s * 0.5 ? 0 : 1) : 2) : null; });
  tube(8, 3); if (L >= 2) tube(5, 2);
  R(p, cx, cy - 8 * s, cx + 10 * s, cy - 8 * s + 3, (x, y) => chrome((y - (cy - 8 * s)) / 3, x, y));   // 上管往後延伸
  R(p, cx, cy + 8 * s - 3, cx + 10 * s, cy + 8 * s, (x, y) => chrome((y - (cy + 8 * s - 3)) / 3, x, y)); // 下管
  for (const fx of [cx + 4 * s, cx + 8 * s]) R(p, fx, cy + 8 * s, fx + 2, cy + 8 * s + 4, 2);              // 固定腳
  if (L >= 1) R(p, cx - 2, cy - 2, cx + 6 * s, cy + 1, (x, y) => chrome((y - cy + 2) / 3, x, y));          // 中間橫撐
  if (L >= 3) { bolt(p, cx + 3, cy - 9 * s, 4); bolt(p, cx + 3, cy + 6 * s, 4); }
}
const DRAW: Record<PartKind, (p: Pen, L: number) => void> = {
  engine, gearbox, nitro, dry, wet, armorF, armorR, armorS,
};
const cache = new Map<string, HTMLCanvasElement>();
function toCanvas(g: Px) { const c = document.createElement('canvas'); c.width = c.height = ICON; const x = c.getContext('2d')!; for (let y = 0; y < ICON; y++) for (let i = 0; i < ICON; i++) { const v = g[y][i]; if (v !== null) { x.fillStyle = G[v]; x.fillRect(i, y, 1, 1); } } return c; }
/** 零件圖示（透明底）。 */
export function partIcon(kind: PartKind, level: number): HTMLCanvasElement {
  const k = `${kind}:${level}`; const hit = cache.get(k); if (hit) return hit;
  const p = new Pen(); DRAW[kind](p, level); p.outline();
  const c = toCanvas(p.g); cache.set(k, c); return c;
}
/** 塗裝圖示：上方一道油漆刷痕（實際花紋＋深淺），下方是這個塗裝的車（48px 車尾）。 */
export function paintIcon(i: number): HTMLCanvasElement {
  const k = `paint:${i}`; const hit = cache.get(k); if (hit) return hit;
  const lv = PAINT_LIVERIES[i % PAINT_LIVERIES.length];
  const p = new Pen();
  for (let y = 0; y < 15; y++) for (let x = 0; x < ICON; x++) {               // 刷痕：左右兩端鋸齒、中間花紋
    const edge = 3 + Math.round(2 * Math.sin(y * 1.7)), top = y < 2 || y > 12;
    if (x < edge || x >= ICON - edge + (y % 3) - 1 || (top && (x + y * 3) % 5 === 0)) continue;
    const pat = lv.pat === 'stripe' ? (Math.abs(x + 0.5 - ICON / 2) >= 2 && Math.abs(x + 0.5 - ICON / 2) <= 5 ? lv.accent : lv.body)
      : lv.pat === 'dither' ? ((x + y) & 1 ? lv.accent : lv.body) : lv.pat === 'band' ? ((x + y) % 6 < 2 ? lv.accent : lv.body) : (y === 3 ? lv.accent : lv.body);
    p.px(x, y + 2, pat);
  }
  for (let j = 0; j < 4; j++) p.px(8 + j * 9, 17 + (j & 1), lv.body);          // 滴下來的漆
  p.outline();
  const c = toCanvas(p.g), x = c.getContext('2d')!; x.imageSmoothingEnabled = false;
  const car = carCanvas('falcon', i, {}, 0);
  x.drawImage(car, 0, ICON - (car as any).bodyH);
  cache.set(k, c); return c;
}
