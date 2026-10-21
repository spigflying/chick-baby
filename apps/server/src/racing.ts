/**
 * 賽車模式（伺服器）v5：檔案／車庫／換匯／賽季（REST）＋即時比賽（WS，伺服器權威，20 台車、空位補電腦）。
 * 一起賽車＝同一個家裡的人互相邀請（流程同多人下樓梯：負責這個家的執行個體處理邀請，訊息走 LISTEN/NOTIFY，跨執行個體）；
 * 也可以自己一個人跑（只有電腦車）。開賽後由開賽的執行個體負責模擬，參賽者離開家也照樣比完。
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import {
  CARS, COUNTRIES, EXCHANGE, ME, PAINTS, PART_KINDS, PARTS, partPrice, RACE_SLOTS, RACE_TICK_RATE, TRACKS, condition, createRace, cupTrack, fillField,
  createInvite, inviteOutcome, replyInvite, type Invite, newCup, normParts, pointsFor, prizeFor, raceRanking, raceTimeMs, seasonOf, setRaceInput, settleCup, stepRace, trackById, type PartKind, type RaceState,
} from '@chick/engine';
import type { Db } from './db';
import { audit, changeBalance, lockWallets, type ReqCtx } from './core';
import { fail } from './errors';
import { randomSeed } from './util';
import { clock } from './hours';
import type { Bus } from './bus';
import type { PresenceStore } from './presence';
import { env } from './env';

export const CLOSING_GUARD_MS = 8 * 60_000; // 關門前 8 分鐘不開新比賽（最長比賽＋等待時間）
export const RACE_INVITE_MS = 15_000;
export const MAX_HUMANS = 8;

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
  return { parts: PARTS, cars: CARS, paints: PAINTS, countries: COUNTRIES, tracks: TRACKS.map(({ pieces, ...t }) => t), slots: RACE_SLOTS, exchange: EXCHANGE, closing_guard_ms: CLOSING_GUARD_MS, invite_ms: RACE_INVITE_MS, max_humans: MAX_HUMANS };
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

// ---------- 一起賽車（家裡邀請，同多人下樓梯）＋單人 ----------
interface Seat { userId: string; name: string; car: string; paint: number; parts: any; left: boolean }
interface Room { id: string; home: string | null; host: string; inst: string; track: string; seats: Seat[]; state: RaceState; startAt: number; ended: boolean; seq: Map<string, number> }
interface Lobby { home: string; invite: Invite; track: string }
interface Deps {
  db: Db; bus: Bus; presence: PresenceStore; instance: () => string;
  /** 送給本機連線（ws.ts 轉發）；只有自己一個執行個體或單人賽時直接用 */
  local: (m: any) => void;
  /** 這個家正在打架／下樓梯（邀請中或比賽中）？ */
  homeBusy?: (home: string) => string | null;
  /** 這個人已經在別的比賽（下樓梯、打架）？ */
  userBusy?: (home: string, user: string) => boolean;
}
let deps: Deps | null = null;
const lobbies = new Map<string, Lobby>();
const starting = new Set<string>();
const rooms = new Map<string, Room>();          // race id → 本機負責模擬的比賽
const byUser = new Map<string, string>();       // user → race id（本機負責的比賽）
export function initRacing(d: Omit<Deps, 'instance'> & { instance?: () => string }) { deps = { ...d, instance: d.instance ?? (() => env.instanceId) }; }
export const raceBusy = (home: string) => lobbies.has(home) || starting.has(home) || [...rooms.values()].some((r) => r.home === home && !r.ended);
export const inRace = (userId: string) => byUser.has(userId);
const isAuthority = (home: string) => !!deps && deps.presence.instances(home)[0] === deps.instance();
/** 家裡的事件：只有自己一個執行個體時本機處理，否則 NOTIFY。 */
function outHome(m: Record<string, unknown> & { home: string }) {
  const inst = deps!.presence.instances(m.home);
  if (inst.length === 1 && inst[0] === deps!.instance()) deps!.local(m); else void deps!.bus.publish(m).catch(() => {});
}
/** 比賽中的訊息：參賽者可能連在任何執行個體 → NOTIFY；單人賽直接本機。 */
function outRace(r: Room, m: Record<string, unknown>) { const x = { ...m, race_id: r.id, home: r.home }; if (!r.home) deps!.local(x); else void deps!.bus.publish(x).catch(() => {}); }
const notice = (home: string, user: string, code: string) => outHome({ t: 'rrace.notice', home, user, code });
/** 送給負責的執行個體：家裡的意圖 → 這個家的負責者；比賽中的輸入 → 開賽的執行個體。 */
export function toRaceAuthority(m: any) {
  if (!deps) return;
  const mine = m.inst ? m.inst === deps.instance() : m.home ? isAuthority(m.home) : true;
  if (mine) onRaceBus(m); else void deps.bus.publish(m).catch(() => {});
}
export function onRaceBus(m: any) {
  if (!deps || typeof m?.t !== 'string') return;
  if (m.t === 'rrace.in' || m.t === 'rrace.quit') { // 比賽中：只有開賽的執行個體處理
    if (m.inst !== deps.instance()) return;
    const r = rooms.get(String(m.race)); if (!r || r.ended) return;
    if (m.t === 'rrace.in') raceInput(r, m.user, m); else quit(r, m.user);
    return;
  }
  if (!['rrace.invite', 'rrace.reply', 'rrace.cancel', 'rrace.leave'].includes(m.t) || !m.home || !isAuthority(m.home)) return;
  if (m.t === 'rrace.invite') void invite(m.home, m.user, m.name);
  else if (m.t === 'rrace.reply') reply(m.home, m.user, String(m.invite), !!m.accept);
  else if (m.t === 'rrace.cancel') { const lb = lobbies.get(m.home); if (lb && lb.invite.from === m.user) cancelLobby(lb, 'CANCELLED'); }
  else if (m.t === 'rrace.leave') leaveLobby(m.home, m.user);
}
/** 關門前 8 分鐘不開新比賽 */
function closingCode(now = Date.now()): string | null { const st = clock().status(now); if (!st.open) return 'GAME_CLOSED'; return st.closes_at !== null && st.closes_at - now < CLOSING_GUARD_MS ? 'RACE_CLOSING' : null; }
const label = (u: any) => (u?.pet?.name ? `${u.pet.name}（${u.display_name}）` : u?.display_name) ?? '玩家';

/** 發起：這個家裡其他在場的人收到邀請（15 秒）。沒有其他人 → 直接單人開跑（全部電腦車）。賽道＝發起人目前的錦標賽站。 */
async function invite(home: string, user: string, name?: string, now = Date.now()) {
  const why = closingCode(now); if (why) return notice(home, user, why);
  if (raceBusy(home)) return notice(home, user, 'RACE_BUSY');
  const busy = deps!.homeBusy?.(home); if (busy) return notice(home, user, busy);
  const users = deps!.presence.users(home), me = users.find((u) => u.id === user);
  if (!me) return notice(home, user, 'NOT_IN_HOME');
  if (byUser.has(user) || deps!.userBusy?.(home, user)) return notice(home, user, 'ALREADY_IN_MATCH');
  starting.add(home);
  let track: string;
  try { const p = await getProfile(deps!.db, user); track = cupTrack(p.cup)?.id ?? TRACKS[0].id; } finally { starting.delete(home); }
  const others = users.filter((u) => u.id !== user && !byUser.has(u.id) && !deps!.userBusy?.(home, u.id)).map((u) => u.id).slice(0, MAX_HUMANS - 1);
  if (!others.length) return void start(home, user, [user], track, null);
  const inv = createInvite(randomUUID(), user, others, now, RACE_INVITE_MS);
  lobbies.set(home, { home, invite: inv, track });
  outHome({ t: 'rrace.event', home, kind: 'invite', invite: inv.id, from: user, from_name: label(me) ?? name, to: inv.to, left_ms: RACE_INVITE_MS, track, max: MAX_HUMANS });
}
function reply(home: string, user: string, id: string, accept: boolean) {
  const lb = lobbies.get(home); if (!lb || lb.invite.id !== id) return;
  if (!replyInvite(lb.invite, user, accept)) return;
  outHome({ t: 'rrace.event', home, kind: 'reply', invite: id, user, accept, count: lb.invite.accepted.length + 1 });
  resolveLobby(lb);
}
function cancelLobby(lb: Lobby, code: string) {
  if (lobbies.get(lb.home) !== lb) return;
  lobbies.delete(lb.home);
  outHome({ t: 'rrace.event', home: lb.home, kind: 'invite_cancel', invite: lb.invite.id, from: lb.invite.from, code });
}
function leaveLobby(home: string, user: string) {
  const lb = lobbies.get(home); if (!lb) return;
  if (lb.invite.from === user) return cancelLobby(lb, 'CANCELLED');
  if (lb.invite.accepted.includes(user)) { lb.invite.accepted = lb.invite.accepted.filter((u) => u !== user); lb.invite.declined.push(user); }
  else replyInvite(lb.invite, user, false);
  outHome({ t: 'rrace.event', home, kind: 'reply', invite: lb.invite.id, user, accept: false, count: lb.invite.accepted.length + 1 });
  resolveLobby(lb);
}
/** 全部回覆或時間到：發起人＋接受的人（仍在場）一起跑；不像下樓梯要 2 隻以上——只剩發起人也照跑（電腦補滿）。 */
function resolveLobby(lb: Lobby, now = Date.now()) {
  const o = inviteOutcome(lb.invite, now); if (!o.done) return;
  const here = new Set(deps!.presence.users(lb.home).map((u) => u.id));
  const parts = [lb.invite.from, ...lb.invite.accepted].filter((u) => here.has(u) && !byUser.has(u));
  if (!parts.includes(lb.invite.from)) return cancelLobby(lb, 'CANCELLED');
  lobbies.delete(lb.home);
  void start(lb.home, lb.invite.from, parts, lb.track, lb.invite.id);
}
/** 單人：不需要在家裡，本機直接開（只有電腦車）。 */
export async function startSolo(userId: string, track: unknown) {
  if (!deps) fail('INTERNAL');
  const why = closingCode(); if (why) fail(why);
  if (byUser.has(userId)) fail('ALREADY_IN_MATCH');
  const t = track ? trackById(String(track)) : null; if (track && !t) fail('BAD_REQUEST');
  const p = await getProfile(deps!.db, userId);
  const tr = t ?? cupTrack(p.cup) ?? TRACKS[0];
  if (tr.countryIdx >= p.unlocked) fail('TRACK_LOCKED');
  return start(null, userId, [userId], tr.id, null);
}
async function start(home: string | null, host: string, users: string[], track: string, inviteId: string | null) {
  const { db, presence } = deps!;
  if (home) starting.add(home);
  try {
    const why = closingCode();
    if (why) { if (home) outHome({ t: 'rrace.event', home, kind: 'invite_cancel', invite: inviteId, from: host, code: why }); else deps!.local({ t: 'rrace.notice', home: null, user: host, code: why }); return null; }
    const names = new Map((home ? presence.users(home) : []).map((u) => [u.id, label(u)]));
    const rows = await (db as any).selectFrom('users').select(['id', 'display_name']).where('id', 'in', users).execute();
    for (const r of rows) if (!names.has(r.id)) names.set(r.id, r.display_name);
    const seats: Seat[] = [];
    for (const u of users) { const p = await getProfile(db, u); seats.push({ userId: u, name: String(names.get(u) ?? '玩家').slice(0, 16), car: p.car, paint: p.paint, parts: p.parts, left: false }); }
    const seed = randomSeed();
    const state = createRace(seed, track, fillField(seats.map((s) => ({ id: s.userId, name: s.name, car: s.car, parts: s.parts, color: s.paint }))));
    const r: Room = { id: randomUUID(), home, host, inst: deps!.instance(), track, seats, state, startAt: Date.now(), ended: false, seq: new Map() };
    rooms.set(r.id, r); for (const s of seats) byUser.set(s.userId, r.id);
    outRace(r, { t: 'rrace.started', inst: r.inst, track, seed, laps: state.laps, len: state.len, tick_rate: RACE_TICK_RATE, users: users, solo: !home,
      cars: state.cars.map((c) => ({ id: c.id, name: c.name, ai: c.ai, car: c.car, color: c.color })) });
    if (home) outHome({ t: 'rrace.event', home, kind: 'start', invite: inviteId, race_id: r.id, users, names: seats.map((s) => s.name), track });
    return r.id;
  } catch (err) {
    console.error('race start failed', err);
    if (home) outHome({ t: 'rrace.event', home, kind: 'invite_cancel', invite: inviteId, from: host, code: 'INTERNAL' });
    return null;
  } finally { if (home) starting.delete(home); }
}
function raceInput(r: Room, userId: string, msg: any) {
  const seq = Number(msg.seq) || 0; if (seq <= (r.seq.get(userId) ?? 0)) return; r.seq.set(userId, seq);
  setRaceInput(r.state, userId, msg);
}
/** 比賽中離開：車子放開油門，結束時照樣結算。 */
function quit(r: Room, userId: string) { const s = r.seats.find((x) => x.userId === userId); if (s) { s.left = true; setRaceInput(r.state, userId, {}); } }
/** 家裡在場名單變了：報名中不在家的人退出；負責者換人 → 邀請取消（比賽本身不受影響）。 */
export function onRacePresence(home: string) {
  if (!deps) return;
  const lb = lobbies.get(home); if (!lb) return;
  if (!isAuthority(home)) { lobbies.delete(home); void deps.bus.publish({ t: 'rrace.event', home, kind: 'invite_cancel', invite: lb.invite.id, from: lb.invite.from, code: 'CANCELLED' }).catch(() => {}); return; }
  const here = new Set(deps.presence.users(home).map((u) => u.id));
  for (const u of [lb.invite.from, ...lb.invite.to]) if (!here.has(u)) leaveLobby(home, u);
}
const snap = (r: Room) => ({ t: 'rrace.snap', tick: r.state.tick, countdown: r.state.countdown, cars: r.state.cars.map((c) => [c.id, +c.z.toFixed(2), +c.x.toFixed(3), +c.speed.toFixed(2), +c.damage.toFixed(1), c.nitro, c.nitroT, c.finishedTick, c.hit]) });
export function stepRaces(now = Date.now()) {
  if (!deps) return;
  for (const lb of [...lobbies.values()]) { if (!isAuthority(lb.home)) onRacePresence(lb.home); else resolveLobby(lb, now); }
  for (const r of rooms.values()) {
    if (r.ended) continue;
    const target = Math.floor(((now - r.startAt) * RACE_TICK_RATE) / 1000);
    while (r.state.tick < target && !r.state.over) { stepRace(r.state); if (r.state.tick % 2 === 0) outRace(r, snap(r)); }
    if (r.state.over) void finish(r);
  }
}
export function startRaceLoop() { const t = setInterval(() => stepRaces(), 1000 / RACE_TICK_RATE / 2); t.unref(); return t; }
async function finish(r: Room) {
  if (r.ended || !deps) return; r.ended = true;
  const db = deps.db;
  outRace(r, snap(r));
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
        await t.insertInto('race_results').values({ race_id: r.id, season, track: r.track, user_id: s.userId, rank: pos, time_ms: time, prize, points: pts, condition: condition(car), humans: r.seats.length, private: !!r.home }).execute();
        // 比賽之間只修好撞壞的部分：完美度不存檔，下一場回到 100%
        results.push({ user_id: s.userId, rank: pos, prize, points: pts, time_ms: time, condition: condition(car), hits: car.hits, cash: p.cash + prize, qualified: cupR.qualified, cup_counted: cupR.counted, country_done: cupR.countryDone, champion: cupR.champion, unlocked: cupR.unlocked, cup: cupR.cup, standings: cupR.standings.slice(0, 10) });
      });
    } catch (e) { console.error('race settle failed', e); }
  }
  const ranking = rank.map((c, i) => ({ id: c.id, name: c.name, ai: c.ai, car: c.car, rank: i + 1, time_ms: raceTimeMs(st, c), condition: condition(c) }));
  outRace(r, { t: 'rrace.ended', track: r.track, ranking, results });
  for (const s of r.seats) if (byUser.get(s.userId) === r.id) byUser.delete(s.userId);
  setTimeout(() => rooms.delete(r.id), 5000).unref?.();
}
/** 測試用：把比賽直接模擬到結束 */
export async function fastForwardRace(raceId: string, drive?: (s: RaceState) => void) {
  const r = rooms.get(raceId); if (!r) throw new Error('no race');
  while (!r.state.over) { drive?.(r.state); stepRace(r.state); }
  await finish(r);
}
export const _raceLobbies = lobbies;
export function abortRaces() {
  if (!deps) return;
  for (const lb of lobbies.values()) outHome({ t: 'rrace.event', home: lb.home, kind: 'invite_cancel', invite: lb.invite.id, from: lb.invite.from, code: 'CANCELLED' });
  lobbies.clear();
  for (const r of rooms.values()) if (!r.ended) { r.ended = true; outRace(r, { t: 'rrace.ended', aborted: true, results: [] }); for (const s of r.seats) byUser.delete(s.userId); }
}
