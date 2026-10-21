/**
 * 賽車模式（伺服器）：個人檔案／車庫（REST）＋即時比賽（WS，伺服器權威，空位補 AI）。
 * 原型限制：比賽房間只存在單一執行個體的記憶體（同一個執行個體上的玩家才會配到同一場）。
 */
import { randomUUID } from 'node:crypto';
import {
  CARS, carById, createRace, NITRO_PER_RACE, PART_KINDS, PARTS, partPrice, POINTS, prizeFor, RACE_SLOTS, RACE_TICK_RATE, raceRanking, raceTimeMs,
  repairCost, setRaceInput, stepRace, TRACKS, trackById, unlockAfter, type PartKind, type Parts, type RaceState, STOCK_PARTS,
} from '@chick/engine';
import type { Db } from './db';
import { audit, type ReqCtx } from './core';
import { fail } from './errors';
import { randomSeed } from './util';

export interface RaceConn { userId: string; name: string; send: (m: unknown) => void }
const AI_NAMES = ['小黃', '阿飛', '雷霆', '閃電', '老鷹', '疾風', '白鯨', '火狐'];
const lobbyMs = () => Number(process.env.RACE_LOBBY_MS) || 6000;
const MAX_HUMANS = 4;

// ---------- 個人檔案／車庫 ----------
export async function getProfile(db: Db, userId: string) {
  await db.insertInto('race_profiles').values({ user_id: userId }).onConflict((oc: any) => oc.column('user_id').doNothing()).execute();
  const p: any = await db.selectFrom('race_profiles').selectAll().where('user_id', '=', userId).executeTakeFirstOrThrow();
  return { ...p, parts: { ...STOCK_PARTS, ...(p.parts ?? {}) } as Parts, repair_cost: repairCost(p.damage, p.parts) };
}
export function raceCatalog() {
  return { parts: PARTS, cars: CARS, tracks: TRACKS.map(({ pieces, ...t }) => t), nitro: NITRO_PER_RACE, slots: RACE_SLOTS };
}
export async function buyPart(db: Db, ctx: ReqCtx, kind: unknown, tier: unknown) {
  if (!PART_KINDS.includes(kind as PartKind)) fail('BAD_REQUEST');
  const k = kind as PartKind, t = Number(tier); const price = partPrice(k, t);
  if (price === null || !Number.isInteger(t)) fail('BAD_REQUEST');
  await getProfile(db, ctx.userId);
  return db.transaction().execute(async (tx) => {
    const p = await tx.selectFrom('race_profiles').selectAll().where('user_id', '=', ctx.userId).forUpdate().executeTakeFirstOrThrow();
    const parts = { ...STOCK_PARTS, ...p.parts } as Parts;
    if (parts[k] >= t) fail('ALREADY_OWNED');
    if (t !== parts[k] + 1) fail('TIER_LOCKED'); // 一級一級升
    if (p.cash < price!) fail('INSUFFICIENT_RACE_CASH');
    parts[k] = t;
    await tx.updateTable('race_profiles').set({ cash: p.cash - price!, parts: JSON.stringify(parts), updated_at: new Date() }).where('user_id', '=', ctx.userId).execute();
    await audit(tx, ctx, 'race.buy_part', 'ok', { detail: { kind: k, tier: t, price } });
    return getProfileTx(tx, ctx.userId);
  });
}
export async function buyCar(db: Db, ctx: ReqCtx, carId: unknown) {
  const c = CARS.find((x) => x.id === carId); if (!c) fail('BAD_REQUEST');
  await getProfile(db, ctx.userId);
  return db.transaction().execute(async (tx) => {
    const p = await tx.selectFrom('race_profiles').selectAll().where('user_id', '=', ctx.userId).forUpdate().executeTakeFirstOrThrow();
    if (p.cars.includes(c!.id)) { await tx.updateTable('race_profiles').set({ car: c!.id }).where('user_id', '=', ctx.userId).execute(); return getProfileTx(tx, ctx.userId); }
    if (p.cash < c!.price) fail('INSUFFICIENT_RACE_CASH');
    await tx.updateTable('race_profiles').set({ cash: p.cash - c!.price, cars: [...p.cars, c!.id], car: c!.id, updated_at: new Date() }).where('user_id', '=', ctx.userId).execute();
    await audit(tx, ctx, 'race.buy_car', 'ok', { detail: { car: c!.id, price: c!.price } });
    return getProfileTx(tx, ctx.userId);
  });
}
export async function repair(db: Db, ctx: ReqCtx) {
  await getProfile(db, ctx.userId);
  return db.transaction().execute(async (tx) => {
    const p = await tx.selectFrom('race_profiles').selectAll().where('user_id', '=', ctx.userId).forUpdate().executeTakeFirstOrThrow();
    const full = repairCost(p.damage, p.parts); if (full <= 0) fail('NOTHING_TO_REPAIR');
    // 錢不夠就修到錢夠的程度
    const per = full / p.damage, fix = Math.min(p.damage, Math.floor(p.cash / per));
    if (fix <= 0) fail('INSUFFICIENT_RACE_CASH');
    const cost = Math.ceil(fix * per);
    await tx.updateTable('race_profiles').set({ cash: p.cash - cost, damage: Math.max(0, p.damage - fix), updated_at: new Date() }).where('user_id', '=', ctx.userId).execute();
    await audit(tx, ctx, 'race.repair', 'ok', { detail: { fixed: fix, cost } });
    return getProfileTx(tx, ctx.userId);
  });
}
async function getProfileTx(tx: any, userId: string) {
  const p = await tx.selectFrom('race_profiles').selectAll().where('user_id', '=', userId).executeTakeFirstOrThrow();
  return { ...p, parts: { ...STOCK_PARTS, ...p.parts }, repair_cost: repairCost(p.damage, p.parts) };
}
export async function raceLeaderboard(db: Db, track: string) {
  if (!trackById(track)) fail('NOT_FOUND');
  const best = await db.selectFrom('race_results').innerJoin('users', 'users.id', 'race_results.user_id')
    .select(['users.display_name as name', (eb: any) => eb.fn.min('race_results.time_ms').as('time_ms')])
    .where('race_results.track', '=', track).where('race_results.time_ms', 'is not', null).groupBy('users.display_name').orderBy('time_ms').limit(10).execute();
  const champ = await db.selectFrom('race_profiles').innerJoin('users', 'users.id', 'race_profiles.user_id')
    .select(['users.display_name as name', 'race_profiles.points', 'race_profiles.wins']).orderBy('race_profiles.points', 'desc').limit(10).execute();
  return { track, best, championship: champ };
}

// ---------- 即時比賽 ----------
interface Seat { userId: string; name: string; conn: RaceConn | null }
interface Room { id: string; track: string; seats: Seat[]; startsAt: number; state: RaceState | null; startAt: number; ended: boolean; seq: Map<string, number> }
const lobbies = new Map<string, Room>(); // track → 等待中的房間
const rooms = new Map<string, Room>();
const byUser = new Map<string, Room>();
let db: Db | null = null;

export const inRace = (userId: string) => byUser.has(userId);
const sendAll = (r: Room, m: unknown) => { for (const s of r.seats) s.conn?.send(m); };
const lobbyMsg = (r: Room) => ({ type: 'race.lobby', race_id: r.id, track: r.track, starts_at: r.startsAt, players: r.seats.map((s) => ({ user_id: s.userId, name: s.name })) });

export async function joinRace(database: Db, conn: RaceConn, track: unknown) {
  db = database;
  const t = trackById(String(track)); if (!t) fail('BAD_REQUEST');
  if (byUser.has(conn.userId)) fail('ALREADY_IN_MATCH');
  const p = await getProfile(database, conn.userId);
  const idx = TRACKS.indexOf(t!);
  if (idx >= p.unlocked) fail('TRACK_LOCKED');
  if (p.damage >= 100) fail('CAR_WRECKED');
  let r = lobbies.get(t!.id);
  if (!r || r.seats.length >= MAX_HUMANS || Date.now() > r.startsAt - 500) {
    r = { id: randomUUID(), track: t!.id, seats: [], startsAt: Date.now() + lobbyMs(), state: null, startAt: 0, ended: false, seq: new Map() };
    lobbies.set(t!.id, r); rooms.set(r.id, r);
    setTimeout(() => start(r!), lobbyMs());
  }
  r.seats.push({ userId: conn.userId, name: conn.name, conn }); byUser.set(conn.userId, r);
  sendAll(r, lobbyMsg(r));
  return r.id;
}
async function start(r: Room) {
  if (lobbies.get(r.track) === r) lobbies.delete(r.track);
  const live = r.seats.filter((s) => s.conn);
  if (!live.length || !db) { rooms.delete(r.id); return; }
  const profs = await Promise.all(r.seats.map((s) => getProfile(db!, s.userId)));
  const humans = r.seats.map((s, i) => ({ id: s.userId, name: s.name, car: profs[i].car, parts: profs[i].parts, damage: profs[i].damage }));
  const ai = Array.from({ length: RACE_SLOTS - humans.length }, (_, i) => ({ id: `ai${i}`, name: AI_NAMES[(i + r.track.length) % AI_NAMES.length], ai: true, car: CARS[(i + 1) % CARS.length].id }));
  // 發車順序：AI 在前、玩家在後（像經典賽車一樣從後面追上去）
  const seed = randomSeed();
  r.state = createRace(seed, r.track, [...ai, ...humans]);
  r.startAt = Date.now();
  sendAll(r, { type: 'race.started', race_id: r.id, track: r.track, seed, cars: r.state.cars.map((c) => ({ id: c.id, name: c.name, ai: c.ai, car: c.car, color: c.color })), laps: r.state.laps, len: r.state.len, tick_rate: RACE_TICK_RATE });
}
export function raceInput(userId: string, msg: any) {
  const r = byUser.get(userId); if (!r?.state || r.ended) return;
  const seq = Number(msg.seq) || 0; if (seq <= (r.seq.get(userId) ?? 0)) return; r.seq.set(userId, seq);
  setRaceInput(r.state, userId, msg);
}
export function leaveRace(userId: string) {
  const r = byUser.get(userId); if (!r) return;
  const s = r.seats.find((x) => x.userId === userId); if (s) s.conn = null;
  if (r.state) setRaceInput(r.state, userId, {}); // 離開＝放開油門（比賽結束仍會結算成績與損傷）
  else { r.seats = r.seats.filter((x) => x.userId !== userId); byUser.delete(userId); sendAll(r, lobbyMsg(r)); }
}
const snap = (r: Room) => ({ type: 'race.snap', race_id: r.id, tick: r.state!.tick, countdown: r.state!.countdown, cars: r.state!.cars.map((c) => [c.id, +c.z.toFixed(2), +c.x.toFixed(3), +c.speed.toFixed(2), +c.damage.toFixed(1), c.nitro, c.nitroT, c.finishedTick, c.hit]) });
export function startRaceLoop(database: Db) {
  db = database;
  const timer = setInterval(() => {
    const now = Date.now();
    for (const r of rooms.values()) {
      if (!r.state || r.ended) continue;
      const target = Math.floor(((now - r.startAt) * RACE_TICK_RATE) / 1000);
      while (r.state.tick < target && !r.state.over) { stepRace(r.state); if (r.state.tick % 2 === 0) sendAll(r, snap(r)); }
      if (r.state.over) void finish(r);
    }
  }, 1000 / RACE_TICK_RATE / 2);
  timer.unref();
  return timer;
}
async function finish(r: Room) {
  if (r.ended || !db || !r.state) return; r.ended = true;
  sendAll(r, snap(r));
  const t = trackById(r.track)!, idx = TRACKS.indexOf(t), rank = raceRanking(r.state);
  const results: any[] = [];
  const humans = r.seats.length;
  for (const s of r.seats) {
    const car = r.state.cars.find((c) => c.id === s.userId)!; const pos = rank.indexOf(car) + 1;
    const prize = car.finishedTick !== null ? prizeFor(t, pos) : 0, time = raceTimeMs(r.state, car);
    try {
      await db.transaction().execute(async (tx) => {
        const p = await tx.selectFrom('race_profiles').selectAll().where('user_id', '=', s.userId).forUpdate().executeTakeFirstOrThrow();
        const unlocked = unlockAfter(pos) && car.finishedTick !== null && idx + 2 > p.unlocked ? Math.min(TRACKS.length, idx + 2) : p.unlocked;
        await tx.updateTable('race_profiles').set({ cash: p.cash + prize, damage: Math.min(100, car.damage), unlocked, points: p.points + (POINTS[pos - 1] ?? 0), races: p.races + 1, wins: p.wins + (pos === 1 ? 1 : 0), updated_at: new Date() }).where('user_id', '=', s.userId).execute();
        await tx.insertInto('race_results').values({ race_id: r.id, track: r.track, user_id: s.userId, rank: pos, time_ms: time, prize, damage: car.damage, humans }).execute();
        results.push({ user_id: s.userId, rank: pos, prize, time_ms: time, damage: car.damage, unlocked, cash: p.cash + prize, new_unlock: unlocked > p.unlocked ? TRACKS[unlocked - 1]?.id ?? null : null });
      });
    } catch (e) { console.error('race settle failed', e); }
  }
  const ranking = rank.map((c, i) => ({ id: c.id, name: c.name, ai: c.ai, rank: i + 1, time_ms: raceTimeMs(r.state!, c) }));
  for (const s of r.seats) s.conn?.send({ type: 'race.ended', race_id: r.id, track: r.track, ranking, me: results.find((x) => x.user_id === s.userId) ?? null });
  for (const s of r.seats) byUser.delete(s.userId);
  setTimeout(() => rooms.delete(r.id), 5000);
}
/** 測試用：把比賽直接模擬到結束（等同時間快轉） */
export async function fastForwardRace(raceId: string, drive?: (s: RaceState) => void) {
  const r = rooms.get(raceId); if (!r?.state) throw new Error('no race');
  while (!r.state.over) { drive?.(r.state); stepRace(r.state); }
  await finish(r);
}
export function abortRaces() { for (const r of rooms.values()) { r.ended = true; sendAll(r, { type: 'race.ended', race_id: r.id, aborted: true }); for (const s of r.seats) byUser.delete(s.userId); } }
export { carById };
