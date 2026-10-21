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
};
export type StairsParams = typeof STAIRS_PARAMS;
export type PlatType = 'normal' | 'spiky' | 'conveyor' | 'bouncy' | 'fragile';
export interface Plat { id: number; x: number; y: number; type: PlatType; dir: 1 | -1; brk: number }
export interface StairsPlayer {
  petId: string; x: number; y: number; vy: number; hp: number; maxHp: number; speed: number; floor: number;
  on: number | null; inv: number; dir: 1 | -1; alive: boolean; left: boolean; right: boolean; diedAtTick: number | null; cause: string | null;
  /** 已經算過樓層的平台（每人各自算；只留還在畫面上的）、最後一個扎到自己的尖刺平台 */
  passed: number[]; spiked: number;
}
export interface StairsState { tick: number; rng: Rng; made: number; nextId: number; plats: Plat[]; players: StairsPlayer[]; over: boolean; params: StairsParams }
export interface PlayerStats { petId: string; speed: number; stamina: number }

export function maxHpFor(stamina: number, P: StairsParams = STAIRS_PARAMS) { return P.hpBase + Math.min(P.hpMaxBonus, Math.max(0, Math.floor((stamina - 10) / 5))); }
export function moveSpeedFor(speed: number, P: StairsParams = STAIRS_PARAMS) { return P.speedBase + Math.min(P.speedMaxBonus, Math.max(0, (speed - 10) * 0.03)); }

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
  // 多人也一樣：全部站在起始平台中間同一個點（寵物之間不會碰撞，可以重疊）
  for (const pl of players) {
    const maxHp = maxHpFor(pl.stamina, params);
    s.players.push({ petId: pl.petId, x: start.x + params.platW / 2 - params.boxW / 2, y: start.y - params.boxH, vy: 0, hp: maxHp, maxHp,
      speed: moveSpeedFor(pl.speed, params), floor: 0, on: start.id, inv: 0, dir: -1, alive: true, left: false, right: false, diedAtTick: null, cause: null,
      passed: [start.id], spiked: 0 });
  }
  return s;
}

export function setInput(s: StairsState, petId: string, left: boolean, right: boolean) {
  const p = s.players.find((q) => q.petId === petId); if (p) { p.left = left; p.right = right; }
}

function hurt(p: StairsPlayer, n: number, P: StairsParams) { if (p.inv > 0) return; p.hp = Math.max(0, p.hp - n); p.inv = P.invulnTicks; }
function eliminate(s: StairsState, p: StairsPlayer, cause: string) { p.alive = false; p.diedAtTick = s.tick; p.cause = cause; }
/** 單人：全部出局才結束；多人：剩 1 隻（或全部出局）就結束；時間到也結束。 */
function checkOver(s: StairsState) {
  const alive = s.players.filter((p) => p.alive).length;
  if (alive === 0 || (s.players.length > 1 && alive <= 1) || s.tick >= s.params.matchMaxTicks) s.over = true;
}
/** 多人局有人離開（按離開／離開這個家／斷線）：當下出局。 */
export function leaveStairs(s: StairsState, petId: string) {
  const p = s.players.find((q) => q.petId === petId);
  if (!p || !p.alive || s.over) return false;
  eliminate(s, p, 'left'); checkOver(s); return true;
}
/**
 * 前進一個 tick（決定性：不使用 Math.random / 實際時間）。
 * 多人局的寵物之間沒有碰撞：同一組平台、各玩各的（requirements §5.1）。
 */
export function stepStairs(s: StairsState) {
  if (s.over) return;
  const P = s.params; s.tick++;
  const maxFloor = Math.max(0, ...s.players.map((p) => p.floor));
  const scroll = P.scrollBase + Math.min(P.scrollMaxExtra, maxFloor * P.scrollPerFloor);
  for (const pl of s.plats) pl.y -= scroll;
  s.plats = s.plats.filter((pl) => pl.y > P.top - 4 && pl.brk !== 0);
  const last = s.plats[s.plats.length - 1];
  if (!last || last.y < P.height + 4 - P.gap) addPlat(s, (last ? last.y : P.height) + P.gap);
  const byId = new Map(s.plats.map((pl) => [pl.id, pl]));
  // 易碎平台：有寵物站著才倒數，但每個平台每 tick 只扣一次（不會因為站了好幾隻就碎得比較快）
  const crumbled = new Set<number>();
  for (const p of s.players) {
    if (!p.alive) continue;
    p.passed = p.passed.filter((id) => byId.has(id));
    const dx = (p.right ? 1 : 0) - (p.left ? 1 : 0);
    if (dx) p.dir = dx as 1 | -1;
    let mx = dx * p.speed;
    if (p.on !== null) {
      const pl = byId.get(p.on);
      if (!pl || p.x + P.boxW - 3 < pl.x || p.x + 3 > pl.x + P.platW) p.on = null;
      else {
        p.y = pl.y - P.boxH;
        if (pl.type === 'conveyor') mx += pl.dir * P.conveyorSpeed;
        if (pl.type === 'fragile' && pl.brk > 0 && !crumbled.has(pl.id)) { crumbled.add(pl.id); pl.brk--; }
        if (pl.type === 'fragile' && pl.brk === 0) p.on = null;
      }
    }
    p.x = Math.max(0, Math.min(P.width - P.boxW, p.x + mx));
    if (p.on === null) {
      const prevBottom = p.y + P.boxH;
      p.vy = Math.min(P.maxFall, p.vy + P.gravity); p.y += p.vy;
      const bottom = p.y + P.boxH;
      for (const pl of s.plats) {
        if (p.vy >= 0 && prevBottom <= pl.y + 1 && bottom >= pl.y && p.x + P.boxW - 3 >= pl.x && p.x + 3 <= pl.x + P.platW && pl.brk !== 0) {
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
  checkOver(s);
}

/** 多人名次：還活著的（時間到）排最前面、依樓層；出局的越晚越前面，同一 tick 再比樓層；全部相同＝同名次（1、1、3）。 */
export interface StairsRank { petId: string; rank: number; floor: number; diedAtTick: number | null; cause: string | null }
export function stairsRanking(s: StairsState): StairsRank[] {
  const key = (p: StairsPlayer) => [p.alive ? 1 : 0, p.alive ? 0 : p.diedAtTick ?? 0, p.floor];
  const better = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
  return s.players.map((p) => ({ petId: p.petId, rank: 1 + s.players.filter((q) => better(key(q), key(p))).length, floor: p.floor, diedAtTick: p.diedAtTick, cause: p.cause }))
    .sort((a, b) => a.rank - b.rank || (a.petId < b.petId ? -1 : 1));
}
/** 多人局（M2）：2–6 人、邀請 15 秒、獎勵 ◎5 + (人數 − 名次) × 3（人數 = 開始時的人數）。 */
export const STAIRS_MULTI = { minPlayers: 2, maxPlayers: 6, inviteMs: 15_000, base: 5, perRank: 3 };
export function multiStairsCoins(players: number, rank: number) { return STAIRS_MULTI.base + Math.max(0, players - rank) * STAIRS_MULTI.perRank; }

/** 是不是撐到這一局的時間上限（matchMaxTicks）才結束：還活著＝時間到，不是死掉。 */
export function stairsTimeUp(s: StairsState): boolean { return s.over && s.tick >= s.params.matchMaxTicks && s.players.some((p) => p.alive); }
export function cloneStairs(s: StairsState): StairsState { return JSON.parse(JSON.stringify(s)); }
