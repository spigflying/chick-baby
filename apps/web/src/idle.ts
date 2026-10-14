import type { Live } from './ws';

export interface IdleConfig { hiddenMs: number; idleMs: number }
/** 分頁隱藏 2 分鐘、或 10 分鐘沒有操作 → 暫停連線（gcp-plan §6.1：開著的 WebSocket 會讓 Cloud Run 一直計費）。 */
export const IDLE: IdleConfig = { hiddenMs: 2 * 60_000, idleMs: 10 * 60_000 };
export interface IdleState { hiddenSince: number | null; lastActivity: number; inMatch: boolean }

export function shouldPause(s: IdleState, now: number, cfg: IdleConfig = IDLE): boolean {
  if (s.inMatch) return false; // 比賽中不斷線
  if (s.hiddenSince !== null && now - s.hiddenSince >= cfg.hiddenMs) return true;
  return now - s.lastActivity >= cfg.idleMs;
}

/** 接上瀏覽器事件：隱藏或閒置就 live.pause()，回到分頁或有操作就 live.resume()。回傳解除函式。 */
export function watchIdle(live: Live, cfg: IdleConfig = IDLE): () => void {
  const s: IdleState = { hiddenSince: document.hidden ? Date.now() : null, lastActivity: Date.now(), inMatch: false };
  const wake = () => { s.lastActivity = Date.now(); if (live.isPaused) live.resume(); };
  const onVis = () => { if (document.hidden) s.hiddenSince = Date.now(); else { s.hiddenSince = null; wake(); } };
  const events = ['pointerdown', 'keydown', 'touchstart'] as const;
  document.addEventListener('visibilitychange', onVis);
  events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
  const timer = window.setInterval(() => { s.inMatch = live.inMatch; if (!live.isPaused && shouldPause(s, Date.now(), cfg)) live.pause(); }, 5000);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); events.forEach((e) => window.removeEventListener(e, wake)); };
}
