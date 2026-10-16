import { createStairs, stepStairs, setInput, cloneStairs, type StairsState } from '@chick/engine';
import { PAL, spr, sw, sh, num, speciesSprite } from './sprites';
import type { Live } from './ws';

interface Input { seq: number; tick: number; left: boolean; right: boolean }
/**
 * 單人下樓梯客戶端：伺服器權威。
 * - 時鐘同步（Live.offset）推算伺服器 tick；輸入標記 tick = 預測 tick + 1（本地跑在伺服器前 N tick）
 * - 本地用共用引擎預測；收到快照 → 重設為伺服器狀態，丟掉已確認輸入，重播其餘輸入
 * - 誤差 ≤ 8px 平滑修正，否則直接瞬移；伺服器回報 late 增加 → N 加大（2–6）
 */
/** 快關門時的剩餘秒數；離時間到超過 5 分鐘（或不是因關門而結束）就不顯示。 */
export function stairsTimeLeft(endsAt: number | null, now: number): number | null {
  if (endsAt === null) return null; const ms = endsAt - now;
  return ms > 5 * 60_000 ? null : Math.max(0, Math.ceil(ms / 1000));
}
export class StairsClient {
  state: StairsState; P: any; matchId: string; petId: string; startAt: number; tickMs: number;
  inputs: Input[] = []; seq = 0; N = 3; left = false; right = false;
  ended = false; lastLate = 0; corr = { x: 0, y: 0 }; frame = 0; result: any = null; endsAt: number | null = null;
  stats = { snapshots: 0, corrections: 0, snaps: 0 };

  constructor(private live: Live, m: any, private species: string, private cb: { ended: (r: any) => void }) {
    this.P = m.params; this.matchId = m.match_id; this.petId = m.players[0].pet_id; this.startAt = m.server_time_at_start; this.tickMs = 1000 / this.P.tickRate; this.endsAt = m.closing_end ? m.ends_at : null;
    this.N = this.P.inputBufferTicks;
    this.state = createStairs(m.seed, m.players.map((p: any) => ({ petId: p.pet_id, speed: p.speed, stamina: p.stamina })), this.P);
    live.inMatch = true;
    (window as any).__stairs = this; // 方便 E2E 測試觀察
  }
  estServerTick() { return Math.floor((this.live.serverNow() - this.startAt) / this.tickMs); }
  private applyInputsFor(next: number) {
    let last: Input | null = null;
    for (const i of this.inputs) if (i.tick <= next) last = i;
    if (last) setInput(this.state, this.petId, last.left, last.right);
  }
  private step() { this.applyInputsFor(this.state.tick + 1); stepStairs(this.state); }
  tick() {
    this.frame++;
    if (this.ended || this.state.over) return;
    const target = this.estServerTick() + this.N;
    let n = 0;
    while (this.state.tick < target && !this.state.over && n++ < 8) this.step();
    this.corr.x *= 0.7; this.corr.y *= 0.7;
  }
  setDir(d: 'left' | 'right', v: boolean) {
    if (this.ended || this[d] === v) return;
    this[d] = v;
    const tick = Math.max(this.state.tick + 1, this.estServerTick() + 1);
    const i = { seq: ++this.seq, tick, left: this.left, right: this.right };
    this.inputs.push(i);
    this.live.send({ type: 'match.input', match_id: this.matchId, ...i });
  }
  key(k: string, down: boolean): boolean {
    if (k === 'ArrowLeft') this.setDir('left', down);
    else if (k === 'ArrowRight') this.setDir('right', down);
    else if (down && k === 'Escape' && !this.ended) this.quit();
    else return false;
    return true;
  }
  quit() { if (!this.ended) this.live.send({ type: 'match.leave', match_id: this.matchId }); }
  leave() { if (!this.ended) this.quit(); this.live.inMatch = false; }
  onLive(m: any) {
    if (m.match_id && m.match_id !== this.matchId) return;
    if (m.type === 'match.snapshot') this.reconcile(m);
    else if (m.type === 'match.ended') {
      this.ended = true; this.live.inMatch = false; this.result = m; this.left = this.right = false;
      if (m.final_tick != null && m.state) this.state = m.state;
      this.cb.ended(m);
    }
  }
  reconcile(snap: any) {
    this.stats.snapshots++;
    if (snap.late > this.lastLate) { this.N = Math.min(6, this.N + 1); this.lastLate = snap.late; }
    this.inputs = this.inputs.filter((i) => i.seq > snap.last_processed_seq);
    const me0 = this.state.players[0], ox = me0.x, oy = me0.y, localTick = this.state.tick;
    this.state = cloneStairs(snap.state);
    while (this.state.tick < localTick && !this.state.over) this.step();
    const me = this.state.players[0], dx = ox - me.x, dy = oy - me.y, err = Math.hypot(dx, dy);
    if (err > 0.01) this.stats.corrections++;
    if (err <= 8) { this.corr.x += dx; this.corr.y += dy; } else { this.corr.x = this.corr.y = 0; this.stats.snaps++; }
  }
  draw(g: CanvasRenderingContext2D) {
    const s = this.state, P = this.P, W = P.width, GH = P.height, PW = P.platW, frame = this.frame;
    const pl = s.players[0];
    g.fillStyle = PAL[0]; g.fillRect(0, 0, W, GH);
    g.fillStyle = PAL[3]; g.fillRect(0, 0, W, 7);
    spr(g, 'heart', 1, 1); for (let i = 0; i < pl.maxHp; i++) { g.fillStyle = i < pl.hp ? PAL[0] : PAL[2]; g.fillRect(8 + i * 3, 2, 2, 3); }
    num(g, pl.floor, W - String(pl.floor).length * 4 - 1, 1, 0);
    const left = stairsTimeLeft(this.endsAt, this.live.serverNow());
    if (left !== null) { const x0 = W / 2 - 9, ss = String(left % 60).padStart(2, '0'); num(g, Math.floor(left / 60), x0, 1, 0); g.fillStyle = PAL[0]; g.fillRect(x0 + 4, 2, 1, 1); g.fillRect(x0 + 4, 4, 1, 1); num(g, +ss[0], x0 + 6, 1, 0); num(g, +ss[1], x0 + 10, 1, 0); }
    g.fillStyle = PAL[2]; for (let x = 0; x < W; x += 4) { g.fillRect(x, 7, 4, 1); g.fillRect(x + 1, 8, 2, 1); g.fillRect(x + 1, 9, 1, 1); }
    for (const p of s.plats) {
      const x = Math.round(p.x), y = Math.round(p.y);
      if (p.type === 'normal') { g.fillStyle = PAL[3]; g.fillRect(x, y, PW, 3); g.fillStyle = PAL[1]; g.fillRect(x + 1, y + 1, PW - 2, 1); }
      else if (p.type === 'spiky') { g.fillStyle = PAL[3]; g.fillRect(x, y + 1, PW, 2); for (let i = 0; i < PW; i += 3) g.fillRect(x + i + 1, y - 1, 1, 2); }
      else if (p.type === 'conveyor') { g.fillStyle = PAL[3]; g.fillRect(x, y, PW, 3); g.fillStyle = PAL[0]; for (let i = 0; i < PW; i += 4) g.fillRect(x + ((i + Math.floor(s.tick / 3) * p.dir) % PW + PW) % PW, y + 1, 2, 1); }
      else if (p.type === 'bouncy') { g.fillStyle = PAL[3]; g.fillRect(x, y, PW, 1); g.fillStyle = PAL[2]; for (let i = 1; i < PW; i += 3) { g.fillRect(x + i, y + 1, 1, 1); g.fillRect(x + i + 1, y + 2, 1, 1); } g.fillStyle = PAL[3]; g.fillRect(x, y + 3, PW, 1); }
      else { g.fillStyle = p.brk > 0 && frame % 2 ? PAL[1] : PAL[2]; for (let i = 0; i < PW; i += 3) g.fillRect(x + i, y + (p.brk > 0 ? i % 2 : 0), 2, 3); }
    }
    const moving = pl.on != null && (pl.left || pl.right);
    const name = speciesSprite(this.species, moving && Math.floor(frame / 4) % 2 ? 2 : 1);
    const pw = sw(name), ph = sh(name);
    const px = pl.x + this.corr.x + P.boxW / 2 - pw / 2, py = pl.y + this.corr.y + P.boxH - ph;
    if (!(pl.inv > 0 && frame % 4 < 2)) spr(g, name, px, py, pl.dir > 0);
    if (this.ended || s.over) { g.fillStyle = PAL[3]; g.fillRect(18, 34, 60, 22); g.fillStyle = PAL[0]; g.fillRect(19, 35, 58, 20); num(g, pl.floor, 48 - String(pl.floor).length * 2, 38); spr(g, 'heart', 45, 47); }
    else if (s.tick <= 0) { const c = Math.max(0, Math.ceil(-this.estServerTick() / this.P.tickRate)); if (c) num(g, c, W / 2 - 2, 40); }
  }
}
