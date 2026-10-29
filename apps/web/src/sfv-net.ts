// @ts-nocheck
import { SFV, SFVServer } from '@chick/engine';

// 預測、回滾與原型共用的繪圖函式；繪圖另由 sfv-draw.ts 對外重匯出。
// 客戶端：自己與對手都不插值。每 tick 本地預測（對手沿用最後確認的輸入），收到伺服器確認的輸入跟預測不同 → 回到確認狀態用 while 迴圈重算到目前 tick。
// 送出：只在按鍵變化時送（Edge），最多每 2 tick 一則（≤ 30 則／秒，伺服器上限 35），輸入標成「目前 tick + 2」吸收抖動。
export const SFVClient = ((SFV, SFVServer) => {
  'use strict';
  const INPUT_DELAY = 2, BATCH_TICKS = 2, CLIENT_MAX_PER_SEC = 30, PING_MS = 500, MAX_STEPS = 8, OWN_KEEP = 60, MAX_EXTRA_LEAD = 6;
  const HIST_VIEW = 4 * SFV.TICK_HZ; // 輸入紀錄顯示最近 4 秒

  /** 模擬網路：單向延遲 = RTT/2 + 隨機抖動，維持順序（同一條 WebSocket 不會亂序）；量每則 bytes */
  class SimLink {
    constructor(net, rng) { this.net = net; this.rng = rng; this.q = []; this.last = 0; this.msgs = 0; this.bytes = 0; this.maxBytes = 0; }
    send(msg, now, deliver) {
      const json = JSON.stringify(msg), b = SFVServer.byteLen(json);
      this.msgs++; this.bytes += b; this.maxBytes = Math.max(this.maxBytes, b);
      const at = Math.max(this.last, now + this.net.rtt / 2 + this.rng() * this.net.jitter);
      this.last = at; this.q.push({ at, json, deliver });
    }
    pump(now) { while (this.q.length && this.q[0].at <= now) { const e = this.q.shift(); e.deliver(JSON.parse(e.json), now); } }
  }

  class NetClient {
    constructor({ pid, sample, send }) {
      this.pid = pid; this.i = pid - 1; this.sample = sample; this.send = send;
      this.confirmed = SFV.createState(); this.C = 0;           // 伺服器確認到第 C tick 的權威狀態
      this.predicted = SFV.cloneState(this.confirmed); this.L = 0; // 畫面上顯示的本地預測（第 L tick）
      this.own = new Map(); this.used = new Map(); this.lastConf = [0, 0];
      this.queue = []; this.lastQueued = 0; this.lastFlushL = -BATCH_TICKS; this.seq = 0; this.acked = 0; this.sendTimes = [];
      this.unacked = new Map(); this.lastResendAt = -Infinity;
      this.clock = []; this.rtts = []; this.lastPingAt = -Infinity;
      this.extraLead = 0; this.lateSeen = 0; this.calmAt = 0;
      this.started = false; this.mispredict = false; this.ended = null;
      this.histConf = []; // 最近 4 秒的確認輸入（顯示用）：[p1Mask, p2Mask]
      this.stats = { sent: 0, maxPerSec: 0, held: 0, rollbacks: 0, resim: 0, lastResim: 0, desync: 0, snapsOk: 0 };
    }
    get rtt() { return this.rtts.length ? this.rtts.reduce((a, b) => a + b, 0) / this.rtts.length : null; }
    oneWayMin() { return this.rtts.length ? Math.min(...this.rtts) / 2 : 0; }
    perSec(now) { while (this.sendTimes.length && now - this.sendTimes[0] >= 1000) this.sendTimes.shift(); return this.sendTimes.length; }
    /** 伺服器時間估計：取延遲最小的樣本（tick 時間 − 收到時間 的最大值），再加回最小單向延遲 */
    timeSample(tick, now) { this.clock.push([now, tick * SFV.TICK_MS - now]); while (now - this.clock[0][0] > 4000) this.clock.shift(); }
    serverTick(now) { let best = -Infinity; for (const [, v] of this.clock) if (v > best) best = v; return (now + best + this.oneWayMin()) / SFV.TICK_MS; }
    /** 本地要跑在伺服器前面「單向延遲」那麼多 tick，加上 2 tick 輸入延遲，送出的輸入才會準時到 */
    lead() { return Math.ceil(this.oneWayMin() / SFV.TICK_MS) + 1 + this.extraLead; }
    target(now) { return Math.floor(this.serverTick(now)) + this.lead(); }

    onMessage(msg, now) {
      switch (msg.type) {
        case 'sfv.ticks': {
          this.onAck(msg.ack?.[this.i]);
          const n = msg.m.length >> 1;
          this.timeSample(msg.from + n - 1, now);
          for (let k = 0; k < n; k++) this.confirm(msg.from + k, msg.m[2 * k], msg.m[2 * k + 1]);
          break;
        }
        case 'sfv.snap': this.timeSample(msg.tick, now); this.onSnap(msg, now); break;
        case 'pong': this.rtts.push(now - msg.c); if (this.rtts.length > 8) this.rtts.shift(); this.timeSample(msg.tick, now); break;
        case 'sfv.ended': this.ended = msg; this.predicted = SFV.cloneState(this.confirmed); this.L = this.C; break;
        default: break;
      }
    }
    confirm(T, m1, m2) {
      if (T !== this.C + 1) return; // 重複或跳號：交給下一個快照校正
      const u = this.used.get(T);
      if (u && (u[0] !== m1 || u[1] !== m2)) this.mispredict = true;
      this.used.delete(T);
      SFV.simulateSFVTick(this.confirmed, m1, m2);
      this.C = T; this.lastConf = [m1, m2];
      this.histConf.push([m1, m2]); if (this.histConf.length > HIST_VIEW) this.histConf.shift();
      for (const k of this.own.keys()) { if (k < T - OWN_KEEP) this.own.delete(k); else break; }
    }
    onAck(seq) {
      if (!Number.isInteger(seq) || seq <= this.acked) return;
      this.acked = seq;
      for (const seq of this.unacked.keys()) if (seq <= this.acked) this.unacked.delete(seq);
    }
    onSnap(msg, now) {
      this.onAck(msg.ack[this.i]);
      const late = msg.late[this.i];
      if (late > this.lateSeen) { this.extraLead = Math.min(MAX_EXTRA_LEAD, this.extraLead + 1); this.calmAt = now; }
      this.lateSeen = late;
      if (msg.tick === this.C) {
        if (SFV.hashState(this.confirmed) === msg.h) { this.stats.snapsOk++; return; }
        this.stats.desync++;
      } else if (msg.tick < this.C) return;
      // 權威快照覆寫，然後重算回目前 tick
      this.confirmed = SFV.unpackState(msg.s); this.C = msg.tick;
      this.lastConf = [SFV.maskAt(this.confirmed.p[0], msg.tick), SFV.maskAt(this.confirmed.p[1], msg.tick)];
      this.mispredict = true;
    }
    ownAt(t) { for (let k = t; k > t - OWN_KEEP; k--) { const v = this.own.get(k); if (v !== undefined) return v; } return 0; }
    pairFor(t) { const pair = [0, 0]; pair[this.i] = this.ownAt(t); pair[1 - this.i] = this.lastConf[1 - this.i]; return pair; }
    rollback() {
      const from = this.C;
      this.predicted = SFV.cloneState(this.confirmed);
      let t = from;
      while (t < this.L) { t++; const pair = this.pairFor(t); this.used.set(t, pair); SFV.simulateSFVTick(this.predicted, pair[0], pair[1]); }
      this.mispredict = false; this.stats.rollbacks++; this.stats.lastResim = this.L - from; this.stats.resim += this.L - from;
    }
    flush(now, t) {
      if (!this.queue.length || t - this.lastFlushL < BATCH_TICKS) return;
      if (this.perSec(now) >= CLIENT_MAX_PER_SEC) { this.stats.held++; return; } // 本地先擋，絕不撞到伺服器的 35
      // NOTIFY 可能遺失：新封包重帶尚未 ACK 的 edge，遺失舊封包時下一包仍能補齊。
      const inputs = [...this.unacked.values()].flatMap((m) => m.inputs).concat(this.queue).slice(-32);
      const msg = { type: 'sfv.input', seq: ++this.seq, inputs };
      this.unacked.set(msg.seq, msg); this.send(msg, now);
      this.queue = []; this.lastFlushL = t; this.sendTimes.push(now); this.stats.sent++;
      this.stats.maxPerSec = Math.max(this.stats.maxPerSec, this.sendTimes.length);
    }
    step(now) {
      const t = this.L + 1, mask = this.sample(this.predicted, this.pid) & 255, at = t + INPUT_DELAY;
      this.own.set(at, mask);
      if (mask !== this.lastQueued) { this.queue.push({ tick: at, mask }); this.lastQueued = mask; }
      this.flush(now, t);
      const pair = this.pairFor(t);
      this.used.set(t, pair);
      SFV.simulateSFVTick(this.predicted, pair[0], pair[1]);
      this.L = t;
    }
    frame(now) {
      if (this.ended || !this.clock.length) return;
      if (!this.started) { this.started = true; this.L = this.C; this.predicted = SFV.cloneState(this.confirmed); }
      if (now - this.lastPingAt >= PING_MS) { this.lastPingAt = now; this.send({ type: 'ping', c: now }, now); }
      if (this.unacked.size && now - this.lastResendAt >= 250 && this.perSec(now) < CLIENT_MAX_PER_SEC) {
        const msg = this.unacked.values().next().value;
        this.send(msg, now); this.lastResendAt = now; this.sendTimes.push(now); this.stats.sent++;
      }
      if (this.extraLead > 0 && now - this.calmAt > 5000) { this.extraLead--; this.calmAt = now; }
      if (this.C >= this.L) { this.predicted = SFV.cloneState(this.confirmed); this.L = this.C; this.mispredict = false; }
      else if (this.mispredict) this.rollback();
      const target = this.target(now);
      for (let n = 0; this.L < target && n < MAX_STEPS; n++) this.step(now);
    }
  }

  /** 觀戰只套用伺服器確認過的 tick；缺號時等下一個快照，不做預測。 */
  class SpectatorClient {
    constructor() { this.state = SFV.createState(); this.tick = 0; this.ended = null; }
    onMessage(msg) {
      if (msg.type === 'sfv.ticks') {
        const n = msg.m.length >> 1;
        for (let k = 0; k < n; k++) {
          const t = msg.from + k; if (t !== this.tick + 1) continue;
          SFV.simulateSFVTick(this.state, msg.m[k * 2], msg.m[k * 2 + 1]); this.tick = t;
        }
      } else if (msg.type === 'sfv.snap' && msg.tick >= this.tick) {
        this.state = SFV.unpackState(msg.s); this.tick = msg.tick;
      } else if (msg.type === 'sfv.ended') this.ended = msg;
    }
  }

  /** 一場：伺服器房間＋兩個客戶端（P1 鍵盤、P2 電腦／木樁），中間是模擬網路 */
  function createWorld(o) {
    const net = o.net ?? { rtt: 100, jitter: 10 }, rng = o.rng ?? Math.random;
    let now = o.now;
    const clients = [];
    const up = [0, 1].map(() => new SimLink(net, rng)), down = [0, 1].map(() => new SimLink(net, rng));
    const room = new SFVServer.SFVRoom({
      matchId: o.matchId, now, closesAt: o.closesAt ?? Infinity, onTick: o.onTick, users: o.users,
      send: (pid, msg) => down[pid - 1].send(msg, now, (m, at) => clients[pid - 1].onMessage(m, at)),
    });
    for (const pid of [1, 2]) {
      clients.push(new NetClient({ pid, sample: o.samplers[pid - 1], send: (msg, at) => up[pid - 1].send(msg, at, (m, t) => room.receive(pid, m, t)) }));
    }
    return {
      net, room, clients, up, down,
      pump(t) { now = t; for (const l of up) l.pump(t); room.update(t); for (const l of down) l.pump(t); for (const c of clients) c.frame(t); },
    };
  }

  /** 對手：AI 或木樁。AI 看的是自己那台客戶端的預測畫面（跟真人一樣有延遲） */
  function createBot(rnd = Math.random) {
    const { UP, DOWN, LEFT, RIGHT, LP, HP, LK, HK, ST, MOVE_LIST } = SFV;
    const q = [];
    const dm = (d, f) => {
      let m = 0; if (d >= 7) m |= UP; if (d <= 3) m |= DOWN;
      const c = d % 3; if (c === 0) m |= f === 1 ? RIGHT : LEFT; else if (c === 1) m |= f === 1 ? LEFT : RIGHT;
      return m;
    };
    const seq = (f, steps) => { for (const [d, b, n = 2] of steps) for (let k = 0; k < n; k++) q.push(dm(d, f) | b); q.push(0); };
    const hold = (m, n) => { for (let k = 0; k < n; k++) q.push(m); };
    function ai(s, pid) {
      const me = s.p[pid - 1], op = s.p[2 - pid], f = me.f;
      if (q.length) return q.shift();
      if (s.rs !== SFV.RS.FIGHT) return 0;
      if (me.st === ST.HIT || me.st === ST.BLOCK || me.st === ST.KD || me.st === ST.AIRHIT) return dm(1, f);
      if (me.st !== ST.IDLE && me.st !== ST.CROUCH) return 0;
      const dist = Math.abs(op.x - me.x), r = rnd(), toward = Math.sign(me.x - op.x);
      const opMove = op.st === ST.MOVE ? MOVE_LIST[op.mv] : null;
      const incoming = s.pr.find((p) => p.o !== pid - 1 && Math.sign(me.x - p.x) === Math.sign(p.vx) && Math.abs(me.x - p.x) < 260);
      if (op.y < -30 && dist < 170 && Math.sign(op.vx) === toward && r < 0.5) seq(f, [[6, 0], [2, 0], [3, HP]]);
      else if (opMove && dist < 150 && r < 0.75) hold(dm(opMove.guard === 'overhead' ? 4 : 1, f), 12);
      else if (incoming) { if (r < 0.3 && dist < 320) { seq(f, [[9, 0, 1]]); hold(0, 14); hold(HK, 2); } else hold(dm(1, f), 10); }
      else if (me.ex >= SFV.EX_MAX && dist < 200 && r < 0.05) seq(f, [[2, 0], [3, 0], [6, 0], [2, 0], [3, 0], [6, HK]]);
      else if (me.vg >= SFV.VG_MAX && r < 0.02) seq(f, [[5, HP | HK]]);
      else if (dist > 280) { if (!s.pr.some((p) => p.o === pid - 1) && r < 0.04) seq(f, [[2, 0], [3, 0], [6, r < 0.02 ? HP : LP]]); else hold(dm(6, f), 8); }
      else if (dist < 90) {
        if (r < 0.05) seq(f, [[5, LP | LK]]);
        else if (r < 0.1) seq(f, [[2, LK], [2, 0, 3], [2, LK], [2, 0], [3, 0], [6, HP]]);
        else if (r < 0.13) seq(f, [[3, HK]]);
        else if (r < 0.16) seq(f, [[5, HP], [5, 0, 8], [6, 0], [2, 0], [3, HP]]);
        else if (r < 0.2) seq(f, [[2, 0], [1, 0], [4, LK]]);
        else if (r < 0.23) seq(f, [[4, 0, 1], [5, 0, 1], [4, 0, 2]]); // 後退步
        else hold(dm(r < 0.6 ? 1 : 4, f), 10);
      } else if (r < 0.03) seq(f, [[2, 0], [3, 0], [6, LP]]);
      else if (r < 0.05) { seq(f, [[9, 0, 1]]); hold(0, 12); hold(r < 0.04 ? HK : HP, 2); }
      else hold(dm(6, f), 6);
      return q.shift();
    }
    const modes = { ai, dummy: () => 0, crouch: (s, pid) => dm(1, s.p[pid - 1].f), stand: (s, pid) => dm(4, s.p[pid - 1].f) };
    return (mode) => (s, pid) => { if (mode !== 'ai') q.length = 0; return (modes[mode] ?? ai)(s, pid); };
  }
  // ---------- Canvas 渲染（純幾何：Pushbox 藍、Hurtbox 綠、Hitbox 紅） ----------
  const W = 960, H = 540, GROUND = 470;
  const COL = { push: '#3da5ff', hurt: '#2ee66b', hit: '#ff3b3b', body: ['#ffd84d', '#f4f1ea'], proj: ['#6ad8ff', '#ff9a4d'], ex: '#4db8ff', vg: '#ff4d6d', stun: '#b36bff', white: '#f2f2f2' };
  const STATE_TEXT = { HIT: '受擊', BLOCK: '防禦', AIRHIT: '浮空', KD: '倒地', THROWN: '被摔', THROWING: '摔', DIZZY: '暈眩', TECH: '解摔', KO: 'K.O.' };
  const sy = (y) => GROUND + y;
  function rect(ctx, b, fill, stroke, dash) {
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(b[0], sy(b[1]), b[2], b[3]); }
    if (stroke) { ctx.setLineDash(dash ? [5, 4] : []); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.strokeRect(b[0] + 1, sy(b[1]) + 1, b[2] - 2, b[3] - 2); ctx.setLineDash([]); }
  }
  function text(ctx, str, x, y, size, color, align = 'center', stroke = true) {
    ctx.font = `800 ${size}px system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (stroke) { ctx.lineWidth = Math.max(3, size / 8); ctx.strokeStyle = '#000'; ctx.strokeText(str, x, y); }
    ctx.fillStyle = color; ctx.fillText(str, x, y);
  }
  function drawStage(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1b1f2e'); g.addColorStop(1, '#0b0c12');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#1f2433'; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 64) { ctx.beginPath(); ctx.moveTo(x, 90); ctx.lineTo(x, GROUND); ctx.stroke(); }
    ctx.fillStyle = '#262b3d'; ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = '#3a4160'; ctx.fillRect(0, GROUND, W, 3);
    ctx.fillStyle = '#ff3b3b55'; ctx.fillRect(0, 90, SFV.WALL, GROUND - 90); ctx.fillRect(W - SFV.WALL, 90, SFV.WALL, GROUND - 90);
  }
  // 人型成年雞：頭（雞冠、嘴、頭巾）＋身體＋兩手兩腳；出招時手／腳伸到攻擊判定的位置
  const SKIN = [{ body: '#ffd84d', wing: '#d9a91a', belly: '#fff3b0' }, { body: '#f4f1ea', wing: '#bdb5a3', belly: '#ffffff' }];
  const LEG = '#ff8c1a', LEG_BACK = '#c96f12', COMB = '#e8453c';
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  /** 兩段肢體的關節：在起點與終點中間，往垂直方向彎 bend px */
  function joint(a, b, bend) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return [(a[0] + b[0]) / 2 - (dy / L) * bend, (a[1] + b[1]) / 2 + (dx / L) * bend];
  }
  const NEUTRAL = { lying: false, lean: 0, hip: -42, sh: -70, head: -87, ff: [12, 0], bf: [-12, 0], fh: [22, -68], bh: [12, -60] };
  /** 這一 tick 的姿勢（座標相對腳底、往前為正） */
  function figurePose(s, i) {
    const p = s.p[i], ST = SFV.ST, st = p.st, mv = st === ST.MOVE ? SFV.MOVE_LIST[p.mv] : null;
    const crouch = st === ST.CROUCH || (mv && mv.posture === 'crouch') || ((st === ST.HIT || st === ST.BLOCK) && p.cr === 1);
    const P = { ...NEUTRAL, lying: ((st === ST.KD || st === ST.KO) && p.y === 0) || (st === ST.THROWN && p.y < -50) }; // 舉過頭時橫躺在對方頭上
    if (crouch) { P.hip = -26; P.sh = -52; P.head = -69; }
    if (p.y < 0) { P.ff = [14, -16]; P.bf = [-6, -12]; }
    else if (crouch) { P.ff = [16, 0]; P.bf = [-16, 0]; }
    else { const w = st === ST.IDLE && p.vx !== 0 ? ((s.tick >> 3) & 1 ? 7 : -7) : 0; P.ff = [12 + w, 0]; P.bf = [-12 - w, 0]; }
    P.fh = [22, P.sh + 2]; P.bh = [12, P.sh + 10];
    if (st === ST.BLOCK) { P.fh = [16, P.sh - 6]; P.bh = [14, P.sh + 6]; P.lean = -3; }
    else if (st === ST.HIT || st === ST.AIRHIT || st === ST.THROWN) { P.lean = -7; P.fh = [-2, P.sh - 14]; P.bh = [-14, P.sh - 8]; }
    else if (st === ST.DIZZY) { P.lean = (s.tick >> 4) & 1 ? 4 : -4; P.fh = [10, P.sh + 24]; P.bh = [-8, P.sh + 24]; }
    else if (st === ST.TECH) { P.fh = [34, P.sh + 6]; P.bh = [30, P.sh + 12]; }
    else if (st === ST.THROWING) { // 抓住 → 雙手跟著對方舉過頭
      const o = s.p[1 - i], hold = [(o.x - p.x) * p.f, Math.min(P.sh + 4, o.y - 12)];
      P.fh = [hold[0] + 6, hold[1]]; P.bh = [hold[0] - 6, hold[1] + 4]; P.lean = o.y < -60 ? -4 : 4;
    }
    if (mv) {
      const mt = p.mt, A = mv.A || 1, tail = Math.min(mv.R || 10, 10);
      const ext = mt < mv.S ? mt / mv.S : mt < mv.S + A ? 1 : Math.max(0, 1 - (mt - mv.S - A) / tail);
      const box = mv.hitbox ?? mv.throwBox;
      let reach = mv.reach ?? (box ? [box[0] + box[2], box[1] + box[3] / 2] : [40, P.sh + 4]);
      if (mv.limb === 'spin') reach = [((mt >> 2) & 1 ? -1 : 1) * 56, P.hip + 2]; // 旋風翅：腳左右甩
      if (mv.limb === 'kicks') reach = [62, mv.hitIndex(mt) & 1 ? -78 : -46];      // 火雞連環踢：高低交替
      if (mv.limb === 'arm') { P.fh = lerp2(P.fh, reach, ext); if (mv.both) P.bh = lerp2(P.bh, [reach[0] - 6, reach[1] + 6], ext); }
      else if (mv.limb) P.ff = lerp2(P.ff, reach, ext);
      if (mv.id === 'VT') P.lean = 8;
    }
    return P;
  }
  function drawFigure(ctx, ox, oy, f, P, sk) {
    const pt = ([x, y]) => [ox + x * f, oy + y];
    const line = (pts, color, w) => {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); pts.map(pt).forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    };
    const leg = (hip, foot, color) => { line([hip, joint(hip, foot, -7), foot], color, 7); line([foot, [foot[0] + 9, foot[1]]], color, 4); line([foot, [foot[0] + 6, foot[1] - 4]], color, 3); };
    const arm = (sh, fist, color) => {
      line([sh, joint(sh, fist, 6), fist], color, 8);
      const [x, y] = pt(fist); ctx.fillStyle = sk.body; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    };
    const hipF = [4 + P.lean * 0.3, P.hip], hipB = [-4 + P.lean * 0.3, P.hip], shF = [8 + P.lean, P.sh + 2], shB = [-6 + P.lean, P.sh + 2];
    leg(hipB, P.bf, LEG_BACK);
    arm(shB, P.bh, sk.wing);
    // 身體＋肚子＋腰帶
    const [tx] = pt([P.lean, 0]), top = oy + P.sh - 8, h = P.hip + 6 - (P.sh - 8);
    ctx.fillStyle = sk.body; ctx.beginPath(); ctx.roundRect(tx - 16, top, 32, h, 12); ctx.fill();
    ctx.fillStyle = sk.belly; ctx.beginPath(); ctx.ellipse(tx + 5 * f, top + h * 0.55, 9, h * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillRect(tx - 16, oy + P.hip - 4, 32, 4);
    // 頭：雞冠、頭巾、眼睛、嘴、肉垂
    const [hx, hy] = pt([2 + P.lean, P.head]);
    ctx.fillStyle = COMB; for (const k of [-5, 0, 5]) { ctx.beginPath(); ctx.arc(hx + k * f, hy - 12 - (k === 0 ? 2 : 0), 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = sk.body; ctx.beginPath(); ctx.arc(hx, hy, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d62828'; ctx.fillRect(hx - 12, hy - 6, 24, 4);
    line([[2 + P.lean - 11, P.head - 4], [2 + P.lean - 22, P.head + 2]], '#d62828', 3);
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(hx + 5 * f, hy, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff8c1a'; ctx.beginPath(); ctx.moveTo(hx + 10 * f, hy + 1); ctx.lineTo(hx + 23 * f, hy + 5); ctx.lineTo(hx + 10 * f, hy + 8); ctx.fill();
    ctx.fillStyle = COMB; ctx.beginPath(); ctx.arc(hx + 9 * f, hy + 11, 3, 0, Math.PI * 2); ctx.fill();
    leg(hipF, P.ff, LEG);
    arm(shF, P.fh, sk.wing);
  }
  function drawLying(ctx, ox, oy, f, sk) {
    ctx.fillStyle = sk.body; ctx.beginPath(); ctx.roundRect(ox - 26, oy - 20, 52, 18, 8); ctx.fill();
    ctx.beginPath(); ctx.arc(ox - 34 * f, oy - 12, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COMB; ctx.beginPath(); ctx.arc(ox - 44 * f, oy - 14, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = LEG; ctx.lineWidth = 6; ctx.lineCap = 'round';
    for (const d of [-6, 2]) { ctx.beginPath(); ctx.moveTo(ox + 22 * f, oy - 10 + d); ctx.lineTo(ox + 44 * f, oy - 16 + d); ctx.stroke(); }
  }
  function drawChick(ctx, s, i, opt) {
    const p = s.p[i], tick = s.tick, sk = SKIN[i];
    const shaking = p.hs > 0 && (p.st === SFV.ST.HIT || p.st === SFV.ST.BLOCK || p.st === SFV.ST.AIRHIT);
    const ox = p.x + (shaking ? (tick & 1 ? 3 : -3) : 0), oy = sy(p.y);
    const P = figurePose(s, i);
    if (p.vt > 0) { // 炸毛：全身紅火
      for (let k = 0; k < 7; k++) {
        const fx = ox - 30 + k * 10, fh = 20 + ((tick * 7 + k * 13) % 16);
        ctx.fillStyle = k % 2 ? '#ff3b3bcc' : '#ffa53bcc';
        ctx.beginPath(); ctx.moveTo(fx - 8, oy + P.hip); ctx.lineTo(fx, oy + P.head - fh); ctx.lineTo(fx + 8, oy + P.hip); ctx.fill();
      }
    }
    if (P.lying) drawLying(ctx, ox, oy, p.f, sk); else drawFigure(ctx, ox, oy, p.f, P, sk);
    const mv = p.st === SFV.ST.MOVE ? SFV.MOVE_LIST[p.mv] : null;
    if (mv && mv.projectile !== undefined && p.mt <= mv.S + 4) drawCharge(ctx, s, i, P, ox, oy, mv);
    const top = oy + (P.lying ? -30 : P.head - 18);
    if (p.st === SFV.ST.DIZZY) {
      for (let k = 0; k < 3; k++) { const a = tick * 0.12 + k * 2.09; ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * 22, top - 4 + Math.sin(a) * 6, 4, 0, Math.PI * 2); ctx.fill(); }
    }
    const label = p.st === SFV.ST.MOVE ? SFV.MOVE_LIST[p.mv].name : STATE_TEXT[SFV.ST_NAME[p.st]];
    if (label) text(ctx, label, p.x, top - 14, 13, '#fff');
    if (i === opt.me) text(ctx, '▼', p.x, top - 32, 12, sk.body, 'center', false);
    if (opt.showBoxes) {
      rect(ctx, SFV.pushbox(p), null, COL.push);
      for (const hb of SFV.hurtboxes(p)) rect(ctx, hb, '#2ee66b22', COL.hurt);
      const hit = SFV.hitboxOf(p);
      if (hit) rect(ctx, hit.box, hit.used ? '#ff3b3b22' : '#ff3b3b88', COL.hit, hit.thr);
    }
  }
  function drawCharge(ctx, s, i, P, ox, oy, mv) {
    const p = s.p[i], f = p.f, col = COL.proj[i], ex = mv.projectile === 2;
    const hx = ox + ((P.fh[0] + P.bh[0]) / 2) * f, hy = oy + (P.fh[1] + P.bh[1]) / 2;
    if (p.mt < mv.S) {
      const u = p.mt / mv.S, n = ex ? 18 : 12;
      for (let k = 0; k < n; k++) {
        const a = (k * Math.PI * 2) / n + s.tick * 0.12 * (k % 2 ? 1 : -1), r = 58 + (k % 3) * 8;
        const sx = ox + Math.cos(a) * r, syy = oy - 50 + Math.sin(a) * r * 0.9;
        const x = sx + (hx - sx) * u, y = syy + (hy - syy) * u;
        ctx.globalAlpha = 0.35 + 0.65 * u; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 2 + 3 * u, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      glow(ctx, hx, hy, 4 + (ex ? 16 : 12) * u, col);
    } else { // 射出瞬間的爆光
      const k = p.mt - mv.S;
      ctx.globalAlpha = Math.max(0, 1 - k / 5); ctx.strokeStyle = col; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(hx, hy, 16 + k * 9, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  function glow(ctx, x, y, r, col) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.8);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, col); g.addColorStop(1, col + '00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2); ctx.fill();
  }
  function drawProjectiles(ctx, s, opt) {
    for (const q of s.pr) {
      const b = SFV.projBox(q), col = COL.proj[q.o], cx = q.x, cy = sy(q.y), r = b[3] / 2;
      for (let k = 3; k >= 1; k--) { ctx.globalAlpha = 0.18 * (4 - k); glow(ctx, cx - q.vx * k * 2.2, cy, r * (1 - k * 0.15), col); } // 尾巴
      ctx.globalAlpha = 1; glow(ctx, cx, cy, r, col);
      ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 2; // 旋轉的光圈
      const a = s.tick * 0.4;
      ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.9, r * 0.5, a, 0, Math.PI * 1.3); ctx.stroke();
      if (opt.showBoxes) rect(ctx, b, null, COL.hit);
    }
  }
  function bar(ctx, x, y, w, h, frac, color, rightAnchored) {
    const fw = Math.max(0, Math.min(1, frac)) * w;
    ctx.fillStyle = color; ctx.fillRect(rightAnchored ? x + w - fw : x, y, fw, h);
  }
  function drawHud(ctx, s, opt) {
    const BW = 380, BX = [40, W - 40 - BW];
    for (let i = 0; i < 2; i++) {
      const p = s.p[i], x = BX[i], right = i === 1;
      ctx.fillStyle = '#000a'; ctx.fillRect(x - 3, 15, BW + 6, 30);
      ctx.fillStyle = '#3a1111'; ctx.fillRect(x, 18, BW, 20);
      bar(ctx, x, 18, BW, 20, (p.hp + p.wd) / SFV.HP_MAX, COL.white, right); // 白殘血（可回復）
      bar(ctx, x, 18, BW, 20, p.hp / SFV.HP_MAX, p.hp < 300 ? '#ff5c5c' : '#ffd84d', right);
      ctx.fillStyle = '#1a1030'; ctx.fillRect(x, 40, BW, 6);
      bar(ctx, x, 40, BW, 6, p.sg / SFV.STUN_MAX, p.dz || p.st === SFV.ST.DIZZY ? '#ff3bd4' : COL.stun, right);
      text(ctx, opt.names[i], right ? x + BW : x, 60, 14, COL.body[i], right ? 'right' : 'left');
      for (let k = 0; k < s.w[i]; k++) { ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(right ? x + 10 + k * 18 : x + BW - 10 - k * 18, 60, 6, 0, Math.PI * 2); ctx.fill(); }
      // 下方：3 格 EX、炸毛條
      for (let k = 0; k < 3; k++) {
        const ex = x + (right ? BW - (k + 1) * 64 : k * 64), fill = Math.max(0, Math.min(1, (p.ex - k * SFV.EX_BAR) / SFV.EX_BAR));
        ctx.fillStyle = '#0d1b2a'; ctx.fillRect(ex, H - 34, 60, 12);
        bar(ctx, ex, H - 34, 60, 12, fill, fill >= 1 ? COL.ex : '#2b5d85', right);
      }
      const vx = right ? x : x + BW - 170;
      ctx.fillStyle = '#2a0d14'; ctx.fillRect(vx, H - 34, 170, 12);
      if (p.vt > 0) { bar(ctx, vx, H - 34, 170, 12, p.vt / SFV.VT_TICKS, (s.tick >> 2) & 1 ? '#ff7a3b' : COL.vg, right); text(ctx, '炸毛中', vx + 85, H - 46, 12, '#ffb03b'); }
      else { bar(ctx, vx, H - 34, 170, 12, p.vg / SFV.VG_MAX, p.vg >= SFV.VG_MAX ? COL.vg : '#80303f', right); text(ctx, '炸毛', vx + 85, H - 46, 11, '#c88'); }
      text(ctx, `EX ${Math.floor(p.ex / SFV.EX_BAR)}`, right ? x + BW : x, H - 46, 11, COL.ex, right ? 'right' : 'left');
      const foe = s.p[1 - i];
      if (foe.cb >= 2) text(ctx, `${foe.cb} HITS`, right ? W - 70 : 70, 150, 28, '#ffe066');
    }
    ctx.fillStyle = '#000c'; ctx.fillRect(W / 2 - 34, 12, 68, 44);
    text(ctx, String(Math.ceil(s.tm / SFV.TICK_HZ)).padStart(2, '0'), W / 2, 35, 30, '#fff');
  }
  function drawBanner(ctx, s, opt) {
    const big = (str, color = '#ffe066') => text(ctx, str, W / 2, H / 2 - 30, 72, color);
    if (opt.ended?.aborted) { ctx.fillStyle = '#000b'; ctx.fillRect(0, 0, W, H); big('比賽中止', '#ff5c5c'); text(ctx, '20:00 關門（aborted，不結算）', W / 2, H / 2 + 30, 20, '#fff'); return; }
    if (s.rs === SFV.RS.INTRO) big(s.rt > 45 ? `ROUND ${s.rnd}` : 'FIGHT!');
    else if (s.rs === SFV.RS.KO) big(s.to ? 'TIME' : s.lw === 2 ? 'DOUBLE K.O.' : 'K.O.', '#ff5c5c');
    else if (s.rs === SFV.RS.OVER) {
      ctx.fillStyle = '#0009'; ctx.fillRect(0, 0, W, H);
      big(s.win === 2 ? 'DRAW' : s.win === opt.me ? 'YOU WIN' : 'YOU LOSE', s.win === opt.me ? '#ffe066' : '#9aa');
      if (opt.settleText) text(ctx, opt.settleText, W / 2, H / 2 + 30, 18, '#fff');
      text(ctx, 'Enter 再來一場　Esc 回選角', W / 2, H / 2 + 62, 16, '#ccc');
    }
  }
  function drawFight(ctx, s, opt) {
    drawStage(ctx);
    const freezeOwner = s.frz > 0 ? s.fo - 1 : -1;
    drawProjectiles(ctx, s, opt);
    for (let i = 0; i < 2; i++) if (i !== freezeOwner) drawChick(ctx, s, i, opt);
    if (freezeOwner >= 0) { // 超必殺暗場特寫
      ctx.fillStyle = '#000000d8'; ctx.fillRect(0, 0, W, H);
      const p = s.p[freezeOwner];
      ctx.strokeStyle = (s.tick >> 1) & 1 ? '#ffe066' : '#ff3b3b'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(p.x, sy(-50), 40 + (30 - s.frz) * 6, 0, Math.PI * 2); ctx.stroke();
      drawChick(ctx, s, freezeOwner, opt);
      text(ctx, '火雞連環踢!!', W / 2, 200, 56, (s.tick >> 2) & 1 ? '#ffe066' : '#ff7a3b');
    }
    drawHud(ctx, s, opt);
    drawBanner(ctx, s, opt);
  }
  const ME = 'MY_CHICK_BABY';
  /** 選角：只有第一格是正常角色，其他七格是「？」；不管選哪格，鎖定後都是自己的電子雞 */
  function drawSelect(ctx, sel, frame) {
    drawStage(ctx);
    ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, W, H);
    text(ctx, 'SELECT YOUR FIGHTER', W / 2, 70, 40, '#ffe066');
    const locked = sel.lockedAt >= 0, reveal = locked && frame - sel.lockedAt > 20;
    for (let k = 0; k < 8; k++) {
      const cx = 150 + (k % 4) * 220, cy = 190 + Math.floor(k / 4) * 170, on = k === sel.cursor, known = k === 0 || reveal;
      ctx.fillStyle = on ? '#3a3410' : '#1a1d29'; ctx.fillRect(cx - 95, cy - 65, 190, 130);
      ctx.strokeStyle = on ? ((frame >> 3) & 1 ? '#ffe066' : '#ff9f43') : '#33384a'; ctx.lineWidth = on ? 4 : 2; ctx.strokeRect(cx - 95, cy - 65, 190, 130);
      if (known) {
        ctx.save(); ctx.translate(cx - 30, cy + 24); ctx.scale(0.85, 0.85); drawFigure(ctx, 0, 0, 1, NEUTRAL, SKIN[0]); ctx.restore();
        text(ctx, ME, cx + 28, cy + 44, 13, '#fff');
      } else {
        text(ctx, '？', cx, cy - 6, 64, '#5a6178', 'center', false);
        text(ctx, '？？？', cx, cy + 44, 15, '#5a6178', 'center', false);
      }
    }
    if (locked) text(ctx, ME, W / 2, H - 60, reveal ? 44 : 30, (frame >> 2) & 1 ? '#ffe066' : '#ff7a3b');
    else text(ctx, 'W A S D 移動　U 確定', W / 2, H - 60, 20, '#ccc');
  }
  const ARROW = { 1: '↙', 2: '↓', 3: '↘', 4: '←', 5: '・', 6: '→', 7: '↖', 8: '↑', 9: '↗' };
  /** 輸入紀錄：連續相同的 tick 合成一列（最新在上），方向用螢幕方向（不分面向） */
  function inputRuns(hist, i) {
    const runs = [];
    for (const pair of hist) {
      const m = pair[i], last = runs[runs.length - 1];
      if (last && last.m === m) last.n++; else runs.push({ m, n: 1 });
    }
    return runs.reverse().map(({ m, n }) => {
      const btn = [[SFV.LP, 'LP'], [SFV.HP, 'HP'], [SFV.LK, 'LK'], [SFV.HK, 'HK']].filter(([b]) => m & b).map(([, l]) => l).join('+');
      return { dir: ARROW[SFV.dirOf(m, 1)], btn, n };
    });
  }
  return { SimLink, NetClient, SpectatorClient, createWorld, createBot, drawFight, drawSelect, inputRuns, INPUT_DELAY, BATCH_TICKS, CLIENT_MAX_PER_SEC };
})(SFV, SFVServer);

export const { NetClient, SpectatorClient, SimLink, createWorld, createBot } = SFVClient;
