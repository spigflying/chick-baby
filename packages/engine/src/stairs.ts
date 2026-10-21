import { createRng, nextFloat, nextInt, type Rng } from './rng';

/** 下樓梯參數：全部由伺服器下發（match.started），客戶端不寫死。 */
export const STAIRS_PARAMS = {
  tickRate: 30, snapshotEvery: 2, inputBufferTicks: 3,
  width: 96, height: 90, top: 10,
  platW: 24, gap: 16, maxStepX: 44,
  // bounceVy：原本 -3.2 會彈回上一層（相對峰值 20.3px > 間距 16）；-2.2 → 最高 8.55px，見 test/stairs-bounce.test.ts
  gravity: 0.2, maxFall: 2.6, bounceVy: -2.2, conveyorSpeed: 0.7,
  scrollBase: 0.25, scrollPerFloor: 0.006, scrollMaxExtra: 0.35,
  spikeDamage: 4, ceilingDamage: 4, invulnTicks: 30, fragileTicks: 12,
  boxW: 12, boxH: 14,
  hpBase: 10, hpMaxBonus: 4, speedBase: 1.2, speedMaxBonus: 0.5,
  typeOdds: { normal: 0.46, spiky: 0.12, conveyor: 0.14, bouncy: 0.13, fragile: 0.15 },
  matchMaxTicks: 30 * 60 * 60, // 安全上限 60 分鐘（防止沒人管的局）；每一局伺服器會再依關門時間縮短（requirements §4.7）
  // M2 推擠（requirements §5.1）：推力 = 力量、質量 = 體重；pushVx 每 tick 衰減，上限 pushMax；出局前 killWindow tick 內最後推的人算擊殺
  pushGain: 0.5, pushMax: 2, pushDecay: 0.85, pushIdle: 0.5, pushMinOverlapY: 3, killWindow: 60,
};
export type StairsParams = typeof STAIRS_PARAMS;
export type PlatType = 'normal' | 'spiky' | 'conveyor' | 'bouncy' | 'fragile';
/** w：平台寬（只有多人局的全寬起始平台有；其他用 platW）。 */
export interface Plat { id: number; x: number; y: number; type: PlatType; dir: 1 | -1; brk: number; w?: number }
export interface StairsPlayer {
  petId: string; x: number; y: number; vy: number; hp: number; maxHp: number; speed: number; floor: number;
  on: number | null; inv: number; dir: 1 | -1; alive: boolean; left: boolean; right: boolean; diedAtTick: number | null; cause: string | null;
  /** 已經算過樓層的平台（每人各自算；只留還在畫面上的）、最後一個扎到自己的尖刺平台 */
  passed: number[]; spiked: number;
  /** 推擠：推力、質量、被推的橫向速度、最後推自己的人與 tick、被誰推出局 */
  push: number; mass: number; pvx: number; lastPushBy: string | null; lastPushTick: number; killedBy: string | null;
}
export interface StairsState { tick: number; rng: Rng; made: number; nextId: number; plats: Plat[]; players: StairsPlayer[]; over: boolean; params: StairsParams }
export interface PlayerStats { petId: string; speed: number; stamina: number; strength?: number; weight?: number }

export function maxHpFor(stamina: number, P: StairsParams = STAIRS_PARAMS) { return P.hpBase + Math.min(P.hpMaxBonus, Math.max(0, Math.floor((stamina - 10) / 5))); }
export function moveSpeedFor(speed: number, P: StairsParams = STAIRS_PARAMS) { return P.speedBase + Math.min(P.speedMaxBonus, Math.max(0, (speed - 10) * 0.03)); }
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export function pushFor(strength = 10) { return clampN(1 + (strength - 10) / 50, 0.8, 1.6); }
export function massFor(weight = 20) { return clampN(1 + (weight - 20) / 50, 0.8, 1.6); }
const platW = (pl: Plat, P: StairsParams) => pl.w ?? P.platW;

function pickType(s: StairsState): PlatType {
  if (s.made < 4) return 'normal';
  const o = s.params.typeOdds, hard = Math.min(0.12, s.made * 0.003), r = nextFloat(s.rng);
  if (r < o.normal - hard) return 'normal';
  let acc = o.normal;
  for (const t of ['spiky', 'conveyor', 'bouncy'] as PlatType[]) { acc += o[t as 'spiky']; if (r < acc) return t; }
  return 'fragile';
}
function addPlat(s: StairsState, y: number) {
  const P = s.params; s.made++;
  const prev = s.plats[s.plats.length - 1];
  const x = prev ? Math.max(0, Math.min(P.width - P.platW, prev.x + Math.round((nextFloat(s.rng) * 2 - 1) * P.maxStepX))) : nextInt(s.rng, P.width - P.platW);
  s.plats.push({ id: s.nextId++, x, y, type: pickType(s), dir: nextFloat(s.rng) < 0.5 ? -1 : 1, brk: -1 });
}

/** 下樓梯在關門前多久強制結束（時間到）：19:59，留 1 分鐘讓結算在 20:00 關門前完成。 */
export const STAIRS_CUTOFF_MS = 60_000;
/** 離收工不到這麼久就不能開新局：19:58 起。 */
export const STAIRS_MIN_START_MS = 60_000;
export function createStairs(seed: number, players: PlayerStats[], params: StairsParams = STAIRS_PARAMS): StairsState {
  const s: StairsState = { tick: 0, rng: createRng(seed), made: 0, nextId: 1, plats: [], players: [], over: false, params };
  for (let y = 30; y < params.height + params.gap; y += params.gap) addPlat(s, y);
  const start = s.plats.find((p) => p.y >= 60)!; start.type = 'normal';
  // 多人：全寬起始平台，依 seed 洗牌後平均排開（一開始不重疊）；單人維持原本的位置
  const multi = players.length > 1, slot = players.map((_, i) => i);
  if (multi) {
    start.x = 0; start.w = params.width;
    for (let i = slot.length - 1; i > 0; i--) { const j = nextInt(s.rng, i + 1); [slot[i], slot[j]] = [slot[j], slot[i]]; }
  }
  players.forEach((pl, i) => {
    const maxHp = maxHpFor(pl.stamina, params);
    const x = multi ? Math.round((slot[i] + 0.5) * params.width / players.length - params.boxW / 2) : start.x + params.platW / 2 - params.boxW / 2 + i * 2;
    s.players.push({ petId: pl.petId, x, y: start.y - params.boxH, vy: 0, hp: maxHp, maxHp,
      speed: moveSpeedFor(pl.speed, params), floor: 0, on: start.id, inv: 0, dir: -1, alive: true, left: false, right: false, diedAtTick: null, cause: null,
      passed: [start.id], spiked: 0, push: pushFor(pl.strength), mass: massFor(pl.weight), pvx: 0, lastPushBy: null, lastPushTick: -1, killedBy: null });
  });
  return s;
}

export function setInput(s: StairsState, petId: string, left: boolean, right: boolean) {
  const p = s.players.find((q) => q.petId === petId); if (p) { p.left = left; p.right = right; }
}

function hurt(p: StairsPlayer, n: number, P: StairsParams) { if (p.inv > 0) return; p.hp = Math.max(0, p.hp - n); p.inv = P.invulnTicks; }
function eliminate(s: StairsState, p: StairsPlayer, cause: string) {
  p.alive = false; p.diedAtTick = s.tick; p.cause = cause;
  p.killedBy = cause !== 'left' && p.lastPushBy && s.tick - p.lastPushTick <= s.params.killWindow ? p.lastPushBy : null;
}
/** 單人：全部出局才結束；多人：剩 1 隻（或全部出局）就結束；時間到也結束。 */
function checkOver(s: StairsState) {
  const alive = s.players.filter((p) => p.alive).length;
  if (alive === 0 || (s.players.length > 1 && alive <= 1) || s.tick >= s.params.matchMaxTicks) s.over = true;
}
/** 多人局有人離開（按離開／離開這個家／斷線）：當下出局，不算誰推的。 */
export function leaveStairs(s: StairsState, petId: string) {
  const p = s.players.find((q) => q.petId === petId);
  if (!p || !p.alive || s.over) return false;
  eliminate(s, p, 'left'); checkOver(s); return true;
}
/**
 * 推擠（requirements §5.1）：水平重疊 > 0 且垂直重疊 ≥ pushMinOverlapY 才算碰到。依推力／質量把兩隻分開；
 * 正朝對方走的那隻會讓對方得到 pvx（空中也有效，可以把人撞下平台），並記為「最後推的人」。
 */
function collide(s: StairsState) {
  const P = s.params, maxX = P.width - P.boxW;
  const alive = s.players.filter((p) => p.alive).sort((a, b) => (a.petId < b.petId ? -1 : a.petId > b.petId ? 1 : 0));
  for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
    const a = alive[i], b = alive[j];
    const ox = Math.min(a.x, b.x) + P.boxW - Math.max(a.x, b.x);
    const oy = Math.min(a.y, b.y) + P.boxH - Math.max(a.y, b.y);
    if (ox <= 0 || oy < P.pushMinOverlapY) continue;
    const [L, R] = a.x <= b.x ? [a, b] : [b, a];
    const movL = L.right && !L.left, movR = R.left && !R.right;
    const wL = (L.push * (movL ? 1 : P.pushIdle)) / R.mass, wR = (R.push * (movR ? 1 : P.pushIdle)) / L.mass;
    L.x -= ox * wR / (wL + wR); R.x += ox * wL / (wL + wR);
    if (L.x < 0) { R.x -= L.x; L.x = 0; }
    if (R.x > maxX) { L.x -= R.x - maxX; R.x = maxX; }
    L.x = clampN(L.x, 0, maxX); R.x = clampN(R.x, 0, maxX);
    if (movL) { R.pvx = clampN(R.pvx + P.pushGain * L.push / R.mass, -P.pushMax, P.pushMax); R.lastPushBy = L.petId; R.lastPushTick = s.tick; }
    if (movR) { L.pvx = clampN(L.pvx - P.pushGain * R.push / L.mass, -P.pushMax, P.pushMax); L.lastPushBy = R.petId; L.lastPushTick = s.tick; }
  }
}

/**
 * 前進一個 tick（決定性：不使用 Math.random / 實際時間）。
 * collide：寵物之間的推擠（伺服器 true；客戶端預測自己時傳 false，推擠只由伺服器決定，requirements §5.4）。
 */
export function stepStairs(s: StairsState, opts: { collide?: boolean } = {}) {
  if (s.over) return;
  const P = s.params; s.tick++;
  const maxFloor = Math.max(0, ...s.players.map((p) => p.floor));
  const scroll = P.scrollBase + Math.min(P.scrollMaxExtra, maxFloor * P.scrollPerFloor);
  for (const pl of s.plats) pl.y -= scroll;
  s.plats = s.plats.filter((pl) => pl.y > P.top - 4 && pl.brk !== 0);
  const last = s.plats[s.plats.length - 1];
  if (!last || last.y < P.height + 4 - P.gap) addPlat(s, (last ? last.y : P.height) + P.gap);
  const byId = new Map(s.plats.map((pl) => [pl.id, pl]));
  for (const p of s.players) {
    if (!p.alive) continue;
    p.passed = p.passed.filter((id) => byId.has(id));
    const dx = (p.right ? 1 : 0) - (p.left ? 1 : 0);
    if (dx) p.dir = dx as 1 | -1;
    let mx = dx * p.speed + p.pvx;
    p.pvx = Math.abs(p.pvx * P.pushDecay) < 0.01 ? 0 : p.pvx * P.pushDecay;
    if (p.on !== null) {
      const pl = byId.get(p.on);
      if (!pl || p.x + P.boxW - 3 < pl.x || p.x + 3 > pl.x + platW(pl, P)) p.on = null;
      else {
        p.y = pl.y - P.boxH;
        if (pl.type === 'conveyor') mx += pl.dir * P.conveyorSpeed;
        if (pl.type === 'fragile' && pl.brk > 0 && --pl.brk === 0) p.on = null;
      }
    }
    p.x = Math.max(0, Math.min(P.width - P.boxW, p.x + mx));
    if (p.on === null) {
      const prevBottom = p.y + P.boxH;
      p.vy = Math.min(P.maxFall, p.vy + P.gravity); p.y += p.vy;
      const bottom = p.y + P.boxH;
      for (const pl of s.plats) {
        if (p.vy >= 0 && prevBottom <= pl.y + 1 && bottom >= pl.y && p.x + P.boxW - 3 >= pl.x && p.x + 3 <= pl.x + platW(pl, P) && pl.brk !== 0) {
          p.y = pl.y - P.boxH; p.vy = 0;
          if (pl.type === 'bouncy') { p.vy = P.bounceVy; break; }
          p.on = pl.id;
          if (pl.type === 'spiky') { if (p.spiked !== pl.id) { p.spiked = pl.id; hurt(p, P.spikeDamage, P); } }
          else if (!p.passed.includes(pl.id)) p.hp = Math.min(p.maxHp, p.hp + 1);
          if (pl.type === 'fragile' && pl.brk < 0) pl.brk = P.fragileTicks;
          break;
        }
      }
    }
    for (const pl of s.plats) if (!p.passed.includes(pl.id) && pl.y + 2 < p.y) { p.passed.push(pl.id); p.floor++; }
    if (p.y < P.top + 1) { hurt(p, P.ceilingDamage, P); p.y = P.top + 2; p.vy = 1; if (p.on !== null) { const pl = byId.get(p.on); if (pl && !p.passed.includes(pl.id)) p.passed.push(pl.id); p.on = null; } }
    if (p.inv > 0) p.inv--;
    if (p.hp <= 0 || p.y > P.height) eliminate(s, p, p.hp <= 0 ? 'hp' : 'fell');
  }
  if (opts.collide !== false && s.players.length > 1) collide(s);
  checkOver(s);
}

/** 多人名次：還活著的（時間到）排最前面、依樓層；出局的越晚越前面，同一 tick 再比樓層；全部相同＝同名次（1、1、3）。 */
export interface StairsRank { petId: string; rank: number; floor: number; diedAtTick: number | null; cause: string | null; killedBy: string | null }
export function stairsRanking(s: StairsState): StairsRank[] {
  const key = (p: StairsPlayer) => [p.alive ? 1 : 0, p.alive ? 0 : p.diedAtTick ?? 0, p.floor];
  const better = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
  return s.players.map((p) => ({ petId: p.petId, rank: 1 + s.players.filter((q) => better(key(q), key(p))).length, floor: p.floor, diedAtTick: p.diedAtTick, cause: p.cause, killedBy: p.killedBy }))
    .sort((a, b) => a.rank - b.rank || (a.petId < b.petId ? -1 : 1));
}
/** 多人局（M2）：2–6 人、邀請 15 秒、獎勵 ◎5 + (人數 − 名次) × 3（人數 = 開始時的人數）。 */
export const STAIRS_MULTI = { minPlayers: 2, maxPlayers: 6, inviteMs: 15_000, base: 5, perRank: 3 };
export function multiStairsCoins(players: number, rank: number) { return STAIRS_MULTI.base + Math.max(0, players - rank) * STAIRS_MULTI.perRank; }

/** 是不是撐到這一局的時間上限（matchMaxTicks）才結束：還活著＝時間到，不是死掉。 */
export function stairsTimeUp(s: StairsState): boolean { return s.over && s.tick >= s.params.matchMaxTicks && s.players.some((p) => p.alive); }
export function cloneStairs(s: StairsState): StairsState { return JSON.parse(JSON.stringify(s)); }
