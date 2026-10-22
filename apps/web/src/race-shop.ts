/**
 * 改裝店畫面（畫布內，原生 240×200，四階綠）：TG2 的版面——左邊大號斜體類別數字、上方標題牌、
 * 後面大框裡是自己的車（側面）、左框＝目前裝的零件、右邊 2×2 四格（原廠＋1/2/3 階）與價錢、左下金幣。
 * 共 9 個畫面：8 類零件＋塗裝（8 色，背景的車即時換色預覽）。全部原創圖。
 */
import { PARTS, PART_KINDS, PAINT_NAMES, CARS, type PartKind } from '@chick/engine';
import { G, W, H, text, textW, zh, zhW } from './race-gfx';
import { partIcon, paintIcon, ICON } from './race-icons';
import { PAINT_LIVERIES } from './race-cars';
import { sideCanvas, SIDE_W, SIDE_H } from './race-side';

export const SHOP_SCREENS = PART_KINDS.length + 1; // 8 類＋塗裝
export const isPaint = (cat: number) => cat === PART_KINDS.length;
export interface ShopUI { cat: number; cur: number; confirm: boolean; note: string; noteT: number }
export const newShop = (): ShopUI => ({ cat: 0, cur: -1, confirm: false, note: '', noteT: 0 });

// ---- 版面 ----
const PANEL = { x: 54, y: 26, w: 182, h: 112 };
const BIG = { x: 60, y: 32, s: 58 };
const TILE = 52;
const GRID = [[128, 28], [183, 28], [128, 96], [183, 96]] as const;
const SW = 25, SWH = 24; // 塗裝色票
const paintCell = (i: number) => [128 + (i % 4) * 27, 32 + Math.floor(i / 4) * 46] as const;

/** 大號斜體數字（像鍍鉻牌）：用 5×7 字型，每格 7×15 px，往右上傾斜，斜向條紋漸層。 */
const DIGITS: Record<string, string> = {
  '1': '00100011000010000100001000010001110', '2': '01110100010000100010001000100011111', '3': '11111000100010000010000011000101110',
  '4': '00010001100101010010111110001000010', '5': '11111100001111000001000011000101110', '6': '00110010001000011110100011000101110',
  '7': '11111000010001000100010000100001000', '8': '01110100011000101110100011000101110', '9': '01110100011000101111000010001001100',
};
export function bigDigit(x: CanvasRenderingContext2D, n: number, ox: number, oy: number) {
  const f = DIGITS[String(n)], cw = 6, ch = 15;
  const bit = (c: number, r: number) => c >= 0 && c < 5 && r >= 0 && r < 7 && f[r * 5 + c] === '1';
  const on = (c: number, r: number) => bit(c, r) || bit(c - 1, r); // 粗體：每一筆往右加粗一格
  for (let py = 0; py < 7 * ch; py++) for (let px = -2; px < 6 * cw + 14; px++) {
    const sx = px - Math.round((7 * ch - py) * 0.12); const c = Math.floor(sx / cw), r = Math.floor(py / ch);
    if (!on(c, r)) continue;
    const edge = !on(Math.floor((sx - 1) / cw), r) || !on(Math.floor((sx + 1) / cw), r) || !on(c, Math.floor((py - 1) / ch)) || !on(c, Math.floor((py + 1) / ch));
    const band = (px * 1.4 - py * 0.5 + 800) % 46, dith = (px + py) & 1; // 斜向鍍鉻反光（大色帶＋交界混色）
    x.fillStyle = G[edge ? 2 : band < 18 ? 0 : band < 22 ? (dith ? 0 : 1) : band < 36 ? 1 : band < 39 ? (dith ? 1 : 2) : band < 43 ? 2 : (dith ? 2 : 0)]; x.fillRect(ox + px, oy + py, 1, 1);
  }
}
/** 大號鍍鉻「1」：粗斜柱＋左上旗角，斜向亮暗條紋（原創造型） */
function bigOne(x: CanvasRenderingContext2D) {
  const polys: [number, number][][] = [[[24, 10], [48, 10], [36, 132], [12, 132]], [[6, 34], [30, 20], [27, 46], [4, 52]]];
  const inP = (px: number, py: number, p: [number, number][]) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c; } return c; };
  const on = (px: number, py: number) => polys.some((p) => inP(px + 0.5, py + 0.5, p));
  for (let py = 8; py < 134; py++) for (let px = 2; px < 52; px++) { if (!on(px, py)) continue;
    const edge = !on(px - 1, py) || !on(px + 1, py) || !on(px, py - 1) || !on(px, py + 1);
    const band = (px * 1.2 + py * 0.9 + 600) % 40, d = (px + py) & 1;
    x.fillStyle = G[edge ? 2 : band < 10 ? 0 : band < 13 ? (d ? 0 : 1) : band < 22 ? 1 : band < 25 ? (d ? 1 : 2) : band < 33 ? 2 : (d ? 2 : 1)]; x.fillRect(px, py, 1, 1); }
}
/** ◎ 金幣符號（7×7） */
function coin(x: CanvasRenderingContext2D, px: number, py: number, col: number) {
  x.fillStyle = G[col]; const m = ['0111110', '1000001', '1011101', '1010101', '1011101', '1000001', '0111110'];
  m.forEach((r, j) => [...r].forEach((v, i) => { if (v === '1') x.fillRect(px + i, py + j, 1, 1); }));
}
function price(x: CanvasRenderingContext2D, n: number, cx: number, y: number, col = 0) {
  const s = n.toLocaleString('en-US'), w = 9 + textW(s); coin(x, cx - w / 2, y, col); text(x, s, cx - w / 2 + 9, y, col);
}
/** 方框：外框（一般第 2 階、選中第 0 階粗框）、內底兩段色（上淺下深，像原作的藍色漸層） */
function frame(x: CanvasRenderingContext2D, px: number, py: number, s: number, sel: boolean, blink: boolean, hh = s) {
  // TG2：細亮框（選中＝粗框閃爍），內底上淺下深兩段（分界約 55%），四角小螺絲
  if (sel) { x.fillStyle = G[blink ? 0 : 1]; x.fillRect(px - 1, py - 1, s + 2, hh + 2); x.fillStyle = G[3]; x.fillRect(px + 2, py + 2, s - 4, hh - 4); }
  else { x.fillStyle = G[0]; x.fillRect(px, py, s, hh); x.fillStyle = G[3]; x.fillRect(px + 1, py + 1, s - 2, hh - 2); }
  const i0 = sel ? 3 : 2, split = py + Math.round(hh * 0.55);
  x.fillStyle = G[1]; x.fillRect(px + i0, py + i0, s - i0 * 2, split - py - i0);
  x.fillStyle = G[2]; x.fillRect(px + i0, split, s - i0 * 2, py + hh - i0 - split);
  x.fillStyle = G[3]; x.fillRect(px + 5, py + 4, 3, 1); x.fillRect(px + s - 8, py + 4, 3, 1);
}
function title(x: CanvasRenderingContext2D, s: string) {
  const px = 46, py = 3, w = 190, h = 20;
  x.fillStyle = G[1]; x.fillRect(px, py, w, h); x.fillStyle = G[2]; x.fillRect(px + 1, py + 1, w - 2, h - 2);
  x.fillStyle = G[3]; x.fillRect(px + 2, py + Math.floor(h / 2), w - 4, h / 2 - 2); x.fillStyle = G[1]; x.fillRect(px + 3, py + 3, w - 6, 1);
  x.fillStyle = G[1]; for (const [a, b] of [[px + 4, py + 4], [px + w - 6, py + 4], [px + 4, py + h - 6], [px + w - 6, py + h - 6]]) x.fillRect(a, b, 2, 2);
  zh(x, s, px + w / 2 - zhW(x, s) / 2 + 1, py + 5, 3); zh(x, s, px + w / 2 - zhW(x, s) / 2, py + 4, 0); // 投影字
  // 換類別箭頭
  x.fillStyle = G[0]; for (let i = 0; i < 6; i++) { x.fillRect(px + 10 + i, py + 10 - i, 1, i * 2 + 1); x.fillRect(px + w - 11 - i, py + 10 - i, 1, i * 2 + 1); }
}
function backdrop(x: CanvasRenderingContext2D, car: string, paint: number) {
  const { x: px, y: py, w, h } = PANEL;
  x.fillStyle = G[2]; x.fillRect(px, py, w, h); x.fillStyle = G[3]; x.fillRect(px + 2, py + 2, w - 4, h - 4);
  // 車庫牆：細橫紋；地板：亮線＋反光
  for (let j = py + 3; j < py + h - 30; j += 4) { x.fillStyle = G[3]; x.fillRect(px + 2, j, w - 4, 1); x.fillStyle = G[2]; for (let i = px + 3 + (j & 4); i < px + w - 3; i += 8) x.fillRect(i, j + 2, 1, 1); }
  x.fillStyle = G[2]; x.fillRect(px + 2, py + h - 30, w - 4, 1); x.fillRect(px + 2, py + h - 26, w - 4, 1); x.fillStyle = G[1]; x.fillRect(px + 2, py + h - 8, w - 4, 1);
  const img = sideCanvas(car, paint); x.drawImage(img, px + w - SIDE_W - 8, py + h - SIDE_H - 5);
}

export function drawShop(x: CanvasRenderingContext2D, ui: ShopUI, prof: any, coins: number, fr: number) {
  x.fillStyle = G[3]; x.fillRect(0, 0, W, H);
  const paintScr = isPaint(ui.cat), k = PART_KINDS[ui.cat] as PartKind | undefined;
  const blink = fr % 16 < 11;
  bigOne(x); // TG2：大號「1」＝1P（每個畫面都一樣）
  title(x, paintScr ? '塗裝' : PARTS[k!].label);
  backdrop(x, prof.car, paintScr && ui.cur >= 0 ? ui.cur : prof.paint);
  // 左：目前裝的
  frame(x, BIG.x, BIG.y, BIG.s, false, false);
  const curIcon = paintScr ? paintIcon(prof.paint) : partIcon(k!, prof.parts[k!]);
  x.drawImage(curIcon, BIG.x + (BIG.s - ICON) / 2, BIG.y + (BIG.s - ICON) / 2);
  x.fillStyle = G[3]; x.fillRect(BIG.x + 2, BIG.y + BIG.s - 1, BIG.s - 4, 11); text(x, 'NOW', BIG.x + BIG.s / 2 - textW('NOW') / 2, BIG.y + BIG.s + 1, 1);
  if (paintScr) {
    PAINT_NAMES.forEach((n, i) => {
      const [px, py] = paintCell(i), sel = i === ui.cur; frame(x, px, py, SW, sel, blink, SWH);
      const lv = PAINT_LIVERIES[i];
      for (let j = 3; j < SWH - 3; j++) for (let q = 3; q < SW - 3; q++) { const pat = lv.pat === 'stripe' ? (q >= 9 && q <= 15 && q !== 12 ? lv.accent : lv.body) : lv.pat === 'dither' ? ((q + j) & 1 ? lv.accent : lv.body) : lv.pat === 'band' ? ((q + j) % 6 < 2 ? lv.accent : lv.body) : (j === 6 ? lv.accent : lv.body); x.fillStyle = G[pat]; x.fillRect(px + q, py + j, 1, 1); }
      if (prof.paint === i) { x.fillStyle = G[0]; x.fillRect(px + SW - 7, py + 3, 4, 4); x.fillStyle = G[3]; x.fillRect(px + SW - 6, py + 4, 2, 2); }
      const tw = zhW(x, n); x.fillStyle = G[3]; x.fillRect(px - 1, py + SWH + 1, SW + 2, 13); zh(x, n, px + SW / 2 - tw / 2, py + SWH + 2, sel ? 0 : 1);
    });
  } else {
    PARTS[k!].tiers.forEach((t, i) => {
      const [px, py] = GRID[i], sel = i === ui.cur, on = prof.parts[k!] === i;
      frame(x, px, py, TILE, sel, blink); x.drawImage(partIcon(k!, i), px + 2, py + 2);
      if (on) zh(x, '裝備中', px + TILE / 2 - zhW(x, '裝備中') / 2, py + TILE + 1, 0);
      else if (t.price) price(x, t.price, px + TILE / 2, py + TILE + 3, t.price > coins ? 2 : 0);
    });
  }
  // 左下：金幣
  zh(x, '金幣', 8, 142, 3); zh(x, '金幣', 7, 141, 1);
  const cs = coins.toLocaleString('en-US'); coin(x, 36, 144, 0); if (46 + textW(cs, 2) < 126) text(x, cs, 46, 141, 0, 2); else text(x, cs, 46, 145, 0, 1); // 大數字縮成 1 倍，不壓到右下格子
  // 下方訊息列
  x.fillStyle = G[2]; x.fillRect(4, 164, W - 8, 33); x.fillStyle = G[3]; x.fillRect(5, 165, W - 10, 31);
  const l1 = (s: string, c = 0) => zh(x, s, 10, 167, c), l2 = (s: string, c = 1) => zh(x, s, 10, 181, c);
  if (ui.note && fr < ui.noteT) { l1(ui.note, 0); l2('←→ 換類別／選格子　A 確定　B 取消'); return; }
  if (paintScr) {
    const n = PAINT_NAMES[ui.cur] ?? ''; l1(`${n}${prof.paint === ui.cur ? '（使用中）' : ''}　${CARS.find((c) => c.id === prof.car)?.name ?? ''}`); l2(prof.paint === ui.cur ? '←→↑↓ 選顏色，後面的車會跟著變' : '按 A 直接換上（不用付錢）'); return;
  }
  const t = PARTS[k!].tiers[ui.cur], equipped = prof.parts[k!] === ui.cur;
  if (ui.confirm && t) { l1(t.price ? `換成${t.name}：付 ${t.price.toLocaleString('en-US')} 金幣？` : `換回${t.name}（免費）？`, 0); l2(`舊的「${PARTS[k!].tiers[prof.parts[k!]].name}」丟掉不退錢　A 確定　B 取消`, 1); return; }
  if (t) { l1(`${t.name}　${equipped ? '裝備中' : t.price ? `${t.price.toLocaleString('en-US')} 金幣` : '免費'}`, 0); l2(equipped ? PARTS[k!].desc : t.price > coins ? '金幣不夠：去下樓梯賺吧' : `按 A 購買（舊零件丟掉、不退錢）`); }
}

/** 畫布點擊：回傳 'prev' | 'next' | 格子編號 | null */
export function shopHit(cat: number, px: number, py: number): 'prev' | 'next' | number | null {
  if (py < 26 && px >= 46 && px < 80) return 'prev';
  if (py < 26 && px >= 202) return 'next';
  if (px < 44 && py < 130) return 'prev';
  if (isPaint(cat)) { for (let i = 0; i < 8; i++) { const [a, b] = paintCell(i); if (px >= a && px < a + SW && py >= b && py < b + SWH + 14) return i; } return null; }
  for (let i = 0; i < 4; i++) { const [a, b] = GRID[i]; if (px >= a && px < a + TILE && py >= b && py < b + TILE + 12) return i; }
  return null;
}
/** 方向鍵：在格子裡移動；撞到左右邊就換類別。回傳新的 {cat, cur} */
export function shopMove(ui: ShopUI, dir: 'up' | 'down' | 'left' | 'right'): 'prev' | 'next' | null {
  const cols = isPaint(ui.cat) ? 4 : 2, n = isPaint(ui.cat) ? 8 : 4, c = ui.cur % cols;
  if (dir === 'left') { if (c === 0) return 'prev'; ui.cur--; }
  else if (dir === 'right') { if (c === cols - 1) return 'next'; ui.cur++; }
  else if (dir === 'up') ui.cur = (ui.cur - cols + n) % n;
  else ui.cur = (ui.cur + cols) % n;
  ui.confirm = false; return null;
}
