// 彩色像素蛋殼（移植自原型）
/** 蛋形：e ≤ 1 在蛋裡；> 0.88 是外框，0.78–0.88 是彩色邊（與 drawShell 同一個公式）。nx, ny 是 0–1 的相對座標。 */
export function eggE(fx: number, fy: number): number {
  const nx = (fx - 0.5) / 0.5, ny = (fy - 0.54) / 0.46;
  return ny < 0 ? nx * nx / (1 + ny * 0.08) ** 2 + ny * ny : nx * nx + ny * ny;
}
/** 內容（畫面）可以佔用的範圍：留在彩色邊以內。 */
export const EGG_SAFE_E = 0.76;
export function drawShell(c: HTMLCanvasElement, palette = ['#ff5c8a', '#ffd23f', '#3ec6ff', '#7ee07e', '#b48cff', '#ff9f43'], rim = '#ff3d7f', H = 56) {
  const W = 40; c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = eggE((x + 0.5) / W, (y + 0.5) / H);
    if (e > 1) continue;
    let col;
    if (e > 0.88) col = '#1a1030';
    else if (e > 0.78) col = rim;
    else {
      const d = ((x >> 2) + (y >> 2)) % 2 === 0 && x % 4 < 3 && y % 4 < 3;
      col = d ? palette[((x >> 2) * 3 + (y >> 2)) % palette.length] : '#fff4d6';
    }
    g.fillStyle = col; g.fillRect(x, y, 1, 1);
  }
  // 高光：只畫在殼的內部（舊座標 (10–12, 8–10) 落在外框／蛋外面，左上角出現白色缺角）
  g.fillStyle = '#ffffff'; SHINE.forEach(([x, y]) => g.fillRect(x, Math.round((y + 0.5) * H / 56 - 0.5), 1, 1)); // 蛋被拉高時跟著等比例往下
}
// 每種物種一個殼色，訪客一眼看出是誰家
export const SHELL_COLORS: Record<string, { palette: string[]; rim: string }> = {
  chicken: { palette: ['#ff5c8a', '#ffd23f', '#3ec6ff', '#7ee07e', '#b48cff', '#ff9f43'], rim: '#ff3d7f' },
  duck: { palette: ['#3ec6ff', '#ffd23f', '#7ee07e', '#ffffff', '#5b8cff', '#ff9f43'], rim: '#1e90ff' },
  penguin: { palette: ['#b48cff', '#3ec6ff', '#ffffff', '#5b8cff', '#ff5c8a', '#7ee07e'], rim: '#6a4cff' },
  dino: { palette: ['#7ee07e', '#ffd23f', '#ff9f43', '#3ec6ff', '#ff5c8a', '#b48cff'], rim: '#2fb34a' },
};
/** 左上角高光的像素（已確認都落在殼的內部填色區）。 */
export const SHINE: [number, number][] = [[12, 10], [13, 10], [11, 11], [11, 12]];
