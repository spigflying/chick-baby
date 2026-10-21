// 開發用：賽車美術設計稿與畫面模擬（不進正式頁面）。/race-preview.html?v=sheet|grid|pack|nitro|rain|night（v3：240×200）
import { drawRace, carCanvas, G, W, H, text, type ViewCar } from './race-gfx';
import { CAR_MODELS, LODS, LIVERIES, LIVERY_NAMES } from './race-cars';
import { trackById, trackSegs, SEG_LEN, CARS } from '@chick/engine';

const root = document.getElementById('root')!;
const v = new URLSearchParams(location.search).get('v') ?? 'sheet';
import { CAR_SPECS } from './race-cars';
const NAMES: Record<string, string> = Object.fromEntries(Object.entries(CAR_SPECS).map(([k, v]) => [k, v.name]));

function sheet() {
  // 一張大圖：每車款一列 × (5 個 LOD) + 6 種塗裝（L 尺寸）+ 煞車/氮氣/受損
  const S = 3, cellW = 56, rowH = 40, cols = LODS.length + LIVERIES.length + 3;
  const cw = 80 + cols * cellW, ch = 22 + CAR_MODELS.length * rowH + 16;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; c.style.width = cw * S + 'px'; c.style.height = ch * S + 'px';
  const x = c.getContext('2d')!; x.imageSmoothingEnabled = false;
  x.fillStyle = G[0]; x.fillRect(0, 0, cw, ch);
  text(x, 'CAR DESIGN SHEET V3', 2, 2, 3, 2);
  const heads = [...LODS.map((w) => `${w}PX`), ...LIVERIES.map((_, i) => `C${i + 1}`), 'BRAKE', 'NITRO', 'HIT'];
  heads.forEach((hd, i) => text(x, hd.slice(0, 6), 80 + i * cellW + 2, 13, 2));
  CAR_MODELS.forEach((m, r) => {
    const y0 = 22 + r * rowH;
    text(x, m.toUpperCase(), 2, y0 + 14, 3, 2);
    for (let i = 0; i < cols; i++) { x.fillStyle = (i + r) % 2 ? G[2] : G[1]; x.fillRect(80 + i * cellW, y0, cellW - 2, rowH - 2); } // 路面底色（近似實際背景）
    const put = (img: HTMLCanvasElement, i: number) => x.drawImage(img, 80 + i * cellW + Math.floor((cellW - 2 - img.width) / 2), y0 + rowH - 3 - img.height);
    LODS.forEach((_, l) => put(carCanvas(m, 0, {}, l), l));
    LIVERIES.forEach((_, k) => put(carCanvas(m, k, {}, 0), LODS.length + k));
    put(carCanvas(m, 1, { brake: true }, 0), LODS.length + LIVERIES.length);
    put(carCanvas(m, 1, { nitro: true, frame: 1 }, 0), LODS.length + LIVERIES.length + 1);
    put(carCanvas(m, 1, { hit: true, frame: 1 }, 0), LODS.length + LIVERIES.length + 2);
  });
  text(x, 'PALETTE', 2, ch - 10, 3); G.forEach((g, i) => { x.fillStyle = g; x.fillRect(34 + i * 10, ch - 11, 9, 8); x.strokeStyle = G[3]; x.strokeRect(34.5 + i * 10, ch - 10.5, 8, 7); });
  const d = document.createElement('div'); d.id = 'sheet'; d.innerHTML = `<h1>賽車設計稿 v3（2 倍解析度）：${CAR_MODELS.map((m) => NAMES[m]).join('・')}</h1><p>每列：5 個尺寸（48/32/20/12/8 px，在各尺寸重新點陣化，遠處直接換小圖，不縮放）＋ 6 種塗裝（${LIVERY_NAMES.join('、')}）＋ 煞車燈／氮氣火焰／受損閃爍。只用四階綠，1px 最暗色外框。</p>`;
  d.append(c); root.append(d);
}
function scene(kind: string) {
  const track = trackById(kind === 'rain' ? 'gbr' : kind === 'night' ? 'hkg' : kind === 'pack' ? 'bra' : 'tpe')!;
  const len = trackSegs(track.id).length * SEG_LEN;
  const mk = (i: number, z: number, xx: number, extra: Partial<ViewCar> = {}): ViewCar => ({ id: 'c' + i, name: 'c' + i, ai: true, car: CARS[i % 4].id, color: i % 6, z, x: xx, speed: 50, damage: 0, nitro: 3, nitroT: 0, fin: null, hit: 0, ...extra });
  const cars: ViewCar[] = []; let me: ViewCar;
  if (kind === 'grid') { for (let i = 0; i < 19; i++) cars.push(mk(i + 1, 300 - Math.floor(i / 2) * 8, i % 2 ? 0.5 : -0.5, { speed: 0 })); me = mk(0, 300 - 10 * 8, 0.5, { id: 'me', speed: 0, car: 'falcon', color: 0 }); }
  else { const base = 1400; me = mk(0, base, 0.1, { id: 'me', car: 'falcon', color: 0, speed: kind === 'nitro' ? 78 : 60, nitroT: kind === 'nitro' ? 30 : 0, nitro: kind === 'nitro' ? 2 : 3 });
    const ahead = [[7, -0.4], [9, 0.45], [16, -0.1], [26, 0.5], [40, -0.5], [60, 0.2], [85, -0.3], [120, 0.4], [170, -0.2], [240, 0.3], [330, 0]];
    ahead.forEach(([dz, xx], i) => cars.push(mk(i + 1, base + dz, xx, { brake: i === 1, hit: kind === 'pack' && i === 0 ? 5 : 0 }))); }
  cars.push(me);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.style.width = W * 3 + 'px'; cv.style.height = H * 3 + 'px';
  const x = cv.getContext('2d')!; x.imageSmoothingEnabled = false;
  let frame = 0;
  const draw = () => { frame++; drawRace(x, { track, me, cars, tick: kind === 'grid' ? 30 : 400, countdown: kind === 'grid' ? 40 : 0, laps: track.laps, len, rank: kind === 'grid' ? 20 : kind === 'nitro' ? 9 : 12, frame, hud: true, flash: kind === 'nitro' ? 'NITRO!' : undefined }); };
  draw(); draw();
  const d = document.createElement('div'); d.id = 'shots'; d.append(cv); root.append(d);
}
if (v === 'sheet') sheet(); else scene(v);
(window as any).__ready = true;
