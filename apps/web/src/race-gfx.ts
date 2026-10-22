/** 賽車模式繪圖：120×100 偽 3D 道路（Game Boy 四階綠），原創像素跑車（從車尾看）。 */
import { SEG_LEN, roadside, FLIP_TICKS, HIT_OBJECT, trackSegs, trackById, NITRO_PER_RACE, SPEED_X, type Track } from '@chick/engine';
import { carBodyH, carPixels, LODS, PLAYER_W, exhaustsOf, DESIGN_W, EXHAUST_Y, type CarLook } from './race-cars';
import { pickupDims } from './race-pickup';
import { frontSprite, ensureComposite, S as PET_S } from './sprites';

/** v3：內部解析度加倍（240×200）；HUD 仍以 120×100 座標畫、放大 2 倍（像經典賽車的粗 HUD）。 */
export const W = 240, H = 200, R = 2;
const HW = 120, HH = 100;
// 0 最亮 … 3 最暗
export const G = ['#9bbc0f', '#8bac0f', '#306230', '#0f380f'];
const NIGHT = ['#306230', '#306230', '#0f380f', '#0f380f'];
/** 全彩對照模式（只給預覽用）：每個畫面元素一組 4 色（亮→暗），綠色模式時全部 = G。 */
export const COLOR_PAL: Record<string, string[]> = {
  sky: ['#b0c4e0', '#f8e8a0', '#8098b8', '#405070'], city: ['#d0d4dc', '#a8b0bc', '#7c8494', '#3c4450'], water: ['#e0f0ff', '#6890d8', '#3c68b8', '#1c3470'],
  grass: ['#60b048', '#48983a', '#2e7428', '#183c14'], rumble: ['#f0f0f0', '#c8c8d0', '#4060c8', '#2840a8'], road: ['#b8b8c0', '#a0a0a8', '#808088', '#383840'],
  line: ['#f4f4f4', '#d0d0d0', '#909090', '#404040'], prop: ['#90c070', '#4a8a34', '#2a5a22', '#101810'], car: ['#ffc0a0', '#e85030', '#a02010', '#300808'],
  ai: ['#d8d8f0', '#8090d8', '#3048a8', '#101030'], fx: ['#ffffff', '#c0d0f0', '#8090b0', '#404860'], hud: ['#fff4a0', '#f0a020', '#707070', '#101010'],
  tachG: ['#80f040', '#40c020', '#606060', '#101010'], tachY: ['#fff060', '#e0c020', '#606060', '#101010'], tachR: ['#ff6040', '#c02010', '#606060', '#101010'],
};
let PAL: Record<string, string[]> | null = null;
let Q: string[] = G;
export function setColorMode(on: boolean) { PAL = on ? COLOR_PAL : null; Q = G; }
const role = (r: string) => { Q = PAL?.[r] ?? G; };

// ---------- 車款（見 race-cars.ts：原創像素車、5 個 LOD 尺寸） ----------
const carCache = new Map<string, HTMLCanvasElement>();
export function carCanvas(model: string, color: number, opts: CarLook = {}, lod = 0) {
  const key = `${Q[1]}:${model}:${color}:${lod}:${+!!opts.brake}:${+!!opts.nitro}:${+!!opts.hit}:${(opts.frame ?? 0) & 3}`;
  let c = carCache.get(key); if (c) return c;
  const px = carPixels(model, color, lod, opts);
  c = document.createElement('canvas'); c.width = px[0].length; c.height = px.length; const x = c.getContext('2d')!;
  const pal = Q; px.forEach((row, j) => row.forEach((v, i) => { if (v !== null) { x.fillStyle = pal[v]; x.fillRect(i, j, 1, 1); } }));
  (c as any).bodyH = carBodyH(lod); // 車身高度（不含火焰），用來對齊地面
  carCache.set(key, c); return c;
}
/** v14：挑不小於目標寬度的最小 LOD（再縮到目標寬），比 48 大就用 48 放大。 */
export function lodFor(targetW: number) { for (let i = LODS.length - 1; i >= 0; i--) if (LODS[i] >= targetW - 0.5) return i; return 0; }
/** 依照畫面上應有的寬度挑 LOD：挑「不超過目標寬度」的最大一張，原尺寸畫，不縮放。 */
export function pickLod(targetW: number) { for (let i = 0; i < LODS.length; i++) if (LODS[i] <= targetW + 0.5) return i; return LODS.length - 1; }
/** 車寬（以半個路寬為 1）：玩家在 PLAYER_DZ 時剛好 24px，所以同深度的車都一樣大。 */
export const CAR_W = 0.44; // v11：車寬／半路寬（= PLAYER_W ÷ 玩家深度半路寬），和引擎 COLLIDE_DX 對齊
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
  tyres: ['.3333.', '312213', '.3333.', '312213', '.3333.', '312213', '.3333.'],
  bush: ['..333..', '.32223.', '3212223', '3222223', '.33333.'],
};
const propCache = new Map<string, HTMLCanvasElement>();
function propCanvas(name: string, night: boolean) {
  const key = name + night + Q[1]; let c = propCache.get(key); if (c) return c;
  const art = PROPS[name]; c = document.createElement('canvas'); c.width = art[0].length; c.height = art.length; const x = c.getContext('2d')!;
  art.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.') { x.fillStyle = (night ? NIGHT : Q)[+ch]; x.fillRect(i, j, 1, 1); } }));
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
  '"': '01010010100000000000000000000000000',
  ' ': '00000000000000000000000000000000000',
};
const TXC = new Map<string, HTMLCanvasElement>();
/** 文字快取：同字串/顏色/大小只畫一次到離屏畫布，之後一次 drawImage（減少每幀數千次 fillRect / fillText）。 */
function txCache(key: string, w: number, h: number, paint: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement | null {
  let c = TXC.get(key); if (c) return c;
  if (typeof document === 'undefined' || w <= 0 || h <= 0) return null;
  c = document.createElement('canvas'); c.width = w; c.height = h; const cx = c.getContext('2d'); if (!cx) return null;
  paint(cx); if (TXC.size > 400) TXC.delete(TXC.keys().next().value!); TXC.set(key, c); return c;
}
function textRaw(x: CanvasRenderingContext2D, s: string, px: number, py: number, col: number, scale: number) {
  x.fillStyle = Q[col];
  [...s.toUpperCase()].forEach((ch, k) => { const f = FONT[ch] ?? FONT[' ']; for (let i = 0; i < 35; i++) if (f[i] === '1') x.fillRect(px + (k * 6 + (i % 5)) * scale, py + Math.floor(i / 5) * scale, scale, scale); });
}
export function text(x: CanvasRenderingContext2D, s: string, px: number, py: number, col = 3, scale = 1, shadow: number | null = null) {
  if (shadow !== null) text(x, s, px + scale, py + scale, shadow, scale);
  const c = txCache(`t${Q[col]}|${scale}|${s}`, Math.max(1, s.length * 6 * scale), 7 * scale, (cx) => textRaw(cx, s, 0, 0, col, scale));
  if (c && px === Math.round(px) && py === Math.round(py)) x.drawImage(c, px, py); else textRaw(x, s, px, py, col, scale);
}
export const textW = (s: string, scale = 1) => s.length * 6 * scale - scale;
/** 中文字（像素字型 Cubic 11 / Zpix，原生 12px），關掉平滑：用來畫賽前資訊卡等中文。 */
export function zh(x: CanvasRenderingContext2D, s: string, px: number, py: number, col = 3, size = 12) {
  const font = `${size}px 'Cubic 11','Zpix',monospace`;
  const c = txCache(`z${Q[col]}|${size}|${s}`, zhW(x, s, size) + 2, size + 4, (cx) => { cx.font = font; cx.textBaseline = 'top'; cx.fillStyle = Q[col]; cx.fillText(s, 0, 0); });
  if (c) { x.drawImage(c, Math.round(px), Math.round(py)); return; }
  x.font = font; x.textBaseline = 'top'; x.fillStyle = Q[col]; x.fillText(s, Math.round(px), Math.round(py));
}
const ZW = new Map<string, number>();
export const zhW = (x: CanvasRenderingContext2D, s: string, size = 12) => { const k = size + '|' + s; let w = ZW.get(k); if (w === undefined) { x.font = `${size}px 'Cubic 11','Zpix',monospace`; w = Math.ceil(x.measureText(s).width); if (ZW.size > 600) ZW.clear(); ZW.set(k, w); } return w; };
/** 框：最暗底＋1px 中間色邊（HUD 面板） */
export function panel(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, bg = 3, edge = 2) {
  x.fillStyle = Q[edge]; x.fillRect(px, py, w, h); x.fillStyle = Q[bg]; x.fillRect(px + 1, py + 1, w - 2, h - 2);
}

export interface ViewCar { id: string; z: number; x: number; speed: number; damage: number; nitro: number; nitroT: number; fin: number | null; hit: number; car: string; color: number; name: string; ai: boolean; brake?: boolean; flip?: number; evT?: number; evK?: number; evS?: number; evSide?: number; /** 前／側／後 分區損傷 0–100 */ zd?: number[]; /** 最後吃到路上氮氣道具的 tick */ pkT?: number; /** 坐在車上的寵物精靈鍵（伺服器給；電腦車沒有） */ pet?: string | null }
export interface View { track: Track; me: ViewCar | null; cars: ViewCar[]; tick: number; countdown: number; laps: number; len: number; rank: number; flash?: string; frame: number; hud: boolean; camZ?: number; camX?: number; gears?: number; top?: number; /** 毫秒時鐘（特效用），預設 performance.now() */ now?: number; /** 路上還沒被吃掉的氮氣道具（絕對距離） */ pickups?: { z: number; x: number }[] }

/** v13：彎道視覺強度（每公尺彎度係數）、攝影機橫向跟車比例。 */
const CURVE_K = 0.0004, CAM_FOLLOW = 0.4;
const ROAD_W = 2.4, CAM_H = 7.5, DEPTH = 0.9, DRAW = 60, HORIZON = 116; // v11：路寬照 TG2（車底那一列路寬 ≈ 0.9 畫面寬、車 ≈ 路寬 0.24）、攝影機較高，地平線 58%
/** 玩家深度的半路寬（px）。車寬一律 = CAR_W × 半路寬 × 2 再乘同一個常數，所以只跟深度有關。 */
const playerPw = () => ROAD_W * (DEPTH * 6 / (PLAYER_DZ + 4)) * (W / 2);
/** v16：路面上跟 40%，衝出路面後平滑加到 85%，翻車／撞路邊物時車還在畫面裡。 */
const camFollow = (x: number) => { const t = Math.max(0, Math.min(1, (Math.abs(x) - 0.95) / 0.4)); return CAM_FOLLOW + (0.85 - CAM_FOLLOW) * t * t * (3 - 2 * t); };
/** 彎度前綴和（天空視差用）。 */
const prefCache = new Map<string, number[]>();
function curvePrefix(t: Track) { let p = prefCache.get(t.id); if (!p) { const s = trackSegs(t.id); p = [0]; for (let i = 0; i < s.length; i++) p.push(p[i] + s[i].curve); prefCache.set(t.id, p); } return p; }
/**
 * v13 純視覺坡道：大部分平路，偶爾一個山丘（凸）或谷（凹）。每個「坡段」是 (1−cos) 平滑的鼓包，起點終點高度 0、斜率 0，
 * 所以整圈自然閉合、處處平滑。伺服器物理不變。
 */
interface Elev { a: Float32Array; s: Float32Array; l: Float32Array; n: number }
const elevCache = new Map<string, Elev>();
export function elevTable(t: Track): Elev {
  let e = elevCache.get(t.id); if (e) return e;
  const n = trackSegs(t.id).length, a = new Float32Array(n), s = new Float32Array(n), l = new Float32Array(n);
  let i = 0, pi = 0;
  for (const [len, , hill] of t.pieces) {
    const keep = Math.abs(hill) >= 0.6 && len >= 10 && hash(pi * 31 + t.id.length * 7 + t.id.charCodeAt(2)) < 0.55;
    const amp = keep ? Math.sign(hill) * (26 + Math.abs(hill) * 12) : 0;
    for (let j = 0; j < len && i < n; j++, i++) { a[i] = amp; s[i] = i - j; l[i] = len; }
    pi++;
  }
  e = { a, s, l, n }; elevCache.set(t.id, e); return e;
}
export function elevAt(e: Elev, z: number) {
  const L = e.n * SEG_LEN; z = ((z % L) + L) % L; const i = Math.min(e.n - 1, Math.floor(z / SEG_LEN));
  if (!e.a[i]) return 0; const u = (z / SEG_LEN - e.s[i]) / e.l[i];
  return e.a[i] * (1 - Math.cos(u * Math.PI * 2)) / 2;
}
// ---------- v15 碰撞特效：震動、火花碎片、車身閃白、HUD 損傷圖分區閃 ----------
interface Spark { id: string; ox: number; oy: number; vx: number; vy: number; t0: number; life: number; c: number; sz: number }
interface HitFx { t0: number; k: number; s: number; side: number }
const fxSeen = new Map<string, number>(), fxHit = new Map<string, HitFx>(); let sparks: Spark[] = [];
/** 力道 0..1（伺服器的 evS：路邊 ~2-8、追撞 ~1-4、側擦 2.5） */
const hitK = (s: number) => Math.max(0.25, Math.min(1, s / 7));
// ---------------- 路上氮氣道具：像素圖（4 綠：0 最亮…3 最暗；'.' 透明），純罐子、不發光不閃 ----------------
const PICKUP_ART = ['....333333....', '....300003....', '...33333333...', '..3311111113..', '.331000000133.', '.310000300013.', '.310003300013.', '.310033300013.', '.310333333013.', '.310000333013.', '.310000330013.', '.310003300013.', '.310033000013.', '.310030000013.', '.311111111113.', '.322222222223.', '..3333333333..', '...3......3...'];
const pickupCache = new Map<string, HTMLCanvasElement>();
export function pickupCanvas(P: string[] = Q) {
  const key = P.join(); let cv = pickupCache.get(key); if (cv) return cv;
  const h = PICKUP_ART.length, w = PICKUP_ART[0].length, pad = 0; cv = document.createElement('canvas'); cv.width = w + pad * 2; cv.height = h + pad * 2;
  const c = cv.getContext('2d')!;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const ch = PICKUP_ART[yy][xx]; if (ch === '.') continue; const k = +ch; c.fillStyle = P[k]; c.fillRect(xx + pad, yy + pad, 1, 1); }
  pickupCache.set(key, cv); return cv;
}
const fxPick = new Map<string, { t: number; t0: number }>();
/** 吃到道具的火花：8 點星形往外擴散（約 0.45 秒），回傳 0..1 進度或 null */
function pickAge(id: string, now: number) { const p = fxPick.get(id); if (!p || !p.t0) return null; const a = (now - p.t0) / 450; return a >= 0 && a < 1 ? a : null; }
function fxUpdate(cars: ViewCar[], now: number) {
  for (const c of cars) { const pk = c.pkT ?? 0, ps = fxPick.get(c.id); if (!ps) fxPick.set(c.id, { t: pk, t0: 0 }); else if (pk > ps.t) fxPick.set(c.id, { t: pk, t0: now }); }
  for (const c of cars) {
    const t = c.evT ?? 0, seen = fxSeen.get(c.id);
    if (seen === undefined) { fxSeen.set(c.id, t); continue; } // 第一次看到這台：舊事件不補播
    if (t <= seen || !c.evK) continue; fxSeen.set(c.id, t);
    const big = c.evK === HIT_OBJECT, k = big ? 1 : hitK(c.evS ?? 2), side = c.evSide ?? 0; fxHit.set(c.id, { t0: now, k: big ? 1.6 : k, s: c.evS ?? 2, side });
    // 碰撞點（相對車身中心，單位＝車寬；y：0 車頂 1 車底）：前＝車頂中央、後＝車尾下緣、側＝左右邊
    const [px, py] = big ? [side * 0.3, 0.3] : c.evK === HIT_FRONT ? [0, 0.15] : c.evK === HIT_BACK ? [0, 0.85] : [side * 0.5, 0.55];
    const n = Math.round((6 + 14 * k) * (big ? 2.2 : 1));
    for (let i = 0; i < n; i++) { const a = big ? Math.random() * Math.PI * 2 : (c.evK === HIT_FRONT ? -Math.PI / 2 : c.evK === HIT_BACK ? Math.PI / 2 : side > 0 ? 0 : Math.PI) + (Math.random() - 0.5) * 2.2;
      const sp = 25 + Math.random() * 70 * k * (big ? 1.6 : 1); sparks.push({ id: c.id, ox: px, oy: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30 * Math.random(), t0: now, life: 180 + Math.random() * 260 * k, c: i % 3 === 0 ? 3 : i % 3 === 1 ? 0 : 1, sz: Math.random() < 0.3 * k ? 2 : 1 }); }
    if (sparks.length > 300) sparks = sparks.slice(-300);
  }
}
const HIT_FRONT = 2, HIT_BACK = 3; // 引擎 HIT_REAR_END（撞到前車＝前頭受損）、HIT_REARED（被追撞＝車尾）
/** 目前這台車的撞擊狀態（0..1 剩餘比例），沒有就 null */
function hitAge(id: string, now: number, ms: number) { const h = fxHit.get(id); if (!h) return null; const a = (now - h.t0) / ms; return a >= 0 && a < 1 ? { ...h, a } : null; }
const flashCache = new Map<HTMLCanvasElement, HTMLCanvasElement>();
/** 車的白色剪影（閃白用） */
function flashOf(img: HTMLCanvasElement) { let f = flashCache.get(img); if (f) return f; f = document.createElement('canvas'); f.width = img.width; f.height = img.height; const c = f.getContext('2d')!; c.drawImage(img, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = Q[0]; c.fillRect(0, 0, f.width, f.height); if (flashCache.size > 200) flashCache.clear(); flashCache.set(img, f); return f; }
/** HUD 損傷圖：哪一區在閃（F 前、R 後、S 側），沒有回傳 null */
function hudZone(me: ViewCar, now: number): { zone: 'f' | 'r' | 's'; on: boolean } | null {
  const h = hitAge(me.id, now, 700); if (!h) return null; const k = fxHit.get(me.id)!; void k;
  const ev = me.evK ?? 0; return { zone: ev === HIT_FRONT ? 'f' : ev === HIT_BACK ? 'r' : 's', on: Math.floor(h.a * 10) % 2 === 0 };
}
/** 畫一個畫面。 */
// ---------------- 寵物上車：每位玩家自己的寵物坐在座艙（電腦車沒有） ----------------
/** 精靈鍵 → 精靈：'egg'／'ghost'／'chick' 直接用；其他＝物種正面圖（含配件，例如 'chicken|bow'） */
export function petSpriteName(key: string) { return key === 'egg' || key === 'chick' || key === 'ghost' ? key : frontSprite(key); }
const petCache = new Map<string, HTMLCanvasElement>();
/** 畫成一張小圖：四階色依目前畫面調色盤（夜晚整體暗一階），外圍 1px 最暗色描邊（在車身上看得清楚） */
function petImg(key: string, P: string[]) {
  const ck = `${key}|${P.join()}`; let c = petCache.get(ck); if (c) return c;
  const name = petSpriteName(key); if (!PET_S[name] && name.includes('|')) ensureComposite(name);
  const rows = PET_S[name] ?? []; const h = rows.length, w = rows[0]?.length ?? 0;
  c = document.createElement('canvas'); c.width = w + 2; c.height = h + 2; const g = c.getContext('2d')!;
  const on = (i: number, j: number) => j >= 0 && j < h && i >= 0 && i < w && rows[j][i] !== '.' && rows[j][i] !== ' ';
  g.fillStyle = P[3]; for (let j = -1; j <= h; j++) for (let i = -1; i <= w; i++) if (!on(i, j) && (on(i - 1, j) || on(i + 1, j) || on(i, j - 1) || on(i, j + 1))) g.fillRect(i + 1, j + 1, 1, 1);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (on(i, j)) { g.fillStyle = P[+rows[j][i]]; g.fillRect(i + 1, j + 1, 1, 1); }
  petCache.set(ck, c); return c;
}
const PET_NIGHT = [G[1], G[2], G[3], G[3]];
type Mood = 'normal' | 'crash' | 'nitro';
function petMood(c: ViewCar, now: number): Mood { return (c.flip ?? 0) > 0 || c.hit > 0 || hitAge(c.id, now, 600) ? 'crash' : c.nitroT > 0 ? 'nitro' : 'normal'; }
/** 表情不變；撞到＝抖＋頭上轉圈星星；氮氣＝跳＋兩側閃光 */
function drawMoodFx(x: CanvasRenderingContext2D, m: Mood, cx: number, top: number, w: number, frame: number, k: number) {
  const r = Math.max(1, Math.round(k));
  if (m === 'crash') for (let i = 0; i < 3; i++) { const a = frame * 0.6 + i * 2.1, px = Math.round(cx + Math.cos(a) * (w * 0.45)), py = Math.round(top - 2 * r + Math.sin(a) * 2 * k); x.fillStyle = Q[3]; x.fillRect(px - 2 * r, py - r, 5 * r, 3 * r); x.fillRect(px - r, py - 2 * r, 3 * r, 5 * r); x.fillStyle = Q[0]; x.fillRect(px - r, py, 3 * r, r); x.fillRect(px, py - r, r, 3 * r); }
  if (m === 'nitro') { const o = frame % 2; x.fillStyle = Q[0]; for (const sd of [-1, 1]) { const px = Math.round(cx + sd * (w / 2 + (2 + o) * k)); x.fillRect(px - r, top + 3 * r, 3 * r, r); x.fillRect(px, top + 2 * r, r, 3 * r); } }
}
/** k＝這台車的縮放（自己＝1）；bottom＝車頂那條線 */
function drawPetRider(x: CanvasRenderingContext2D, key: string, m: Mood, cx: number, bottom: number, frame: number, moving: boolean, k: number, P: string[]) {
  const img = petImg(key, P), bob = (m === 'nitro' ? (frame % 2 ? -2 : 0) : moving && frame % 4 < 2 ? -1 : 0) * k, jit = m === 'crash' ? (frame % 2 ? 1 : -1) * Math.max(1, Math.round(k)) : 0;
  // 只露出上半身（下半身在座艙裡）
  const shp = Math.ceil(img.height * 0.72), dw = Math.max(1, Math.round(img.width * k)), dh = Math.max(1, Math.round(shp * k)), top = Math.round(bottom - dh + bob);
  if (dw < 3) return;
  x.drawImage(img, 0, 0, img.width, shp, Math.round(cx - dw / 2) + jit, top, dw, dh);
  drawMoodFx(x, m, cx + jit, top, dw, frame, k);
}
export function drawRace(x: CanvasRenderingContext2D, v: View) {
  const t = v.track, segs = trackSegs(t.id), n = segs.length, now = v.now ?? performance.now();
  fxUpdate(v.cars, now);
  // 震動：自己被撞時整個畫面（不含 HUD）抖 2-4px，150-250ms，越後面越小
  const sh = v.me ? hitAge(v.me.id, now, 150 + 100 * (fxHit.get(v.me.id)?.k ?? 0)) : null;
  x.save();
  if (sh) { const amp = (2 + 2 * sh.k) * (1 - sh.a), ph = Math.floor(now / 33); x.translate(Math.round((ph % 2 ? 1 : -1) * amp), Math.round(((ph >> 1) % 2 ? 1 : -1) * amp * 0.6)); }
  const night = t.weather === 'night', P = night ? NIGHT : G;
  const camZ = v.camZ ?? (v.me ? v.me.z - PLAYER_DZ : 0);
  // v13：攝影機跟著車橫移一部分（世界單位：半路寬 = ROAD_W），全部用小數，不先取整
  const camXw = v.camX !== undefined ? v.camX * ROAD_W : (v.me ? v.me.x * ROAD_W * camFollow(v.me.x) : 0);
  const base = Math.floor(camZ / SEG_LEN), frac = (camZ % SEG_LEN + SEG_LEN) % SEG_LEN / SEG_LEN;
  const el = elevTable(t), camY = elevAt(el, camZ + PLAYER_DZ) + CAM_H;
  // 天空與遠景（隨彎道視差移動）：累積彎度＋本段小數部分，連續不跳格
  const bend = curvePrefix(t)[((base % n) + n) % n] * 0.8 + segs[((base % n) + n) % n].curve * frac * 0.8;
  role('sky'); x.fillStyle = night ? Q[3] : Q[0]; x.fillRect(0, 0, W, H);
  if (night) { for (let i = 0; i < 36; i++) { x.fillStyle = Q[i % 3 ? 2 : 1]; x.fillRect(Math.floor(((hash(i) * 480 - bend * 0.6) % W + W) % W), Math.floor(hash(i + 50) * 60), 1, 1); } const mx = Math.floor(((180 - bend * 0.6) % W + W) % W); x.fillStyle = Q[1]; x.fillRect(mx + 1, 12, 6, 8); x.fillRect(mx, 13, 8, 6); x.fillStyle = Q[3]; x.fillRect(mx + 4, 13, 3, 5); }
  else if (t.weather === 'clear' && !v.hud) { x.fillStyle = Q[1]; const sx0 = Math.floor(((192 - bend * 0.6) % 280 + 280) % 280) - 20; x.fillRect(sx0 + 2, 16, 8, 12); x.fillRect(sx0, 18, 12, 8); }
  role('city'); drawSkyline(x, t.scenery, bend, night ? NIGHT : Q);
  // 道路（v13，Outrun/TG2 式路段投影）：從攝影機往前逐段積分彎度
  // 每段彎度固定 → 航向 h 線性、橫移 x 二次，且對 camZ 連續（不會隨段落邊界跳格）。
  const pts: { y: number; x: number; w: number; scale: number; i: number; clip: number; wx: number; wy: number; z: number; d: number; h: number; c: number }[] = [];
  let lx = 0, lh = 0, maxy = H;
  const proj = (d: number, wx: number, wy: number) => { const zRel = d + 4, scale = DEPTH * 6 / zRel; return { zRel, scale, py: HORIZON - (wy - camY) * scale * (W / 2) / 6, pxc: W / 2 + (wx - camXw) * scale * (W / 2) }; };
  for (let k = 0; k < DRAW; k++) {
    const d = k === 0 ? 0 : (k - frac) * SEG_LEN, i = base + Math.max(0, k - 1);
    const c = segs[(((base + k) % n) + n) % n].curve * CURVE_K; // 下一段（d → d+L）的彎度
    const wy = elevAt(el, camZ + d), p = proj(d, lx, wy);
    pts.push({ y: p.py, x: p.pxc, w: ROAD_W * p.scale * (W / 2), scale: p.scale, i, clip: maxy, wx: lx, wy, z: p.zRel, d, h: lh, c });
    if (p.py < maxy) maxy = p.py;
    const L = k === 0 ? (1 - frac) * SEG_LEN : SEG_LEN;
    lx += lh * L + c * L * L / 2; lh += c * L;
  }
  for (let k = DRAW - 1; k > 0; k--) {
    const a = pts[k - 1], b = pts[k]; if (b.scale === 0 || a.scale === 0) continue;
    if (b.y >= a.y) continue; // 被坡擋住
    const alt = Math.floor(b.i / 5) % 2 === 0; // v24：路邊紅白／車道虛線每 100m 換一次（原 40m：高速時 2–3 幀就閃一次）
    const y1 = Math.max(0, Math.round(b.y)), y2 = Math.min(H, Math.round(a.y));
    const fog = (night && k > 18) || (t.weather === 'fog' && k > 11), fogC = night ? Q[3] : Q[1];
    for (let yy = y1; yy < y2; yy++) {
      const f = (yy - b.y) / (a.y - b.y || 1);
      const rx = b.x + (a.x - b.x) * f, rw = b.w + (a.w - b.w) * f;
      // 草地色帶：逐行用透視還原真實距離（1/z 內插），每 3m 換色 → 遠處細、近處粗，平順交替
      const zw = 1 / ((1 - f) / (b.z ?? 1) + f / (a.z ?? 1)), galt = Math.floor((camZ + zw) / (SEG_LEN * 1.8)) % 2 === 0; /* v24：草地色帶 36m（原 12m；全滿＋氮氣 489 m/s 時仍 ≥4.4 幀才換色） */ role('grass'); x.fillStyle = fog ? fogC : night ? (galt ? Q[2] : Q[3]) : (galt ? Q[1] : Q[0]); if (t.scenery === 'snow' && !night) x.fillStyle = galt ? Q[0] : Q[1]; if (t.scenery === 'desert' && !fog) x.fillStyle = galt ? Q[1] : Q[0];
      x.fillRect(0, yy, W, 1);
      role('rumble'); x.fillStyle = fog ? fogC : (alt ? Q[3] : Q[0]); const rum = Math.max(1, rw * 0.14);
      x.fillRect(Math.round(rx - rw - rum), yy, Math.ceil(rum), 1); x.fillRect(Math.round(rx + rw), yy, Math.ceil(rum), 1);
      role('road'); x.fillStyle = fog ? fogC : night ? Q[3] : (t.weather === 'rain' ? Q[2] : alt ? Q[2] : Q[2]); if (night && !fog) x.fillStyle = Q[2];
      x.fillRect(Math.round(rx - rw), yy, Math.round(rw * 2), 1);
      role('line'); if (alt && !fog) { x.fillStyle = night ? Q[1] : Q[0]; const lw = Math.max(1, Math.round(rw * 0.035)); for (const lf of [-0.5, 0, 0.5]) x.fillRect(Math.round(rx + rw * lf - lw / 2), yy, lw, 1); } // 虛線車道線（4 線道，像 TG2）
      if (!fog && rw > 6) { x.fillStyle = night ? Q[1] : Q[0]; const ew = Math.max(1, Math.round(rw * 0.02)); x.fillRect(Math.round(rx - rw * 0.94), yy, ew, 1); x.fillRect(Math.round(rx + rw * 0.94) - ew, yy, ew, 1); } // 路肩白線
    }
  }
  // 路邊物與其他車（遠到近）
  const sprites: { k: number; draw: () => void }[] = [];
  // v16：路邊物位置來自引擎 roadside()（伺服器用同一份做碰撞）；pts[k] 正好在第 base+k 段的起點
  const side = roadside(t.id), bySeg = new Map<number, typeof side>(); for (const o of side) { const l = bySeg.get(o.seg); if (l) l.push(o); else bySeg.set(o.seg, [o]); }
  for (let k = Math.min(DRAW - 1, 26); k >= 1; k--) {
    const p = pts[k]; if (!p.scale || p.w < 4) continue;
    const segIdx = (((base + k) % n) + n) % n, os = bySeg.get(segIdx); if (!os) continue;
    if (p.y > pts[k].clip + 1) continue;
    for (const o of os) {
      role('prop'); const img = propCanvas(o.name, night);
      const wx = p.x + o.x * p.w, sc = p.w / ROAD_W * 0.75 / 14 * (o.name === 'tower' ? 2.2 : 1.6);
      const ww = img.width * sc, hh = img.height * sc;
      sprites.push({ k, draw: () => { x.drawImage(img, Math.round(wx - ww / 2), Math.round(p.y - hh), Math.max(1, Math.round(ww)), Math.max(1, Math.round(hh))); } });
    }
  }
  // 所有車（含自己）用同一套投影：同深度同尺寸，自己最近所以最大
  const place = (c: ViewCar) => {
    let dz = c.z - camZ; const L = v.len; dz = ((dz % L) + L) % L; if (dz > L / 2) dz -= L;
    if (dz < 0.5 || dz > (DRAW - 2) * SEG_LEN) return null;
    let k = 0; while (k + 1 < pts.length && pts[k + 1].d <= dz) k++;
    const a = pts[k]; if (!a || !pts[k + 1]) return null;
    const u = dz - a.d, wx = a.wx + a.h * u + a.c * u * u / 2, wy = elevAt(el, camZ + dz), p = proj(dz, wx, wy);
    return { k: k + 1, py: p.py, pxc: p.pxc, pw: ROAD_W * p.scale * (W / 2), clip: a.clip };
  };
  // v14：近處的車（含自己）真實深度會投影到畫面外，畫的時候抬到底線 GROUND；橫向位置也要用「那一列」的路寬，
  // 否則車左右移動比路面快 ~1.8 倍（這正是轉向看起來很衝的原因之一），並排的電腦車也會被甩到畫面邊。
  const GROUND = H - 6;
  const rowAt = (y: number) => { for (let k = 1; k < pts.length; k++) { const a = pts[k - 1], b = pts[k]; if (b.y <= y && a.y >= y && a.y > b.y) { const f = (y - b.y) / (a.y - b.y); return { x: b.x + (a.x - b.x) * f, w: b.w + (a.w - b.w) * f }; } } return null; };
  const gw = rowAt(GROUND)?.w ?? playerPw(); // 底線那一列的半路寬：玩家車寬 PLAYER_W 對應這個路寬
  role('fx');
  for (const pk of v.pickups ?? []) { // 路上氮氣道具：跟車同一套投影
    if (Math.abs(pk.z - camZ) > v.len / 2) continue;
    const p0 = place({ z: pk.z } as ViewCar); if (!p0 || (p0.clip < H && p0.py > p0.clip + 2) || (t.weather === 'fog' && p0.k > 13)) continue;
    // 跟車一樣：比底線近就貼底線那一列（用那一列的路寬），尺寸只隨那一列路寬變大，不設上限
    const row = p0.py > GROUND ? rowAt(GROUND) : null, lat = row ? row.w : p0.pw, cxp = row ? row.x : p0.pxc, py = row ? GROUND : p0.py;
    const img = pickupCanvas(night ? NIGHT.map((c, i) => (i === 0 ? G[0] : c)) : Q), dm = pickupDims(lat, gw, PLAYER_W);
    if (dm.h < 2) continue;
    const ww = Math.max(2, Math.round(dm.w)), hh = Math.max(2, Math.round(dm.h));
    sprites.push({ k: p0.k + 0.1, draw: () => x.drawImage(img, Math.round(cxp + pk.x * lat - ww / 2), Math.round(py - hh), ww, hh) });
  }
  for (const c of v.cars) {
    const isMe = !!v.me && c.id === v.me.id, p0 = place(c); if (!p0) continue;
    const row = p0.py > GROUND ? rowAt(GROUND) : null, p = row ? { ...p0, pxc: row.x, lat: row.w } : { ...p0, lat: p0.pw };
    if (!isMe && p.clip < H && p.py > p.clip + 2) continue; // 被坡頂擋住
    if (!isMe && t.weather === 'fog' && p.k > 13) continue; // 霧裡看不到遠方的車
    const target = PLAYER_W * p.lat / gw; /* v14：車寬跟畫在那一列的路寬成正比 */ if (!isMe && target < 5) continue; const lod = isMe ? -1 : lodFor(target); role(isMe ? 'car' : c.ai ? 'ai' : 'car');
    const img = carCanvas(c.car, c.color, { brake: c.brake, nitro: c.nitroT > 0, hit: c.hit > 0 || (isMe && c.damage > 60 && v.frame % 20 < 2), frame: v.frame }, lod);
    const bh = (img as any).bodyH as number;
    const bob = isMe && c.speed > 5 && c.speed < 15 * SPEED_X && Math.floor(now / 160) % 2 ? 1 : 0, /* v24：只在低速輕輕晃（依毫秒），高速不晃 */ shake = c.hit > 0 ? (v.frame % 2 ? 1 : -1) : 0;
    // 畫面寬度超過 24px（比玩家還近）才放大 L 圖，否則原尺寸
    // v14：AI 與玩家同比例 —— 挑「不小於目標寬度」的 LOD 再縮到剛好目標寬（以前挑較小的 LOD 不放大，遠一點就小一截）
    const scale = isMe ? 1 : target / LODS[lod];
    const dw = Math.round(img.width * scale), dh = Math.round(img.height * scale);
    const sx = Math.round(p.pxc + c.x * p.lat - dw / 2 + shake), sy = (isMe ? Math.min(H - 6 - bh, Math.round(p.py - bh)) : Math.min(H - 6 - Math.round(bh * scale), Math.round(p.py - bh * scale))) - bob; // v14：和玩家並排的車也貼同一條底線，不會掉出畫面
    sprites.push({ k: p.k + (isMe ? -0.5 : 0), draw: () => {
      const fp = c.flip ? 1 - c.flip / FLIP_TICKS : 0;
      if (fp > 0) { // v16 翻車：拋起來翻滾兩圈半、往外側飄，落地前壓扁（像 TG2 撞樹翻車）
        const dir = c.x >= 0 ? 1 : -1, lift = Math.sin(Math.PI * Math.min(1, fp * 1.15)) * dh * 1.6, ang = dir * fp * Math.PI * 5;
        const squash = fp > 0.85 ? 1 - (fp - 0.85) * 2 : 1;
        x.save(); x.translate(Math.round(sx + dw / 2 + dir * fp * dw * 0.35), Math.round(sy + dh / 2 - lift)); x.rotate(Math.round(ang / (Math.PI / 8)) * (Math.PI / 8)); x.scale(1, squash);
        x.drawImage(img, -dw / 2, -dh / 2, dw, dh); if (fp < 0.08) x.drawImage(flashOf(img), -dw / 2, -dh / 2, dw, dh); x.restore();
        x.fillStyle = Q[3]; const shw = Math.round(dw * (0.5 + 0.5 * (1 - lift / (dh * 1.6)))); x.fillRect(Math.round(sx + dw / 2 - shw / 2 + dir * fp * dw * 0.35), sy + dh - 2, shw, 2); // 地上影子
      } else { const fire = isMe && c.nitroT > 0 && !c.fin; if (fire) drawFlameBack(x, c.car, sx, sy, dw, bh, v.frame); x.drawImage(img, sx, sy, dw, dh); if (fire) drawBigFlame(x, c.car, sx, sy, dw, v.frame); if (c.pet && !c.ai) drawPetRider(x, c.pet, petMood(c, now), sx + dw / 2, sy + Math.round(bh * 0.4 * scale), v.frame, c.speed > 5, scale, night ? PET_NIGHT : Q); }
      const fl = hitAge(c.id, now, 90 + 90 * (fxHit.get(c.id)?.k ?? 0)); if (fl && Math.floor(fl.a * 4) % 2 === 0) x.drawImage(flashOf(img), sx, sy, dw, dh); // 閃白
      for (const p of sparks) { if (p.id !== c.id) continue; const age = now - p.t0; if (age < 0 || age > p.life) continue; const ts = age / 1000;
        const sc = dw / 48; x.fillStyle = Q[p.c]; x.fillRect(Math.round(sx + dw / 2 + p.ox * dw + p.vx * ts * sc), Math.round(sy + p.oy * dh + (p.vy * ts + 160 * ts * ts) * sc), p.sz, p.sz); }
      const pa = pickAge(c.id, now); if (pa !== null && (isMe || !c.ai)) { // 吃到道具：小小 6 點火花（不發光）
        const cx0 = sx + dw / 2, cy0 = sy + dh * 0.4, R = dw * (0.2 + pa * 0.4);
                for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + 0.2, px = Math.round(cx0 + Math.cos(a) * R), py = Math.round(cy0 + Math.sin(a) * R * 0.7), z = pa < 0.5 ? 1 : 0;
          x.fillStyle = Q[i % 2 ? 0 : 1]; x.fillRect(px - z, py, z * 2 + 1, 1); x.fillRect(px, py - z, 1, z * 2 + 1); }
      }
      if (isMe && c.damage > 50) for (let i = 0; i < 3; i++) { x.fillStyle = Q[i % 2 ? 1 : 2]; x.fillRect(sx + 6 + ((v.frame * 3 + i * 7) % 12), sy - 3 - ((v.frame + i * 3) % 6), 2, 2); }
      if (isMe && Math.abs(c.x) > 1 && c.speed > 5) for (let i = 0; i < 4; i++) { x.fillStyle = Q[1]; x.fillRect(sx + (i % 2 ? dw - 2 : 0) + (v.frame % 3), sy + bh - 2 - (i >> 1) * 2, 2, 1); }
    } });
  }
  sprites.sort((p, q) => q.k - p.k).forEach((s) => s.draw());
  if (sparks.length && now - sparks[0].t0 > 1500) sparks = sparks.filter((p) => now - p.t0 < 1000);
  // 天氣
  role('fx');
  if (t.weather === 'rain') { x.fillStyle = Q[1]; for (let i = 0; i < 90; i++) { const rx = Math.floor((hash(i) * W + v.frame * 6 + i * 7) % W), ry = Math.floor((hash(i + 99) * H + v.frame * 18) % H); x.fillRect(rx, ry, 1, 5); x.fillRect(rx - 1, ry + 5, 1, 2); } }
  if (t.weather === 'snow') { x.fillStyle = Q[0]; for (let i = 0; i < 90; i++) { const sx = Math.floor((hash(i) * W + Math.sin((v.frame + i * 13) / 9) * 3 - (v.me?.x ?? 0) * 10 + W) % W), sy = Math.floor((hash(i + 7) * H + v.frame * (1 + (i % 3))) % H); x.fillRect(sx, sy, i % 4 ? 1 : 2, 1); } }
  if (t.weather === 'fog') { const fc = txCache(`fog${Q[1]}|${v.frame & 1}`, W, HORIZON + 30, (cx) => { cx.fillStyle = Q[1]; for (let yy = 0; yy < HORIZON + 30; yy++) for (let xx = (yy + v.frame) & 1; xx < W; xx += yy < HORIZON ? 2 : 4 + ((yy - HORIZON) >> 3)) if (yy < HORIZON || hash(xx * 7 + yy) < 0.5) cx.fillRect(xx, yy, 1, 1); }); if (fc) x.drawImage(fc, 0, 0); }
  if (v.hud && v.me && v.me.nitroT > 0 && !v.me.fin) drawNitroFx(x, v, now);
  x.restore();
  role('hud'); if (v.hud) drawHud(x, v, now);
  Q = G;
}
/** 氮氣：不出字，用畫面本身表現——下半部微微拉寬（FOV 感）、從消失點往外的速度線、左右邊緣一閃一閃的亮色描邊。 */
// ---------------- v25 氮氣特效：大火焰＋放射狀動態模糊（4 綠、像素風） ----------------
/** 強度（0 關…1 預設…1.5 強）：flame＝火焰長度倍率、blur＝邊緣模糊密度倍率 */
export const NITRO_FX = { flame: 1, blur: 1 };
const n1 = (i: number) => hash(i * 7.31 + 0.17);
/** 每根排氣管往後（朝鏡頭＝往下）噴出扇形大火：中心最亮、外圈最暗描邊，20Hz 閃動、舌尖參差。L≈車寬 0.65（兩側合起來比車還寬） */
function drawBigFlame(x: CanvasRenderingContext2D, model: string, sx: number, sy: number, dw: number, frame: number) {
  // 畫在車身上面：從排氣口往後（朝鏡頭＝往下）噴，越往下越寬，畫面底下切掉；舌頭長度每幀變（20Hz 閃動）
  const k = dw / DESIGN_W, L = dw * 0.7 * NITRO_FX.flame; if (L < 4) return;
  const ys = sy + Math.round(EXHAUST_Y * k) - 2, xs = exhaustsOf(model).map((e) => sx + e * k), cols = Math.ceil(L * 1.3);
  const y1 = Math.min(H, Math.ceil(ys + L));
  for (const ex of xs) for (let px = Math.floor(ex - cols); px <= ex + cols; px++) {
    const u = (px - ex) / cols, len = L * (1 - u * u * 0.75) * (0.7 + 0.3 * n1(Math.floor(px / 2) * 13 + frame * 7 + ex)); // 中間最長、兩側短
    for (let py = ys; py < y1; py++) {
      const d = py - ys, hw = (d + 2) * 1.5; if (Math.abs(px - ex) > hw || d > len) continue; // 往下張開的扇形
      const s = Math.max(d / len, Math.abs(px - ex) / hw);
      x.fillStyle = Q[s < 0.35 ? 0 : s < 0.6 ? 1 : s < 0.85 ? 2 : 3]; x.fillRect(px, py, 1, 1);
    }
  }
}
/** 車身後面的火球：以排氣口為中心、比車寬的橢圓，邊緣參差閃動；車身蓋在上面 → 火舌從車尾兩側與上方竄出 */
function drawFlameBack(x: CanvasRenderingContext2D, model: string, sx: number, sy: number, dw: number, bh: number, frame: number) {
  const k = dw / DESIGN_W, f = NITRO_FX.flame; if (dw * f < 8) return;
  const xs = exhaustsOf(model).map((e) => sx + e * k), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = sy + Math.round(EXHAUST_Y * k);
  const rx = dw * (0.5 + 0.28 * f) + (xs.length > 1 ? (Math.max(...xs) - Math.min(...xs)) / 2 : 0), ry = bh * 0.75 * f, bins = 16;
  const tl: number[] = []; for (let b = 0; b < bins; b++) tl.push(0.68 + 0.32 * n1(b * 17 + frame * 3));
  // 逐列掃描、同色連續段一次 fillRect（避免逐像素繪製）
  const x0 = Math.floor(cx - rx), x1 = Math.floor(cx + rx), y1 = Math.min(H, cy + ry * 0.4);
  for (let py = Math.max(0, Math.floor(cy - ry)); py < y1; py++) {
    const dy = (py - cy) / ry; let run = -1, rs = 0;
    for (let px = x0; px <= x1 + 1; px++) {
      let ci = -1;
      if (px <= x1) {
        const dx = (px - cx) / rx, bi = Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * bins) % bins, s = Math.hypot(dx, dy) / tl[bi];
        if (s < 1 && !(((px + py + frame) & 1) && s > 0.62 && s < 0.7)) ci = s < 0.62 ? 0 : s < 0.84 ? 1 : 2;
      }
      if (ci !== run) { if (run >= 0) { x.fillStyle = Q[run]; x.fillRect(rs, py, px - rs, 1); } run = ci; rs = px; }
    }
  }
}
/** Bayer 4×4 有序抖動遮罩：中間（消失點附近）完全透明，越往邊緣越密 → 疊上放大的畫面＝放射狀拖影，但仍只有 4 種綠 */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const maskCache = new Map<string, HTMLCanvasElement>();
function blurMask(dens: number, cy: number) {
  const key = `${dens.toFixed(2)}|${cy}`; let m = maskCache.get(key); if (m) return m;
  m = document.createElement('canvas'); m.width = W; m.height = H; const g = m.getContext('2d')!; g.fillStyle = '#000';
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) { const r = Math.hypot((xx - W / 2) / (W / 2), (y - cy) / (H * 0.62)); const st = Math.min(1, Math.max(0, (r - 0.38) / 0.62)) ** 1.4 * dens; if ((BAYER[(y & 3) * 4 + (xx & 3)] + 0.5) / 16 < st) g.fillRect(xx, y, 1, 1); }
  maskCache.set(key, m); return m;
}
let zoomCv: HTMLCanvasElement | null = null;
function drawRadialBlur(x: CanvasRenderingContext2D, frame: number, cy: number) {
  if (NITRO_FX.blur <= 0 || typeof document === 'undefined') return;
  if (!zoomCv) { zoomCv = document.createElement('canvas'); zoomCv.width = W; zoomCv.height = H; }
  const z = zoomCv.getContext('2d')!; z.imageSmoothingEnabled = false;
  for (const [s0, d] of [[1.05, 0.55], [1.12, 0.4]] as const) { // 兩層：小放大較密、大放大較疏
    const s = s0 + (frame & 1) * 0.015, cx = W / 2;
    z.globalCompositeOperation = 'copy'; z.drawImage(x.canvas, 0, 0, W, H, cx - cx * s, cy - cy * s, W * s, H * s);
    z.globalCompositeOperation = 'destination-in'; z.drawImage(blurMask(Math.min(1, d * NITRO_FX.blur), Math.round(cy)), 0, 0);
    x.drawImage(zoomCv, 0, 0);
  }
  z.globalCompositeOperation = 'source-over';
}
function drawNitroFx(x: CanvasRenderingContext2D, v: View, now: number) {
  role('fx');
  drawRadialBlur(x, v.frame, HORIZON + 6);
  const t = now / 1000, pulse = 0.5 + 0.5 * Math.sin(t * 18), cx = W / 2, cy = HORIZON + 6;
  // 1) 拉伸：地平線以下左右各外擴 3~5%
  const st = 0.03 + 0.02 * pulse, sy = HORIZON, sh = H - HORIZON;
  if (x.canvas && (x.canvas as any).width) x.drawImage(x.canvas, 0, sy, W, sh, -W * st / 2, sy, W * (1 + st), sh);
  // 2) 速度線：從消失點往外，越外面越長，最亮／最暗交錯
  for (let i = 0; i < 52; i++) { // 手動氮氣與路上道具共用（都是 nitroT > 0）；v23 線數 ×2、更長更粗
    const a = hash(i + 300) * Math.PI * 2, sp = (t * (2.2 + hash(i + 400)) + hash(i + 500)) % 1;
    const r0 = 24 + sp * 140, r1 = r0 + 22 + sp * 70;
    x.fillStyle = Q[i % 3 ? 0 : 3];
    for (let r = r0; r < r1; r += 1.5) { const px = Math.round(cx + Math.cos(a) * r * 1.3), py = Math.round(cy + Math.sin(a) * r * 0.8); if (px < 0 || px >= W || py < 0 || py >= H) break; if (Math.abs(px - cx) < 40 && py > H - 70) continue; x.fillRect(px, py, 3, 2); }
  }
  // 3) 邊緣色調脈動：左右兩條抖動的亮色網點
  const bw = 6 + Math.round(pulse * 6); x.fillStyle = Q[0];
  for (let yy = 0; yy < H; yy += 2) for (let xx = 0; xx < bw; xx += 2) { const o = (yy >> 1) & 1; if ((xx + o + v.frame) & 2) { x.fillRect(xx + o, yy, 1, 1); x.fillRect(W - 1 - xx - o, yy, 1, 1); } }
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
    const hh = Math.min(10, Math.round(h * 0.6)); x.fillStyle = P[2]; x.fillRect(px, HORIZON - 4 - hh, 1, hh + 5); // v10：天際線矮一點、貼近地平線
    if (scene === 'snow') { x.fillStyle = Q[0]; x.fillRect(px, HORIZON - 4 - Math.min(10, Math.round(h * 0.6)), 1, 2); }
    if (scene === 'city' && (wx * 7 + h) % 5 === 0 && h > 8) { x.fillStyle = P[0] === Q[0] ? Q[1] : Q[1]; x.fillRect(px, HORIZON - 2 - Math.min(10, Math.round(h * 0.6)), 1, 1); }
  }
  if (scene === 'city' || scene === 'coast') { // 海灣：天際線前一條水面＋反光
    const Wp = PAL?.water ?? P; x.fillStyle = Wp === P ? P[1] : Wp[1]; x.fillRect(0, HORIZON - 5, W, 5);
    x.fillStyle = Wp === P ? P[0] : Wp[0]; for (let i = 0; i < 40; i++) x.fillRect(Math.floor(((hash(i + 300) * 520 - bend * 0.8) % W + W) % W), HORIZON - 5 + (i % 4), 2 + (i % 3), 1);
    x.fillStyle = Wp === P ? P[2] : Wp[2]; x.fillRect(0, HORIZON - 1, W, 1);
  }
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
/** 名次：跑完的照完賽順序排前面，其餘照距離（跟 HUD 名次一致；修「1ST」選到還沒跑完但 z 比較大的車）。 */
/** 速度表顯示＝真實 km/h ÷ 3（v21：速度再 ×2 後數字不要太誇張） */
export const kmhShown = (ms: number) => ms * 3.6 / 3;
export function raceOrder<T extends { z: number; fin: number | null }>(cars: T[]): T[] { return [...cars].sort((p, q) => (p.fin ?? 1e12) - (q.fin ?? 1e12) || q.z - p.z); }
export function drawMinimap(x: CanvasRenderingContext2D, v: View, mx: number, my: number, bw = 64, bh = 52) {
  const m = trackMap(v.track.id, bw, bh), n = m.pts.length;
  role('hud');
  if (!v.hud) panel(x, mx, my, bw, bh);
  // 粗線賽道：先畫最暗外框，再畫亮色
  for (const [c, wd] of [[3, 2], [0, 1]] as const) { x.fillStyle = Q[c]; for (let i = 0; i < n; i++) { const a = m.pts[i], b = m.pts[(i + 1) % n]; for (let oy = -wd + 1; oy < wd; oy++) for (let ox = -wd + 1; ox < wd; ox++) line(x, mx + a[0] + ox, my + a[1] + oy, mx + b[0] + ox, my + b[1] + oy); } }
  const at = (z: number) => m.pts[((Math.floor(((z % v.len) + v.len) % v.len / SEG_LEN)) % n + n) % n];
  const dot = (p: [number, number], c: number) => { x.fillStyle = Q[3]; x.fillRect(mx + p[0] - 2, my + p[1] - 2, 5, 5); x.fillStyle = Q[c]; x.fillRect(mx + p[0] - 1, my + p[1] - 1, 3, 3); };
  // v21：每台車都畫點（名次跟 HUD 一樣：先跑完的在前）。電腦＝小暗點；真人＝大點；前 3 名和真人標名次；自己閃爍＋P名次
  const order = raceOrder(v.cars), placed: [number, number, number][] = [];
  const lab = (t: string, p: [number, number], col: number) => {
    const tw = textW(t), px = mx + p[0], py = my + p[1];
    const cands: [number, number][] = [[px + 5, py - 3], [px - 5 - tw, py - 3], [px - tw / 2, py - 12], [px - tw / 2, py + 5], [px + 5, py - 12], [px - 5 - tw, py + 5], [px + 5, py + 5], [px - 5 - tw, py - 12], [px - tw / 2, py - 18], [px - tw / 2, py + 11]];
    const cost = ([cx0, cy0]: [number, number]) => (cx0 < 0 || cx0 + tw > W - 1 ? 99 : 0) + placed.reduce((n, [qx, qy, qw]) => n + Math.max(0, Math.min(cx0 + tw, qx + qw) - Math.max(cx0, qx) + 1) * Math.max(0, Math.min(cy0 + 7, qy + 7) - Math.max(cy0, qy)), 0);
    const [tx, ty] = cands.reduce((b, c) => (cost(c) < cost(b) ? c : b));
    placed.push([tx, ty, tw]); otext(x, t, Math.round(tx), Math.round(ty), col);
  };
  for (const pk of v.pickups ?? []) { const p = at(pk.z); x.fillStyle = Q[3]; x.fillRect(mx + p[0] - 1, my + p[1] - 1, 3, 3); } // 路上氮氣道具：固定小方塊（不閃、無光暈）
  const others = order.map((c, i) => ({ c, i })).filter(({ c }) => !(v.me && c.id === v.me.id));
  for (const { c } of others) if (c.ai) { const p = at(c.z); x.fillStyle = Q[3]; x.fillRect(mx + p[0] - 1, my + p[1] - 1, 2, 2); }
  const tagged = others.filter(({ c, i }) => !c.ai || i < 3);
  for (const { c } of tagged) dot(at(c.z), c.ai ? 2 : 1);
  if (v.hud) { for (const c of [...tagged.map((q) => q.c), ...(v.me ? [v.me] : [])]) { const p = at(c.z); placed.push([mx + p[0] - 3, my + p[1] - 3, 6]); } }
  if (v.hud) for (const { c, i } of tagged) lab(String(i + 1), at(c.z), 0);
  if (v.me) { const p = at(v.me.z), on = v.frame % 8 < 5, r = order.findIndex((c) => c.id === v.me!.id) + 1;
    x.fillStyle = Q[3]; x.fillRect(mx + p[0] - 3, my + p[1] - 3, 7, 7); x.fillStyle = Q[on ? 0 : 1]; x.fillRect(mx + p[0] - 2, my + p[1] - 2, 5, 5); x.fillStyle = Q[on ? 1 : 0]; x.fillRect(mx + p[0], my + p[1], 1, 1);
    if (v.hud) lab(`P${r}`, p, 0); }
}
/** 外框字：先畫 8 方向最暗色，再填色（HUD 疊在天空上也看得清楚） */
function otext(x: CanvasRenderingContext2D, s: string, px: number, py: number, col: number, scale = 1) {
  // 乾淨的粗體像素字：字形遮罩（大字每筆加粗 1px）→ 外圍一圈 1px 最暗色 → 實心填色
  const bold = scale >= 2, cw = textW(s, scale) + 4, ch = 7 * scale + 3, m = new Uint8Array(cw * ch);
  [...s.toUpperCase()].forEach((c, k) => { const f = FONT[c] ?? FONT[' ']; for (let i = 0; i < 35; i++) if (f[i] === '1') for (let a = 0; a < scale + (bold ? 1 : 0); a++) for (let b = 0; b < scale; b++) { const X = 1 + (k * 6 + (i % 5)) * scale + a, Y = 1 + Math.floor(i / 5) * scale + b; if (X < cw && Y < ch) m[Y * cw + X] = 1; } });
  // 綠色模式天空是最亮色：字用最暗色實心＋中淺色 1px 外框；全彩模式用亮字＋黑框（像 TG2）
  const fill = PAL ? Q[col] : Q[col === 0 ? 3 : 2], edge = PAL ? Q[3] : Q[1];
  x.fillStyle = edge;
  for (let y = 0; y < ch; y++) for (let i = 0; i < cw; i++) if (!m[y * cw + i] && ((i > 0 && m[y * cw + i - 1]) || m[y * cw + i + 1] || (y > 0 && m[(y - 1) * cw + i]) || m[(y + 1) * cw + i])) x.fillRect(px - 1 + i, py - 1 + y, 1, 1);
  x.fillStyle = fill; for (let y = 0; y < ch; y++) for (let i = 0; i < cw; i++) if (m[y * cw + i]) x.fillRect(px - 1 + i, py - 1 + y, 1, 1);
}
const SUF = (n: number) => (n % 100 >= 11 && n % 100 <= 13) ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH';
/** v9 HUD（TG2 版面）：左上 轉速弧＋大速度、氮氣列、AUTO＋檔位、車體損傷圖、完美度 E…F；右上 計時、地圖、LAP、名次。 */
/** HUD 俯視車（44×15）：r 後段、s 兩側、f 車頭、c 座艙、k 座艙線條、w 輪胎、o 外框（自動描邊） */
export const HUD_CAR_W = 42;
let hudCarCache: [number, number, string][] | null = null;
export function hudCarPixels(): [number, number, string][] {
  if (hudCarCache) return hudCarCache;
  const W0 = HUD_CAR_W, H0 = 17, g: string[][] = Array.from({ length: H0 }, () => Array(W0).fill('.'));
  const set = (i: number, j: number, ch: string) => { if (i >= 0 && i < W0 && j >= 0 && j < H0) g[j][i] = ch; };
  // 輪胎（上下各兩顆，凸出車身）
  for (const wx of [6, 25]) for (let i = wx; i < wx + 7; i++) for (const j of [2, 14]) set(i, j, 'w');
  // 車身：x 2..30 方形，30..39 圓弧車頭（TG2 那種圓鼻子）
  for (let j = 3; j <= 13; j++) for (let i = 2; i <= 39; i++) {
    const dy = Math.abs(j - 8), nose = i > 30 ? ((i - 30) / 9.5) ** 2.6 + (dy / 5.6) ** 2.6 <= 1 : true; if (!nose) continue;
    set(i, j, i <= 8 ? 'r' : i >= 31 ? 'f' : (j <= 4 || j >= 12) ? 's' : 'c');
  }
  // 座艙：框線＋前後擋風玻璃線、尾翼
  for (let i = 11; i <= 28; i++) { set(i, 5, 'k'); set(i, 11, 'k'); }
  for (let j = 5; j <= 11; j++) { set(11, j, 'k'); set(28, j, 'k'); set(16, j, 'k'); set(23, j, 'k'); }
  for (let j = 4; j <= 12; j++) set(4, j, 'k');
  // 外框兩圈：裡圈最亮（o）、外圈最暗（d），在淺色背景上也看得清楚
  const solid = (i: number, j: number) => !!g[j]?.[i] && g[j][i] !== '.';
  const ring = (want: (i: number, j: number) => boolean, ch: string) => { const add: [number, number][] = [];
    for (let j = 0; j < H0; j++) for (let i = 0; i < W0; i++) if (g[j][i] === '.' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => want(i + a, j + b))) add.push([i, j]);
    for (const [i, j] of add) g[j][i] = ch; };
  ring(solid, 'o'); ring((i, j) => g[j]?.[i] === 'o', 'd');
  const out: [number, number, string][] = [];
  for (let j = 0; j < H0; j++) for (let i = 0; i < W0; i++) if (g[j][i] !== '.') out.push([i, j, g[j][i]]);
  return (hudCarCache = out);
}
function drawHud(x: CanvasRenderingContext2D, v: View, now = performance.now()) {
  const me = v.me; if (!me) return;
  const top = v.top ?? 80, gears = Math.max(4, Math.min(6, v.gears ?? 5)), frac = Math.max(0, Math.min(1, me.speed / top));
  const gear = Math.min(gears, 1 + Math.floor(frac * gears * 0.999));
  const rpm = me.speed < 1 ? 0.08 : Math.min(1, 0.25 + ((frac * gears) % 1) * 0.75 + (gear === gears ? frac * 0.2 : 0));
  // 轉速弧：16 格，沿四分之一橢圓由左下往右上，最後 4 格是紅區
  const SEG = 16, lit = Math.round(rpm * SEG), cxA = 104, cyA = 36, rx = 96, ry = 32;
  for (let i = 0; i < SEG; i++) {
    const a0 = Math.PI + (i / SEG) * Math.PI / 2, a1 = Math.PI + ((i + 0.72) / SEG) * Math.PI / 2;
    const red = i >= SEG - 4; role(red ? 'tachR' : i >= SEG - 8 ? 'tachY' : 'tachG'); if (!PAL) Q = G;
    for (let r = 0; r < 7; r++) for (let a = a0; a <= a1; a += 0.004) {
      const px = Math.round(cxA + Math.cos(a) * (rx - r)), py = Math.round(cyA + Math.sin(a) * (ry - r * 0.9)); if (py < 2) continue;
      x.fillStyle = PAL ? Q[i < lit ? (r === 0 || r === 6 ? 3 : r < 3 ? 0 : 1) : (r === 0 || r === 6 ? 3 : 2)] : Q[i < lit ? (r === 0 || r === 6 ? 3 : r < 3 ? 2 : 3) : (r === 0 || r === 6 ? 2 : 1)]; x.fillRect(px, py, 1, 1);
      if (i < lit && red && v.frame % 4 < 2 && r > 2 && r < 5) { x.fillStyle = Q[PAL ? 0 : 1]; x.fillRect(px, py, 1, 1); }
    }
  }
  role('hud');
  const sp = String(Math.round(kmhShown(me.speed))); otext(x, sp, 104 - textW(sp, 3), 16, me.nitroT > 0 && v.frame % 4 < 2 ? 1 : 0, 3); otext(x, 'KM/H', 104 - textW('KM/H'), 39, 1);
  // 氮氣列：斜體 N＋斜條（每瓶 2 條），用掉的變暗
  otext(x, 'N', 16, 47, 1);
  // v20：剩餘氮氣次數 —— 3 支小鋼瓶（剩的實心、用掉的空心、正在噴的閃）＋「×N」
  const BOT = ['.33.', '3333', '3013', '3013', '3113', '3113', '3333'];
  for (let i = 0; i < NITRO_PER_RACE; i++) {
    const on = i < me.nitro, act = me.nitroT > 0 && i === me.nitro, bx = 25 + i * 7;
    BOT.forEach((r, j) => [...r].forEach((ch, k) => { if (ch === '.') return; const edge = ch === '3';
      if (!on && !act && !edge) return; // 用掉的：只剩外框（空瓶）
      x.fillStyle = Q[act ? (v.frame % 2 ? 1 : 3) : on ? (edge ? 3 : ch === '0' ? 1 : 2) : 2]; x.fillRect(bx + k, 47 + j, 1, 1); }));
  }
  otext(x, `×${me.nitro}`.replace('×', 'X'), 25 + NITRO_PER_RACE * 7 + 2, 47, me.nitro ? 0 : 2);
  otext(x, 'AUTO', 26, 57, 0);
  // 檔位 R 1..n，目前檔位亮＋放大
  let gx = 22; ['R', ...Array.from({ length: gears }, (_, i) => String(i + 1))].forEach((g, i) => { const cur = me.speed > 1 && i === gear; if (cur) { otext(x, g, gx, 64, 1, 2); gx += 12; } else { otext(x, g, gx, 68, 2); gx += 7; } });
  // v23：車體損傷圖（照 TG2：俯視、橫放、車頭圓弧朝右；黑色車身＋座艙／輪胎細節，外圈最亮色描邊）
  // 前／側／後三區各自依分區損傷變色（黑→深綠→淺綠閃爍），剛撞到的那一區快閃；旁邊顯示完美度 NN%（＝condition，跟極速懲罰同一個數）
  const cond = Math.max(0, Math.round(100 - me.damage));
  const zd = me.zd ?? [0, 0, 0], zcol = (d: number) => d < 34 ? 3 : d < 67 ? 2 : (v.frame % 8 < 5 ? 1 : 3);
  const zc: Record<string, number> = { o: 0, d: 3, w: 3, k: 2, c: 3, f: zcol(zd[0]), s: zcol(zd[1]), r: zcol(zd[2]) };
  const hz = hudZone(me, now); if (hz) zc[hz.zone] = hz.on ? 0 : 3; // 被撞的那一區快閃
  const DX = 20, DY = 79;
  for (const [i, j, ch] of hudCarPixels()) { x.fillStyle = Q[zc[ch]]; x.fillRect(DX + i, DY + j, 1, 1); }
  const pct = `${cond}%`; otext(x, pct, DX + HUD_CAR_W + 3, DY + 5, cond < 40 && v.frame % 6 < 3 ? 2 : 0);
  // 完美度條（像油表 E…F）
  otext(x, 'E', 8, 97, 2); otext(x, 'F', 90, 97, 0);
  for (let i = 0; i < 14; i++) { const on = i < Math.round(cond / 100 * 14); x.fillStyle = Q[3]; x.fillRect(16 + i * 5, 96, 5, 9); x.fillStyle = Q[on ? (i < 4 ? 1 : 0) : 2]; x.fillRect(17 + i * 5, 97, 3, 7); }
  // 右上：計時 0'28"98
  const ms = Math.max(0, v.tick - 60) * 50, ts = `${Math.floor(ms / 60000)}'${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}"${String(Math.floor(ms / 10) % 100).padStart(2, '0')}`;
  otext(x, ts, W - 6 - textW(ts, 2), 5, 0, 2);
  drawMinimap(x, v, W - 104, 20, 100, 62); // v23：小地圖放大約 1.7 倍（原 58×40）
  role('hud');
  const lap = Math.min(v.laps, Math.floor(Math.max(0, me.z) / v.len) + 1);
  otext(x, 'LAP', W - 86, 88, 0); otext(x, `${lap}/${v.laps}`, W - 62, 84, 0, 2);
  const rk = String(v.rank), rw = textW(rk, 2) + 3 + textW(SUF(v.rank)); otext(x, rk, W - 8 - rw, 100, 0, 2); otext(x, SUF(v.rank), W - 8 - textW(SUF(v.rank)), 100, 0); // 名次留在地平線（路面）上方
  // 倒數／訊息
  if (v.countdown > 0) { const s = String(Math.ceil(v.countdown / 20)); otext(x, s, W / 2 - 15, 40, 0, 6); }
  else if (v.tick - 60 < 20 && v.tick >= 60) otext(x, 'GO!', W / 2 - 34, 46, 0, 4);
  if (v.countdown > 0 || (v.tick >= 60 && v.tick < 110)) { // 起跑對話框（TG2 的 BURN RUBBER 泡泡），在自己的車左上
    const s1 = 'BURN', s2 = 'RUBBER!', bx = W / 2 - 58, by = 128, bw = 46, bh = 21;
    x.fillStyle = Q[3]; x.fillRect(bx - 1, by - 1, bw + 2, bh + 2); x.fillStyle = Q[0]; x.fillRect(bx, by, bw, bh);
    for (let i = 0; i < 6; i++) { x.fillStyle = Q[3]; x.fillRect(bx + bw - 12 + i, by + bh + i, 3, 1); x.fillStyle = Q[0]; x.fillRect(bx + bw - 11 + i, by + bh - 1 + i, 1, 1); }
    text(x, s1, bx + bw / 2 - textW(s1) / 2, by + 3, 3); text(x, s2, bx + bw / 2 - textW(s2) / 2, by + 11, 3);
  }
  if (v.flash && v.frame % 8 < 6) otext(x, v.flash, Math.round(W / 2 - textW(v.flash, 2) / 2), 120, 0, 2);
}
export { trackById };
