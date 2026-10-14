import { phaseAt, type Phase } from '@chick/engine';
import { clock } from './hours';

export interface ClosingHandlers {
  onClosing(closesAt: number): void | Promise<void>;
  onClosed(opensAt: number | null): void | Promise<void>;
}
/** 定期檢查開放狀態：進入「快關門」時呼叫 onClosing、進入「已關門」時呼叫 onClosed，各一次。 */
export function startClosingLoop(h: ClosingHandlers, now: () => number = Date.now, intervalMs = 1000) {
  let prev: Phase = phaseAt(clock(), now());
  const tick = async () => {
    const t = now(), cur = phaseAt(clock(), t);
    if (cur === prev) return;
    prev = cur;
    if (cur === 'closing') await h.onClosing(clock().status(t).closes_at!);
    else if (cur === 'closed') await h.onClosed(clock().status(t).opens_at);
  };
  const timer = setInterval(() => { tick().catch((e) => console.error('closing loop failed', e)); }, intervalMs);
  timer.unref();
  return { timer, tick };
}
