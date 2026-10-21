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
function engine(p: Pen, L: number) {
  p.rect(5, 13, 22, 26, 2); p.rect(5, 13, 22, 14, 1); p.rect(5, 25, 22, 26, 3);           // 缸體
  for (let x = 7; x < 21; x += 3) p.rect(x, 15, x + 1, 24, 3);                              // 散熱鰭
  p.rect(7, 8, 20, 13, L >= 1 ? 1 : 2); for (let x = 8; x < 20; x += 2) p.rect(x, 9, x + 1, 12, L >= 1 ? 0 : 1); // 汽缸蓋
  p.rect(8, 26, 19, 29, 3); p.disc(5, 20, 3, 1); p.disc(5, 20, 1, 3);                       // 油底殼、皮帶輪
  if (L >= 1) { p.rect(12, 3, 15, 8, 2); p.disc(13.5, 3, 3, 1); p.ring(13.5, 3, 2, 3, 2); p.set(13, 3, 0); } // 進氣＋空濾
  if (L >= 2) { p.rect(21, 15, 24, 18, 2); p.disc(26, 16.5, 4.5, 1); p.ring(26, 16.5, 3.5, 4.5, 2); p.disc(26, 16.5, 1.5, 3); p.line(26, 12, 29, 15, 0); } // 渦輪（蝸殼）
  if (L >= 3) {
    p.rect(21, 8, 24, 11, 2); p.disc(26, 8.5, 3.5, 1); p.ring(26, 8.5, 2.5, 3.5, 2); p.disc(26, 8.5, 1, 3);  // 第二顆渦輪
    p.line(9, 19, 13, 15, 0); p.line(13, 15, 12, 19, 0); p.line(12, 19, 16, 22, 0);                          // 閃電
    for (let i = 0; i < 4; i++) p.rect(23 + i, 23 + (i & 1), 24 + i, 24 + (i & 1), 0);                         // 尾焰火花
  }
}
function gear(p: Pen, cx: number, cy: number, r: number, teeth: number, c: number) {
  p.disc(cx, cy, r, c);
  for (let i = 0; i < teeth; i++) { const a = (i / teeth) * Math.PI * 2; p.disc(cx + Math.cos(a) * (r + 1), cy + Math.sin(a) * (r + 1), 1.1, c); }
  p.ring(cx, cy, r - 2, r - 1.2, c === 1 ? 2 : 1); p.disc(cx, cy, Math.max(1, r / 3), 3); p.set(cx - 1, cy - 1, 0);
}
function gearbox(p: Pen, L: number) {
  const G4: [number, number, number, number, number][] = [[12, 18, 8, 12, 1], [24, 10, 5, 9, 2], [24, 24, 4.5, 8, 1], [6, 7, 3.5, 7, 2]];
  for (let i = 0; i <= L; i++) gear(p, ...G4[i]);
  if (L >= 3) { p.rect(27, 15, 29, 21, 2); p.disc(28, 14, 2.5, 0); p.ring(28, 14, 1.6, 2.5, 1); }   // 序列式排檔桿
}
function nitro(p: Pen, L: number) {
  const n = L + 1, w = 5, gap = 2, x0 = Math.round((32 - (n * w + (n - 1) * gap)) / 2);
  for (let i = 0; i < n; i++) {
    const x = x0 + i * (w + gap);
    p.rect(x, 12, x + w, 28, 1); p.rect(x + 1, 13, x + 2, 27, 0); p.rect(x + w - 1, 13, x + w, 28, 2);   // 鋼瓶＋高光＋陰影
    p.rect(x, 18, x + w, 20, 3); p.set(x + 2, 19, 0);                                                       // 標籤帶
    p.rect(x + 1, 9, x + w - 1, 12, 2); p.rect(x + 2, 7, x + 3, 9, 3);                                     // 瓶頸、閥
    const fl = 1 + L * 1.6;                                                                                  // 火焰（往上）
    for (let k = 0; k < fl; k++) { const y = 6 - k; p.rect(x + 1 + (k > fl * 0.6 ? 1 : 0), y, x + w - 1 - (k > fl * 0.6 ? 1 : 0), y + 1, k < fl * 0.4 ? 0 : k < fl * 0.8 ? 1 : 2); }
  }
  if (L >= 2) p.rect(x0 - 1, 22, x0 + n * (w + gap) - 1, 23, 3);                                           // 高壓管路
}
/** 輪胎（正面看）：w 胎寬，grooves(x,y) 回傳是否是溝紋 */
function tyre(p: Pen, w: number, groove: (x: number, y: number) => boolean) {
  const x0 = 16 - w / 2, x1 = 16 + w / 2;
  const R = 3.5; // 胎肩圓角
  for (let y = 3; y < 29; y++) { const d = Math.min(y - 3, 28 - y), inset = d < R ? Math.round(R - Math.sqrt(R * R - (R - d - 0.5) ** 2)) : 0;
    for (let x = Math.ceil(x0) + inset; x < x1 - inset; x++) p.set(x, y, groove(x - x0, y) ? 3 : (x - x0 > w - 2.5 ? 3 : 2)); }
  for (let y = 6; y < 26; y++) p.set(Math.ceil(x0) + 1, y, 1);                                               // 高光
  p.rect(Math.ceil(x0) + 2, 4, Math.ceil(x0) + 4, 5, 1);
}
function dry(p: Pen, L: number) {
  const w = 10 + L * 3;
  tyre(p, w, (x, y) => (L === 0 ? (Math.round(x) === Math.round(w / 2) || ((y >> 1) % 2 === 0 && (Math.round(x) === 2 || Math.round(x) === Math.round(w) - 2))) : L < 3 && (Math.round(x) === Math.round(w / 3) || Math.round(x) === Math.round((2 * w) / 3))));
  if (L >= 2) { p.rect(16 - w / 2 - 1, 15, 16 - w / 2, 18, 1); p.rect(16 + w / 2, 15, 16 + w / 2 + 1, 18, 1); } // 胎側字樣
  if (L >= 3) { p.line(26, 3, 26, 7, 0); p.line(24, 5, 28, 5, 0); p.set(5, 25, 0); p.set(4, 25, 1); p.set(6, 25, 1); } // 光頭胎閃光
}
function wet(p: Pen, L: number) {
  const w = 12 + L * 2, step = Math.max(2, 5 - L);
  tyre(p, w, (x, y) => { const cx = Math.abs(x - w / 2); return (Math.round(y + cx * 0.8) % step === 0 && cx > 1) || (L >= 2 && Math.round(cx) === 0); });
  const drops: [number, number][] = [[3, 5], [28, 9], [4, 20], [28, 24]];
  for (let i = 0; i < L + 1 && i < drops.length; i++) { const [x, y] = drops[i]; p.set(x, y - 2, 1); p.rect(x - 1, y - 1, x + 2, y + 2, 1); p.set(x - 1, y - 1, 0); }
}
const rivets = (p: Pen, x0: number, x1: number, y: number, n: number) => { for (let i = 0; i < n; i++) p.set(x0 + ((x1 - x0) * (i + 0.5)) / n, y, 3); };
function carFront(p: Pen, rear: boolean) {
  p.rect(9, 8, 23, 14, 2); p.rect(10, 9, 22, 13, rear ? 3 : 3); p.rect(11, 9, 14, 10, 1);   // 車頂＋擋風玻璃
  p.rect(4, 14, 28, 24, 2); p.rect(4, 14, 28, 15, 1);                                         // 車身
  p.rect(5, 24, 10, 28, 3); p.rect(22, 24, 27, 28, 3);                                        // 輪胎
  if (rear) { p.rect(5, 16, 10, 18, 3); p.rect(6, 16, 9, 17, 1); p.rect(22, 16, 27, 18, 3); p.rect(23, 16, 26, 17, 1); p.rect(13, 17, 19, 20, 1); }
  else { p.rect(5, 16, 10, 19, 0); p.rect(22, 16, 27, 19, 0); p.rect(12, 18, 20, 21, 3); for (let x = 13; x < 20; x += 2) p.set(x, 19, 2); }
}
function armorFR(p: Pen, L: number, rear: boolean) {
  carFront(p, rear);
  if (!L) return;
  const t = 1 + L * 1.5, y0 = Math.round(24 - t);                                             // 保桿鋼板
  p.rect(2, y0, 30, 25, 1); p.rect(2, y0, 30, y0 + 1, 0); p.rect(2, 24, 30, 25, 3);
  rivets(p, 2, 30, y0 + Math.floor(t / 2), 2 + L * 2);
  if (L >= 2) { p.rect(3, 13, 5, y0, 1); p.rect(27, 13, 29, y0, 1); }                         // 防撞桿
  if (L >= 3) { p.rect(13, 3, 19, 8, 1); p.rect(14, 4, 18, 7, 0); p.rect(15, 5, 17, 7, 2); p.set(16, 7, 2); } // 盾牌徽章
}
function armorS(p: Pen, L: number) {
  p.rect(9, 9, 21, 15, 2); p.rect(10, 10, 15, 14, 3); p.rect(16, 10, 20, 14, 3); p.rect(10, 10, 12, 11, 1);
  p.rect(2, 15, 30, 23, 2); p.rect(2, 15, 30, 16, 1); p.rect(2, 22, 30, 23, 3);
  p.disc(8, 23.5, 4, 3); p.disc(8, 23.5, 1.8, 1); p.disc(24, 23.5, 4, 3); p.disc(24, 23.5, 1.8, 1);
  if (!L) return;
  const h = 1 + L * 1.6, y0 = Math.round(21 - h);
  p.rect(12, y0, 20, 22, 1); p.rect(12, y0, 20, y0 + 1, 0); rivets(p, 12, 20, y0 + Math.ceil(h / 2), 1 + L);
  if (L >= 2) { p.rect(3, 19, 13, 21, 1); p.rect(19, 19, 29, 21, 1); }                         // 延伸側裙
  if (L >= 3) { p.line(10, 9, 15, 15, 3); p.line(20, 9, 15, 15, 3); p.rect(2, 16, 30, 17, 0); } // 防滾籠
}
const DRAW: Record<PartKind, (p: Pen, L: number) => void> = {
  engine, gearbox, nitro, dry, wet, armorF: (p, L) => armorFR(p, L, false), armorR: (p, L) => armorFR(p, L, true), armorS,
};
const cache = new Map<string, HTMLCanvasElement>();
function toCanvas(g: Px) { const c = document.createElement('canvas'); c.width = c.height = ICON; const x = c.getContext('2d')!; for (let y = 0; y < ICON; y++) for (let i = 0; i < ICON; i++) { const v = g[y][i]; if (v !== null) { x.fillStyle = G[v]; x.fillRect(i, y, 1, 1); } } return c; }
/** 零件圖示（透明底）。 */
export function partIcon(kind: PartKind, level: number): HTMLCanvasElement {
  const k = `${kind}:${level}`; const hit = cache.get(k); if (hit) return hit;
  const p = new Pen(); DRAW[kind](p, level); p.outline(); p.pips(level);
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
