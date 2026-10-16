import { createRng, simulate, GAME, stagesDue, stageAt, evolveProgress, CARE_POOL, rollBao, lookKey, resolveLook, type PetState, type SimEvent } from '@chick/engine';
import { clock } from './hours';
import { randomSeed } from './util';
import { sql, type Tx } from './db';
import { notify } from './core';

const ms = (d: Date | null) => (d ? d.getTime() : null);
const dt = (n: number | null) => (n === null ? null : new Date(n));

export function rowToState(r: any): PetState {
  return {
    speciesId: r.species_id, status: r.status, bornAt: ms(r.born_at)!, hatchedAt: ms(r.hatched_at), lastSimulatedAt: ms(r.last_simulated_at)!,
    hunger: r.hunger, happiness: r.happiness, energy: r.energy, cleanliness: r.cleanliness, health: r.health, poop: r.poop,
    lastPoopAt: ms(r.last_poop_at), dirtySince: ms(r.dirty_since), sick: r.sick, sleeping: r.sleeping,
    strength: r.strength, speed: r.speed, stamina: r.stamina, weight: r.weight, personality: r.personality, bestFloor: r.best_floor,
    counters: { ...(r.counters ?? {}) }, diedAt: ms(r.died_at), deathCause: r.death_cause,
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
    bao: row.bao ? { items: row.bao.items as string[], cat: row.bao.cat as string, care: row.bao.care as number } : null,
    bao_at: row.bao_at ? new Date(row.bao_at).getTime() : null, bao_stage: row.bao_stage ?? 0,
    ...evolveInfo(row, s),
    outfits: (row.outfits ?? []) as string[], look: petLook(row),
    died_at: s.diedAt, death_cause: s.deathCause, revived_at: row.revived_at ? row.revived_at.getTime() : null, simulated_at: s.lastSimulatedAt,
  };
}
/** 下一次進化：時間點與開放毫秒進度（只有活著且已孵化的寵物）。 */
function evolveInfo(row: any, s: PetState) {
  const pr = s.status === 'alive' ? evolveProgress(s, clock(), Date.now(), row.bao_stage ?? 0, GAME.bao) : null;
  return { evolve_at: pr?.next_at ?? null, evolve_done_ms: pr?.done_ms ?? null, evolve_need_ms: pr?.need_ms ?? null };
}
export type PublicPet = ReturnType<typeof publicPet>;
/** 畫面要畫的配件（已處理欄位衝突），逗號分隔；空字串 = 沒有配件。 */
export function petLook(row: any): string { return resolveLook(row.bao?.items, row.outfits).join(','); }
/** 給前端畫精靈用的鍵：`species` 或 `species|配件,...` */
export function spriteKey(p: { species: string; look?: string }) { return p.look ? `${p.species}|${p.look}` : p.species; }

/**
 * v1.7 寶：到時間就進化一次（伺服器決定）。種子 = 寵物 id；和其他活著的寵物外觀完全一樣就用 seed+n 重抽（最多 maxRerolls 次）。
 * force = 管理員／開發用，不管時間。row 必須已上鎖；會更新 row.bao。
 */
export async function maybeEvolve(tx: Tx, row: any, s: PetState, now = Date.now(), force = false) {
  if (s.status !== 'alive' || s.hatchedAt === null) return null;
  const have = row.bao_stage ?? 0;
  const due = stagesDue(s, clock(), now, GAME.bao);
  if (!force && due <= have) return null;
  // 離線跨過好幾個門檻：只抽最新那一次，但次數照算
  const stage = force ? Math.max(have + 1, due) : due;
  const prevItems: string[] = row.bao?.items ?? [];
  const prevKey = row.bao ? lookKey(prevItems) : null;
  const avoid = prevItems.filter((id) => !(CARE_POOL as string[]).includes(id)); // 避開上一次的主／副配件
  let look = rollBao(row.id, s, 0, stage, avoid);
  for (let n = 0; n <= GAME.bao.maxRerolls; n++) {
    look = rollBao(row.id, s, n, stage, avoid);
    const k = lookKey(look.items);
    if (k === prevKey) continue;
    const dup = await tx.selectFrom('pets').select('id').where('status', '=', 'alive').where('id', '<>', row.id)
      .where(sql`bao->>'key'`, '=', k).executeTakeFirst();
    if (!dup) break;
  }
  const bao = { ...look, stage, key: lookKey(look.items) };
  const at = stageAt(s, clock(), stage, GAME.bao);
  const when = force || at === null ? now : Math.min(now, at);
  await tx.updateTable('pets').set({ bao: JSON.stringify(bao), bao_at: new Date(when), bao_stage: stage } as any).where('id', '=', row.id).execute();
  row.bao = bao; row.bao_at = new Date(when); row.bao_stage = stage;
  await insertEvents(tx, row.id, [{ type: 'evolve', payload: { ...bao, from: have }, at: when }]);
  const home = await tx.selectFrom('homes').select('id').where('owner_id', '=', row.owner_id).executeTakeFirst();
  if (home) await notify(tx, { t: 'pet', home: home.id, pet: row.id, ev: { type: 'evolve', items: bao.items, stage } });
  return bao;
}

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
  await maybeEvolve(tx, row, s, now);
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
