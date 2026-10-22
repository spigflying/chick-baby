/** 狀態頁「目前極速」數字的三種預覽樣式（四色綠像素）。A：粗 7 段顯示器；B：斜體賽車數字＋速度線；C：弧形指針錶＋大數字。 */
import { G } from './race-gfx';

export type SpeedFont = 'A' | 'B' | 'C';
export function speedFont(): SpeedFont {
  const q = new URLSearchParams(location.search).get('sf') ?? localStorage.getItem('chick.speedFont');
  return q === 'B' || q === 'C' ? q : 'A';
}
// 5×7 點陣數字
const F7: Record<string, string[]> = {
  '0': ['01110', '11011', '11011', '11011', '11011', '11011', '01110'], '1': ['00110', '01110', '00110', '00110', '00110', '00110', '01111'],
  '2': ['01110', '11011', '00011', '00110', '01100', '11000', '11111'], '3': ['11110', '00011', '00011', '01110', '00011', '00011', '11110'],
  '4': ['00110', '01110', '11010', '11010', '11111', '00010', '00010'], '5': ['11111', '11000', '11110', '00011', '00011', '11011', '01110'],
  '6': ['01110', '11000', '11110', '11011', '11011', '11011', '01110'], '7': ['11111', '00011', '00110', '00110', '01100', '01100', '01100'],
  '8': ['01110', '11011', '11011', '01110', '11011', '11011', '01110'], '9': ['01110', '11011', '11011', '01111', '00011', '00011', '01110'],
};
// 3×5 小字（km/h）
const F5: Record<string, string[]> = { k: ['100', '101', '110', '101', '101'], m: ['000', '110', '111', '101', '101'], '/': ['001', '001', '010', '100', '100'], h: ['100', '100', '110', '101', '101'] };
function small(x: CanvasRenderingContext2D, s: string, px: number, py: number, c: string, sc = 1) {
  x.fillStyle = c; let cx = px;
  for (const ch of s) { const g = F5[ch]; g.forEach((row, j) => [...row].forEach((b, i) => { if (b === '1') x.fillRect(cx + i * sc, py + j * sc, sc, sc); })); cx += (ch === 'm' ? 4 : 4) * sc; }
}
const smallW = (s: string, sc = 1) => s.length * 4 * sc - sc;
function mk(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')!; return { c, x }; }

/** A：粗 7 段（每段 3px 厚），亮段最深綠，不畫暗段（避免 0 看起來像 8）。 */
function segA(n: string) {
  const W = 14, H = 24, T = 3, gap = 3, pad = 4, unitW = smallW('km/h', 2);
  const { c, x } = mk(pad * 2 + n.length * (W + gap) - gap + 4 + unitW, H + pad * 2);
  x.fillStyle = G[0]; x.fillRect(0, 0, c.width, c.height); x.fillStyle = G[3]; x.fillRect(0, 0, c.width, 1); x.fillRect(0, c.height - 1, c.width, 1); x.fillRect(0, 0, 1, c.height); x.fillRect(c.width - 1, 0, 1, c.height);
  const SEG: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg' };
  const h2 = Math.floor(H / 2);
  const seg = (ox: number, s: string) => {
    const r: Record<string, [number, number, number, number]> = { a: [1, 0, W - 2, T], g: [1, h2 - 1, W - 2, T], d: [1, H - T, W - 2, T], f: [0, 1, T, h2 - 1], b: [W - T, 1, T, h2 - 1], e: [0, h2 + 1, T, h2 - 2], c: [W - T, h2 + 1, T, h2 - 2] };
    return r[s].map((v, i) => v + (i === 0 ? ox : i === 1 ? pad : 0)) as [number, number, number, number];
  };
  [...n].forEach((d, i) => { const ox = pad + i * (W + gap); for (const s of 'abcdefg') { const [a, b, w, h] = seg(ox, s); if (!SEG[d].includes(s)) continue; x.fillStyle = G[3]; x.fillRect(a, b, w, h); } });
  small(x, 'km/h', c.width - pad - unitW, c.height - pad - 10, G[2], 2);
  return c;
}
/** B：5×7 數字放大 3 倍、每列往右錯開做斜體，加陰影與左側速度線。 */
function italB(n: string) {
  const S = 3, cw = 6 * S, slant = 7, lead = 22, unitW = smallW('km/h', 2);
  const { c, x } = mk(lead + n.length * cw + slant + 6 + unitW + 4, 7 * S + 8);
  const draw = (col: string, dx: number, dy: number) => [...n].forEach((d, k) => F7[d].forEach((row, j) => [...row].forEach((b, i) => {
    if (b !== '1') return; x.fillStyle = col; x.fillRect(lead + k * cw + i * S + Math.round((6 - j) * slant / 6) + dx, 2 + j * S + dy, S, S); })));
  x.fillStyle = G[2]; [[3, 14], [7, 10], [12, 18], [16, 8], [20, 12]].forEach(([y, w]) => x.fillRect(lead - 4 - w, y, w, 2));
  draw(G[2], 2, 2); draw(G[3], 0, 0);
  small(x, 'km/h', c.width - unitW - 2, c.height - 12, G[3], 2);
  return c;
}
/** C：上半圓弧形錶（0～最高刻度），指針指到目前極速，下方大數字。 */
function gaugeC(v: number, n: string) {
  const R = 30, W = 2 * R + 12, S = 2, numW = n.length * 6 * S;
  const { c, x } = mk(Math.max(W, numW + 4), R + 8 + 7 * S + 12);
  const cx = Math.floor(c.width / 2), cy = R + 4, max = Math.max(200, Math.ceil(v / 100) * 100 + 100);
  for (let a = 0; a <= 180; a += 1) { const t = Math.PI * (1 - a / 180); for (let r = R - 3; r <= R; r++) { x.fillStyle = a / 180 <= v / max ? G[3] : G[1]; x.fillRect(Math.round(cx + Math.cos(t) * r), Math.round(cy - Math.sin(t) * r), 1, 1); } }
  for (let k = 0; k <= 10; k++) { const t = Math.PI * (1 - k / 10); for (let r = R - 7; r <= R - 5; r++) { x.fillStyle = G[2]; x.fillRect(Math.round(cx + Math.cos(t) * r), Math.round(cy - Math.sin(t) * r), 1, 1); } }
  const t = Math.PI * (1 - Math.min(1, v / max)); for (let r = 0; r <= R - 6; r++) { x.fillStyle = G[3]; x.fillRect(Math.round(cx + Math.cos(t) * r), Math.round(cy - Math.sin(t) * r), 2, 2); }
  x.fillStyle = G[3]; x.fillRect(cx - 2, cy - 2, 5, 5);
  const ox = cx - Math.floor(numW / 2), oy = cy + 5;
  [...n].forEach((d, k) => F7[d].forEach((row, j) => [...row].forEach((b, i) => { if (b === '1') { x.fillStyle = G[3]; x.fillRect(ox + k * 6 * S + i * S, oy + j * S, S, S); } })));
  small(x, 'km/h', cx - Math.floor(smallW('km/h') / 2), c.height - 6, G[2]);
  return c;
}
export function speedCanvas(v: number, f: SpeedFont = speedFont()): HTMLCanvasElement {
  const n = String(Math.max(0, Math.round(v)));
  return f === 'A' ? segA(n) : f === 'B' ? italB(n) : gaugeC(v, n);
}
