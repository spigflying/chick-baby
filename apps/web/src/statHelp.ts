import { GAME, FOODS, type GameConfig } from '@chick/engine';
/** 上方 5 個狀態圖示（畫在 canvas 的 HUD 列）：順序、位置與點一下的說明。數字直接從引擎參數算，改參數說明會跟著變。 */
export const STAT_KEYS = ['hunger', 'happiness', 'energy', 'cleanliness', 'health'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export const STAT_NAME: Record<StatKey, string> = { hunger: '飽足', happiness: '心情', energy: '精力', cleanliness: '清潔', health: '健康' };
/** HUD 每格：x = 1 + i×24，寬 23（圖示 11＋條 11）；y 0–12（canvas 座標，120×100）。 */
export const HUD_CELL = { x0: 1, step: 24, w: 23, h: 13 };
export function statAt(x: number, y: number): number {
  if (y < 0 || y >= HUD_CELL.h || x < HUD_CELL.x0) return -1;
  const i = Math.floor((x - HUD_CELL.x0) / HUD_CELL.step);
  return i >= 0 && i < STAT_KEYS.length && x - HUD_CELL.x0 - i * HUD_CELL.step < HUD_CELL.w ? i : -1;
}
const r1 = (n: number) => String(Math.round(n * 10) / 10);
/** 每小時（營業時間）的變化量：引擎每分鐘 × timeScale × 60。 */
export function statHelp(k: StatKey, c: GameConfig = GAME): { name: string; lines: string[] } {
  const ph = (perMin: number) => r1(perMin * c.timeScale * 60);
  const lowH = c.health.lowBelow, maxFood = (f: 'hunger' | 'happiness') => Math.max(...FOODS.map((x) => x[f]));
  const L: Record<StatKey, string[]> = {
    hunger: [
      `↓ 營業時間每小時 −${ph(c.decay.hunger)}（睡覺時減半），下樓梯也會餓`,
      `↑ 餵食（米粒 +${FOODS.find((f) => f.id === 'rice')?.hunger ?? 20}，最多 +${maxFood('hunger')}）；${c.feed.snackOnlyAt} 以上只吃得下點心`,
      `低於 ${c.sick.hungryBelow} 可能生病；低於 ${lowH} 健康會下降`,
    ],
    happiness: [
      `↓ 營業時間每小時 −${ph(c.decay.happiness)}（睡覺時少很多）；看醫生 −${c.doctor.happinessLoss}`,
      `↑ 餵點心（蛋糕 +${FOODS.find((f) => f.id === 'cake')?.happiness ?? 35}）、帶去下樓梯（+10 以上）`,
      `低於 ${lowH} 健康會下降`,
    ],
    energy: [
      `↓ 醒著每小時 −${ph(c.decay.energy)}，下樓梯消耗更多`,
      `↑ 睡覺很快補滿（睡飽自己起床）${c.morningEnergy !== null ? '；每天開門時補滿' : ''}`,
      `低於 ${c.stairsMinEnergy} 不能下樓梯；低於 ${lowH} 健康會下降`,
    ],
    cleanliness: [
      `↓ 每小時 −${ph(c.decay.cleanliness)}，每坨便便再 −${ph(c.poop.cleanPerPoopPerMin)}`,
      '↑ 清潔：馬上回到 100，便便清光',
      `低於 ${c.sick.dirtyBelow} 超過 ${Math.round(c.sick.dirtyForMs / 60_000)} 分鐘可能生病；低於 ${lowH} 健康會下降`,
    ],
    health: [
      `↓ 其他狀態每有一項低於 ${lowH}，每小時 −${ph(-c.health.perLowPerMin)}；生病再 −${ph(-c.health.sickPerMin)}`,
      `↑ 都沒問題時每小時 +${ph(c.health.recoverPerMin)}；看醫生 +${c.doctor.healthGain} 並治好病`,
      '歸零就會死掉，要趕快照顧！',
    ],
  };
  return { name: STAT_NAME[k], lines: L[k] };
}
