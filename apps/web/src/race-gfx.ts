/** 賽車模式繪圖：120×100 偽 3D 道路（Game Boy 四階綠），原創像素跑車（從車尾看）。 */
import { SEG_LEN, trackSegs, trackById, NITRO_PER_RACE, type Track } from '@chick/engine';
import { carArt, carPixels, LODS, type CarLook } from './race-cars';

export const W = 120, H = 100;
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
  (c as any).bodyH = carArt(model, lod).length; // 車身高度（不含火焰），用來對齊地面
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
  propCache.set(key, c); return c;
}
const hash = (n: number) => { let x = (n * 2654435761) >>> 0; x ^= x >>> 13; x = Math.imul(x, 1274126177) >>> 0; return x / 4294967296; };

// ---------- 3×5 像素字 ----------
const FONT: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
  P: '111101111100100', O: '111101101101111', S: '111100111001111', L: '100100100100111', A: '111101111101101', K: '101101110101101', M: '101111111101101', H: '101101111101101', N: '110101101101101', G: '111100101101111', D: '110101101101110', R: '110101110101101', E: '111100110100111', T: '111010010010010', I: '111010010010111', F: '111100110100100', C: '111100100100111', U: '101101101101111', W: '101101111111101', Y: '101101010010010', B: '110101110101110', V: '101101101101010', X: '101101010101101',
  '/': '001001010100100', ':': '000010000010000', '.': '000000000000010', '-': '000000111000000', '!': '010010010000010', ' ': '000000000000000', "'": '010010000000000', '"': '101101000000000',
};
export function text(x: CanvasRenderingContext2D, s: string, px: number, py: number, col = 3, scale = 1, shadow: number | null = null) {
  if (shadow !== null) text(x, s, px + scale, py + scale, shadow, scale);
  x.fillStyle = G[col];
  [...s.toUpperCase()].forEach((ch, k) => { const f = FONT[ch] ?? FONT[' ']; for (let i = 0; i < 15; i++) if (f[i] === '1') x.fillRect(px + (k * 4 + (i % 3)) * scale, py + Math.floor(i / 3) * scale, scale, scale); });
}
export const textW = (s: string, scale = 1) => s.length * 4 * scale - scale;

export interface ViewCar { id: string; z: number; x: number; speed: number; damage: number; nitro: number; nitroT: number; fin: number | null; hit: number; car: string; color: number; name: string; ai: boolean; brake?: boolean }
export interface View { track: Track; me: ViewCar | null; cars: ViewCar[]; tick: number; countdown: number; laps: number; len: number; rank: number; flash?: string; frame: number; hud: boolean; camZ?: number; camX?: number }

const ROAD_W = 0.75, CAM_H = 6, DEPTH = 0.9, DRAW = 60, HORIZON = 40;
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
  if (night) { for (let i = 0; i < 18; i++) { x.fillStyle = G[i % 3 ? 2 : 1]; x.fillRect(Math.floor(((hash(i) * 240 - bend * 0.3) % 120 + 120) % 120), Math.floor(hash(i + 50) * 30), 1, 1); } x.fillStyle = G[1]; x.fillRect(Math.floor(((90 - bend * 0.3) % 120 + 120) % 120), 6, 4, 4); }
  else if (t.weather === 'clear') { x.fillStyle = G[1]; x.fillRect(Math.floor(((96 - bend * 0.3) % 140 + 140) % 140) - 10, 8, 6, 6); }
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
    const target = CAR_W * p.pw * 2 * (24 / (CAR_W * 2 * playerPw())), lod = isMe ? 0 : pickLod(target);
    const img = carCanvas(c.car, c.color, { brake: c.brake, nitro: c.nitroT > 0, hit: c.hit > 0 || (isMe && c.damage > 70 && v.frame % 20 < 2), frame: v.frame }, lod);
    const bh = (img as any).bodyH as number;
    const bob = isMe && c.speed > 5 && v.frame % 4 < 2 ? 1 : 0, shake = c.hit > 0 ? (v.frame % 2 ? 1 : -1) : 0;
    // 畫面寬度超過 24px（比玩家還近）才放大 L 圖，否則原尺寸
    const scale = !isMe && target > 26 ? target / 24 : 1;
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
  if (t.weather === 'rain') { x.fillStyle = G[1]; for (let i = 0; i < 40; i++) { const rx = Math.floor((hash(i) * W + v.frame * 3 + i * 7) % W), ry = Math.floor((hash(i + 99) * H + v.frame * 9) % H); x.fillRect(rx, ry, 1, 3); x.fillRect(rx - 1, ry + 3, 1, 1); } }
  if (t.weather === 'snow') { x.fillStyle = G[0]; for (let i = 0; i < 45; i++) { const sx = Math.floor((hash(i) * W + Math.sin((v.frame + i * 13) / 9) * 3 - (v.me?.x ?? 0) * 10 + W) % W), sy = Math.floor((hash(i + 7) * H + v.frame * (1 + (i % 3))) % H); x.fillRect(sx, sy, i % 4 ? 1 : 2, 1); } }
  if (v.hud) drawHud(x, v);
}
function drawSkyline(x: CanvasRenderingContext2D, scene: string, bend: number, P: string[]) {
  const off = ((-bend * 0.5) % 120 + 120) % 120;
  for (let px = 0; px < W; px++) {
    const wx = (px + off) % 120;
    let h: number;
    if (scene === 'city') h = 6 + Math.floor(hash(Math.floor(wx / 6)) * 12);
    else if (scene === 'desert') h = 3 + Math.round(4 * Math.abs(Math.sin(wx / 19)) + (wx > 70 && wx < 90 ? 6 - Math.abs(wx - 80) * 0.6 : 0));
    else if (scene === 'coast') h = wx < 40 ? 2 : 4 + Math.round(5 * Math.abs(Math.sin(wx / 13)));
    else if (scene === 'snow') h = 6 + Math.round(9 * Math.abs(Math.sin(wx / 15)) - (wx % 30 < 15 ? (wx % 15) / 3 : 0));
    else h = 4 + Math.round(5 * Math.abs(Math.sin(wx / 11)) + 3 * Math.abs(Math.sin(wx / 4.3)));
    x.fillStyle = P[2]; x.fillRect(px, HORIZON - h, 1, h + 1);
    if (scene === 'snow') { x.fillStyle = G[0]; x.fillRect(px, HORIZON - h, 1, 2); }
    if (scene === 'city' && (wx * 7 + h) % 5 === 0 && h > 8) { x.fillStyle = P[0] === G[0] ? G[1] : G[1]; x.fillRect(px, HORIZON - h + 3, 1, 1); }
  }
  if (scene === 'coast') { x.fillStyle = P[1]; x.fillRect(0, HORIZON - 1, 40, 2); }
}
function drawHud(x: CanvasRenderingContext2D, v: View) {
  const me = v.me; if (!me) return;
  const total = v.cars.length;
  // 左上：名次（大字）
  const rk = String(v.rank), bw = 16 + rk.length * 8 + String(total).length * 4 + 4;
  x.fillStyle = G[3]; x.fillRect(0, 0, bw, 15);
  text(x, 'POS', 2, 2, 1); text(x, rk, 15, 2, 0, 2); text(x, '/' + total, 15 + rk.length * 8, 8, 1);
  // 右上：圈數
  const lap = Math.min(v.laps, Math.floor(Math.max(0, me.z) / v.len) + 1);
  x.fillStyle = G[3]; x.fillRect(W - 30, 0, 30, 9); text(x, `LAP${lap}/${v.laps}`, W - 29, 2, 0);
  // 下方：速度、氮氣、損傷
  x.fillStyle = G[3]; x.fillRect(0, H - 9, 34, 9); x.fillRect(W - 34, H - 9, 34, 9);
  const kmh = String(Math.round(me.speed * 3.6)).padStart(3, ' ');
  text(x, kmh, 2, H - 7, me.nitroT > 0 && v.frame % 4 < 2 ? 1 : 0); text(x, 'KM', 16, H - 7, 1);
  for (let i = 0; i < NITRO_PER_RACE; i++) { const on = i < me.nitro; x.fillStyle = on ? G[0] : G[2]; x.fillRect(W - 33 + i * 5, H - 8, 4, 7); if (on) { x.fillStyle = G[3]; x.fillRect(W - 32 + i * 5, H - 7, 2, 1); } }
  x.fillStyle = G[2]; x.fillRect(W - 17, H - 6, 16, 3); x.fillStyle = me.damage > 70 && v.frame % 6 < 3 ? G[1] : G[0]; x.fillRect(W - 17, H - 6, Math.round(16 * me.damage / 100), 3);
  text(x, 'D', W - 17, H - 7 - 5, 0);
  // 右側進度條（每台車一個點，自己是方塊）
  x.fillStyle = G[3]; x.fillRect(W - 4, 12, 3, 70);
  const tot = v.len * v.laps;
  for (const c of v.cars) { const f = Math.max(0, Math.min(1, c.z / tot)); const yy = 81 - Math.round(f * 68); x.fillStyle = c.id === me.id ? G[0] : G[1]; x.fillRect(W - (c.id === me.id ? 5 : 4), yy, c.id === me.id ? 5 : 3, c.id === me.id ? 3 : 1); }
  // 倒數／訊息
  if (v.countdown > 0) { const s = String(Math.ceil(v.countdown / 20)); x.fillStyle = G[3]; x.fillRect(W / 2 - 9, 22, 18, 16); text(x, s, W / 2 - 5, 24, 0, 4); }
  else if (v.tick - 60 < 20 && v.tick >= 60) { x.fillStyle = G[3]; x.fillRect(W / 2 - 15, 26, 30, 11); text(x, 'GO!', W / 2 - 11, 28, 0, 2); }
  if (v.flash && v.frame % 8 < 6) { const w = textW(v.flash) + 4; x.fillStyle = G[3]; x.fillRect(Math.round(W / 2 - w / 2), 3, w, 9); text(x, v.flash, Math.round(W / 2 - w / 2) + 2, 5, 0); }
}
export { trackById };
