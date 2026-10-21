/**
 * 賽車模式（伺服器）v5：檔案／車庫／換匯／賽季（REST）＋即時比賽（WS，伺服器權威，20 台車、空位補電腦）。
 * 公開房間：同一條賽道的等待室；私人房間：房號邀請、房主開賽。
 * 原型限制：房間只存在單一執行個體的記憶體。
 */
import { randomUUID, randomInt } from 'node:crypto';
import { sql } from 'kysely';
import {
  CARS, COUNTRIES, EXCHANGE, ME, PAINTS, PART_KINDS, PARTS, partPrice, RACE_SLOTS, RACE_TICK_RATE, TRACKS, condition, createRace, cupTrack, fillField,
  newCup, normParts, pointsFor, prizeFor, raceRanking, raceTimeMs, seasonOf, setRaceInput, settleCup, stepRace, trackById, type PartKind, type RaceState,
} from '@chick/engine';
import type { Db } from './db';
import { audit, changeBalance, lockWallets, type ReqCtx } from './core';
import { fail } from './errors';
import { randomSeed } from './util';
import { clock } from './hours';

export interface RaceConn { userId: string; name: string; send: (m: unknown) => void }
const lobbyMs = () => Number(process.env.RACE_LOBBY_MS) || 6000;
const MAX_HUMANS = 8;
export const CLOSING_GUARD_MS = 8 * 60_000; // 關門前 8 分鐘不開新比賽（最長比賽＋等待時間）
const PRIVATE_WAIT_MS = 120_000;

// ---------- 檔案（含賽季換季） ----------
async function ensure(db: any, userId: string) {
  await db.insertInto('race_profiles').values({ user_id: userId, season: seasonOf(Date.now()) }).onConflict((oc: any) => oc.column('user_id').doNothing()).execute();
}
/** 讀檔並在換月時結算上一季：積分、勝場、解鎖、錦標賽進度歸零；獎金、零件、車款保留。 */
async function loadForUpdate(tx: any, userId: string) {
  const p: any = await tx.selectFrom('race_profiles').selectAll().where('user_id', '=', userId).forUpdate().executeTakeFirstOrThrow();
  const now = seasonOf(Date.now());
  if (p.season !== now) {
    await tx.insertInto('race_seasons').values({ season: p.season, user_id: userId, points: p.points, wins: p.wins, races: p.races, unlocked: p.unlocked }).onConflict((oc: any) => oc.columns(['season', 'user_id']).doNothing()).execute();
    Object.assign(p, { season: now, points: 0, wins: 0, races: 0, unlocked: 1, cup: newCup(0) });
    await tx.updateTable('race_profiles').set({ season: now, points: 0, wins: 0, races: 0, unlocked: 1, cup: JSON.stringify(newCup(0)), updated_at: new Date() }).where('user_id', '=', userId).execute();
  }
  p.parts = normParts(p.parts); p.cup = p.cup?.points ? p.cup : newCup(0);
  return p;
}
const view = (p: any) => ({ cash: p.cash, parts: p.parts, car: p.car, cars: p.cars, paint: p.paint, season: p.season, unlocked: p.unlocked, cup: p.cup, cup_track: cupTrack(p.cup)?.id ?? null, points: p.points, races: p.races, wins: p.wins });
const tx = <T>(db: Db, f: (t: any) => Promise<T>) => (db as any).transaction().execute(f) as Promise<T>;
export async function getProfile(db: Db, userId: string) { await ensure(db, userId); return tx(db, async (t) => view(await loadForUpdate(t, userId))); }
export function raceCatalog() {
  return { parts: PARTS, cars: CARS, paints: PAINTS, countries: COUNTRIES, tracks: TRACKS.map(({ pieces, ...t }) => t), slots: RACE_SLOTS, exchange: EXCHANGE, closing_guard_ms: CLOSING_GUARD_MS };
}
export async function buyPart(db: Db, ctx: ReqCtx, kind: unknown, tier: unknown) {
  if (!PART_KINDS.includes(kind as PartKind)) fail('BAD_REQUEST');
  const k = kind as PartKind, tr = Number(tier), price = partPrice(k, tr);
  if (price === null || !Number.isInteger(tr)) fail('BAD_REQUEST');
  await ensure(db, ctx.userId);
  return tx(db, async (t) => {
    const p = await loadForUpdate(t, ctx.userId);
    if (p.parts[k] >= tr) fail('ALREADY_OWNED');
    if (tr !== p.parts[k] + 1) fail('TIER_LOCKED');
    if (p.cash < price!) fail('INSUFFICIENT_RACE_CASH');
    p.parts[k] = tr; p.cash -= price!;
    await t.updateTable('race_profiles').set({ cash: p.cash, parts: JSON.stringify(p.parts), updated_at: new Date() }).where('user_id', '=', ctx.userId).execute();
    await audit(t, ctx, 'race.buy_part', 'ok', { detail: { kind: k, tier: tr, price } });
    return view(p);
  });
}
export async function buyCar(db: Db, ctx: ReqCtx, carId: unknown, paint?: unknown) {
  const c = CARS.find((x) => x.id === carId); if (!c) fail('BAD_REQUEST');
  await ensure(db, ctx.userId);
  return tx(db, async (t) => {
    const p = await loadForUpdate(t, ctx.userId);
    if (!p.cars.includes(c!.id)) {
      if (p.cash < c!.price) fail('INSUFFICIENT_RACE_CASH');
      p.cash -= c!.price; p.cars = [...p.cars, c!.id];
      await audit(t, ctx, 'race.buy_car', 'ok', { detail: { car: c!.id, price: c!.price } });
    }
    p.car = c!.id;
    if (paint !== undefined) { const pi = Number(paint); if (!Number.isInteger(pi) || pi < 0 || pi >= PAINTS) fail('BAD_REQUEST'); p.paint = pi; }
    await t.updateTable('race_profiles').set({ cash: p.cash, cars: p.cars, car: p.car, paint: p.paint, updated_at: new Date() }).where('user_id', '=', ctx.userId).execute();
    return view(p);
  });
}
/** 換匯：in＝金幣換賽車獎金（1 → $500），out＝獎金換金幣（$1000 → 1）；每個方向每天（台北日）最多 50 枚金幣。 */
export async function exchange(db: Db, ctx: ReqCtx, dir: unknown, coins: unknown) {
  const n = Number(coins); if (!Number.isInteger(n) || n < 1 || n > EXCHANGE.dailyCapCoins || (dir !== 'in' && dir !== 'out')) fail('BAD_REQUEST');
  await ensure(db, ctx.userId);
  return tx(db, async (t) => {
    await lockWallets(t, [ctx.userId]);
    const p = await loadForUpdate(t, ctx.userId);
    const reason = dir === 'in' ? 'race_exchange_in' : 'race_exchange_out';
    const used = await sql<{ n: number }>`SELECT COALESCE(SUM(ABS(delta)),0)::int AS n FROM coin_ledger WHERE user_id = ${ctx.userId} AND reason = ${reason}
      AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei'`.execute(t).then((r) => r.rows[0].n);
    if (used + n > EXCHANGE.dailyCapCoins) fail('EXCHANGE_CAP');
    const ref = { type: 'race_exchange', id: randomUUID() };
    let balance: number;
    if (dir === 'in') { balance = await changeBalance(t, ctx.userId, -n, reason, ref); p.cash += n * EXCHANGE.coinToCash; }
    else { if (p.cash < n * EXCHANGE.cashPerCoin) fail('INSUFFICIENT_RACE_CASH'); p.cash -= n * EXCHANGE.cashPerCoin; balance = await changeBalance(t, ctx.userId, n, reason, ref); }
    await t.updateTable('race_profiles').set({ cash: p.cash, updated_at: new Date() }).where('user_id', '=', ctx.userId).execute();
    await audit(t, ctx, 'race.exchange', 'ok', { detail: { dir, coins: n } });
    return { profile: view(p), balance, used_today: used + n };
  });
}
export async function raceLeaderboard(db: Db, track: string) {
  if (!trackById(track)) fail('NOT_FOUND');
  const season = seasonOf(Date.now()), d = db as any;
  const best = await d.selectFrom('race_results').innerJoin('users', 'users.id', 'race_results.user_id')
    .select(['users.display_name as name', (eb: any) => eb.fn.min('race_results.time_ms').as('time_ms')])
    .where('race_results.track', '=', track).where('race_results.season', '=', season).where('race_results.time_ms', 'is not', null).groupBy('users.display_name').orderBy('time_ms').limit(10).execute();
  const champ = await d.selectFrom('race_profiles').innerJoin('users', 'users.id', 'race_profiles.user_id')
    .select(['users.display_name as name', 'race_profiles.points', 'race_profiles.wins', 'race_profiles.unlocked']).where('race_profiles.season', '=', season).orderBy('race_profiles.points', 'desc').limit(10).execute();
  return { season, track, best, championship: champ };
}

// ---------- 即時比賽 ----------
interface Seat { userId: string; name: string; conn: RaceConn | null; car: string; paint: number; parts: any }
interface Room { id: string; track: string; seats: Seat[]; startsAt: number; state: RaceState | null; startAt: number; ended: boolean; seq: Map<string, number>; code: string | null; host: string | null; timer: NodeJS.Timeout | null }
const lobbies = new Map<string, Room>();
const privates = new Map<string, Room>();
const rooms = new Map<string, Room>();
const byUser = new Map<string, Room>();
let db: Db | null = null;
export const inRace = (userId: string) => byUser.has(userId);
const sendAll = (r: Room, m: unknown) => { for (const s of r.seats) s.conn?.send(m); };
const lobbyMsg = (r: Room) => ({ type: 'race.lobby', race_id: r.id, track: r.track, starts_at: r.startsAt, code: r.code, host: r.host, private: !!r.code, players: r.seats.map((s) => ({ user_id: s.userId, name: s.name, car: s.car })) });
/** 關門前 8 分鐘不能開新比賽 */
function guardClosing(now = Date.now()) { const st = clock().status(now); if (st.open && st.closes_at !== null && st.closes_at - now < CLOSING_GUARD_MS) fail('RACE_CLOSING'); }
async function seatFor(database: Db, conn: RaceConn, trackId: string): Promise<Seat> {
  const p = await getProfile(database, conn.userId);
  const t = trackById(trackId)!;
  if (t.countryIdx >= p.unlocked) fail('TRACK_LOCKED');
  return { userId: conn.userId, name: conn.name, conn, car: p.car, paint: p.paint, parts: p.parts };
}
function newRoom(track: string, code: string | null, host: string | null, wait: number): Room {
  const r: Room = { id: randomUUID(), track, seats: [], startsAt: Date.now() + wait, state: null, startAt: 0, ended: false, seq: new Map(), code, host, timer: null };
  rooms.set(r.id, r); r.timer = setTimeout(() => void start(r), wait); return r;
}
export async function joinRace(database: Db, conn: RaceConn, track: unknown) {
  db = database;
  const t = trackById(String(track)); if (!t) fail('BAD_REQUEST');
  if (byUser.has(conn.userId)) fail('ALREADY_IN_MATCH');
  guardClosing();
  const seat = await seatFor(database, conn, t!.id);
  let r = lobbies.get(t!.id);
  if (!r || r.seats.length >= MAX_HUMANS || Date.now() > r.startsAt - 500) { r = newRoom(t!.id, null, null, lobbyMs()); lobbies.set(t!.id, r); }
  r.seats.push(seat); byUser.set(conn.userId, r);
  sendAll(r, lobbyMsg(r));
  return r.id;
}
/** 私人房：建立（拿到 6 碼房號）→ 朋友用房號加入 → 房主按開始（或 2 分鐘後自動開）。 */
export async function createPrivate(database: Db, conn: RaceConn, track: unknown) {
  db = database;
  const t = trackById(String(track)); if (!t) fail('BAD_REQUEST');
  if (byUser.has(conn.userId)) fail('ALREADY_IN_MATCH');
  guardClosing();
  const seat = await seatFor(database, conn, t!.id);
  let code = ''; do code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join(''); while (privates.has(code));
  const r = newRoom(t!.id, code, conn.userId, PRIVATE_WAIT_MS); privates.set(code, r);
  r.seats.push(seat); byUser.set(conn.userId, r); sendAll(r, lobbyMsg(r));
  return code;
}
export async function joinPrivate(database: Db, conn: RaceConn, code: unknown) {
  db = database;
  const r = privates.get(String(code ?? '').toUpperCase()); if (!r || r.state) fail('ROOM_NOT_FOUND');
  if (byUser.has(conn.userId)) fail('ALREADY_IN_MATCH');
  if (r!.seats.length >= MAX_HUMANS) fail('ROOM_FULL');
  guardClosing();
  // 私人房允許跑還沒解鎖的賽道（朋友帶你跑）；錦標賽只算自己目前那一站
  const p = await getProfile(database, conn.userId);
  r!.seats.push({ userId: conn.userId, name: conn.name, conn, car: p.car, paint: p.paint, parts: p.parts }); byUser.set(conn.userId, r!);
  sendAll(r!, lobbyMsg(r!));
  return r!.id;
}
export function startPrivate(userId: string) {
  const r = byUser.get(userId); if (!r || !r.code || r.state) fail('ROOM_NOT_FOUND');
  if (r!.host !== userId) fail('FORBIDDEN');
  guardClosing();
  if (r!.timer) clearTimeout(r!.timer); r!.startsAt = Date.now() + 3000; sendAll(r!, lobbyMsg(r!)); r!.timer = setTimeout(() => void start(r!), 3000);
}
export const privateRoomOf = (userId: string) => { const r = byUser.get(userId); return r?.code && !r.state ? { code: r.code, track: r.track } : null; };

async function start(r: Room) {
  if (lobbies.get(r.track) === r) lobbies.delete(r.track);
  if (r.code) privates.delete(r.code);
  if (!r.seats.some((s) => s.conn) || !db || r.state) { rooms.delete(r.id); for (const s of r.seats) byUser.delete(s.userId); return; }
  const humans = r.seats.map((s) => ({ id: s.userId, name: s.name, car: s.car, parts: s.parts, color: s.paint }));
  const seed = randomSeed();
  r.state = createRace(seed, r.track, fillField(humans));
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
  if (r.state) setRaceInput(r.state, userId, {}); // 比賽中離開：車子放開油門，結束時照樣結算
  else {
    r.seats = r.seats.filter((x) => x.userId !== userId); byUser.delete(userId);
    if (r.code && r.host === userId) r.host = r.seats[0]?.userId ?? null;
    if (!r.seats.length) { if (r.timer) clearTimeout(r.timer); rooms.delete(r.id); if (r.code) privates.delete(r.code); if (lobbies.get(r.track) === r) lobbies.delete(r.track); }
    else sendAll(r, lobbyMsg(r));
  }
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
  const st = r.state, rank = raceRanking(st), season = seasonOf(Date.now());
  const results: any[] = [];
  for (const s of r.seats) {
    const car = st.cars.find((c) => c.id === s.userId)!; const pos = rank.indexOf(car) + 1;
    const done = car.finishedTick !== null, prize = done ? prizeFor(pos) : 0, pts = done ? pointsFor(pos) : 0, time = raceTimeMs(st, car);
    // 錦標賽積分榜：自己＝ME，電腦用名字，其他真人用 user:id
    const ranking = rank.map((c, i) => ({ key: c.id === s.userId ? ME : c.ai ? c.name : `user:${c.id}`, rank: c.finishedTick === null && c.id === s.userId ? RACE_SLOTS : i + 1 }));
    try {
      await tx(db, async (t) => {
        const p = await loadForUpdate(t, s.userId);
        const cupR = settleCup(p.cup, p.unlocked, r.track, ranking);
        await t.updateTable('race_profiles').set({ cash: p.cash + prize, unlocked: cupR.unlocked, cup: JSON.stringify(cupR.cup), points: p.points + pts, races: p.races + 1, wins: p.wins + (pos === 1 ? 1 : 0), updated_at: new Date() }).where('user_id', '=', s.userId).execute();
        await t.insertInto('race_results').values({ race_id: r.id, season, track: r.track, user_id: s.userId, rank: pos, time_ms: time, prize, points: pts, condition: condition(car), humans: r.seats.length, private: !!r.code }).execute();
        // 比賽之間只修好撞壞的部分：完美度不存檔，下一場回到 100%
        results.push({ user_id: s.userId, rank: pos, prize, points: pts, time_ms: time, condition: condition(car), hits: car.hits, cash: p.cash + prize, qualified: cupR.qualified, cup_counted: cupR.counted, country_done: cupR.countryDone, champion: cupR.champion, unlocked: cupR.unlocked, cup: cupR.cup, standings: cupR.standings.slice(0, 10) });
      });
    } catch (e) { console.error('race settle failed', e); }
  }
  const ranking = rank.map((c, i) => ({ id: c.id, name: c.name, ai: c.ai, car: c.car, rank: i + 1, time_ms: raceTimeMs(st, c), condition: condition(c) }));
  for (const s of r.seats) s.conn?.send({ type: 'race.ended', race_id: r.id, track: r.track, ranking, me: results.find((x) => x.user_id === s.userId) ?? null });
  for (const s of r.seats) byUser.delete(s.userId);
  setTimeout(() => rooms.delete(r.id), 5000);
}
/** 測試用：把比賽直接模擬到結束 */
export async function fastForwardRace(raceId: string, drive?: (s: RaceState) => void) {
  const r = rooms.get(raceId); if (!r?.state) throw new Error('no race');
  while (!r.state.over) { drive?.(r.state); stepRace(r.state); }
  await finish(r);
}
export function abortRaces() { for (const r of rooms.values()) { r.ended = true; if (r.timer) clearTimeout(r.timer); sendAll(r, { type: 'race.ended', race_id: r.id, aborted: true }); for (const s of r.seats) byUser.delete(s.userId); } }
