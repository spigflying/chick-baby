/**
 * 賽車車款（原創像素圖，從車尾看）。每台車有 5 個 LOD 尺寸，遠處直接用小圖，不縮放雜訊。
 * 只寫左半邊，右半邊鏡像產生（左右對稱、輪廓 1px 乾淨）。
 * 字元：o 輪廓(最暗) b 車身 a 配色條 w 玻璃 l 尾燈 x 排氣/擴散器 t 輪胎 . 透明
 */
export const LODS = [24, 16, 10, 6, 4] as const; // 寬度（px）
type Half = string[];
export const CAR_HALVES: Record<string, Half[]> = {
  // 隼 GT：大尾翼＋支架、雙圓尾燈、中央條紋
  falcon: [
    ['..oooooooooo', '..oaaaaaaaaa', '..ooo.o.....', '......oooooo', '.....owwwwww', '....owwwwwww', '..oooooooooo', '.obbbbbbbbbb', 'olllobbbbbaa', 'olllobbbbbaa', 'obbbbbbbbbbb', 'oxxooooooooo', 'ttto........', 'ttto........'],
    ['.ooooooo', '.oaaaaaa', '.oo.o...', '....oooo', '...owwww', '.ooooooo', 'ollobbba', 'obbbbbbb', 'oxoooooo', 'tto.....'],
    ['ooooo', 'o.ooo', '..oww', 'ooooo', 'olbba', 'ooooo', 'to...'],
    ['ooo', '.ow', 'olb', 'ooo'],
    ['oo', 'ob', 'oo'],
  ],
  // 箭 RS：低矮楔形、一字型燈條、中央雙出排氣
  arrow: [
    ['......oooooo', '....oowwwwww', '...owwwwwwww', '..oowwwwwwww', '.ooooooooooo', 'obbbbbbbbbbb', 'olllllllllll', 'obbbbbbbbbbb', 'obbbbbbbboxx', 'oooooooooooo', 'tttto.......', 'tttto.......'],
    ['....oooo', '..oowwww', '.owwwwww', 'oooooooo', 'olllllll', 'obbbbbbb', 'obbbbbox', 'oooooooo', 'tto.....'],
    ['..ooo', '.owww', 'ooooo', 'ollll', 'ooooo', 'to...'],
    ['.oo', 'oll', 'ooo'],
    ['oo', 'oo'],
  ],
  // 犀 4WD：高車身、車尾備胎、直立尾燈
  rhino: [
    ['..oooooooooo', '..owwwwwwwww', '..owwwwwwwww', '..owwwwwwwww', '.ooooooooooo', '.olbbbbboooo', '.olbbbbotttt', '.olbbbbotxxx', '.obbbbbotttt', '.obbbbbboooo', 'oooooooooooo', 'ttttto......', 'ttttto......'],
    ['.ooooooo', '.owwwwww', '.owwwwww', 'oooooooo', 'olbbbott', 'olbbbotx', 'obbbbott', 'oooooooo', 'ttto....'],
    ['.oooo', '.owww', 'ooooo', 'olbot', 'ooooo', 'tto..'],
    ['.oo', 'olb', 'ooo'],
    ['oo', 'ob', 'oo'],
  ],
  // 彗星 Z：超寬超跑、四顆尾燈、大擴散器
  comet: [
    ['........oooo', '......oowwww', '....oowwwwww', '..ooaaaaaaaa', '.obbbbbbbbbb', 'olloollobbaa', 'obbbbbbbbbbb', 'oxoxoxoxoxox', 'oooooooooooo', 'ttto.oo.....', 'ttto........'],
    ['.....ooo', '...oowww', '.ooaaaaa', 'olollobb', 'obbbbbbb', 'oxoxoxox', 'oooooooo', 'tto.....'],
    ['...oo', '.ooww', 'ololb', 'ooooo', 'to...'],
    ['..o', 'olb', 'ooo'],
    ['oo', 'oo'],
  ],
};
export const CAR_MODELS = Object.keys(CAR_HALVES);
/** 完整（鏡像後）的字元圖 */
export function carArt(model: string, lod: number): string[] {
  const h = (CAR_HALVES[model] ?? CAR_HALVES.falcon)[lod];
  return h.map((r) => r + [...r].reverse().join(''));
}
/** 塗裝（四階綠，0 最亮 3 最暗）：[車身, 配色條] */
export const LIVERIES: [number, number][] = [[0, 1], [1, 0], [2, 0], [0, 2], [1, 3], [2, 1]];
export const LIVERY_NAMES = ['白', '淺綠', '墨綠', '白／墨條', '淺綠／黑條', '墨綠／淺條'];
export interface CarLook { brake?: boolean; nitro?: boolean; hit?: boolean; frame?: number }
/** 把字元圖轉成 0..3 的色碼陣列（null = 透明）。純函式，方便測試與做設計稿。 */
export function carPixels(model: string, livery: number, lod: number, look: CarLook = {}): (number | null)[][] {
  const art = carArt(model, lod), [body, accent] = LIVERIES[livery % LIVERIES.length];
  const glass = body === 2 ? 3 : 2, lampOff = body === 2 ? 1 : body === 1 ? 2 : 2;
  const rows = art.map((row, j) => [...row].map((ch, i): number | null => {
    switch (ch) {
      case 'o': case 't': return 3;
      case 'b': return look.hit && (look.frame ?? 0) % 2 ? (body === 0 ? 2 : 0) : body; // 受損：整片車身閃色（不加雜點）
      case 'a': return accent;
      case 'w': return i === j + 4 && lod === 0 ? (glass === 3 ? 2 : 1) : glass; // 後窗一道反光
      case 'l': return look.brake ? 0 : lampOff;
      case 'x': return 2;
      default: return null;
    }
  }));
  if (look.nitro && lod <= 2) { // 排氣火焰：從排氣口往下噴、閃動（亮→中→暗外圈）
    const w = rows[0].length, f = (look.frame ?? 0) & 1;
    const len = lod === 0 ? 4 + f : lod === 1 ? 3 + f : 2;
    const fw = lod === 0 ? 2 : 1;
    const xs = lod === 0 ? [6, w - 8] : lod === 1 ? [4, w - 5] : [3, w - 4];
    const last = rows.length - 1;
    for (let k = 0; k < len; k++) {
      const row: (number | null)[] = Array(w).fill(null);
      for (const x0 of xs) for (let d = 0; d < fw; d++) row[x0 + d] = k < len - 2 ? 0 : k < len - 1 ? 1 : 2;
      // 從輪胎那一列開始往下覆蓋
      const at = last - 1 + k; if (at < rows.length) { for (let i = 0; i < w; i++) if (row[i] !== null) rows[at][i] = row[i]; } else rows.push(row);
    }
  }
  return rows;
}
