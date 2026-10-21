/**
 * 賽車車款 v3（原創，從車尾看）：用「48×30 設計座標」的向量圖元描述，每個 LOD 寬度直接點陣化，
 * 所以遠處的小車是在小尺寸重新畫的（不是把大圖縮小），外框一律 1px 最暗色。
 * 色碼：0 最亮 … 3 最暗（Game Boy 四階綠）。
 */
export const LODS = [48, 32, 20, 12, 8] as const;
export const DESIGN_W = 48, DESIGN_H = 30;
/** 玩家車專用尺寸（lod = -1）：約畫面 1/4 寬，跟 TG2 比例接近；在這個寬度直接點陣化，不放大。 */
export const PLAYER_W = 62;
const lodW = (lod: number) => lod < 0 ? PLAYER_W : LODS[lod];
type C = 'b' | 's' | 'h' | 'g' | 'r' | 'l' | 'L' | 'd' | 'm' | 'a' | 'k';
// b 車身 s 車身陰影 h 車身亮面 g 玻璃 r 玻璃反光 l 尾燈 L 尾燈中心 d 最暗 m 中暗 a 配色 k 強制透明
type Op =
  | ['rect', number, number, number, number, C, number?]                 // x0 y0 x1 y1 色 最小寬度
  | ['trap', number, number, number, number, number, number, C, number?] // y0 y1 上x0 上x1 下x0 下x1
  | ['ell', number, number, number, number, C, number?]                  // cx cy rx ry
  | ['fins', number, number, number, number, number, C, number?]         // 直條紋：x0 y0 x1 y1 間距
  | ['tread', number, number, number, number, number?];                  // 輪胎紋
const tyres = (x0: number, w: number, y0: number): Op[] => [['rect', x0, y0, x0 + w, 30, 'd'], ['tread', x0 + 1, y0 + 1, x0 + w - 1, 29, 24], ['tread', 48 - x0 - w + 1, y0 + 1, 48 - x0 - 1, 29, 24], ['rect', 48 - x0 - w, y0, 48 - x0, 30, 'd']];
/** 左右鏡像：給一組左側圖元，自動加上右側 */
function sym(...ops: Op[]): Op[] {
  const out: Op[] = [];
  for (const o of ops) {
    out.push(o);
    if (o[0] === 'rect') out.push(['rect', 48 - o[3], o[2], 48 - o[1], o[4], o[5], o[6]]);
    else if (o[0] === 'ell') out.push(['ell', 48 - o[1], o[2], o[3], o[4], o[5], o[6]]);
    else if (o[0] === 'trap') out.push(['trap', o[1], o[2], 48 - o[4], 48 - o[3], 48 - o[6], 48 - o[5], o[7], o[8]]);
    else if (o[0] === 'fins') out.push(['fins', 48 - o[3], o[2], 48 - o[1], o[4], o[5], o[6], o[7]]);
    else if (o[0] === 'tread') out.push(['tread', 48 - o[3], o[2], 48 - o[1], o[4], o[5]]);
  }
  return out;
}
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
  // 燕 F1：開輪方程式——外露的大後輪、高尾翼＋端板、頭盔與 halo 護架、引擎進氣罩、中央雨燈、沒有車頂
  f1: { name: '燕 F1', ops: [
    ...sym(['rect', 0, 12, 11, 30, 'd'], ['tread', 1, 13, 10, 29, 24], ['rect', 1, 12, 10, 13, 'm', 32]),
    ['rect', 11, 24, 37, 30, 'd'], ['fins', 13, 25, 35, 30, 3, 'm', 20],          // 擴散器
    ['rect', 12, 18, 36, 24, 'b'], ['rect', 12, 23, 36, 24, 's', 20],             // 側箱
    ['trap', 12, 22, 21, 27, 15, 33, 'b'], ['rect', 23, 12, 25, 22, 'h', 32],     // 引擎蓋＋脊線亮面
    ['ell', 24, 10.5, 3.6, 3, 'a'], ['rect', 21, 10, 27, 11, 'd', 20],            // 頭盔＋護目鏡
    ['rect', 19, 6, 29, 7, 'd'], ...sym(['rect', 19, 6, 20, 12, 'd']),             // halo
    ['rect', 5, 0, 43, 3, 'a'], ['rect', 5, 3, 43, 4, 's', 20],                   // 尾翼
    ...sym(['rect', 4, 0, 6, 11, 'd']), ['rect', 23, 4, 25, 6, 'd'],              // 端板、主支柱
    ['rect', 22, 25, 26, 28, 'l'], ['rect', 23, 26, 25, 27, 'L', 32],              // 雨燈
  ] },
  // 鷹 RALLY：拉力掀背車——高車身、車頂進氣、大車頂尾翼、方燈、單邊排氣、擋泥板
  rally: { name: '鷹 拉力', ops: [
    ...tyres(2, 8, 21),
    ['trap', 3, 15, 13, 35, 9, 39, 'b'],
    ['trap', 5, 14, 15, 33, 12, 36, 'g'],
    ['trap', 6, 8, 21, 24, 18, 21, 'r', 32], ['trap', 8, 12, 18, 20, 15, 17, 'r', 32],
    ['rect', 9, 2, 39, 4, 'a'], ['rect', 20, 0, 28, 2, 'b'],                      // 車頂尾翼＋進氣
    ['trap', 14, 20, 5, 43, 3, 45, 'b'], ['rect', 4, 14, 44, 15, 'h', 20],
    ['rect', 3, 20, 45, 25, 'b'], ['rect', 3, 24, 45, 25, 's', 20],
    ...sym(['rect', 5, 16, 11, 20, 'd'], ['rect', 6, 17, 10, 19, 'l']),
    ['rect', 19, 19, 29, 22, 'h', 32],
    ['rect', 9, 25, 39, 29, 'd'], ['ell', 35, 26.5, 1.8, 1.4, 'm', 20],
    ...sym(['rect', 2, 26, 9, 30, 'a']),                                           // 擋泥板
  ] },
  // 野馬 V8：美式肌肉車——長斜背、雙賽車條紋、三段式全寬尾燈、鍍鉻保險桿、兩側雙出
  muscle: { name: '野馬 V8', ops: [
    ...tyres(1, 9, 21),
    ['trap', 6, 14, 14, 34, 10, 38, 'b'],
    ['trap', 14, 19, 3, 45, 1, 47, 'b'], ['rect', 2, 14, 46, 15, 'h', 20],
    ['rect', 1, 19, 47, 25, 'b'],
    ...sym(['rect', 18, 6, 21, 25, 'a', 20]),                                      // 條紋
    ['trap', 7, 13, 16, 32, 12, 36, 'g'], ['trap', 8, 12, 19, 21, 16, 18, 'r', 32],
    ['rect', 4, 13, 44, 14, 'a'],                                                  // 鴨尾
    ...sym(['rect', 3, 19, 17, 22, 'd'], ['rect', 4, 20, 8, 21, 'l'], ['rect', 9, 20, 12, 21, 'l', 20], ['rect', 13, 20, 16, 21, 'l', 32]),
    ['rect', 4, 25, 44, 27, 'h'], ['rect', 6, 27, 42, 30, 'd'],                     // 鍍鉻保險桿
    ...sym(['ell', 9, 27.5, 2, 1.4, 'm', 20]),
  ] },
  // 曙 LMP：利曼原型車——超寬超低、鯊魚鰭、天鵝頸大尾翼、小座艙罩、細 LED 燈、巨大擴散器
  lmp: { name: '曙 LMP', ops: [
    ...tyres(1, 9, 20),
    ...sym(['ell', 9, 16, 8.5, 5, 'b']),                                           // 輪拱
    ['trap', 14, 22, 6, 42, 0, 48, 'b'], ['rect', 2, 15, 46, 16, 'h', 20],
    ['ell', 24, 13, 7, 5, 'b'], ['ell', 24, 13, 5, 3.5, 'g'], ['rect', 21, 11, 23, 12, 'r', 32],
    ['rect', 23, 2, 25, 13, 'b'],                                                  // 鯊魚鰭
    ['rect', 3, 4, 45, 7, 'a'], ['rect', 3, 7, 45, 8, 's', 20],
    ...sym(['rect', 15, 8, 17, 13, 'd'], ['rect', 2, 3, 4, 14, 'd']),              // 天鵝頸、端板
    ...sym(['rect', 4, 17, 15, 18, 'l']), ['rect', 18, 19, 30, 20, 'L'],
    ['rect', 6, 22, 42, 30, 'd'], ['fins', 8, 23, 40, 30, 2, 'm', 20],
    ['rect', 22, 24, 26, 26, 'l', 20],
  ] },
  // 鬼 DRIFT：日系甩尾車——方正雙門、高腳大尾翼、寬體鉚釘輪拱、外八輪胎、四方燈、單邊大砲管
  drift: { name: '鬼 甩尾', ops: [
    ...sym(['trap', 21, 30, 2, 10, 0, 9, 'd'], ['tread', 1, 23, 9, 29, 24]),
    ['trap', 7, 15, 14, 34, 10, 38, 'b'],
    ['trap', 8, 14, 16, 32, 12, 36, 'g'], ['trap', 9, 11, 21, 24, 18, 21, 'r', 32], ['trap', 11, 14, 18, 20, 15, 17, 'r', 32],
    ['trap', 15, 20, 3, 45, 0, 48, 'b'], ['rect', 2, 15, 46, 16, 'h', 20],
    ...sym(['rect', 3, 17, 4, 18, 'd', 32], ['rect', 7, 16, 8, 17, 'd', 32]),      // 鉚釘
    ['rect', 1, 20, 47, 25, 'b'], ['rect', 1, 24, 47, 25, 's', 20],
    ...sym(['rect', 4, 20, 10, 23, 'd'], ['rect', 5, 21, 9, 22, 'l'], ['rect', 11, 20, 16, 23, 'd'], ['rect', 12, 21, 15, 22, 'l']),
    ['rect', 8, 25, 40, 30, 'd'], ['fins', 12, 26, 30, 30, 3, 'm', 32],
    ['ell', 36, 27, 2.8, 2, 'm', 12], ['ell', 36, 27, 1.6, 1.1, 'd', 20],
    ['rect', 10, 25, 12, 28, 'a', 32],                                             // 拖車鉤
    ['rect', 4, 1, 44, 4, 'a'], ['rect', 4, 4, 44, 5, 's', 20],
    ...sym(['rect', 12, 5, 14, 9, 'd'], ['rect', 3, 0, 5, 7, 'd']),
  ] },
  // 電腦車：單一灰色通用小轎車（所有 LOD 都一樣、沒有塗裝），一眼就能和真人玩家分開
  ai: { name: '電腦車', ops: [
    ...tyres(2, 10, 19),
    ['trap', 6, 15, 14, 34, 10, 38, 'b'],
    ['trap', 7, 14, 16, 32, 12, 36, 'g'],
    ['rect', 4, 15, 44, 25, 'b'],
    ['rect', 4, 24, 44, 25, 's'],
    ['rect', 6, 18, 12, 21, 'l'], ['rect', 36, 18, 42, 21, 'l'],
    ['rect', 19, 19, 29, 22, 's'],
    ['rect', 6, 25, 42, 28, 'd'],
  ] },
};
export const CAR_MODELS = Object.keys(CAR_SPECS).filter((m) => m !== 'ai');
/** 塗裝（四階綠）：[車身, 配色] */
/**
 * 8 種塗裝（TG2：紅 灰 綠 淺藍 深藍 黃 黑 紫）。畫面只有四階綠，所以每種顏色＝「車身深淺＋配色深淺＋花紋」的獨特組合：
 * solid 單色、stripe 中央雙條紋、dither 細格點（兩階混色＝中間色調）、band 斜紋。電腦車是另一款灰色通用車（無配色、無燈），不會混淆。
 */
export type Pattern = 'solid' | 'stripe' | 'dither' | 'band';
export interface Livery { name: string; body: number; accent: number; pat: Pattern }
export const PAINT_LIVERIES: Livery[] = [
  { name: '紅', body: 1, accent: 3, pat: 'stripe' },
  { name: '灰', body: 2, accent: 1, pat: 'solid' },
  { name: '綠', body: 0, accent: 2, pat: 'solid' },
  { name: '淺藍', body: 0, accent: 1, pat: 'dither' },
  { name: '深藍', body: 2, accent: 3, pat: 'dither' },
  { name: '黃', body: 0, accent: 3, pat: 'stripe' },
  { name: '黑', body: 3, accent: 1, pat: 'solid' },
  { name: '紫', body: 1, accent: 2, pat: 'band' },
];
export const LIVERIES: [number, number][] = PAINT_LIVERIES.map((l) => [l.body, l.accent]);
export const LIVERY_NAMES = PAINT_LIVERIES.map((l) => l.name);
export interface CarLook { brake?: boolean; nitro?: boolean; hit?: boolean; frame?: number }

const cache = new Map<string, (number | null)[][]>();
/** 點陣化：回傳 [列][行] 的色碼（null = 透明）。高度 = 寬 × 30/48。 */
export function carPixels(model: string, livery: number, lod: number, look: CarLook = {}): (number | null)[][] {
  if (model === 'ai') livery = 0;
  const key = `${model}:${livery}:${lod}:${+!!look.brake}:${+!!look.nitro}:${+!!look.hit}:${(look.frame ?? 0) & 1}`;
  const hit = cache.get(key); if (hit) return hit.map((r) => r.slice());
  const W = lodW(lod), k = (W - 2) / DESIGN_W, H = Math.round(DESIGN_H * k) + 2;
  const lv = PAINT_LIVERIES[livery % PAINT_LIVERIES.length];
  const [body, accent] = model === 'ai' ? [2, 2] : [lv.body, lv.accent];
  const pat: Pattern = model === 'ai' ? 'solid' : lv.pat;
  const flash = look.hit && (look.frame ?? 0) % 2 === 1;
  const b = flash ? (body === 0 ? 2 : 0) : body;
  const col: Record<C, number | null> = {
    b, s: Math.min(3, b + 1) === 3 && b === 2 ? 3 : Math.min(3, b + 1), h: Math.max(0, b - 1) === b ? (b === 0 ? 0 : b - 1) : b - 1,
    g: 3, r: model === 'ai' ? null : 1, l: look.brake ? 0 : model === 'ai' ? 3 : (b === 0 ? 2 : b === 1 ? 2 : 1), L: look.brake ? 0 : 1, d: 3, m: 2, a: accent, k: null,
  };
  const g: (number | null)[][] = Array.from({ length: H }, () => Array(W).fill(null));
  const X = (x: number) => 1 + Math.round(x * k), Y = (y: number) => 1 + Math.round(y * k);
  const cx = W / 2, sw = Math.max(1, Math.round(W / 24));
  const patCol = (x: number, y: number) => pat === 'stripe' ? (Math.abs(x + 0.5 - cx) >= sw * 0.5 && Math.abs(x + 0.5 - cx) <= sw * 1.5 + 0.5 ? accent : b)
    : pat === 'dither' ? ((x + y) & 1 ? accent : b) : pat === 'band' ? ((x + y) % 6 < 2 ? accent : b) : b;
  const put = (x: number, y: number, c: C) => { if (y >= 0 && y < H && x >= 0 && x < W) g[y][x] = c === 'b' && !flash ? patCol(x, y) : col[c]; };
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
    const len = Math.round((lod < 0 ? 18 : lod === 0 ? 14 : lod === 1 ? 9 : 5) + ((look.frame ?? 0) & 1) * k * 3), fw = Math.max(1, Math.round(4 * k));
    const ex: Record<string, number[]> = { falcon: [24], f1: [24], rhino: [11, 37], muscle: [9, 39], rally: [35], drift: [36], lmp: [20, 28] };
    const xs = (ex[model] ?? [21, 27]).map((e) => X(e) - (fw >> 1));
    const top = Y(27);
    for (let j = 0; j < len; j++) { const y = top + j; if (y >= out.length) out.push(Array(W).fill(null)); const c = j < len * 0.5 ? 0 : j < len * 0.8 ? 1 : 2; const shrink = j > len * 0.6 ? 1 : 0;
      for (const x0 of xs) for (let d = shrink; d < fw - shrink || d === shrink && d < fw; d++) out[y][x0 + d] = c; }
  }
  cache.set(key, out); return out.map((r) => r.slice());
}
/** 車身高度（不含火焰），用來對齊地面 */
export const carBodyH = (lod: number) => Math.round(DESIGN_H * (lodW(lod) - 2) / DESIGN_W) + 2;
