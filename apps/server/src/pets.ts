import { createRng, simulate, GAME, type PetState, type SimEvent } from '@chick/engine';
import { clock } from './hours';
import { randomSeed } from './util';
import type { Tx } from './db';

const ms = (d: Date | null) => (d ? d.getTime() : null);
const dt = (n: number | null) => (n === null ? null : new Date(n));

export function rowToState(r: any): PetState {
  return {
    speciesId: r.species_id, status: r.status, bornAt: ms(r.born_at)!, hatchedAt: ms(r.hatched_at), lastSimulatedAt: ms(r.last_simulated_at)!,
    hunger: r.hunger, happiness: r.happiness, energy: r.energy, cleanliness: r.cleanliness, health: r.health, poop: r.poop,
    lastPoopAt: ms(r.last_poop_at), dirtySince: ms(r.dirty_since), sick: r.sick, sleeping: r.sleeping,
    strength: r.strength, speed: r.speed, stamina: r.stamina, weight: r.weight, personality: r.personality, bestFloor: r.best_floor,
    counters: r.counters, diedAt: ms(r.died_at), deathCause: r.death_cause,
  };
}
export function stateToRow(s: PetState) {
  return {
    species_id: s.speciesId, status: s.status, born_at: dt(s.bornAt), hatched_at: dt(s.hatchedAt), last_simulated_at: dt(s.lastSimulatedAt),
    hunger: s.hunger, happiness: s.happiness, energy: s.energy, cleanliness: s.cleanliness, health: s.health, poop: s.poop,
    last_poop_at: dt(s.lastPoopAt), dirty_since: dt(s.dirtySince), sick: s.sick, sleeping: s.sleeping,
    strength: s.strength, speed: s.speed, stamina: s.stamina, weight: s.weight, personality: s.personality, best_floor: s.bestFloor,
    counters: JSON.stringify(s.counters), died_at: dt(s.diedAt), death_cause: s.deathCause,
  };
}
const r1 = (v: number) => Math.round(v * 10) / 10;
/** 對外的寵物資料（不含任何使用者私密資料）。 */
export function publicPet(row: any, s: PetState) {
  return {
    id: row.id, owner_id: row.owner_id, name: row.name, species: s.speciesId, status: s.status,
    born_at: s.bornAt, hatched_at: s.hatchedAt, hatch_at: clock().addOpen(s.bornAt, GAME.eggSeconds * 1000),
    hunger: r1(s.hunger), happiness: r1(s.happiness), energy: r1(s.energy), cleanliness: r1(s.cleanliness), health: r1(s.health),
    poop: s.poop, sick: s.sick, sleeping: s.sleeping,
    strength: s.strength, speed: s.speed, stamina: s.stamina, weight: s.weight, personality: s.personality, best_floor: s.bestFloor,
    died_at: s.diedAt, death_cause: s.deathCause, revived_at: row.revived_at ? row.revived_at.getTime() : null, simulated_at: s.lastSimulatedAt,
  };
}
export type PublicPet = ReturnType<typeof publicPet>;

export async function lockPet(tx: Tx, petId: string): Promise<any> {
  return tx.selectFrom('pets').selectAll().where('id', '=', petId).forUpdate().executeTakeFirst();
}
export async function insertEvents(tx: Tx, petId: string, events: { type: string; actor?: string | null; payload?: unknown; at?: number }[]) {
  if (!events.length) return;
  await tx.insertInto('pet_events').values(events.map((e) => ({
    pet_id: petId, actor_user_id: e.actor ?? null, type: e.type, payload: JSON.stringify(e.payload ?? {}), created_at: e.at ? new Date(e.at) : new Date(),
  }))).execute();
}
/** 結算到現在（離線衰減），寫入系統事件；row 必須已上鎖。 */
export async function settle(tx: Tx, row: any, now = Date.now()): Promise<{ state: PetState; events: SimEvent[] }> {
  const s = rowToState(row);
  const events = simulate(s, now, createRng(randomSeed()), GAME, clock());
  await insertEvents(tx, row.id, events.map((e) => ({ type: e.type, payload: e.payload, at: e.at })));
  return { state: s, events };
}
export async function savePet(tx: Tx, id: string, s: PetState, extra: Record<string, unknown> = {}) {
  await tx.updateTable('pets').set((eb: any) => ({ ...stateToRow(s), ...extra, version: eb('version', '+', 1) })).where('id', '=', id).execute();
}
/** 讀取並結算寵物（短 transaction）。 */
export async function loadSettledPet(tx: Tx, petId: string) {
  const row = await lockPet(tx, petId);
  if (!row) return null;
  const { state, events } = await settle(tx, row);
  if (events.length || state.lastSimulatedAt !== row.last_simulated_at.getTime()) await savePet(tx, row.id, state);
  return { row, state, events };
}
