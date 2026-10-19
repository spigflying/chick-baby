/**
 * 雞以外的物種：正面精靈、配件錨點、少數要改尺寸／位置的配件（以該物種座標直接畫），以及外套的畫法。
 * 色碼同 sprites：0 最亮、1 亮、2 暗、3 輪廓；'.' 透明。
 */
export type Anchor = 'head' | 'eye' | 'neck' | 'back' | 'hand' | 'feet' | 'body';
export type Pts = [number, number, number | string][];

/** 正面精靈（16 寬），眼睛和雞正面一樣在 x=5、x=10，讓墨鏡等正面配件對得上。 */
export const SPECIES_FRONT: Record<string, string[]> = {
  duck: [
    '.....333333.....',
    '....30000003....',
    '...3000000003...',
    '...3030000303...',
    '...3000000003...',
    '...3002222003...',
    '....30222203....',
    '..330000000033..',
    '.30000000000003.',
    '3000000000000003',
    '3220000000000223',
    '3222000000002223',
    '3022000000002203',
    '.30000000000003.',
    '..333333333333..',
    '.....3....3.....',
    '....22....22....',
  ],
  penguin: [
    '.....333333.....',
    '....33333333....',
    '...3333333333...',
    '...3303333033...',
    '...3333333333...',
    '...3333223333...',
    '..333300003333..',
    '.33330000003333.',
    '3333000000003333',
    '3.330000000033.3',
    '..300000000003..',
    '..300000000003..',
    '..330000000033..',
    '...3333333333...',
    '....222..222....',
    '...2222..2222...',
  ],
  dino: [
    '......3..3......',
    '.....333333.....',
    '....32222223....',
    '...3222222223...',
    '...3202222023...',
    '...3222222223...',
    '...3222222223...',
    '....32333323....',
    '...3322222233...',
    '..321111111123..',
    '3322111111112233',
    '3.321111111123.3',
    '..321111111123..',
    '...3222222223...',
    '....33333333....',
    '....332..233....',
    '...3332..2333...',
  ],
};
/** 正面最上面幾列是「頭毛」（戴帽子時拿掉）：雞 0-1 列、恐龍的背刺第 0 列。 */
export const FRONT_HAIR_ROWS: Record<string, number> = { chicken: 1, dino: 0, duck: -1, penguin: -1 };

const Z: [number, number] = [0, 0];
/** 側面錨點：相對於雞的位移。 */
export const SIDE_ANCHORS: Record<string, Record<Anchor, [number, number]>> = {
  chicken: { head: Z, eye: Z, neck: Z, back: Z, hand: Z, feet: Z, body: Z },
  duck: { head: [1, -2], eye: [1, -4], neck: [1, -4], back: [1, -1], hand: [0, -1], feet: [-1, -2], body: [0, -1] },
  penguin: { head: [-1, -2], eye: [0, -3], neck: [0, -4], back: [0, -2], hand: [0, -2], feet: [-2, -2], body: [0, -2] },
  dino: { head: [-3, -2], eye: [-3, -3], neck: [-2, -4], back: [0, -3], hand: [1, -1], feet: [0, -2], body: [2, -2] },
};
/** 正面錨點：相對於雞正面（眼睛 y=6、頭頂 y=2、腳 y=15-16）。 */
export const FRONT_ANCHORS: Record<string, Record<Anchor, [number, number]>> = {
  chicken: SIDE_ANCHORS.chicken,
  duck: { head: [0, -3], eye: [0, -3], neck: [0, -1], back: [0, 0], hand: [0, 0], feet: [0, 0], body: [0, 0] },
  penguin: { head: [0, -3], eye: [0, -3], neck: [0, -3], back: [0, -1], hand: [0, -1], feet: [0, -1], body: [0, -1] },
  dino: { head: [0, -2], eye: [0, -2], neck: [0, -1], back: [0, 0], hand: [0, 0], feet: [0, 0], body: [0, 0] },
};
/** 個別配件在某物種上的額外位移（側面）。 */
export const SIDE_EXTRA: Record<string, Record<string, [number, number]>> = {
};

const grid = (rows: string[], ox: number, oy: number): Pts => {
  const out: Pts = [];
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c !== '.') out.push([x + ox, y + oy, c]); }));
  return out;
};
/** 縮小版：保留原本的設計（皇冠三個尖＋珠子＋寶石；帽子圓頂＋前簷；聖誕帽毛邊＋往後垂的毛球）。 */
const CROWN_S = ['.3...3...3.', '303.303.303', '.313.3.313.', '.3113.3113.', '.311131113.', '.312111213.', '.311121113.', '.333333333.'];
const HAT_S = ['....333...', '...32223..', '..3222223.', '3000033333', '.3333.....'];
const SANTA_S = ['...3333.....', '..322223....', '.32112223...', '.3222222333.', '311111111313', '310101010303', '.3333333333.'];
/** 以物種座標直接畫的替代圖（側面，第 1 格）。 */
export const SIDE_ART: Record<string, Record<string, Pts>> = {
  dino: { crown: grid(CROWN_S, -1, -6), hat: grid(HAT_S, -1, -2), santa: grid(SANTA_S, -1, -4) },
  duck: { hat: grid(HAT_S, 1, -2), santa: grid(SANTA_S, 1, -5) },
};
export const FRONT_ART: Record<string, Record<string, Pts>> = {
  dino: { crown: grid(CROWN_S, 3, -7) },
};

/** 外套的身體範圍：[第一列, 最後一列, 前襟 x]（側面面向左，前襟靠左；正面在中間）。 */
const COAT_SIDE: Record<string, [number, number, number]> = { duck: [7, 11, 4], penguin: [6, 11, 4], dino: [6, 10, 5] };
const COAT_FRONT: Record<string, [number, number, number]> = { duck: [8, 13, 7], penguin: [7, 12, 7], dino: [9, 13, 7] };
const COAT_COLOR: Record<string, string> = { duck: '2', penguin: '2', dino: '0' };
/**
 * 外套：把身體那幾列的內部塗滿（實心），上緣是領子、前襟一條開口線＋鈕扣、下擺一條邊。
 * 依底圖輪廓算，所以任何物種都貼著身形。
 */
export function coatPoints(sp: string, rows: string[], front: boolean, dy: number): Pts {
  const spec = (front ? COAT_FRONT : COAT_SIDE)[sp]; if (!spec) return [];
  const [ya, yb, fx] = spec, col = COAT_COLOR[sp] ?? '2', light = col === '0' ? '2' : '0';
  const out: Pts = [];
  for (let y = ya + dy; y <= yb + dy; y++) {
    const r = rows[y] ?? ''; const xs = [...r].map((c, x) => (c !== '.' ? x : -1)).filter((x) => x >= 0);
    if (xs.length < 3) continue;
    const l = xs[0], rr = xs[xs.length - 1];
    for (let x = l + 1; x < rr; x++) {
      if (r[x] === '.') continue;
      let c = col;
      if (y === yb + dy) c = '3'; // 下擺
      if (front ? (x === fx || x === fx + 1) : x === fx) c = '3'; // 前襟開口
      out.push([x, y, c]);
    }
    if (y > ya + dy && y < yb + dy && (y - ya - dy) % 2 === 1) out.push([front ? fx - 1 : fx + 1, y, light]); // 鈕扣
  }
  // 領子：最上面一列，前襟兩側各一個亮色的翻領
  const y = ya + dy;
  if (front) { out.push([fx - 1, y, light], [fx - 2, y, light], [fx + 2, y, light], [fx + 3, y, light]); }
  else { out.push([fx - 1, y, light], [fx + 1, y, light], [fx + 2, y, light]); }
  return out;
}
