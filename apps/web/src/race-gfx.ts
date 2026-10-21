/** 賽車模式繪圖：120×100 偽 3D 道路（Game Boy 四階綠），原創像素跑車（從車尾看）。 */
import { SEG_LEN, trackSegs, trackById, NITRO_PER_RACE, type Track } from '@chick/engine';
import { carBodyH, carPixels, LODS, type CarLook } from './race-cars';

/** v3：內部解析度加倍（240×200）；HUD 仍以 120×100 座標畫、放大 2 倍（像經典賽車的粗 HUD）。 */
export const W = 240, H = 200, R = 2;
const HW = 120, HH = 100;
// 0 最亮 … 3 最暗
export const G = ['#9bbc0f', '#8bac0f', '#306230', '#0f380f'];
const NIGHT = ['#306230', '#306230', '#0f380f', '#0f380f'];

// ---------- 車款（見 race-cars.ts：原創像素車、5 個 LOD 尺寸） ----------
const carCache = new Map<string, HTMLCanvasElement>();
export function carCanvas(model: string, color: number, opts: CarLook = {}, lod = 0) {
  const key = `${model}:${color}:${lod}:${+!!opts.brake}:${+!!opts.nitro}:${+!!opts.hit}:${(opts.frame ?? 0) & 3}`;
  let c = carCache.get(key); if (c) return c;
  const px = carPixels(model, color, lod, opts);
  c = document.createElement('canvas'); c.width = px[0].length; c.height = px.length; const x = c.getContext('2d')!;
  px.forEach((row, j) => row.forEach((v, i) => { if (v !== null) { x.fillStyle = G[v]; x.fillRect(i, j, 1, 1); } }));
  (c as any).bodyH = carBodyH(lod); // 車身高度（不含火焰），用來對齊地面
  carCache.set(key, c); return c;
}
/** 依照畫面上應有的寬度挑 LOD：挑「不超過目標寬度」的最大一張，原尺寸畫，不縮放。 */
export function pickLod(targetW: number) { for (let i = 0; i < LODS.length; i++) if (LODS[i] <= targetW + 0.5) return i; return LODS.length - 1; }
/** 車寬（以半個路寬為 1）：玩家在 PLAYER_DZ 時剛好 24px，所以同深度的車都一樣大。 */
export const CAR_W = 0.66;
export const PLAYER_DZ = 2.75; // 玩家車在攝影機前方的距離（m）

// ---------- 路邊物 ----------
const PROPS: Record<string, string[]> = {
  pine: ['...3...', '..323..', '..323..', '.32223.', '.32223.', '3222223', '...3...', '...3...'],
  snowpine: ['...0...', '..030..', '..303..', '.30003.', '.32023.', '3000003', '...3...', '...3...'],
  cactus: ['..3..', '.323.', '.323.', '3323.', '3223.', '.3233', '.3223', '.323.', '.323.'],
  palm: ['33.33', '.3333', '3.3.3', '..3..', '..3..', '..3..', '..3..', '.333.'],
  lamp: ['3333.', '3..2.', '3....', '3....', '3....', '3....', '3....', '33...'],
  tower: ['.333.', '30303', '33333', '30303', '33333', '30303', '33333', '30303', '33333'],
  fence: ['3.3.3.3', '3333333', '3.3.3.3', '3333333', '3.3.3.3'],
  hay: ['.222.', '23332', '22222', '23332', '.222.'],
  rock: ['..33..', '.3223.', '322223', '333333'],
  sign: ['3333333', '3200023', '3333333', '...3...', '...3...'],
};
const SCENE_PROPS: Record<string, string[]> = { city: ['lamp', 'tower', 'sign'], forest: ['pine', 'pine', 'rock'], desert: ['cactus', 'rock', 'sign'], farm: ['fence', 'hay', 'pine'], coast: ['palm', 'palm', 'sign'], snow: ['snowpine', 'rock', 'snowpine'] };
const propCache = new Map<string, HTMLCanvasElement>();
function propCanvas(name: string, night: boolean) {
  const key = name + night; let c = propCache.get(key); if (c) return c;
  const art = PROPS[name]; c = document.createElement('canvas'); c.width = art[0].length; c.height = art.length; const x = c.getContext('2d')!;
  art.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.') { x.fillStyle = (night ? NIGHT : G)[+ch]; x.fillRect(i, j, 1, 1); } }));
  c = epx(c); propCache.set(key, c); return c;
}
/** EPX/Scale2x：把小像素圖放大成 2 倍細節（邊緣變平滑但仍是純四色像素）。 */
function epx(src: HTMLCanvasElement) {
  const w = src.width, h = src.height, d = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const px = (x: number, y: number) => { x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y)); const i = (y * w + x) * 4; return (d[i] << 24 | d[i + 1] << 16 | d[i + 2] << 8 | d[i + 3]) >>> 0; };
  const out = document.createElement('canvas'); out.width = w * 2; out.height = h * 2; const o = out.getContext('2d')!; const img = o.createImageData(w * 2, h * 2);
  const set = (x: number, y: number, v: number) => { const i = (y * w * 2 + x) * 4; img.data[i] = v >>> 24; img.data[i + 1] = v >>> 16 & 255; img.data[i + 2] = v >>> 8 & 255; img.data[i + 3] = v & 255; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const P = px(x, y), A = px(x, y - 1), B = px(x + 1, y), C = px(x - 1, y), D = px(x, y + 1);
    set(2 * x, 2 * y, C === A && C !== D && A !== B ? A : P); set(2 * x + 1, 2 * y, A === B && A !== C && B !== D ? B : P);
    set(2 * x, 2 * y + 1, D === C && D !== B && C !== A ? C : P); set(2 * x + 1, 2 * y + 1, B === D && B !== A && D !== C ? D : P);
  }
  o.putImageData(img, 0, 0); return out;
}
const hash = (n: number) => { let x = (n * 2654435761) >>> 0; x ^= x >>> 13; x = Math.imul(x, 1274126177) >>> 0; return x / 4294967296; };

// ---------- 5×7 像素字（v4：HUD 用原生 240×200，不再放大） ----------
const FONT: Record<string, string> = {
  '0': '01110100011001110101110011000101110',
  '1': '00100011000010000100001000010001110',
  '2': '01110100010000100010001000100011111',
  '3': '11111000100010000010000011000101110',
  '4': '00010001100101010010111110001000010',
  '5': '11111100001111000001000011000101110',
  '6': '00110010001000011110100011000101110',
  '7': '11111000010001000100010000100001000',
  '8': '01110100011000101110100011000101110',
  '9': '01110100011000101111000010001001100',
  'A': '01110100011000111111100011000110001',
  'B': '11110100011000111110100011000111110',
  'C': '01110100011000010000100001000101110',
  'D': '11100100101000110001100011001011100',
  'E': '11111100001000011110100001000011111',
  'F': '11111100001000011110100001000010000',
  'G': '01110100011000010111100011000101111',
  'H': '10001100011000111111100011000110001',
  'I': '01110001000010000100001000010001110',
  'J': '00111000100001000010000101001001100',
  'K': '10001100101010011000101001001010001',
  'L': '10000100001000010000100001000011111',
  'M': '10001110111010110101100011000110001',
  'N': '10001100011100110101100111000110001',
  'O': '01110100011000110001100011000101110',
  'P': '11110100011000111110100001000010000',
  'Q': '01110100011000110001101011001001101',
  'R': '11110100011000111110101001001010001',
  'S': '01111100001000001110000010000111110',
  'T': '11111001000010000100001000010000100',
  'U': '10001100011000110001100011000101110',
  'V': '10001100011000110001100010101000100',
  'W': '10001100011000110101101011010101010',
  'X': '10001100010101000100010101000110001',
  'Y': '10001100010101000100001000010000100',
  'Z': '11111000010001000100010001000011111',
  '/': '00001000100001000100010000100010000',
  ':': '00000011000110000000011000110000000',
  '.': '00000000000000000000000000110001100',
  '-': '00000000000000011111000000000000000',
  '!': '00100001000010000100001000000000100',
  '$': '00100011111010001110001011111000100',
  '%': '11000110010001000100010001001100011',
  "'": '00100001000000000000000000000000000',
  ' ': '00000000000000000000000000000000000',
};
export function text(x: CanvasRenderingContext2D, s: string, px: number, py: number, col = 3, scale = 1, shadow: number | null = null) {
  if (shadow !== null) text(x, s, px + scale, py + scale, shadow, scale);
  x.fillStyle = G[col];
  [...s.toUpperCase()].forEach((ch, k) => { const f = FONT[ch] ?? FONT[' ']; for (let i = 0; i < 35; i++) if (f[i] === '1') x.fillRect(px + (k * 6 + (i % 5)) * scale, py + Math.floor(i / 5) * scale, scale, scale); });
}
export const textW = (s: string, scale = 1) => s.length * 6 * scale - scale;
/** 中文字（像素字型 Cubic 11 / Zpix，原生 12px），關掉平滑：用來畫賽前資訊卡等中文。 */
export function zh(x: CanvasRenderingContext2D, s: string, px: number, py: number, col = 3, size = 12) {
  x.font = `${size}px 'Cubic 11','Zpix',monospace`; x.textBaseline = 'top'; x.fillStyle = G[col]; x.fillText(s, Math.round(px), Math.round(py));
}
export const zhW = (x: CanvasRenderingContext2D, s: string, size = 12) => { x.font = `${size}px 'Cubic 11','Zpix',monospace`; return Math.ceil(x.measureText(s).width); };
/** 框：最暗底＋1px 中間色邊（HUD 面板） */
export function panel(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, bg = 3, edge = 2) {
  x.fillStyle = G[edge]; x.fillRect(px, py, w, h); x.fillStyle = G[bg]; x.fillRect(px + 1, py + 1, w - 2, h - 2);
}

export interface ViewCar { id: string; z: number; x: number; speed: number; damage: number; nitro: number; nitroT: number; fin: number | null; hit: number; car: string; color: number; name: string; ai: boolean; brake?: boolean }
export interface View { track: Track; me: ViewCar | null; cars: ViewCar[]; tick: number; countdown: number; laps: number; len: number; rank: number; flash?: string; frame: number; hud: boolean; camZ?: number; camX?: number }

const ROAD_W = 0.75, CAM_H = 6, DEPTH = 0.9, DRAW = 60, HORIZON = 80;
/** 玩家深度的半路寬（px）。車寬一律 = CAR_W × 半路寬 × 2 再乘同一個常數，所以只跟深度有關。 */
const playerPw = () => ROAD_W * (DEPTH * 6 / (PLAYER_DZ + 4)) * (W / 2);
/** 畫一個畫面。 */
export function drawRace(x: CanvasRenderingContext2D, v: View) {
  const t = v.track, segs = trackSegs(t.id), n = segs.length;
  const night = t.weather === 'night', P = night ? NIGHT : G;
  const camZ = v.camZ ?? (v.me ? v.me.z - PLAYER_DZ : 0), camX = v.camX ?? (v.me ? v.me.x * 0.55 : 0);
  const base = Math.floor(camZ / SEG_LEN), frac = (camZ % SEG_LEN + SEG_LEN) % SEG_LEN / SEG_LEN;
  const segY = (i: number) => segs[((i % n) + n) % n].y * 0.8;
  const camY = segY(base) + (segY(base + 1) - segY(base)) * frac + CAM_H;
  // 天空與遠景（隨彎道視差移動）
  const bend = segs.slice(0, ((base % n) + n) % n).reduce((a, s) => a + s.curve, 0) * 0.8;
  x.fillStyle = night ? G[3] : G[0]; x.fillRect(0, 0, W, H);
  if (night) { for (let i = 0; i < 36; i++) { x.fillStyle = G[i % 3 ? 2 : 1]; x.fillRect(Math.floor(((hash(i) * 480 - bend * 0.6) % W + W) % W), Math.floor(hash(i + 50) * 60), 1, 1); } const mx = Math.floor(((180 - bend * 0.6) % W + W) % W); x.fillStyle = G[1]; x.fillRect(mx + 1, 12, 6, 8); x.fillRect(mx, 13, 8, 6); x.fillStyle = G[3]; x.fillRect(mx + 4, 13, 3, 5); }
  else if (t.weather === 'clear') { x.fillStyle = G[1]; const sx0 = Math.floor(((192 - bend * 0.6) % 280 + 280) % 280) - 20; x.fillRect(sx0 + 2, 16, 8, 12); x.fillRect(sx0, 18, 12, 8); }
  drawSkyline(x, t.scenery, bend, P);
  // 道路：由近到遠投影，再由遠到近畫
  const pts: { y: number; x: number; w: number; scale: number; i: number; clip: number; wx: number; wy: number }[] = [];
  let dx = -segs[((base % n) + n) % n].curve * frac, cx = 0, maxy = H;
  for (let k = 0; k < DRAW; k++) {
    const i = base + k, s = segs[((i % n) + n) % n];
    const zRel = Math.max(1, (k - frac) * SEG_LEN + 4); if (zRel <= 0.5) { pts.push({ y: H, x: W / 2, w: 0, scale: 0, i, clip: H, wx: cx * 0.06, wy: segY(i) }); cx += dx; dx += s.curve; continue; }
    const scale = DEPTH / zRel * 6;
    const py = HORIZON - (segY(i) - camY) * scale * (W / 2) / 6;
    const pxc = W / 2 + (cx * 0.06 - camX * ROAD_W) * scale * (W / 2) / 6 * 6 / 6;
    pts.push({ y: py, x: pxc, w: ROAD_W * scale * (W / 2), scale, i, clip: maxy, wx: cx * 0.06, wy: segY(i) });
    if (py < maxy) maxy = py;
    cx += dx; dx += s.curve;
  }
  for (let k = DRAW - 1; k > 0; k--) {
    const a = pts[k - 1], b = pts[k]; if (b.scale === 0 || a.scale === 0) continue;
    if (b.y >= a.y) continue; // 被坡擋住
    const alt = Math.floor(b.i / 3) % 2 === 0;
    const y1 = Math.max(0, Math.round(b.y)), y2 = Math.min(H, Math.round(a.y));
    const fog = night && k > 18;
    for (let yy = y1; yy < y2; yy++) {
      const f = (yy - b.y) / (a.y - b.y || 1);
      const rx = b.x + (a.x - b.x) * f, rw = b.w + (a.w - b.w) * f;
      x.fillStyle = fog ? G[3] : night ? (alt ? G[2] : G[3]) : (alt ? G[1] : G[0]); if (t.scenery === 'snow' && !night) x.fillStyle = alt ? G[0] : G[1]; if (t.scenery === 'desert' && !fog) x.fillStyle = alt ? G[1] : G[0];
      x.fillRect(0, yy, W, 1);
      x.fillStyle = fog ? G[3] : (alt ? G[3] : G[0]); const rum = Math.max(1, rw * 0.14);
      x.fillRect(Math.round(rx - rw - rum), yy, Math.ceil(rum), 1); x.fillRect(Math.round(rx + rw), yy, Math.ceil(rum), 1);
      x.fillStyle = fog ? G[3] : night ? G[3] : (t.weather === 'rain' ? G[2] : alt ? G[2] : G[2]); if (night && !fog) x.fillStyle = G[2];
      x.fillRect(Math.round(rx - rw), yy, Math.round(rw * 2), 1);
      if (alt && !fog) { x.fillStyle = night ? G[1] : G[0]; x.fillRect(Math.round(rx - Math.max(0.5, rw * 0.03)), yy, Math.max(1, Math.round(rw * 0.035)), 1); }
    }
  }
  // 路邊物與其他車（遠到近）
  const sprites: { k: number; draw: () => void }[] = [];
  const names = SCENE_PROPS[t.scenery];
  for (let k = DRAW - 1; k > 1; k--) {
    const p = pts[k]; if (!p.scale) continue;
    const segIdx = ((p.i % n) + n) % n;
    if (segIdx % 4 === 0) for (const side of [-1, 1]) {
      const h = hash(segIdx * 2 + (side > 0 ? 1 : 0)); if (h < 0.25) continue;
      const name = names[Math.floor(h * 97) % names.length], img = propCanvas(name, night);
      const wx = p.x + side * p.w * (1.9 + h * 0.6), sc = p.w / 14 * (name === 'tower' ? 2.2 : 1.6);
      const ww = img.width * sc, hh = img.height * sc;
      if (p.y > pts[k].clip + 1) continue;
      sprites.push({ k, draw: () => { x.drawImage(img, Math.round(wx - ww / 2), Math.round(p.y - hh), Math.max(1, Math.round(ww)), Math.max(1, Math.round(hh))); } });
    }
  }
  // 所有車（含自己）用同一套投影：同深度同尺寸，自己最近所以最大
  const place = (c: ViewCar) => {
    let dz = c.z - camZ; const L = v.len; dz = ((dz % L) + L) % L; if (dz > L / 2) dz -= L;
    if (dz < 0.5 || dz > (DRAW - 2) * SEG_LEN) return null;
    const kf = (dz - 4 + 4) / SEG_LEN + frac; // pts[k] 的 zRel = (k − frac)·SEG_LEN + 4，車的 zRel = dz + 4
    const k = Math.floor(kf), a = pts[k], b = pts[k + 1]; if (!a || !b) return null;
    const f = kf - k, zRel = dz + 4, scale = DEPTH * 6 / zRel; // 直接用真實深度投影（不在 1/z 上做線性內插）
    const wx = a.wx + (b.wx - a.wx) * f, wy = a.wy + (b.wy - a.wy) * f;
    return { k, py: HORIZON - (wy - camY) * scale * (W / 2) / 6, pxc: W / 2 + (wx - camX * ROAD_W) * scale * (W / 2), pw: ROAD_W * scale * (W / 2), clip: a.clip };
  };
  for (const c of v.cars) {
    const isMe = !!v.me && c.id === v.me.id, p = place(c); if (!p) continue;
    if (!isMe && p.py > p.clip + 2) continue; // 被坡頂擋住
    const target = 48 * p.pw / playerPw(), lod = isMe ? 0 : pickLod(target);
    const img = carCanvas(c.car, c.color, { brake: c.brake, nitro: c.nitroT > 0, hit: c.hit > 0 || (isMe && c.damage > 70 && v.frame % 20 < 2), frame: v.frame }, lod);
    const bh = (img as any).bodyH as number;
    const bob = isMe && c.speed > 5 && v.frame % 4 < 2 ? 1 : 0, shake = c.hit > 0 ? (v.frame % 2 ? 1 : -1) : 0;
    // 畫面寬度超過 24px（比玩家還近）才放大 L 圖，否則原尺寸
    const scale = !isMe && target > 52 ? target / 48 : 1;
    const dw = Math.round(img.width * scale), dh = Math.round(img.height * scale);
    const sx = Math.round(p.pxc + c.x * p.pw - dw / 2) + shake, sy = Math.round(p.py - bh * scale) - bob;
    sprites.push({ k: p.k + (isMe ? -0.5 : 0), draw: () => {
      x.drawImage(img, sx, sy, dw, dh);
      if (isMe && c.damage > 50) for (let i = 0; i < 3; i++) { x.fillStyle = G[i % 2 ? 1 : 2]; x.fillRect(sx + 6 + ((v.frame * 3 + i * 7) % 12), sy - 3 - ((v.frame + i * 3) % 6), 2, 2); }
      if (isMe && Math.abs(c.x) > 1 && c.speed > 5) for (let i = 0; i < 4; i++) { x.fillStyle = G[1]; x.fillRect(sx + (i % 2 ? dw - 2 : 0) + (v.frame % 3), sy + bh - 2 - (i >> 1) * 2, 2, 1); }
    } });
  }
  sprites.sort((p, q) => q.k - p.k).forEach((s) => s.draw());
  // 天氣
  if (t.weather === 'rain') { x.fillStyle = G[1]; for (let i = 0; i < 90; i++) { const rx = Math.floor((hash(i) * W + v.frame * 6 + i * 7) % W), ry = Math.floor((hash(i + 99) * H + v.frame * 18) % H); x.fillRect(rx, ry, 1, 5); x.fillRect(rx - 1, ry + 5, 1, 2); } }
  if (t.weather === 'snow') { x.fillStyle = G[0]; for (let i = 0; i < 90; i++) { const sx = Math.floor((hash(i) * W + Math.sin((v.frame + i * 13) / 9) * 3 - (v.me?.x ?? 0) * 10 + W) % W), sy = Math.floor((hash(i + 7) * H + v.frame * (1 + (i % 3))) % H); x.fillRect(sx, sy, i % 4 ? 1 : 2, 1); } }
  if (v.hud) drawHud(x, v);
}
function drawSkyline(x: CanvasRenderingContext2D, scene: string, bend: number, P: string[]) {
  const off = ((-bend) % 240 + 240) % 240;
  for (let px = 0; px < W; px++) {
    const wx = ((px + off) % 240) / R;
    let h: number;
    if (scene === 'city') h = 6 + Math.floor(hash(Math.floor(wx / 6)) * 12);
    else if (scene === 'desert') h = 3 + Math.round(4 * Math.abs(Math.sin(wx / 19)) + (wx > 70 && wx < 90 ? 6 - Math.abs(wx - 80) * 0.6 : 0));
    else if (scene === 'coast') h = wx < 40 ? 2 : 4 + Math.round(5 * Math.abs(Math.sin(wx / 13)));
    else if (scene === 'snow') h = 6 + Math.round(9 * Math.abs(Math.sin(wx / 15)) - (wx % 30 < 15 ? (wx % 15) / 3 : 0));
    else h = 4 + Math.round(5 * Math.abs(Math.sin(wx / 11)) + 3 * Math.abs(Math.sin(wx / 4.3)));
    x.fillStyle = P[2]; x.fillRect(px, HORIZON - h * R, 1, h * R + 1);
    if (scene === 'snow') { x.fillStyle = G[0]; x.fillRect(px, HORIZON - h * R, 1, 3); }
    if (scene === 'city' && (wx * 7 + h) % 5 === 0 && h > 8) { x.fillStyle = P[0] === G[0] ? G[1] : G[1]; x.fillRect(px, HORIZON - h * R + 5, 1, 2); }
  }
  if (scene === 'coast') { x.fillStyle = P[1]; x.fillRect(0, HORIZON - 2, 80, 3); }
}
// ---------- 迷你地圖：把路段彎度積分成平面軌跡，線性修正讓它閉合 ----------
const mapCache = new Map<string, { pts: [number, number][]; box: [number, number] }>();
export function trackMap(id: string, bw: number, bh: number) {
  const key = `${id}:${bw}:${bh}`; let m = mapCache.get(key); if (m) return m;
  const segs = trackSegs(id), n = segs.length; let th = 0, px = 0, py = 0; const raw: [number, number][] = [];
  // 彎度換算成轉角，再平均補上一點固定轉角，讓總轉角剛好一圈（環狀賽道看起來像真的賽道）
  const k = 0.045, total = segs.reduce((a, s) => a + s.curve, 0) * k, base = (Math.PI * 2 - total) / n;
  for (const s of segs) { raw.push([px, py]); th += s.curve * k + base; px += Math.sin(th); py -= Math.cos(th); }
  const ex = px / n, ey = py / n; const fixed = raw.map(([x0, y0], i) => [x0 - ex * i, y0 - ey * i] as [number, number]);
  const xs = fixed.map((p) => p[0]), ys = fixed.map((p) => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const sc = Math.min((bw - 6) / (maxx - minx || 1), (bh - 6) / (maxy - miny || 1));
  const ox = (bw - (maxx - minx) * sc) / 2, oy = (bh - (maxy - miny) * sc) / 2;
  m = { pts: fixed.map(([x0, y0]) => [Math.round(ox + (x0 - minx) * sc), Math.round(oy + (y0 - miny) * sc)]), box: [bw, bh] };
  mapCache.set(key, m); return m;
}
function line(x: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
  for (let i = 0; i < 400; i++) { x.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
}
export function drawMinimap(x: CanvasRenderingContext2D, v: View, mx: number, my: number, bw = 64, bh = 52) {
  const m = trackMap(v.track.id, bw, bh), n = m.pts.length;
  panel(x, mx, my, bw, bh);
  x.fillStyle = G[2]; for (let i = 0; i < n; i++) { const a = m.pts[i], b = m.pts[(i + 1) % n]; line(x, mx + a[0], my + a[1], mx + b[0], my + b[1]); }
  const s0 = m.pts[0]; x.fillStyle = G[0]; x.fillRect(mx + s0[0] - 1, my + s0[1] - 2, 3, 1); x.fillRect(mx + s0[0] - 1, my + s0[1] + 1, 3, 1); // 起終點線
  const at = (z: number) => m.pts[((Math.floor(((z % v.len) + v.len) % v.len / SEG_LEN)) % n + n) % n];
  for (const c of v.cars) { if (v.me && c.id === v.me.id) continue; const p = at(c.z); x.fillStyle = G[1]; x.fillRect(mx + p[0] - 1, my + p[1] - 1, 2, 2); }
  if (v.me) { // 自己：4×4 亮色方塊＋閃爍外框
    const p = at(v.me.z); const X0 = mx + p[0] - 2, Y0 = my + p[1] - 2;
    if (v.frame % 10 < 6) { x.fillStyle = G[0]; x.fillRect(X0 - 2, Y0 - 2, 8, 1); x.fillRect(X0 - 2, Y0 + 5, 8, 1); x.fillRect(X0 - 2, Y0 - 2, 1, 8); x.fillRect(X0 + 5, Y0 - 2, 1, 8); }
    x.fillStyle = G[3]; x.fillRect(X0 - 1, Y0 - 1, 6, 6); x.fillStyle = G[0]; x.fillRect(X0, Y0, 4, 4);
  }
}
function drawHud(x: CanvasRenderingContext2D, v: View) {
  const me = v.me; if (!me) return;
  const total = v.cars.length;
  // 左上：名次
  const rk = String(v.rank), tw = 34 + textW(rk, 3) + textW('/' + total);
  panel(x, 2, 2, tw, 27); text(x, 'POS', 6, 6, 1); text(x, rk, 28, 5, 0, 3); text(x, '/' + total, 30 + textW(rk, 3), 19, 1);
  // 右上：圈數＋時間
  const lap = Math.min(v.laps, Math.floor(Math.max(0, me.z) / v.len) + 1), ls = `LAP ${lap}/${v.laps}`;
  panel(x, W - 70, 2, 68, 13); text(x, ls, W - 66, 5, 0);
  const secs = Math.max(0, v.tick - 60) / 20, ts = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}.${Math.floor((secs * 10) % 10)}`;
  panel(x, W - 70, 16, 68, 13); text(x, ts, W - 66, 19, 1);
  // 迷你地圖（右側）
  drawMinimap(x, v, W - 70, 31, 68, 56);
  // 左下：速度
  panel(x, 2, H - 22, 74, 20); text(x, String(Math.round(me.speed * 3.6)).padStart(3, ' '), 6, H - 18, me.nitroT > 0 && v.frame % 4 < 2 ? 1 : 0, 2); text(x, 'KM/H', 46, H - 11, 1);
  // 右下：氮氣＋損傷
  panel(x, W - 92, H - 22, 90, 20);
  for (let i = 0; i < NITRO_PER_RACE; i++) { const on = i < me.nitro, bx = W - 88 + i * 9; x.fillStyle = on ? G[0] : G[2]; x.fillRect(bx + 1, H - 19, 5, 1); x.fillRect(bx, H - 18, 7, 13); if (on) { x.fillStyle = G[1]; x.fillRect(bx + 2, H - 16, 1, 9); x.fillStyle = G[3]; x.fillRect(bx, H - 12, 7, 1); } }
  text(x, 'DMG', W - 58, H - 19, 1);
  x.fillStyle = G[2]; x.fillRect(W - 58, H - 10, 52, 5); x.fillStyle = me.damage > 70 && v.frame % 6 < 3 ? G[1] : G[0]; x.fillRect(W - 58, H - 10, Math.round(52 * me.damage / 100), 5);
  // 倒數／訊息
  if (v.countdown > 0) { const s = String(Math.ceil(v.countdown / 20)); panel(x, W / 2 - 20, 40, 40, 50); text(x, s, W / 2 - 14, 45, 0, 6); }
  else if (v.tick - 60 < 20 && v.tick >= 60) { panel(x, W / 2 - 40, 50, 80, 30); text(x, 'GO!', W / 2 - 34, 55, 0, 4); }
  if (v.flash && v.frame % 8 < 6) { const w = textW(v.flash, 2) + 10; panel(x, Math.round(W / 2 - w / 2) - 10, 34, w, 20); text(x, v.flash, Math.round(W / 2 - w / 2) - 5, 37, 0, 2); }
}
export { trackById };
