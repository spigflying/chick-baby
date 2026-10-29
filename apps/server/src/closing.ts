import { phaseAt, type Phase } from '@chick/engine';
import { clock } from './hours';
import { abortAll } from './stairs';
import { abortArenas } from './arena';
import { abortMStairs } from './mstairs';
import { abortRaces } from './racing';
import { abortFights } from './fight1v1';
import type { Db } from './db';

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

/**
 * 20:00 關門：順序固定——
 * 1) 進行中的下樓梯標記 aborted（不發獎勵、不扣精力；同時把 match 標成 ended）
 * 2) 廣播 game.closed 並以 4423 關閉 WebSocket（之後的斷線處理看到 ended，不會再結算）
 * 3) 停止 LISTEN，避免 20:15 資料庫關機後一直重連
 */
export async function handleClosed(deps: { db: Db; hub: { closeAll(msg: unknown, code: number): void }; gate: { release(): Promise<void> } }, opensAt: number | null) {
  await abortAll(deps.db);
  await abortMStairs(); // M2 多人局：aborted，不發獎勵、不扣精力
  await abortArenas(); // v1.4：對戰取消，不轉帳
  await abortFights('GAME_CLOSED');
  abortRaces(); // 賽車：中止、不結算（不能等斷線變成「沒跑完」→ 錦標賽重來）
  deps.hub.closeAll({ type: 'game.closed', opens_at: opensAt }, 4423);
  await deps.gate.release();
}
