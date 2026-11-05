/** 格鬥可選的臉：chick = 原本的雞臉；其他是照片臉（圖在 apps/web/public/fight/face_<id>.webp）。伺服器用來檢查，前端用來畫。 */
export const FIGHT_FACES = ['chick', 'a', 'b', 'c'] as const;
export type FightFace = (typeof FIGHT_FACES)[number];
export const fightFace = (v: unknown): FightFace => (FIGHT_FACES as readonly unknown[]).includes(v) ? (v as FightFace) : 'chick';
