// 雞（chicken = adult 精靈）圓頂頭（3 列收窄的弧形）＋正中央一根 1px 呆毛（尖端微捲），取代原本的雞冠（v1.5）
import { ACC_SPRITES, CHICKEN_FRONT } from './bao-sprites';
import { ACCESSORIES } from '@chick/engine';
// 由根目錄原型 script.js 移植的像素精靈（Game Boy 四階綠）
export const PAL = ['#9bbc0f', '#8bac0f', '#306230', '#0f380f'];
export const S: Record<string, string[]> = {
  rosetea: ['..1..1..','.1..1...','333333..','3222233.','322223.3','322223.3','3222233.','.3333...'],
  egg: ['....3333....','..33111133..','.3111111113.','.3112111213.','311111111113','311211111113','311111112113','311111111113','.3111211113.','.3111111113.','..33111133..','....3333....'],
  egg2:['....3333....','..33111133..','.3111111113.','.3112111213.','311111111113','3113.3.31113','3111.3.11113','311111111113','.3111211113.','.3111111113.','..33111133..','....3333....'],
  chick: ['....3333....','...311113...','..31111113..','.3131111113.','322111111113','.33111111113','.31111111113','311112211113','311112221113','311111111113','.3111111113.','..33333333..','...3....3...','..33....33..'],
  chick2: ['............','....3333....','...311113...','..31111113..','.3131111113.','322111111113','.33111111113','.31111111113','311112211113','311112221113','311111111113','..33333333..','...3....3...','..33....33..'],
  adult: ['.......33.......','.......3........','.....33333......','....3111113.....','...311111113....','..31111111113...','..31131111113...','..311111111113..','.3222111111113..','..33311111111133','...311112221113.','...311122222113.','...31111111113..','....3111111113..','.....33333333...','......3....3....','.....33...33....'],
  adult2: ['................','.......33.......','.......3........','.....33333......','....3111113.....','...311111113....','..31111111113...','..31131111113...','..311111111113..','.3222111111113..','..33311111111133','...311112221113.','...311122222113.','...31111111113..','....3111111113..','......3....3....','.....33...33....'],
  ghost: ['...3333...','..311113..','.31111113.','.31311313.','.31111113.','.31133113.','.31111113.','.31111113.','.3131313..','.3.3.3.3..'],
  poop: ['...3...','..323..','.32223.','3222223','3333333'],
  z: ['3333','..3.','.3..','3333'],
  skull: ['.333.','31313','33333','.3.3.'],
  heart: ['.3.3.','33333','33333','.333.','..3..'],
  food: ['..33.','.3223','.3223','.333.','3....'],
  ball: ['.333.','32123','31213','32123','.333.'],
  bubble: ['.33.','3..3','3..3','.33.'],
  syringe: ['3.....','.3333.','.3222.3','.3333.','3.....'],
  i_hunger: ['..3333.....','.322223....','3211223....','3212223....','32222223...','32222223...','.3332203.3.','....3330303','.......3003','......3003.','.......33..'],
  i_happy: ['..3333..','.311113.','31311313','31111113','31311313','31133113','.311113.','..3333..'],
  i_energy: ['....333.','...333..','..333...','.3333333','.....33.','....33..','...33...','..3.....'],
  i_clean: ['....3....','....3....','...323...','...323...','..30223..','.3002223.','301222223','312222223','322222223','.3222223.','..33333..'],
  i_feed: ['..3333.....','.322223....','3211223....','3212223....','32222223...','32222223...','.3332203.3.','....3330303','.......3003','......3003.','.......33..'],
  i_play: ['.......33','.......3.','.....333.','.....3...','...333...','...3.....','.333.....','.3.......'],
  i_sleep: ['...3333..','..33.....','.33......','.33......','.33......','.33......','..33.....','...3333..'],
  i_wash: ['....3....','....3....','...323...','...323...','..30223..','.3002223.','301222223','312222223','322222223','.3222223.','..33333..'],
  i_doc: ['...333...','...323...','.3333333.','.3222223.','.3333333.','...323...','...333...','.........'],
  i_stat: ['3..........33','3..........33','3.......33.33','3.......33.33','3....33.33.33','3....33.33.33','3.33.33.33.33','3.33.33.33.33','3.33.33.33.33','3333333333333'],
  rice: ['.3.3.','3.3.3','.3.3.'],
  worm: ['.33....','3223.33','3..3223','....33.'],
  corn: ['..33..','.3223.','.3223.','.3223.','.3223.','..33..','.3..3.'],
  cake: ['..3...','.333..','322223','311113','322223','333333'],
  candy: ['3.333.3','.32223.','3.333.3'],
  sparkle: ['..3..','..3..','33.33','..3..','..3..'],
  i_shop: ['.......33','......323','.....323.','....323..','3..323...','.3323....','..33.....','.3.3.....','3...3....'],
  i_health: ['.33..33.','32233223','32122223','32222223','.322223.','..3223..','...33...','........']
};

// ===== 物種精靈（預設面向左；第 2 格由程式產生上下彈跳）=====
const SPECIES_F1: Record<string, string[]> = {
  chicken: S.adult,
  duck: [
    '....3333........','...300003.......','..30003003......','2222000003......','2222200003......',
    '.333000003......','...3000003..33..','..30000000033003','.30000000000000 3'.replace(' ', '') ,
    '.300022220000003','.300002222000003','..30000000000003.','...33333333333..','.....3....3.....','....22...22.....'],
  penguin: [
    '....33333.......','...3333333......','..333033333.....','.22333333333....','2223003333333...',
    '..30000033333...','.3300000033333..','33300000003333 .'.replace(' ', ''),'3.30000000033.3.','..30000000033...',
    '..30000000033...','..3300000033....','...33333333.....','...22....22.....','..222...222.....'],
  dino: [
    '..33333............','.3222223...........','3222222233.3.3.....','3203222223333333...','3222222222222223...',
    '3222211222222223...','.33111122222222233.','...3111222222222223','..33111122222222233','..3.31112222222223.',
    '....311112222223...','.....3111122223....','......33333333.....','......32...32......','.....332..332......'],
};
// 閉眼：[x, y, 顏色]（以第 1 格座標）
const SLEEP_EYES: Record<string, [number, number, string][]> = {
  chicken: [[4, 6, '3'], [5, 6, '3']],
  duck: [[6, 2, '3'], [7, 2, '3']],
  penguin: [[5, 2, '3'], [4, 3, '0'], [5, 3, '0']],
  dino: [[2, 3, '3'], [3, 3, '3']],
};
function bob(rows: string[]) { const w = rows[0].length; return ['.'.repeat(w), ...rows.slice(0, -3), ...rows.slice(-2)]; }
function normalize(rows: string[]) { const w = Math.max(...rows.map((r) => r.length)); return rows.map((r) => r.padEnd(w, '.')); }
for (const [id, f1raw] of Object.entries(SPECIES_F1)) {
  const f1 = normalize(f1raw), f2 = bob(f1);
  const sl = f2.map((r) => [...r]);
  for (const [x, y, c] of SLEEP_EYES[id]) if (sl[y + 1]) sl[y + 1][x] = c;
  S[`${id}_1`] = f1; S[`${id}_2`] = f2; S[`${id}_s`] = sl.map((r) => r.join(''));
}
export const SPECIES_LABEL: Record<string, string> = { chicken: '雞', duck: '鴨', penguin: '企鵝', dino: '恐龍' };
S.i_home = ['....3....', '...323...', '..32223..', '.3222223.', '333333333', '.3111113.', '.3133313.', '.3133313.', '.3333333.'];
S.i_wake = ['...3...', '3..3..3', '.3...3.', '..333..', '33313 33'.replace(' ', ''), '..333..', '.3...3.', '3..3..3'];
S.tomb = ['..3333..', '.322223.', '32233223', '32222223', '32333323', '32222223', '32222223', '33333333'];

/** 合成精靈（寶的配件）的錨點：本體在合成圖中的位移與本體大小；sw/sh 回傳本體大小，畫的時候自動位移，所以版面與碰撞都不變。 */
export const ANCHOR: Record<string, { ox: number; oy: number; bw: number; bh: number }> = {};
export const sw = (n: string) => ANCHOR[n]?.bw ?? S[n][0].length;
export const sh = (n: string) => ANCHOR[n]?.bh ?? S[n].length;
export function spr(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, flip = false, cut = 0) {
  if (!S[name] && name.includes('|')) ensureComposite(name);
  const rows = S[name]; if (!rows) return;
  const an = ANCHOR[name];
  if (an) { x -= flip ? rows[0].length - an.bw - an.ox : an.ox; y -= an.oy; }
  rows.forEach((r, j) => [...r].forEach((c, i) => {
    if (c === '.' || c === ' ') return;
    if (cut && i >= r.length - cut) return;
    const xi = flip ? r.length - 1 - i : i;
    ctx.fillStyle = PAL[+c]; ctx.fillRect(Math.round(x + xi), Math.round(y + j), 1, 1);
  }));
}
const DIG = ['333','3.3','3.3','3.3','333','.3.','33.','.3.','.3.','333','333','..3','333','3..','333','333','..3','333','..3','333','3.3','3.3','333','..3','..3','333','3..','333','..3','333','333','3..','333','3.3','333','333','..3','..3','..3','..3','333','3.3','333','3.3','333','333','3.3','333','..3','333'];
export function num(ctx: CanvasRenderingContext2D, n: number, x: number, y: number, c = 3) {
  String(n).split('').forEach((d, i) => { for (let j = 0; j < 5; j++) [...DIG[+d * 5 + j]].forEach((ch, k) => { if (ch === '3') { ctx.fillStyle = PAL[c]; ctx.fillRect(x + i * 4 + k, y + j, 1, 1); } }); });
}
/**
 * species 可以帶配件：`chicken|sword,bow`（伺服器的 spriteKey）。目前配件只對齊雞的精靈；其他物種先畫原本的樣子。
 */
export function speciesSprite(species: string, kind: 1 | 2 | 's') {
  const [sp0, look] = species.split('|');
  const sp = S[`${sp0}_1`] ? sp0 : 'chicken';
  if (!look) return `${sp}_${kind}`;
  const lk = look;
  const name = `${sp}_${kind}|${lk}`; ensureComposite(name); return name;
}
/**
 * 配件圖是對齊雞畫的；其他物種依部位（anchor）平移到該物種的頭頂／眼睛／脖子／背／手／腳／身體。
 * 值是相對於雞的位移（側面、未翻轉的座標）。
 */
type Anchor = 'head' | 'eye' | 'neck' | 'back' | 'hand' | 'feet' | 'body';
export const SPECIES_ANCHORS: Record<string, Record<Anchor, [number, number]>> = {
  chicken: { head: [0, 0], eye: [0, 0], neck: [0, 0], back: [0, 0], hand: [0, 0], feet: [0, 0], body: [0, 0] },
  duck: { head: [1, -2], eye: [1, -4], neck: [1, -4], back: [1, -1], hand: [0, -1], feet: [-1, -2], body: [0, -1] },
  penguin: { head: [-1, -2], eye: [0, -3], neck: [0, -4], back: [0, -2], hand: [0, -2], feet: [-2, -2], body: [0, -2] },
  dino: { head: [-3, -2], eye: [-3, -3], neck: [-2, -4], back: [0, -3], hand: [1, -1], feet: [0, -2], body: [2, -2] },
};
const SLOT_ANCHOR: Record<string, Anchor> = { head: 'head', deco: 'head', face: 'eye', back: 'back', hand: 'hand', feet: 'feet', body: 'body' };
/** 例外：圍巾跟著脖子。 */
const ITEM_ANCHOR: Record<string, Anchor> = { scarf: 'neck' };
export function accAnchor(id: string): Anchor { return ITEM_ANCHOR[id] ?? SLOT_ANCHOR[(ACCESSORIES as any)[id]?.slot] ?? 'body'; }
/** 貼身的衣服（外套）在其他物種上只畫在身體輪廓內，跟著身形走。 */
const CLIP_TO_BODY = new Set(['jacket']);
/** 正面（狀態面板）：只有雞有正面精靈；其他物種回傳側面。 */
export function frontSprite(species: string) {
  const [sp0, look] = species.split('|');
  if (sp0 !== 'chicken') return speciesSprite(species, 1);
  const name = `chicken_front|${look ?? ''}`; ensureComposite(name); return name;
}
/** 依 `base|a,b,c` 合成並登錄到 S／ANCHOR（快取）。 */
export function ensureComposite(name: string) {
  if (S[name]) return;
  const [base, look = ''] = name.split('|');
  const front = base === 'chicken_front', kind = base.endsWith('_2') || base.endsWith('_s') ? 2 : 1;
  const rows = front ? CHICKEN_FRONT : S[base];
  if (!rows) return;
  const ids = look.split(',').filter((id) => ACC_SPRITES[id]);
  const sp0 = base.split('_')[0], anchors = front ? SPECIES_ANCHORS.chicken : SPECIES_ANCHORS[sp0] ?? SPECIES_ANCHORS.chicken;
  const shift = (l: any[], [ox, oy]: [number, number]) => l.map(([x, y, c]) => [x + ox, y + oy, c] as [number, number, number | string]);
  const accs = ids.map((id) => { const v = front ? ACC_SPRITES[id].front : ACC_SPRITES[id].side, o = anchors[accAnchor(id)]; return { id, o, a: ACC_SPRITES[id], v: { back: shift(v.back, o), front: shift(v.front, o), fx: shift(v.fx, o) } }; });
  const dyOf = (id: string) => (kind === 2 && !GROUNDED.has(id) ? 1 : 0); // 走路第 2 格：身體往下 1px，配件跟著動（地上的球、鞋子不動）
  const g = new Map<string, [number, number, string]>();
  const put = (x: number, y: number, c: string) => g.set(`${x},${y}`, [x, y, c]);
  for (const { id, v } of accs) for (const [x, y, c] of v.back) put(x, y + dyOf(id), String(c));
  const isChicken = front || sp0 === 'chicken'; // 拿掉頭毛／腳只對雞的像素有意義
  const nohair = isChicken && accs.some((a) => a.a.nohair), nofeet = isChicken && accs.some((a) => a.a.nofeet);
  const hairTo = 1 + (kind === 2 ? 1 : 0);
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === '.' || c === ' ') return;
    if (nohair && y <= hairTo) return;
    if (nofeet && y >= 16) return;
    put(x, y, c);
  }));
  // 雞以外：墨鏡的鏡腳超出頭的部分、外套超出身體的部分（底圖是空白）拿掉，免得浮在半空中
  const empty = (x: number, y: number) => (rows[y]?.[x] ?? '.') === '.';
  const clip = (id: string, o: [number, number], x: number, y: number) => !isChicken && ((id === 'shades' && x > 5 + o[0] + 3 && empty(x, y)) || (CLIP_TO_BODY.has(id) && empty(x, y)));
  for (const { id, o, v } of accs) for (const [x, y, c] of v.front) if (!clip(id, o, x, y)) put(x, y + dyOf(id), String(c));
  for (const { id, v } of accs) for (const [x, y, c] of v.fx) put(x, y + dyOf(id), String(c));
  const bw = rows[0].length, bh = rows.length;
  let x0 = 0, y0 = 0, x1 = bw - 1, y1 = bh - 1;
  for (const [x, y] of g.values()) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const out = Array.from({ length: y1 - y0 + 1 }, () => Array(x1 - x0 + 1).fill('.'));
  for (const [x, y, c] of g.values()) out[y - y0][x - x0] = c;
  S[name] = out.map((r) => r.join('')); ANCHOR[name] = { ox: -x0, oy: -y0, bw, bh };
}
const GROUNDED = new Set(['shoes', 'soccer']);
/** v1.7 頂部列金幣圖示（9×9，四階綠）。 */
export const COIN9 = ['..33333..', '.3222223.', '321011123', '320111123', '321111123', '321111123', '321111223', '.3222223.', '..33333..'];
let coinUrl = '';
export function coinIconUrl() {
  if (coinUrl || typeof document === 'undefined') return coinUrl;
  const c = document.createElement('canvas'); c.width = 9; c.height = 9; const g = c.getContext('2d'); if (!g) return '';
  spr(g, '__coin', 0, 0); coinUrl = c.toDataURL(); return coinUrl;
}
S.__coin = COIN9;
export const coinHtml = (n: number | string) => `<img class="coin-ic" src="${coinIconUrl()}" alt="◎" width="9" height="9">${n}`;
/** 把精靈畫到一個小 canvas（圖示 / 物種選擇用）。 */
export function spriteCanvas(name: string, scale = 1, inverse = false) {
  if (!S[name] && name.includes('|')) ensureComposite(name);
  const an = ANCHOR[name];
  const c = document.createElement('canvas'); c.width = S[name][0].length * scale; c.height = S[name].length * scale;
  const g = c.getContext('2d')!; g.scale(scale, scale);
  if (an) { g.translate(an.ox, an.oy); }
  if (inverse) S[name].forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '.') return; g.fillStyle = ch === '3' ? PAL[0] : PAL[1]; g.fillRect(i, j, 1, 1); }));
  else spr(g, name, 0, 0);
  return c;
}
export const FOOD_SPRITE: Record<string, string> = { rice: 'rice', candy: 'candy', worm: 'worm', corn: 'corn', cake: 'cake', rosetea: 'rosetea' };
/** 玫瑰茶杯子的茶水列（由上到下）與杯內 x 範圍，用來畫「慢慢喝光」。 */
export const CUP_LIQUID = { rows: [3, 4, 5, 6], x0: 1, x1: 4 };

/** 伺服器 publicPet／PetSummary → 精靈鍵（帶配件）。 */
export function petSpriteKey(p: { species: string; look?: string } | null | undefined) { return !p ? 'chicken' : p.look ? `${p.species}|${p.look}` : p.species; }
