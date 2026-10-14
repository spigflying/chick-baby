import { ALWAYS_OPEN, makeClock, parseOpenHours, type Clock } from '@chick/engine';
import { env } from './env';

/** 開放時間（requirements §4.7）。沒設 OPEN_HOURS = 永遠開放（本機開發與既有整合測試）。 */
let current: Clock = env.openHours ? makeClock(parseOpenHours(env.openHours)) : ALWAYS_OPEN;
export const clock = () => current;
/** 只給測試用：換成指定的時鐘。 */
export function setClock(c: Clock) { current = c; }
