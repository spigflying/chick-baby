// @ts-nocheck
import { SFV } from './sfv';

// 不碰 I/O 的權威房間：輸入佇列、tick 批次、快照與大小檢查。

// === [MODULE 2: apps/server/sfv-room.ts (Simulated)] ===
// 伺服器權威：60 Hz 跑同一支引擎。沒收到某 tick 的輸入就沿用上一個（Input Repeat）；
// 每 2 tick 廣播一次「這段每個 tick 雙方實際用的輸入」，每 30 tick 送一次小快照校正。
// 所有廣播都量 bytes：正式環境跨執行個體走 Postgres NOTIFY（apps/server/src/bus.ts），payload 上限 8000 bytes。
export const SFVServer = ((SFV) => {
  'use strict';
  const INPUT_LIMIT = 35, OTHER_LIMIT = 20, LIMIT_WINDOW_MS = 1000; // 同 apps/server/src/ws.ts 的 rateLimit
  const NOTIFY_MAX = 8000, STATE_MAX = 600;
  const BATCH_TICKS = 2, SNAP_EVERY = 30, MAX_AHEAD = 120, MAX_ENTRIES = 32, MAX_CATCHUP = 8;
  const enc = new TextEncoder();
  const byteLen = (str) => enc.encode(str).length;

  /** 滑動視窗限流（同 core.ts rateLimit）：超過就丟掉這則，不斷線 */
  class RateLimiter {
    constructor(max, windowMs = LIMIT_WINDOW_MS) { this.max = max; this.windowMs = windowMs; this.hits = []; }
    allow(now) {
      while (this.hits.length && now - this.hits[0] >= this.windowMs) this.hits.shift();
      if (this.hits.length >= this.max) return false;
      this.hits.push(now); return true;
    }
  }

  class SFVRoom {
    constructor({ matchId, now, send, closesAt = Infinity, users = ['p1', 'p2'], onTick = null }) {
      this.matchId = matchId; this.send = send; this.closesAt = closesAt; this.users = users; this.onTick = onTick;
      this.state = SFV.createState(); this.tick = 0; this.status = 'playing'; this.nextAt = now + SFV.TICK_MS;
      this.inbox = [new Map(), new Map()]; this.last = [0, 0]; this.seq = [0, 0]; this.edgeTick = [0, 0];
      this.limits = [0, 1].map(() => ({ input: new RateLimiter(INPUT_LIMIT), other: new RateLimiter(OTHER_LIMIT) }));
      this.pending = []; this.pendingFrom = 1;
      this.stats = { late: [0, 0], dropped: [0, 0], bad: [0, 0], msgs: 0, maxBytes: 0, oversize: 0, snapBytes: 0, maxSnapBytes: 0, snapMsgBytes: 0 };
    }
    receive(pid, msg, now) {
      const i = pid - 1, isInput = msg?.type === 'sfv.input';
      if (!this.limits[i][isInput ? 'input' : 'other'].allow(now)) { this.stats.dropped[i]++; return; }
      if (isInput) this.onInput(i, msg);
      else if (msg?.type === 'ping') this.send(pid, { type: 'pong', c: msg.c, tick: this.tick });
    }
    onInput(i, msg) {
      if (this.status !== 'playing') return;
      if (!Number.isInteger(msg.seq) || msg.seq <= this.seq[i]) return; // 重送只補遺失，不讓舊狀態蓋掉新狀態
      if (!Array.isArray(msg.inputs) || msg.inputs.length > MAX_ENTRIES) { this.stats.bad[i]++; return; }
      for (const e of msg.inputs) {
        if (!Number.isInteger(e?.tick) || !Number.isInteger(e?.mask) || e.mask < 0 || e.mask > 255) { this.stats.bad[i]++; continue; }
        let at = e.tick;
        if (at > this.tick + MAX_AHEAD) { this.stats.bad[i]++; continue; }
        if (at <= this.edgeTick[i]) continue; // 累積重送已收過的 edge，不重複套用也不誤算遲到
        this.edgeTick[i] = at;
        if (at <= this.tick) { this.stats.late[i]++; at = this.tick + 1; } // 遲到：這個 tick 已經跑過，順延到下一個
        this.inbox[i].set(at, e.mask);
      }
      this.seq[i] = msg.seq;
    }
    update(now) {
      if (this.status !== 'playing') return;
      if (now >= this.closesAt) { this.abort('GAME_CLOSED'); return; }
      for (let n = 0; now >= this.nextAt && n < MAX_CATCHUP && this.status === 'playing'; n++) { this.stepOnce(); this.nextAt += SFV.TICK_MS; }
      if (now - this.nextAt > 500) this.nextAt = now; // 執行個體卡住太久：不追，從現在接著跑
    }
    stepOnce() {
      const T = this.tick + 1;
      const m = [0, 1].map((i) => {
        const v = this.inbox[i].get(T);
        if (v !== undefined) { this.inbox[i].delete(T); this.last[i] = v; }
        return this.last[i]; // Server Input Repeat：沒有新輸入就沿用 T-1
      });
      SFV.simulateSFVTick(this.state, m[0], m[1]);
      this.tick = T;
      this.onTick?.(T, this.state);
      if (!this.pending.length) this.pendingFrom = T;
      this.pending.push(m[0], m[1]);
      if (T % BATCH_TICKS === 0) this.flush();
      if (T % SNAP_EVERY === 0) this.snapshot();
      if (this.state.rs === SFV.RS.OVER) this.finish();
    }
    flush() {
      if (!this.pending.length) return;
      this.broadcast({ type: 'sfv.ticks', from: this.pendingFrom, m: this.pending, ack: this.seq.slice() });
      this.pending = [];
    }
    snapshot() {
      const s = SFV.packState(this.state), sb = byteLen(s);
      this.stats.snapBytes = sb; this.stats.maxSnapBytes = Math.max(this.stats.maxSnapBytes, sb);
      this.stats.snapMsgBytes = this.broadcast({ type: 'sfv.snap', tick: this.tick, s, h: SFV.hashStr(s), ack: this.seq.slice(), late: this.stats.late.slice() });
    }
    broadcast(msg) {
      const b = byteLen(JSON.stringify(msg));
      this.stats.msgs++; this.stats.maxBytes = Math.max(this.stats.maxBytes, b);
      if (b >= NOTIFY_MAX) { this.stats.oversize++; return b; } // NOTIFY 會失敗：不送，記下來
      this.send(1, msg); this.send(2, msg);
      return b;
    }
    finish() {
      this.flush(); this.snapshot();
      this.status = 'done';
      this.outcome = { win: this.state.win, users: this.users };
      this.broadcast({ type: 'sfv.ended', aborted: false, win: this.state.win });
    }
    /** 20:00 關門／SIGTERM／負責的執行個體換人：中止，不結算 */
    abort(reason) {
      if (this.status !== 'playing') return;
      this.status = 'aborted';
      this.broadcast({ type: 'sfv.ended', aborted: true, reason });
    }
  }

  return { SFVRoom, RateLimiter, byteLen, INPUT_LIMIT, OTHER_LIMIT, NOTIFY_MAX, STATE_MAX, BATCH_TICKS, SNAP_EVERY };
})(SFV);
// === [END MODULE 2] ===

export const SFVRoom = SFVServer.SFVRoom;
