/** 遊戲參數（伺服器可用 game_config 覆寫）。 */
export const ENGINE_VERSION = '1.0.0';
export const GAME = {
  timeScale: 1 / 12,
  eggSeconds: 60,
  startCoins: 20,
  decay: { hunger: 0.8, happiness: 0.6, energy: 0.5, cleanliness: 0.4 },
  sleepEnergyGain: 120, // v1.4：× timeScale(1/12) = 每實際分鐘 +10，0 → 100 約 10 分鐘
  /** 每次開門（休息 → 開放）時精力設成這個值；null = 不補（requirements §4.7 早安）。 */
  morningEnergy: 100 as number | null,
  poop: { afterFeedChance: 0.7, max: 3, cleanPerPoopPerMin: 0.3 },
  sick: { dirtyBelow: 25, dirtyForMs: 30 * 60_000, chancePerMin: 0.05, hungryBelow: 15 },
  health: { lowBelow: 20, perLowPerMin: -0.6, sickPerMin: -0.8, recoverPerMin: 0.3 },
  feed: { snackOnlyAt: 90, fullAt: 100, visitorLowHealthSnackBelow: 30, visitorDailyPerPet: 20, visitorDailyPerVisitorPerPet: 5 },
  doctor: { healthGain: 30, happinessLoss: 10, notNeededAbove: 90 },
  stairsMinEnergy: 15,
  revive: { stat: 50, health: 50 },
  rateLimit: { feedPerMinute: 10, wsMsgsPerSecond: 35 },
  dailyEarnCap: null as number | null,
};
export type GameConfig = typeof GAME;
