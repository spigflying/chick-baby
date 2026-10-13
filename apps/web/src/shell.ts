// 彩色像素蛋殼（移植自原型）
export function drawShell(c: HTMLCanvasElement, palette = ['#ff5c8a', '#ffd23f', '#3ec6ff', '#7ee07e', '#b48cff', '#ff9f43'], rim = '#ff3d7f') {
  const W = 40, H = 56; c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = (x + 0.5 - W / 2) / (W / 2), ny = (y + 0.5 - H * 0.54) / (H * 0.46);
    const e = ny < 0 ? nx * nx / (1 + ny * 0.08) ** 2 + ny * ny : nx * nx + ny * ny;
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
  g.fillStyle = '#ffffff'; [[11, 8], [12, 8], [10, 9], [10, 10]].forEach(([x, y]) => g.fillRect(x, y, 1, 1));
}
// 每種物種一個殼色，訪客一眼看出是誰家
export const SHELL_COLORS: Record<string, { palette: string[]; rim: string }> = {
  chicken: { palette: ['#ff5c8a', '#ffd23f', '#3ec6ff', '#7ee07e', '#b48cff', '#ff9f43'], rim: '#ff3d7f' },
  duck: { palette: ['#3ec6ff', '#ffd23f', '#7ee07e', '#ffffff', '#5b8cff', '#ff9f43'], rim: '#1e90ff' },
  penguin: { palette: ['#b48cff', '#3ec6ff', '#ffffff', '#5b8cff', '#ff5c8a', '#7ee07e'], rim: '#6a4cff' },
  dino: { palette: ['#7ee07e', '#ffd23f', '#ff9f43', '#3ec6ff', '#ff5c8a', '#b48cff'], rim: '#2fb34a' },
};
