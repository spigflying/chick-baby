// 小雞農場主畫面的固定版面（960×600 的 SVG 場景座標，左上角＋寬高）。
// 位置固定、新內容只往後加（spec：farm_slots 的編號固定對應這些位置）。
export interface Box { x: number; y: number; w: number; h: number }
export const SCENE = { w: 960, h: 600, hudH: 70 };

const FW = 96, FH = 64;
const COLS = [220, 328, 436, 544], ROWS = [270, 350, 430];

export const LAYOUT = {
  /** 12 格田集中在農場中央；編號仍由上到下、由左到右，避免改動既有存檔。 */
  fields: ROWS.flatMap((y) => COLS.map((x) => ({ x, y, w: FW, h: FH }))) as Box[],
  hutch: { x: 18, y: 108, w: 190, h: 118 },
  coop: { x: 222, y: 108, w: 190, h: 118 },
  bakery: { x: 510, y: 96, w: 190, h: 132 },
  jamhouse: { x: 712, y: 96, w: 190, h: 132 },
  tree: { x: 16, y: 288, w: 150, h: 136 },
  board: { x: 20, y: 458, w: 120, h: 110 },
  barn: { x: 754, y: 438, w: 184, h: 140 },
  /** 環田步道不切開田區，也保留通往東邊新地的空間。 */
  path: [
    { x: 178, y: 240, w: 556, h: 14 },
    { x: 182, y: 258, w: 16, h: 246 },
    { x: 662, y: 258, w: 16, h: 244 },
    { x: 198, y: 510, w: 476, h: 16 },
    { x: 680, y: 372, w: 250, h: 16 },
  ] as Box[],
  /** 池塘；小雞在場景外的照顧提示卡，不佔用田區。 */
  pond: { x: 765, y: 284, w: 152, h: 70 },
  /** 第二階段：小路右端的路牌「東邊新地 →」 */
  eastSign: { x: 864, y: 360, w: 78, h: 46 } as Box,
};

/** 第二階段「東邊新地」：第二個 960×600 畫面。田 12–17、蜂箱、牛棚、起司小屋、熱氣球、小攤、6 個裝飾格。 */
const ECOLS = [176, 284, 392], EROWS = [230, 315];
export const EAST = {
  fields: EROWS.flatMap((y) => ECOLS.map((x) => ({ x, y, w: FW, h: FH }))) as Box[],
  beehive: { x: 24, y: 104, w: 150, h: 120 } as Box,
  cowshed: { x: 200, y: 104, w: 236, h: 120 } as Box,
  dairy: { x: 530, y: 96, w: 190, h: 132 } as Box,
  balloon: { x: 730, y: 190, w: 220, h: 180 } as Box,
  stall: { x: 550, y: 296, w: 170, h: 96 } as Box,
  decos: [100, 215, 330, 445, 560, 675].map((x) => ({ x, y: 425, w: 110, h: 110 })) as Box[],
  /** 小路左端的路牌「← 回農場」 */
  back: { x: 4, y: 358, w: 78, h: 46 } as Box,
  path: [
    { x: 150, y: 232, w: 16, h: 190 },
    { x: 506, y: 232, w: 16, h: 190 },
    { x: 172, y: 405, w: 564, h: 12 },
  ] as Box[],
};
