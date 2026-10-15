// 外殼：白色貼紙蛋＋粉紅星框的照片（去背；apps/web/public/shell-white.webp）。比例固定，永遠不拉長。
export const SHELL = {
  src: '/shell-white.webp', w: 635, h: 733,
  /** 照片裡 LCD 的位置（佔外殼寬／高的比例）；畫面（頂部列＋遊戲畫面）一定要放在這裡面。 */
  lcd: { left: 0.2142, top: 0.2838, width: 0.5638, height: 0.4652 },
} as const;
/** 頂部列＋畫面要放進 LCD 時的寬度比例（佔 LCD 寬）上下限。 */
export const LCD_FIT_MAX = 1, LCD_FIT_MIN = 0.4;
