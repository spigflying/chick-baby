import { applyStairsResult, checkStairsStart, phaseAt, cloneStairs, createStairs, ENGINE_VERSION, setInput, STAIRS_PARAMS, stepStairs, type StairsState } from '@chick/engine';
import type { Db } from './db';
import { changeBalance, lockWallets, notify, runAction, type ReqCtx } from './core';
import { fail } from './errors';
import { insertEvents, lockPet, publicPet, savePet, settle } from './pets';
import { randomSeed, stableHash } from './util';
import { env } from './env';
import { clock } from './hours';

export interface MatchConn { userId: string; send: (msg: unknown) => void }
interface PendingInput { tick: number; seq: number; left: boolean; right: boolean }
export interface Match {
  id: string; userId: string; petId: string; homeId: string; conn: MatchConn; state: StairsState; startAt: number;
  pending: PendingInput[]; lastSeq: number; lastProcessedSeq: number; late: number; ended: boolean;
}
const P = STAIRS_PARAMS;
const TICK_MS = 1000 / P.tickRate;
export const matches = new Map<string, Match>();

export function currentTick(m: Match, now = Date.now()) { return Math.floor((now - m.startAt) / TICK_MS); }

/** 單人下樓梯：伺服器權威模擬。 */
export async function createSolo(db: Db, ctx: ReqCtx, conn: MatchConn, requestId: unknown) {
  const phase = phaseAt(clock(), Date.now());
  if (phase !== 'open') fail(phase === 'closing' ? 'GAME_CLOSING' : 'GAME_CLOSED'); // 19:55 起不能開新局
  for (const m of matches.values()) if (m.userId === ctx.userId && !m.ended) fail('ALREADY_IN_MATCH');
  const seed = randomSeed();
  const res = await runAction(db, ctx, 'stairs.start', requestId, {}, async (tx) => {
    const pet = await tx.selectFrom('pets').select('id').where('owner_id', '=', ctx.userId).where('status', 'in', ['egg', 'alive']).executeTakeFirst();
    if (!pet) fail('NO_PET');
    const row = await lockPet(tx, pet!.id);
    const { state } = await settle(tx, row);
    await savePet(tx, row.id, state);
    const err = checkStairsStart(state); if (err) fail(err);
    const home = await tx.selectFrom('homes').select('id').where('owner_id', '=', ctx.userId).executeTakeFirstOrThrow();
    const m = await tx.insertInto('stair_matches').values({ mode: 'solo', host_user_id: ctx.userId, status: 'playing', instance_id: env.instanceId, seed, engine_version: ENGINE_VERSION, config: JSON.stringify(P), started_at: new Date() }).returning('id').executeTakeFirstOrThrow();
    await tx.insertInto('stair_match_players').values({ match_id: m.id, user_id: ctx.userId, pet_id: row.id }).execute();
    return { match_id: m.id as string, pet_id: row.id as string, home_id: home.id as string, speed: state.speed, stamina: state.stamina, species: state.speciesId, seed };
  });
  if ((res as any).replayed) fail('IDEMPOTENCY_REPLAY');
  const players = [{ petId: res.pet_id, speed: res.speed, stamina: res.stamina }];
  const m: Match = { id: res.match_id, userId: ctx.userId, petId: res.pet_id, homeId: res.home_id, conn, state: createStairs(res.seed, players), startAt: Date.now() + 500,
    pending: [], lastSeq: 0, lastProcessedSeq: 0, late: 0, ended: false };
  matches.set(m.id, m);
  conn.send({ type: 'match.started', match_id: m.id, seed: res.seed, engine_version: ENGINE_VERSION, config_hash: stableHash(P), start_tick: 0,
    server_time_at_start: m.startAt, params: P, players: [{ user_id: ctx.userId, pet_id: res.pet_id, species: res.species, speed: res.speed, stamina: res.stamina }] });
  return m;
}

export function handleInput(m: Match, msg: any) {
  const seq = Number(msg.seq), tick = Number(msg.tick);
  if (!Number.isInteger(seq) || !Number.isInteger(tick) || seq <= m.lastSeq) return { error: 'BAD_INPUT' };
  const now = currentTick(m);
  if (tick > now + P.inputBufferTicks + 15) return { error: 'INPUT_TOO_EARLY' };
  m.lastSeq = seq;
  let at = tick;
  if (tick <= m.state.tick) { at = m.state.tick + 1; m.late++; }
  m.pending.push({ tick: at, seq, left: !!msg.left, right: !!msg.right });
  return { late: at !== tick };
}

let db: Db | null = null;
export function startStairsLoop(database: Db) {
  db = database;
  const timer = setInterval(() => {
    const now = Date.now();
    for (const m of matches.values()) {
      if (m.ended) continue;
      const target = currentTick(m, now);
      while (m.state.tick < target && !m.state.over) {
        const next = m.state.tick + 1;
        m.pending.sort((a, b) => a.tick - b.tick || a.seq - b.seq);
        while (m.pending.length && m.pending[0].tick <= next) { const i = m.pending.shift()!; setInput(m.state, m.petId, i.left, i.right); m.lastProcessedSeq = i.seq; }
        stepStairs(m.state);
        if (m.state.tick % P.snapshotEvery === 0 || m.state.over) {
          m.conn.send({ type: 'match.snapshot', match_id: m.id, tick: m.state.tick, state: m.state, last_processed_seq: m.lastProcessedSeq, late: m.late });
        }
      }
      if (m.state.over) void finish(m, 'over');
    }
  }, TICK_MS / 2);
  timer.unref();
  return timer;
}

export async function finish(m: Match, reason: 'over' | 'quit') {
  if (m.ended || !db) return; m.ended = true;
  const pl = m.state.players[0]; const floors = pl.floor;
  try {
    const result = await db.transaction().execute(async (tx) => {
      await lockWallets(tx, [m.userId]);
      const row = await lockPet(tx, m.petId);
      const { state } = await settle(tx, row);
      let coins = 0;
      if (state.status === 'alive') coins = applyStairsResult(state, floors);
      await savePet(tx, m.petId, state);
      const balance = coins > 0 ? await changeBalance(tx, m.userId, coins, 'stairs_solo', { type: 'stair_match', id: m.id }) :
        (await tx.selectFrom('wallets').select('balance').where('user_id', '=', m.userId).executeTakeFirstOrThrow()).balance;
      await insertEvents(tx, m.petId, [{ type: 'stairs_solo', actor: m.userId, payload: { match_id: m.id, floors, coins, reason } }]);
      await tx.updateTable('stair_matches').set({ status: 'done', ended_at: new Date() }).where('id', '=', m.id).execute();
      await tx.updateTable('stair_match_players').set({ rank: 1, floors, eliminated_at_tick: pl.diedAtTick ?? m.state.tick, coins_awarded: coins }).where('match_id', '=', m.id).execute();
      await tx.insertInto('audit_log').values({ user_id: m.userId, action: 'stairs.finish', result: 'ok', target_type: 'stair_match', target_id: m.id, detail: JSON.stringify({ floors, coins, reason, late: m.late }) }).execute();
      await notify(tx, { t: 'pet', home: m.homeId, pet: m.petId, ev: { type: 'stairs_solo', floors } });
      return { coins, balance, pet: publicPet(row, state) };
    });
    m.conn.send({ type: 'match.ended', match_id: m.id, floors, coins: result.coins, balance: result.balance, reason, pet: result.pet, final_tick: m.state.tick });
  } catch (e) {
    console.error('stairs finish failed', e);
    m.conn.send({ type: 'error', code: 'INTERNAL', message: 'stairs settlement failed' });
  } finally { setTimeout(() => matches.delete(m.id), 5000); }
}

/** SIGTERM：進行中的比賽標記 aborted（不發獎勵、不扣精力）。 */
export async function abortAll(database: Db) {
  for (const m of matches.values()) {
    if (m.ended) continue; m.ended = true;
    await database.updateTable('stair_matches').set({ status: 'aborted', ended_at: new Date() }).where('id', '=', m.id).execute().catch(() => {});
    m.conn.send({ type: 'match.ended', match_id: m.id, aborted: true, floors: m.state.players[0].floor, coins: 0 });
  }
}
export const snapshotOf = (m: Match) => cloneStairs(m.state);
