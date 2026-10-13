import { GAME, type GameConfig } from './config';
import { FOOD_BY_ID, type Food } from './foods';
import { SPECIES, type SpeciesId } from './species';
import { nextFloat, type Rng } from './rng';

export type PetStatus = 'egg' | 'alive' | 'dead';
export type Personality = '溫和' | '貪吃' | '活潑' | '懶散' | '勇敢' | '機靈';
export interface Counters { feeds: number; snacks: number; plays: number; sleeps: number; cleans: number; doctor: number }
/** 寵物模擬狀態（時間皆為 epoch ms）。 */
export interface PetState {
  speciesId: SpeciesId; status: PetStatus; bornAt: number; hatchedAt: number | null; lastSimulatedAt: number;
  hunger: number; happiness: number; energy: number; cleanliness: number; health: number;
  poop: number; lastPoopAt: number | null; dirtySince: number | null; sick: boolean; sleeping: boolean;
  strength: number; speed: number; stamina: number; weight: number; personality: Personality;
  bestFloor: number; counters: Counters; diedAt: number | null; deathCause: string | null;
}
export interface SimEvent { type: 'hatch' | 'poop' | 'sick' | 'death' | 'wake'; at: number; payload?: Record<string, unknown> }
export type GameErrorCode =
  | 'FORBIDDEN' | 'PET_DEAD' | 'PET_EGG' | 'PET_SLEEPING' | 'ALREADY_SLEEPING' | 'NOT_SLEEPING' | 'TOO_FULL' | 'SNACK_ONLY' | 'VISITOR_FREE_FOOD'
  | 'LOW_HEALTH_SNACK' | 'DAILY_CAP' | 'INSUFFICIENT_COINS' | 'NOT_NEEDED' | 'TOO_TIRED' | 'BAD_REQUEST' | 'UNKNOWN_FOOD';

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const MIN = 60_000;

export function newPet(speciesId: SpeciesId, now: number): PetState {
  const b = SPECIES[speciesId].base;
  return {
    speciesId, status: 'egg', bornAt: now, hatchedAt: null, lastSimulatedAt: now,
    hunger: 80, happiness: 80, energy: 80, cleanliness: 100, health: 100, poop: 0, lastPoopAt: null, dirtySince: null,
    sick: false, sleeping: false, strength: b.strength, speed: b.speed, stamina: b.stamina, weight: b.weight,
    personality: '溫和', bestFloor: 0, counters: { feeds: 0, snacks: 0, plays: 0, sleeps: 0, cleans: 0, doctor: 0 }, diedAt: null, deathCause: null,
  };
}

/** 能力值成長：乘上物種倍率（體重不乘），範圍 1–999。 */
export function grow(p: PetState, k: 'strength' | 'speed' | 'stamina' | 'weight', d: number) {
  const m = k === 'weight' ? 1 : SPECIES[p.speciesId].mult[k];
  const v = d > 0 ? d * m : d;
  p[k] = Math.max(1, Math.min(999, round1(p[k] + v)));
}
export function updatePersonality(p: PetState) {
  const c = p.counters;
  let r: Personality = '溫和';
  if (p.weight > 60 || c.snacks > c.feeds * 0.5 + 2) r = '貪吃';
  else if (c.plays > c.feeds && c.plays > 4) r = '活潑';
  else if (c.sleeps > c.plays + 3) r = '懶散';
  else if (p.strength > p.speed + 8) r = '勇敢';
  else if (p.speed > p.strength + 8) r = '機靈';
  p.personality = r;
}

function tryPoop(p: PetState, at: number, chance: number, rng: Rng, cfg: GameConfig, events: SimEvent[]) {
  if (p.hunger < cfg.poop.minHunger || p.poop >= cfg.poop.max) return;
  if (p.lastPoopAt !== null && at - p.lastPoopAt < cfg.poop.minIntervalMs) return;
  if (nextFloat(rng) < chance) { p.poop++; p.lastPoopAt = at; events.push({ type: 'poop', at }); }
}

/**
 * 把寵物狀態結算到 `to`（離線衰減）。以 1 分鐘為步長；所有每分鐘的速率/機率乘 timeScale。
 * 蛋期間不衰減，到 eggSeconds 自動孵化。
 */
export function simulate(p: PetState, to: number, rng: Rng, cfg: GameConfig = GAME): SimEvent[] {
  const events: SimEvent[] = [];
  if (p.status === 'dead' || to <= p.lastSimulatedAt) return events;
  if (p.status === 'egg') {
    const hatchAt = p.bornAt + cfg.eggSeconds * 1000;
    if (to < hatchAt) { p.lastSimulatedAt = to; return events; }
    p.status = 'alive'; p.hatchedAt = hatchAt; p.lastSimulatedAt = Math.max(p.lastSimulatedAt, hatchAt);
    events.push({ type: 'hatch', at: hatchAt });
  }
  const ts = cfg.timeScale;
  let t = p.lastSimulatedAt;
  while (t < to && p.status === 'alive') {
    const stepMs = Math.min(MIN, to - t); const m = stepMs / MIN; t += stepMs;
    const sleep = p.sleeping, d = cfg.decay;
    p.hunger = clamp(p.hunger - d.hunger * m * ts * (sleep ? 0.5 : 1));
    p.happiness = clamp(p.happiness - d.happiness * m * ts * (sleep ? 0.3 : 1));
    p.energy = clamp(p.energy + (sleep ? cfg.sleepEnergyGain : -d.energy) * m * ts);
    p.cleanliness = clamp(p.cleanliness - (d.cleanliness + p.poop * cfg.poop.cleanPerPoopPerMin) * m * ts);
    tryPoop(p, t, cfg.poop.chancePerMin * m * ts, rng, cfg, events);
    if (sleep && p.energy >= 100) { p.sleeping = false; events.push({ type: 'wake', at: t, payload: { auto: true } }); }
    // 骯髒持續時間
    if (p.cleanliness < cfg.sick.dirtyBelow) { if (p.dirtySince === null) p.dirtySince = t; } else p.dirtySince = null;
    if (!p.sick) {
      const dirtyLong = p.dirtySince !== null && t - p.dirtySince >= cfg.sick.dirtyForMs;
      const hungry = p.hunger < cfg.sick.hungryBelow;
      const chance = cfg.sick.chancePerMin * m * ts;
      if ((dirtyLong && nextFloat(rng) < chance) || (hungry && nextFloat(rng) < chance)) { p.sick = true; events.push({ type: 'sick', at: t }); }
    }
    const lows = [p.hunger, p.happiness, p.energy, p.cleanliness].filter((v) => v < cfg.health.lowBelow).length;
    let dh = lows * cfg.health.perLowPerMin + (p.sick ? cfg.health.sickPerMin : 0);
    if (!lows && !p.sick) dh = cfg.health.recoverPerMin;
    p.health = clamp(p.health + dh * m * ts);
    if (p.health <= 0) {
      p.status = 'dead'; p.diedAt = t; p.sleeping = false;
      p.deathCause = p.sick ? 'illness' : p.hunger < cfg.health.lowBelow ? 'starvation' : 'neglect';
      events.push({ type: 'death', at: t, payload: { cause: p.deathCause } });
    }
  }
  p.lastSimulatedAt = to;
  return events;
}

export interface FeedContext { isOwner: boolean; visitorCountPet: number; visitorCountMine: number; balance: number }
/** 檢查是否可以餵食；回傳錯誤碼或 null。 */
export function checkFeed(p: PetState, food: Food | undefined, ctx: FeedContext, cfg: GameConfig = GAME): GameErrorCode | null {
  if (!food) return 'UNKNOWN_FOOD';
  if (p.status === 'dead') return 'PET_DEAD';
  if (p.status === 'egg') return 'PET_EGG';
  if (p.sleeping) return 'PET_SLEEPING';
  if (!ctx.isOwner && (!food.visitorAllowed || food.price === 0)) return 'VISITOR_FREE_FOOD';
  if (p.hunger >= cfg.feed.fullAt) return 'TOO_FULL';
  if (p.hunger >= cfg.feed.snackOnlyAt && !food.snack) return 'SNACK_ONLY';
  if (!ctx.isOwner) {
    if (food.snack && p.health < cfg.feed.visitorLowHealthSnackBelow) return 'LOW_HEALTH_SNACK';
    if (ctx.visitorCountPet >= cfg.feed.visitorDailyPerPet || ctx.visitorCountMine >= cfg.feed.visitorDailyPerVisitorPerPet) return 'DAILY_CAP';
  }
  if (ctx.balance < food.price) return 'INSUFFICIENT_COINS';
  return null;
}
/** 套用食物效果（v1.1：不降低清潔）。 */
export function applyFood(p: PetState, food: Food, at: number, rng: Rng, cfg: GameConfig = GAME): SimEvent[] {
  const events: SimEvent[] = [];
  p.hunger = clamp(p.hunger + food.hunger); p.happiness = clamp(p.happiness + food.happiness); p.health = clamp(p.health + food.health);
  grow(p, 'weight', food.weight); grow(p, 'strength', food.strength); grow(p, 'speed', food.speed); grow(p, 'stamina', food.stamina);
  p.counters.feeds++; if (food.snack) p.counters.snacks++;
  tryPoop(p, at, cfg.poop.afterFeedChance, rng, cfg, events);
  updatePersonality(p);
  return events;
}
export function foodById(id: string): Food | undefined { return FOOD_BY_ID[id]; }

export type OwnerAction = 'sleep' | 'wake' | 'clean' | 'doctor';
export function applyOwnerAction(p: PetState, action: OwnerAction, cfg: GameConfig = GAME): GameErrorCode | null {
  if (p.status === 'dead') return 'PET_DEAD';
  if (p.status === 'egg') return 'PET_EGG';
  if (action === 'wake') { if (!p.sleeping) return 'NOT_SLEEPING'; p.sleeping = false; }
  else if (action === 'sleep' && p.sleeping) return 'ALREADY_SLEEPING';
  else if (p.sleeping) return 'PET_SLEEPING';
  else if (action === 'sleep') { p.sleeping = true; p.counters.sleeps++; grow(p, 'stamina', 0.5); }
  else if (action === 'clean') { p.cleanliness = 100; p.poop = 0; p.dirtySince = null; p.counters.cleans++; }
  else if (action === 'doctor') {
    if (!p.sick && p.health > cfg.doctor.notNeededAbove) return 'NOT_NEEDED';
    p.sick = false; p.health = clamp(p.health + cfg.doctor.healthGain); p.happiness = clamp(p.happiness - cfg.doctor.happinessLoss); p.counters.doctor++;
  } else return 'BAD_REQUEST';
  updatePersonality(p);
  return null;
}
export function checkStairsStart(p: PetState, cfg: GameConfig = GAME): GameErrorCode | null {
  if (p.status === 'dead') return 'PET_DEAD';
  if (p.status === 'egg') return 'PET_EGG';
  if (p.sleeping) return 'PET_SLEEPING';
  if (p.energy < cfg.stairsMinEnergy) return 'TOO_TIRED';
  return null;
}
/** 下樓梯結算（消耗乘 timeScale）。回傳獲得金幣。 */
export function applyStairsResult(p: PetState, floors: number, cfg: GameConfig = GAME): number {
  const ts = cfg.timeScale;
  p.energy = clamp(p.energy - 15 * ts); p.hunger = clamp(p.hunger - 8 * ts);
  p.happiness = clamp(p.happiness + 10 + Math.min(15, Math.floor(floors / 2)));
  grow(p, 'speed', Math.min(2, 0.5 + floors * 0.03)); grow(p, 'weight', -1);
  p.counters.plays++; p.bestFloor = Math.max(p.bestFloor, floors);
  updatePersonality(p);
  return floors; // 單人：1 樓 = ◎1
}
export function revive(p: PetState, now: number, cfg: GameConfig = GAME) {
  p.status = 'alive'; p.health = cfg.revive.health;
  p.hunger = p.happiness = p.energy = p.cleanliness = cfg.revive.stat;
  p.sick = false; p.poop = 0; p.sleeping = false; p.dirtySince = null; p.lastSimulatedAt = now; p.diedAt = null; p.deathCause = null;
}
