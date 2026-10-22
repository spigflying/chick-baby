/** 狀態頁「目前極速」數字：粗 7 段顯示器（四色綠像素），內含 km/h。 */
import { G } from './race-gfx';

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
export function speedCanvas(v: number): HTMLCanvasElement { return segA(String(Math.max(0, Math.round(v)))); }
