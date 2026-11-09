// 格鬥 3D 動畫的純函數工具（不碰 three.js，也不碰引擎 state）：姿勢內插曲線、狀態切換淡入、
// 兩個 tick 之間的畫面內插、彈簧次級動作、腳踩地 IK。全部只影響畫面；判定照引擎。
export type Pose = Record<string, any>;
export const HALF = Math.PI / 2;

/** 姿勢預設值（面向 +x 的側面平面角度）。turn：轉身進度 1 = 轉完 */
export const P = (o: Pose = {}): Pose => ({
  drop: 0, lean: 0, roll: 0, spin: 0, head: 0, puff: 0, sx: 1, sy: 1,
  aF: -0.95, eF: 1.25, aB: -0.65, eB: 1.35, hF: -HALF + 0.45, kF: -0.7, hB: -HALF - 0.45, kB: 0.5,
  ik: 0, ikLimb: null, turn: 1, ...o,
});
export const NUM = Object.keys(P()).filter((k) => typeof P()[k] === 'number');

/** 角度最短路徑的差（給 spin） */
const angDiff = (a: number, b: number) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
/** 兩個姿勢線性混合；spin 走最短角度；ikLimb 取有的那個 */
export function mix(a: Pose, b: Pose, u: number): Pose {
  const o: Pose = { ...b };
  for (const k of NUM) o[k] = k === 'spin' ? a.spin + angDiff(a.spin, b.spin) * u : a[k] + (b[k] - a[k]) * u;
  o.ikLimb = u < 0.5 ? a.ikLimb ?? b.ikLimb : b.ikLimb ?? a.ikLimb;
  return o;
}
export const easeOut = (u: number) => Math.sin(Math.max(0, Math.min(1, u)) * HALF); // 前快後慢（sine ease-out，第一步不會太猛）
export const smooth = (u: number) => u * u * (3 - 2 * u);

/** 單一數值的單調三次 Hermite（Fritsch–Carlson）：通過每個關鍵格，關鍵格是轉折點時速度 0（預備動作不會被抹掉），不會亂超出 */
function hermite1(ts: number[], vs: number[], i: number, t: number) {
  const n = ts.length, d = (k: number) => (vs[k + 1] - vs[k]) / (ts[k + 1] - ts[k] || 1);
  const tan = (k: number) => {
    if (k === 0 || k === n - 1) return 0;
    const d0 = d(k - 1), d1 = d(k);
    if (d0 * d1 <= 0) return 0;
    return 2 / (1 / d0 + 1 / d1); // 調和平均：單調
  };
  const h = ts[i + 1] - ts[i], s = (t - ts[i]) / h, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * vs[i] + (s3 - 2 * s2 + s) * h * tan(i) + (-2 * s3 + 3 * s2) * vs[i + 1] + (s3 - s2) * h * tan(i + 1);
}
/** keys: [[幀, 姿勢], ...]，幀遞增；兩格之間用單調 Hermite 曲線（在每個關鍵格剛好等於那格姿勢） */
export function keyed(keys: [number, Pose][], t: number): Pose {
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  let i = 0; while (t > keys[i + 1][0]) i++;
  const [a, A] = keys[i], [b, B] = keys[i + 1];
  if (b === a) return B;
  const ts = keys.map((k) => k[0]), o: Pose = { ...B };
  for (const k of NUM) o[k] = hermite1(ts, keys.map((kk) => kk[1][k]), i, t);
  o.ik = Math.max(0, Math.min(1, o.ik));
  o.ikLimb = (t - a) / (b - a) < 0.5 ? A.ikLimb ?? B.ikLimb : B.ikLimb ?? A.ikLimb;
  return o;
}
/** 收招略過頭再回來（ease-out + overshoot）的那一格：base 往 base−from 方向多走 amt */
export function overshoot(from: Pose, base: Pose, amt = 0.12): Pose {
  const o: Pose = { ...base };
  for (const k of NUM) o[k] = base[k] + (base[k] - from[k]) * amt;
  o.ik = 0; return o;
}

// ---------- 狀態切換淡入 ----------
/** 從 from 組切到 to 組要淡入幾個 tick；0 = 刻意的瞬間切換（出招、被打第一幀、防禦） */
export function blendTicks(from: string, to: string): number {
  if (!from || from === to) return 0;
  if (to.startsWith('move') || to === 'hit' || to === 'airhit' || to === 'block' || to === 'thrown') return 0;
  if (to === 'prox') return 2;
  if (to === 'land') return 3;
  if (to === 'jump') return 3;
  if (to === 'prejump') return 3;
  if (to === 'kd') return from === 'airhit' ? 4 : 10; // 站著被掃倒：倒下要有過程
  if (from === 'walk' && (to === 'idle' || to === 'crouch' || to === 'prox')) return 4;
  if ((from === 'idle' || from === 'prox') && (to === 'crouch' || to === 'idle' || to === 'prox')) return 3;
  if (from === 'crouch' && (to === 'idle' || to === 'walk' || to === 'prox')) return 3;
  if (to === 'walk') return 4;
  if (from === 'hit' || from === 'block' || from === 'kd' || from === 'land' || from.startsWith('move') || from === 'throwing' || from === 'tech' || from === 'dizzy') return 5;
  return 4;
}
export const TURN_TICKS = 4;

type Mem = { tick: number; rnd: number; g: string; gStart: number; from: Pose | null; start: number; n: number; last: Pose | null; f: number; turnStart: number };
const fresh = (): Mem => ({ tick: -1, rnd: -1, g: '', gStart: 0, from: null, start: 0, n: 0, last: null, f: 0, turnStart: -99 });

/**
 * 每位角色一個：依 tick 順序把引擎 state 轉成「要顯示的姿勢」（含切換淡入、轉身進度）。
 * 記憶只依 tick 序列決定；同一 tick 再算（回滾、畫面內插回頭算上一 tick）會先倒回那之前的記憶，結果一樣。
 */
export class FighterAnim {
  mem: Mem = fresh();
  hist: Mem[] = [];
  constructor(public poseFn: (p: any, s: any, ctx: { age: number }) => Pose, public strikeAt: (p: any) => boolean = () => false) {}
  reset() { this.mem = fresh(); this.hist = []; }
  at(s: any, i: number): Pose {
    if (this.mem.rnd !== -1 && s.rnd !== this.mem.rnd) this.reset();
    if (this.mem.tick >= s.tick) { // 倒帶：回到這個 tick 之前最後一份記憶
      while (this.hist.length && this.hist[this.hist.length - 1].tick >= s.tick) this.hist.pop();
      this.mem = this.hist.length ? { ...this.hist[this.hist.length - 1] } : fresh();
    }
    const m = this.mem, p = s.p[i];
    let raw = this.poseFn(p, s, { age: s.tick - m.gStart });
    const g = raw.g ?? '';
    let snap = false;
    if (g !== m.g) {
      const n = m.last ? blendTicks(m.g, g) : 0;
      m.gStart = s.tick; raw = this.poseFn(p, s, { age: 0 });
      if (n > 0) { m.from = m.last; m.start = s.tick; m.n = n; } else { m.from = null; snap = !!m.last; }
      m.g = g;
    }
    let out = raw;
    if (m.from) {
      const k = s.tick - m.start + 1;
      if (k > m.n) m.from = null; else out = mix(m.from, raw, (m.n >= 8 ? smooth : easeOut)(k / (m.n + 1)));
    }
    if (this.strikeAt(p)) snap = true;
    // 轉身：引擎直接換 f；畫面用 TURN_TICKS 幀轉過去
    if (m.f && p.f !== m.f) m.turnStart = s.tick;
    m.f = p.f;
    const tk = s.tick - m.turnStart + 1;
    out = { ...out, turn: tk > TURN_TICKS ? 1 : tk / (TURN_TICKS + 1), snap }; // 等速轉，每 tick 約 0.5 rad
    m.last = out; m.tick = s.tick; m.rnd = s.rnd;
    this.hist.push({ ...m }); if (this.hist.length > 32) this.hist.shift();
    return out;
  }
}

/** 畫面在兩個 tick 之間的比例（0 = 上一 tick、1 = 這一 tick）；snap 的那一 tick 直接顯示 */
export function interpPose(a: Pose | null, b: Pose, alpha: number): Pose {
  if (!a || b.snap || !(alpha < 1)) return b;
  return mix(a, b, Math.max(0, alpha));
}

// ---------- 彈簧（次級動作） ----------
export class Spring {
  x = 0; v = 0;
  constructor(public k = 360, public c = 13, public lim = 0.5) {}
  /** dv：外力造成的速度變化（衝量）；dt 秒 */
  step(dv: number, dt: number) {
    this.v += dv;
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for (let i = 0; i < n; i++) { this.v += (-this.k * this.x - this.c * this.v) * h; this.x += this.v * h; }
    if (!Number.isFinite(this.x) || !Number.isFinite(this.v)) { this.x = 0; this.v = 0; }
    this.x = Math.max(-this.lim, Math.min(this.lim, this.x)); this.v = Math.max(-30, Math.min(30, this.v));
    return this.x;
  }
  reset() { this.x = 0; this.v = 0; }
}

// ---------- 兩節腳 IK（腳踩地） ----------
/** 從髖關節出發，讓腳到 (tx, ty)；e 的正負號（膝蓋往哪彎）照原本姿勢。回傳 [a, e] */
export function solveLeg(l1: number, l2: number, tx: number, ty: number, eSign: number): [number, number] {
  const d = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min(l1 + l2 - 1e-3, Math.hypot(tx, ty)));
  const phi = Math.atan2(ty, tx);
  const alpha = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const beta = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))));
  const s = eSign < 0 ? 1 : -1;
  return [phi + s * alpha, -s * (Math.PI - beta)];
}
/** 姿勢裡腳底相對髖關節的位置 */
export const footOf = (l1: number, l2: number, a: number, e: number): [number, number] => [l1 * Math.cos(a) + l2 * Math.cos(a + e), l1 * Math.sin(a) + l2 * Math.sin(a + e)];
