import { GAME, FOODS, type GameConfig } from '@chick/engine';
/** 上方 5 個狀態圖示（畫在 canvas 的 HUD 列）：順序、位置與點一下的說明。數字直接從引擎參數算，改參數說明會跟著變。 */
export const STAT_KEYS = ['hunger', 'happiness', 'energy', 'cleanliness', 'health'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export const STAT_NAME: Record<StatKey, string> = { hunger: '飽足', happiness: '心情', energy: '精力', cleanliness: '清潔', health: '健康' };
/** HUD 每格：x = 1 + i×24，寬 23（圖示 11＋條 11）；y 0–12（canvas 座標，120×100）。 */
export const HUD_CELL = { x0: 1, step: 24, w: 23, h: 13 };
/** HUD 下方的分隔線（canvas y = 13）兼進化進度：點擊範圍上 2、下 3 格，方便手機點。 */
export const EVO_HELP = 99, EVO_LINE_Y = 13, EVO_HIT = { y0: 11, y1: 17 };
/** 進度線「還沒到」那段的顏色：LCD 調色盤的中間色 PAL[2]（#306230），介於最深色和螢幕底色之間，一般看就分得出兩段。 */
export const EVO_LINE_TRACK = '#306230';
/** 睡覺時螢幕底色就是 PAL[2]，剩下那段改用介於 PAL[3] 和 PAL[2] 之間的顏色，線才不會斷掉。 */
export const EVO_LINE_TRACK_SLEEP = '#1f4d20';
export function hudTarget(x: number, y: number): number {
  if (y >= EVO_HIT.y0 && y < EVO_HIT.y1 && x >= 0 && x < 120) return EVO_HELP;
  return statAt(x, y);
}
export function statAt(x: number, y: number): number {
  if (y < 0 || y >= EVO_HIT.y0 || x < HUD_CELL.x0) return -1;
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
import { CARE_POOL, CARE_POOL_MID, ACCESSORIES } from '@chick/engine';
import { evoEta } from './topTip';
const CAT_NAME: Record<string, string> = { strength: '力量', speed: '速度', stamina: '體力', weight: '體重' };
/** 進度條的說明：進化規則（照 bao.ts 的 rollBao／GAME.bao）＋這隻的階段與下次時間。 */
export function evoHelp(p: { status: string; bao_stage?: number | null; evolve_at?: number | null; evolve_done_ms?: number | null; evolve_need_ms?: number | null } | null | undefined, c: GameConfig = GAME): { name: string; lines: string[] } {
  const h1 = Math.round(c.bao.evolveOpenMs / 3_600_000), h2 = Math.round(c.bao.reevolveOpenMs / 3_600_000);
  const st = p?.bao_stage ?? 0, eta = evoEta(p);
  const mid = CARE_POOL_MID.map((id) => ACCESSORIES[id].name).join('、');
  return {
    name: `進化（${st > 0 ? `第 ${st} 階` : '還沒進化'}）`,
    lines: [
      ...(eta ? [`下次：${eta}`] : []),
      `孵化後營業時間累計 ${h1} 小時第一次進化，之後每 ${h2} 小時再變一次；晚上和週末不算`,
      `主配件看成長最多的數值（${Object.values(CAT_NAME).join('／')}），第二名有第一名的 80% 以上再加一個副配件`,
      `照顧得好（少生病、少餓、少髒）會多一個小配件：50 分以上從${mid}挑，80 分以上有 ${CARE_POOL.length} 種可抽（還有彩虹頭帶、蒲公英…）`,
    ],
  };
}
