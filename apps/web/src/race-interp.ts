/**
 * 賽車畫面的時間軸：伺服器每 tick 50ms、每 2 tick 送一次快照。
 * 用「tick 號碼」而不是封包到達時間當時間軸（到達時間會抖），
 * base = 最近 N 個快照裡最早的 (到達時間 − tick×50)，也就是「延遲最少的那一包」。
 * 緩衝 delay 依晚到程度自動調整：平常 100ms，網路抖時最多 150ms，平滑地變化免得畫面跳。
 */
export const TICK_MS = 50;
export const DELAY_MIN = 100, DELAY_MAX = 150;

export class SnapClock {
  private offs: number[] = [];
  private late: number[] = [];
  base = 0;
  delay = DELAY_MIN;
  private target = DELAY_MIN;
  private lastT = 0;
  reset() { this.offs = []; this.late = []; this.delay = this.target = DELAY_MIN; this.lastT = 0; }
  /** 收到快照時呼叫 */
  onSnap(tick: number, at: number) {
    const off = at - tick * TICK_MS;
    this.offs.push(off); if (this.offs.length > 40) this.offs.shift();
    this.base = Math.min(...this.offs);
    this.late.push(off - this.base); if (this.late.length > 20) this.late.shift();
    const s = [...this.late].sort((a, b) => a - b); const p90 = s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
    // 快照 100ms 一包，基本延遲 100ms 剛好夾在兩包之間；晚到多少就多留多少（上限 150）
    this.target = Math.max(DELAY_MIN, Math.min(DELAY_MAX, DELAY_MIN + p90));
  }
  /** 目前該畫的 tick（小數），now = performance.now() */
  renderTick(now: number): number {
    const dt = this.lastT ? Math.min(100, now - this.lastT) : 0; this.lastT = now;
    // 每秒最多改 50ms，往上快、往下慢
    const rate = this.target > this.delay ? 0.05 : 0.02; const d = this.target - this.delay;
    this.delay += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    return (now - this.delay - this.base) / TICK_MS;
  }
}

/** 在依 tick 排序的快照中找出包住 t 的兩包與比例（超出範圍就夾住，不外插） */
export function bracket<S extends { tick: number }>(sn: S[], t: number): [S, S, number] {
  let a = sn[0], b = sn[sn.length - 1];
  if (t <= a.tick) return [a, a, 1];
  if (t >= b.tick) return [b, b, 1];
  for (let i = 0; i < sn.length - 1; i++) if (sn[i].tick <= t && sn[i + 1].tick >= t) { a = sn[i]; b = sn[i + 1]; break; }
  return [a, b, b.tick === a.tick ? 1 : (t - a.tick) / (b.tick - a.tick)];
}
