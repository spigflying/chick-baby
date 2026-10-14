import { createRng, nextFloat, nextInt, type Rng } from './rng';

/** 下樓梯參數：全部由伺服器下發（match.started），客戶端不寫死。 */
export const STAIRS_PARAMS = {
  tickRate: 30, snapshotEvery: 2, inputBufferTicks: 3,
  width: 96, height: 90, top: 10,
  platW: 24, gap: 16, maxStepX: 44,
  gravity: 0.2, maxFall: 2.6, bounceVy: -3.2, conveyorSpeed: 0.7,
  scrollBase: 0.25, scrollPerFloor: 0.006, scrollMaxExtra: 0.35,
  spikeDamage: 4, ceilingDamage: 4, invulnTicks: 30, fragileTicks: 12,
  boxW: 12, boxH: 14,
  hpBase: 10, hpMaxBonus: 4, speedBase: 1.2, speedMaxBonus: 0.5,
  typeOdds: { normal: 0.46, spiky: 0.12, conveyor: 0.14, bouncy: 0.13, fragile: 0.15 },
  matchMaxTicks: 30 * 60 * 5, // 5 分鐘：19:55 前開的局一定在 20:00 前結束（requirements §4.7）
};
export type StairsParams = typeof STAIRS_PARAMS;
export type PlatType = 'normal' | 'spiky' | 'conveyor' | 'bouncy' | 'fragile';
export interface Plat { id: number; x: number; y: number; type: PlatType; dir: 1 | -1; brk: number; counted: boolean; hurt: boolean }
export interface StairsPlayer {
  petId: string; x: number; y: number; vy: number; hp: number; maxHp: number; speed: number; floor: number;
  on: number | null; inv: number; dir: 1 | -1; alive: boolean; left: boolean; right: boolean; diedAtTick: number | null; cause: string | null;
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
  s.plats.push({ id: s.nextId++, x, y, type: pickType(s), dir: nextFloat(s.rng) < 0.5 ? -1 : 1, brk: -1, counted: false, hurt: false });
}

export function createStairs(seed: number, players: PlayerStats[], params: StairsParams = STAIRS_PARAMS): StairsState {
  const s: StairsState = { tick: 0, rng: createRng(seed), made: 0, nextId: 1, plats: [], players: [], over: false, params };
  for (let y = 30; y < params.height + params.gap; y += params.gap) addPlat(s, y);
  const start = s.plats.find((p) => p.y >= 60)!; start.type = 'normal'; start.counted = true;
  players.forEach((pl, i) => {
    const maxHp = maxHpFor(pl.stamina, params);
    s.players.push({ petId: pl.petId, x: start.x + params.platW / 2 - params.boxW / 2 + i * 2, y: start.y - params.boxH, vy: 0, hp: maxHp, maxHp,
      speed: moveSpeedFor(pl.speed, params), floor: 0, on: start.id, inv: 0, dir: -1, alive: true, left: false, right: false, diedAtTick: null, cause: null });
  });
  return s;
}

export function setInput(s: StairsState, petId: string, left: boolean, right: boolean) {
  const p = s.players.find((q) => q.petId === petId); if (p) { p.left = left; p.right = right; }
}

function hurt(p: StairsPlayer, n: number, P: StairsParams) { if (p.inv > 0) return; p.hp = Math.max(0, p.hp - n); p.inv = P.invulnTicks; }

/** 前進一個 tick（決定性：不使用 Math.random / 實際時間）。 */
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
  for (const p of s.players) {
    if (!p.alive) continue;
    const dx = (p.right ? 1 : 0) - (p.left ? 1 : 0);
    if (dx) p.dir = dx as 1 | -1;
    let mx = dx * p.speed;
    if (p.on !== null) {
      const pl = byId.get(p.on);
      if (!pl || p.x + P.boxW - 3 < pl.x || p.x + 3 > pl.x + P.platW) p.on = null;
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
        if (p.vy >= 0 && prevBottom <= pl.y + 1 && bottom >= pl.y && p.x + P.boxW - 3 >= pl.x && p.x + 3 <= pl.x + P.platW && pl.brk !== 0) {
          p.y = pl.y - P.boxH; p.vy = 0;
          if (pl.type === 'bouncy') { p.vy = P.bounceVy; break; }
          p.on = pl.id;
          if (pl.type === 'spiky') { if (!pl.hurt) { pl.hurt = true; hurt(p, P.spikeDamage, P); } }
          else if (!pl.counted) p.hp = Math.min(p.maxHp, p.hp + 1);
          if (pl.type === 'fragile' && pl.brk < 0) pl.brk = P.fragileTicks;
          break;
        }
      }
    }
    for (const pl of s.plats) if (!pl.counted && pl.y + 2 < p.y) { pl.counted = true; p.floor++; }
    if (p.y < P.top + 1) { hurt(p, P.ceilingDamage, P); p.y = P.top + 2; p.vy = 1; if (p.on !== null) { const pl = byId.get(p.on); if (pl) pl.counted = true; p.on = null; } }
    if (p.inv > 0) p.inv--;
    if (p.hp <= 0 || p.y > P.height) { p.alive = false; p.diedAtTick = s.tick; p.cause = p.hp <= 0 ? 'hp' : 'fell'; }
  }
  if (s.players.every((p) => !p.alive) || s.tick >= P.matchMaxTicks) s.over = true;
}

export function cloneStairs(s: StairsState): StairsState { return JSON.parse(JSON.stringify(s)); }
