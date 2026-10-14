/**
 * 開放時間（requirements §4.7）：遊戲只在開放時間內計時，休息時段時間凍結。
 * 只支援固定時差的時區（不處理夏令時間），所以結果完全決定性。
 */
export interface OpenHours { days: number[]; openMin: number; closeMin: number; offsetMin: number }
export interface OpenStatus { open: boolean; opens_at: number | null; closes_at: number | null }
export type Phase = 'open' | 'closing' | 'closed';
export interface Clock {
  alwaysOpen: boolean;
  isOpen(t: number): boolean;
  /** [from, to) 之中落在開放時間的區間，依時間排序。 */
  segments(from: number, to: number): [number, number][];
  /** [a, b) 之中的開放毫秒數。 */
  elapsed(a: number, b: number): number;
  /** 從 from 起累計 ms 開放毫秒後的時間點；永遠不開放時回傳 Infinity。 */
  addOpen(from: number, ms: number): number;
  /** 開門時間點 O，滿足 from < O ≤ to（用來觸發「早安」）。 */
  openingsIn(from: number, to: number): number[];
  status(t: number): OpenStatus;
}

const DAY = 86_400_000;
const MIN = 60_000;
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const TZ_OFFSET_MIN: Record<string, number> = { 'Asia/Taipei': 480, UTC: 0 };
/** 關門前幾毫秒開始「快關門」（停止開新局、廣播 game.closing）。 */
export const CLOSING_WARN_MS = 5 * MIN;

/** 解析 `mon-fri 09:00-20:00 Asia/Taipei`。 */
export function parseOpenHours(s: string): OpenHours {
  const m = /^([a-z]{3})-([a-z]{3}) (\d\d):(\d\d)-(\d\d):(\d\d) (\S+)$/i.exec(s.trim());
  if (!m) throw new Error(`OPEN_HOURS 格式錯誤：${s}`);
  const d0 = DAY_NAMES.indexOf(m[1].toLowerCase()), d1 = DAY_NAMES.indexOf(m[2].toLowerCase());
  if (d0 < 0 || d1 < 0 || d1 < d0) throw new Error(`OPEN_HOURS 星期錯誤：${s}`);
  const openMin = +m[3] * 60 + +m[4], closeMin = +m[5] * 60 + +m[6];
  if (!(openMin < closeMin && closeMin <= 24 * 60)) throw new Error(`OPEN_HOURS 時間錯誤：${s}`);
  const offsetMin = TZ_OFFSET_MIN[m[7]];
  if (offsetMin === undefined) throw new Error(`OPEN_HOURS 不支援的時區：${m[7]}`);
  const days: number[] = [];
  for (let d = d0; d <= d1; d++) days.push(d);
  return { days, openMin, closeMin, offsetMin };
}

export const ALWAYS_OPEN: Clock = {
  alwaysOpen: true,
  isOpen: () => true,
  segments: (from, to) => (to > from ? [[from, to]] : []),
  elapsed: (a, b) => Math.max(0, b - a),
  addOpen: (from, ms) => from + ms,
  openingsIn: () => [],
  status: () => ({ open: true, opens_at: null, closes_at: null }),
};

export function makeClock(h: OpenHours): Clock {
  const off = h.offsetMin * MIN;
  const dayIndex = (t: number) => Math.floor((t + off) / DAY);
  const dayStart = (d: number) => d * DAY - off;
  const weekday = (d: number) => (((d + 4) % 7) + 7) % 7; // 1970-01-01 是星期四
  const segOfDay = (d: number): [number, number] | null => {
    if (!h.days.includes(weekday(d))) return null;
    const s = dayStart(d);
    return [s + h.openMin * MIN, s + h.closeMin * MIN];
  };
  const segments = (from: number, to: number) => {
    const out: [number, number][] = [];
    if (to <= from) return out;
    for (let d = dayIndex(from); dayStart(d) < to; d++) {
      const g = segOfDay(d); if (!g) continue;
      const a = Math.max(g[0], from), b = Math.min(g[1], to);
      if (a < b) out.push([a, b]);
    }
    return out;
  };
  const isOpen = (t: number) => { const g = segOfDay(dayIndex(t)); return !!g && t >= g[0] && t < g[1]; };
  /** t 之後（含 t）第一個開門時間；兩週內都沒有就回傳 null。 */
  const nextOpening = (t: number) => {
    for (let d = dayIndex(t); d <= dayIndex(t) + 14; d++) { const g = segOfDay(d); if (g && g[0] >= t) return g[0]; }
    return null;
  };
  return {
    alwaysOpen: false,
    isOpen,
    segments,
    elapsed: (a, b) => segments(a, b).reduce((sum, [x, y]) => sum + (y - x), 0),
    addOpen(from, ms) {
      if (!h.days.length) return Infinity;
      let rem = ms;
      for (let d = dayIndex(from); ; d++) {
        const g = segOfDay(d); if (!g) continue;
        const a = Math.max(g[0], from); if (a >= g[1]) continue;
        if (rem <= g[1] - a) return a + rem;
        rem -= g[1] - a;
      }
    },
    openingsIn(from, to) {
      const out: number[] = [];
      for (let d = dayIndex(from); dayStart(d) <= to; d++) { const g = segOfDay(d); if (g && g[0] > from && g[0] <= to) out.push(g[0]); }
      return out;
    },
    status(t) {
      if (isOpen(t)) { const g = segOfDay(dayIndex(t))!; return { open: true, closes_at: g[1], opens_at: nextOpening(g[1]) }; }
      return { open: false, closes_at: null, opens_at: nextOpening(t) };
    },
  };
}

/** 開放中、快關門（關門前 CLOSING_WARN_MS 內）或已關門。 */
export function phaseAt(clock: Clock, t: number): Phase {
  const s = clock.status(t);
  if (!s.open) return 'closed';
  return s.closes_at !== null && s.closes_at - t <= CLOSING_WARN_MS ? 'closing' : 'open';
}
