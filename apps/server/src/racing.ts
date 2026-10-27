/**
 * 賽車模式（伺服器）v5：檔案／車庫／換匯／賽季（REST）＋即時比賽（WS，伺服器權威，20 台車、空位補電腦）。
 * 一起賽車＝同一個家裡的人互相邀請（流程同多人下樓梯：負責這個家的執行個體處理邀請，訊息走 LISTEN/NOTIFY，跨執行個體）；
 * 也可以自己一個人跑（只有電腦車）。開賽後由開賽的執行個體負責模擬，參賽者離開家也照樣比完。
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import {
  CARS, COUNTRIES, MAX_OUT_COST, ME, PAINTS, PAINT_NAMES, PRIZES, PART_KINDS, PARTS, partPrice, RACE_SLOTS, RACE_TICK_RATE, TRACKS, condition, createRace, cupTrack, fillField,
  MAX_LAPS, createInvite, inviteOutcome, replyInvite, type Invite, newCup, normParts, pointsFor, prizeFor, raceRanking, raceTimeMs, seasonOf, setRaceInput, settleCup, stepRace, trackById, type PartKind, type RaceState,
  snapCar, snapPickups, TRACK_VERSION } from '@chick/engine';
import type { Db } from './db';
import { audit, changeBalance, lockWallets, type ReqCtx } from './core';
import { fail } from './errors';
import { randomSeed } from './util';
import { clock } from './hours';
import type { Bus } from './bus';
import type { PresenceStore } from './presence';
import { env } from './env';
import { petLook, spriteKey } from './pets';
import { roomPrize, startRoomStairs, STAIRS_ROOM_MAX, STAIRS_ROOM_MIN } from './mstairs';
import { newRoom, roomConfig, roomDrop, roomJoin, roomLeave, roomReady, roomTick, roomView, type RaceRoom } from './race-rooms';

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
const view = (p: any) => ({ parts: p.parts, car: p.car, paint: p.paint, season: p.season, unlocked: p.unlocked, cup: p.cup, cup_track: cupTrack(p.cup)?.id ?? null, points: p.points, races: p.races, wins: p.wins });
const tx = <T>(db: Db, f: (t: any) => Promise<T>) => (db as any).transaction().execute(f) as Promise<T>;
export async function getProfile(db: Db, userId: string) { await ensure(db, userId); return tx(db, async (t) => view(await loadForUpdate(t, userId))); }
export function raceCatalog() {
  return { parts: PARTS, cars: CARS, paints: PAINTS, countries: COUNTRIES, tracks: TRACKS.map(({ pieces, ...t }) => t), slots: RACE_SLOTS, paint_names: PAINT_NAMES, prizes: PRIZES, max_out_cost: MAX_OUT_COST, closing_guard_ms: CLOSING_GUARD_MS, invite_ms: RACE_INVITE_MS, max_humans: MAX_HUMANS };
}
/** 改裝（TG2）：任何一階都能直接買；換階（含降級）舊零件丟掉、全額付款（寵物金幣）、不退錢；原廠標準免費。 */
export async function buyPart(db: Db, ctx: ReqCtx, kind: unknown, tier: unknown) {
  if (!PART_KINDS.includes(kind as PartKind)) fail('BAD_REQUEST');
  const k = kind as PartKind, tr = Number(tier), price = partPrice(k, tr);
  if (price === null || !Number.isInteger(tr)) fail('BAD_REQUEST');
  await ensure(db, ctx.userId);
  return tx(db, async (t) => {
    const [w] = await lockWallets(t, [ctx.userId]);
    const p = await loadForUpdate(t, ctx.userId);
    if (p.parts[k] === tr) fail('ALREADY_OWNED');
    if (!w || w.balance < price!) fail('INSUFFICIENT_COINS');
    const from = p.parts[k];
    const balance = price! > 0 ? await changeBalance(t, ctx.userId, -price!, 'race_part', { type: 'race_part', id: randomUUID() })
      : Number((await t.selectFrom('wallets').select('balance').where('user_id', '=', ctx.userId).executeTakeFirstOrThrow()).balance);
    p.parts[k] = tr;
    await t.updateTable('race_profiles').set({ parts: JSON.stringify(p.parts), updated_at: new Date() }).where('user_id', '=', ctx.userId).execute();
    await audit(t, ctx, 'race.buy_part', 'ok', { detail: { kind: k, from, tier: tr, price } });
    return { ...view(p), balance };
  });
}
/** 車款（外觀）與塗裝：免費。 */
export async function buyCar(db: Db, ctx: ReqCtx, carId: unknown, paint?: unknown) {
  const c = carId === undefined ? null : CARS.find((x) => x.id === carId); if (carId !== undefined && !c) fail('BAD_REQUEST');
  await ensure(db, ctx.userId);
  return tx(db, async (t) => {
    const p = await loadForUpdate(t, ctx.userId);
    if (c) p.car = c.id;
    if (paint !== undefined) { const pi = Number(paint); if (!Number.isInteger(pi) || pi < 0 || pi >= PAINTS) fail('BAD_REQUEST'); p.paint = pi; }
    await t.updateTable('race_profiles').set({ car: p.car, paint: p.paint, updated_at: new Date() }).where('user_id', '=', ctx.userId).execute();
    return view(p);
  });
}
export async function raceLeaderboard(db: Db, track: string) {
  if (!trackById(track)) fail('NOT_FOUND');
  const season = seasonOf(Date.now()), d = db as any;
  // 依使用者分組（同名的人不會被併成一筆）；名字跟賽車上一樣用「寵物（玩家）」
  const best = await d.selectFrom('race_results').innerJoin('users', 'users.id', 'race_results.user_id')
    .select(['users.id as id', 'users.display_name as display', (eb: any) => eb.fn.min('race_results.time_ms').as('time_ms')])
    .where('race_results.track', '=', track).where('race_results.season', '=', season).where('race_results.track_ver', '=', TRACK_VERSION) /* race-prod-port：舊版賽道的紀錄保留在表裡，但不列入 */.where('race_results.time_ms', 'is not', null).groupBy(['users.id', 'users.display_name']).orderBy('time_ms').limit(10).execute();
  const champ = await d.selectFrom('race_profiles').innerJoin('users', 'users.id', 'race_profiles.user_id')
    .select(['users.id as id', 'users.display_name as display', 'race_profiles.points', 'race_profiles.wins', 'race_profiles.unlocked']).where('race_profiles.season', '=', season).orderBy('race_profiles.points', 'desc').limit(10).execute();
  const ids = [...new Set([...best, ...champ].map((r: any) => r.id))];
  const pets = ids.length ? await d.selectFrom('pets').select(['owner_id', 'name']).where('owner_id', 'in', ids).where('status', 'in', ['egg', 'alive']).execute() : [];
  const petOf = new Map(pets.map((x: any) => [x.owner_id, x.name]));
  const named = ({ id, display, ...rest }: any) => ({ name: raceLabel(petOf.get(id) as any, display), ...rest });
  return { season, track, best: best.map(named), championship: champ.map(named) };
}

// ---------- 一起賽車（家裡邀請，同多人下樓梯）＋單人 ----------
/**
 * 斷線處理：客戶端比賽中至少每 250ms 送一次操作，伺服器用「最後收到操作的時間」判斷這個人還在不在。
 * 超過 RACE_IDLE_MS 沒收到 → 放開油門（車停下來，不會一直衝）；斷線後 RACE_DROP_MS 內重連可以接回同一場（race.resume），
 * 超過才算棄賽（跟按「離開比賽」一樣）。從開賽起一次都沒收到（例如 race.started 沒送到）→ 這個座位作廢、不結算。
 */
export const RACE_IDLE_MS = 1500;
export const RACE_DROP_MS = 30_000;
interface Seat { userId: string; name: string; car: string; paint: number; parts: any; /** 坐在車上的寵物精靈鍵（null＝沒有寵物） */ pet: string | null; left: boolean; seenAt: number | null; idle: boolean; void: boolean }
interface Room { id: string; home: string | null; host: string; inst: string; track: string; seats: Seat[]; state: RaceState; startAt: number; ended: boolean; seq: Map<string, number>;
  /** 有人從別的執行個體接回這場（單人賽也要走 NOTIFY） */
  remote: boolean;
  /** 結算後的 rrace.ended（剛結束時重連的人還拿得到結果） */
  final: Record<string, unknown> | null;
  /** v27 從賽車房開的：獎金一律改成真人前三名 ◎150／100／50；fullLaps＝圈數跟賽道預設相同（才算積分、錦標賽、最快時間） */
  room?: { fullLaps: boolean } }
interface Lobby { home: string; invite: Invite; track: string; createdAt: number }
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
/**
 * 比賽中的訊息：一律先送本機連線（LISTEN 斷線時本機的人也照樣收得到）；
 * 一起賽車（或有人從別的執行個體接回）再 NOTIFY 給其他執行個體，帶 src 讓自己收到回音時不重送。
 */
function outRace(r: Room, m: Record<string, unknown>) {
  const x = { ...m, race_id: r.id, home: r.home };
  deps!.local(x);
  if (r.home || r.remote) void deps!.bus.publish({ ...x, src: deps!.instance() }).catch(() => {});
}
/** 自己 outRace 出去又從 LISTEN 收回來的訊息（本機已經送過了） */
export const raceEcho = (m: any) => !!deps && typeof m?.src === 'string' && m.src === deps.instance();
/** 只回給某個執行個體上的某一條連線（race.resume 的回覆） */
function outConn(via: string, cid: number, m: Record<string, unknown>) {
  const x = { ...m, via, cid };
  if (via === deps!.instance()) deps!.local(x); else void deps!.bus.publish(x).catch(() => {});
}
const notice = (home: string, user: string, code: string) => outHome({ t: 'rrace.notice', home, user, code });
/** 送給負責的執行個體：家裡的意圖 → 這個家的負責者；比賽中的輸入 → 開賽的執行個體。 */
export function toRaceAuthority(m: any) {
  if (!deps) return;
  const mine = m.inst ? m.inst === deps.instance() : m.home ? isAuthority(m.home) : true;
  if (mine) onRaceBus(m); else void deps.bus.publish(m).catch(() => {});
}
export function onRaceBus(m: any) {
  if (!deps || typeof m?.t !== 'string') return;
  if (m.t === 'rrace.in' || m.t === 'rrace.quit' || m.t === 'rrace.drop' || m.t === 'rrace.resume') { // 比賽中：只有開賽的執行個體處理
    if (m.inst !== deps.instance()) return;
    const r = rooms.get(String(m.race));
    if (m.t === 'rrace.resume') return resume(r, m);
    if (!r || r.ended) return;
    if (m.t === 'rrace.in') raceInput(r, m.user, m); else if (m.t === 'rrace.drop') drop(r, m.user); else quit(r, m.user);
    return;
  }
  if (m.t === 'rrace.rquery') { if (!raceEcho(m)) onRoomQuery(m); return; }
  if (m.t.startsWith('rrace.r') && ROOM_INTENTS.has(m.t)) { if (m.inst === deps.instance()) onRoomIntent(m); return; }
  if (!['rrace.invite', 'rrace.reply', 'rrace.cancel', 'rrace.leave'].includes(m.t) || !m.home || !isAuthority(m.home)) return;
  if (m.t === 'rrace.invite') void invite(m.home, m.user, m.name).catch((err) => console.error('race invite failed', err));
  else if (m.t === 'rrace.reply') reply(m.home, m.user, String(m.invite), !!m.accept);
  else if (m.t === 'rrace.cancel') { const lb = lobbies.get(m.home); if (lb && lb.invite.from === m.user) cancelLobby(lb, 'CANCELLED'); }
  else if (m.t === 'rrace.leave') leaveLobby(m.home, m.user);
}
/** 關門前 8 分鐘不開新比賽 */
function closingCode(now = Date.now()): string | null { const st = clock().status(now); if (!st.open) return 'GAME_CLOSED'; return st.closes_at !== null && st.closes_at - now < CLOSING_GUARD_MS ? 'RACE_CLOSING' : null; }
/** 賽車上的名字：「寵物名（玩家名）」，太長只縮玩家名、保留右括號；沒有寵物就只用玩家名。 */
export function raceLabel(pet: string | null | undefined, display: string | null | undefined, max = 16): string {
  const d = [...String(display ?? '').trim()], p = [...String(pet ?? '').trim()].slice(0, 12);
  if (!p.length) return (d.length ? (d.length > max ? d.slice(0, max - 1).join('') + '…' : d.join('')) : '玩家');
  const room = max - p.length - 2; if (!d.length || room < 2) return p.join('');
  return `${p.join('')}（${d.length > room ? d.slice(0, room - 1).join('') + '…' : d.join('')}）`;
}
const label = (u: any) => raceLabel(u?.pet?.name, u?.display_name);

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
  // 讀檔失敗（資料庫出錯）要在這裡接住：invite 是 void 呼叫，沒接住的 rejection 會讓整個程序結束
  try { const p = await getProfile(deps!.db, user); track = cupTrack(p.cup)?.id ?? TRACKS[0].id; }
  catch (err) { console.error('race invite failed', err); return notice(home, user, 'INTERNAL'); }
  finally { starting.delete(home); }
  const others = users.filter((u) => u.id !== user && !byUser.has(u.id) && !deps!.userBusy?.(home, u.id)).map((u) => u.id).slice(0, MAX_HUMANS - 1);
  if (!others.length) return void start(home, user, [user], track, null);
  const inv = createInvite(randomUUID(), user, others, now, RACE_INVITE_MS);
  lobbies.set(home, { home, invite: inv, track, createdAt: Date.now() });
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
/** 單人：不需要在家裡，本機直接開（只有電腦車）。cancelled()＝開好之前玩家已經按了離開（就不開了）。 */
export async function startSolo(userId: string, track: unknown, cancelled?: () => boolean) {
  if (!deps) fail('INTERNAL');
  const why = closingCode(); if (why) fail(why);
  if (byUser.has(userId)) fail('ALREADY_IN_MATCH');
  const t = track ? trackById(String(track)) : null; if (track && !t) fail('BAD_REQUEST');
  const p = await getProfile(deps!.db, userId);
  const tr = t ?? cupTrack(p.cup) ?? TRACKS[0];
  if (tr.countryIdx >= p.unlocked) fail('TRACK_LOCKED');
  if (cancelled?.()) return null;
  return start(null, userId, [userId], tr.id, null, cancelled);
}
/** 坐在車上的寵物：目前活著（蛋／長大）的寵物，沒有就用最近一隻（死掉＝幽靈）；精靈鍵：'egg'／'ghost'／'物種|配件' */
export function racePetKey(row: { species: string; status: string; bao?: any; outfits?: any } | null | undefined): string | null {
  if (!row) return null;
  if (row.status === 'dead') return 'ghost';
  if (row.status === 'egg') return 'egg';
  return spriteKey({ species: row.species, look: petLook(row) });
}
export async function racePets(db: Db, users: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>(); if (!users.length) return out;
  try {
    const rows = await (db as any).selectFrom('pets').select(['owner_id', 'species_id as species', 'status', 'bao', 'outfits', 'born_at']).where('owner_id', 'in', users).orderBy('born_at', 'desc').execute();
    for (const u of users) { const mine = rows.filter((r: any) => r.owner_id === u); out.set(u, racePetKey(mine.find((r: any) => r.status !== 'dead') ?? mine[0])); }
  } catch (err) { console.error('race pets failed', err); }
  return out;
}
async function start(home: string | null, host: string, users: string[], track: string, inviteId: string | null, cancelled?: () => boolean, room?: { laps: number }) {
  const { db, presence } = deps!;
  if (home) starting.add(home);
  try {
    const why = closingCode();
    if (why) { if (home) outHome({ t: 'rrace.event', home, kind: 'invite_cancel', invite: inviteId, from: host, code: why }); else deps!.local({ t: 'rrace.notice', home: null, user: host, code: why }); return null; }
    const names = new Map((home ? presence.users(home) : []).map((u) => [u.id, label(u)]));
    const rows = await (db as any).selectFrom('users').select(['id', 'display_name']).where('id', 'in', users).execute();
    // 不在家裡名單裡（單人賽）：自己查寵物名，跟一起賽車時顯示一樣
    const missing = rows.filter((r: any) => !names.has(r.id)).map((r: any) => r.id);
    const pets = missing.length ? await (db as any).selectFrom('pets').select(['owner_id', 'name']).where('owner_id', 'in', missing).where('status', 'in', ['egg', 'alive']).execute() : [];
    const petOf = new Map(pets.map((x: any) => [x.owner_id, x.name]));
    for (const r of rows) if (!names.has(r.id)) names.set(r.id, raceLabel(petOf.get(r.id) as any, r.display_name));
    const seats: Seat[] = [];
    const petKeys = await racePets(db, users);
    for (const u of users) { const p = await getProfile(db, u); seats.push({ userId: u, name: String(names.get(u) ?? '玩家'), car: p.car, paint: p.paint, parts: p.parts, pet: petKeys.get(u) ?? null, left: false, seenAt: null, idle: false, void: false }); }
    const seed = randomSeed();
    const state = createRace(seed, track, fillField(seats.map((s) => ({ id: s.userId, name: s.name, car: s.car, parts: s.parts, color: s.paint }))), 1, room?.laps);
    state.maxTicks = capRaceTicks(state.maxTicks, state.countdown, clock().status(Date.now()).closes_at, Date.now());
    const r: Room = { id: randomUUID(), home, host, inst: deps!.instance(), track, seats, state, startAt: Date.now(), ended: false, seq: new Map(), remote: !!room, final: null, room: room ? { fullLaps: room.laps === trackById(track)!.laps } : undefined };
    if (cancelled?.()) return null; // 準備中按了離開：從這裡到送出 race.started 都是同步的，不會漏
    rooms.set(r.id, r); for (const s of seats) byUser.set(s.userId, r.id);
    outRace(r, startedMsg(r));
    if (home) outHome({ t: 'rrace.event', home, kind: 'start', invite: inviteId, race_id: r.id, users, names: seats.map((s) => s.name), track });
    return r.id;
  } catch (err) {
    console.error('race start failed', err);
    if (home) outHome({ t: 'rrace.event', home, kind: 'invite_cancel', invite: inviteId, from: host, code: 'INTERNAL' });
    return null;
  } finally { if (home) starting.delete(home); }
}
/** 比賽最長 9 分鐘，但關門保護只有 8 分鐘：快關門時開的比賽，上限縮到關門前 10 秒（時間到照常結算，不會被關門打斷）。 */
export function capRaceTicks(maxTicks: number, countdown: number, closesAt: number | null, now: number) {
  if (closesAt === null) return maxTicks;
  return Math.max(countdown, Math.min(maxTicks, Math.floor(((closesAt - now - 10_000) * RACE_TICK_RATE) / 1000)));
}
const startedMsg = (r: Room) => ({ t: 'rrace.started', inst: r.inst, track: r.track, seed: r.state.seed, laps: r.state.laps, len: r.state.len, tick_rate: RACE_TICK_RATE, users: r.seats.map((s) => s.userId), solo: !r.home, pickups: r.state.pickups.map((p) => [p.id, p.z, p.x, p.q]),
  cars: r.state.cars.map((c) => ({ id: c.id, name: c.name, ai: c.ai, car: c.car, color: c.color, pet: c.ai ? null : r.seats.find((x) => x.userId === c.id)?.pet ?? null })) });
function raceInput(r: Room, userId: string, msg: any) {
  const s = r.seats.find((x) => x.userId === userId); if (!s || s.left) return;
  s.seenAt = Date.now(); s.idle = false; // 亂序的舊封包也代表人還在
  const seq = Number(msg.seq) || 0; if (seq <= (r.seq.get(userId) ?? 0)) return; r.seq.set(userId, seq);
  setRaceInput(r.state, userId, msg);
}
/** 連線斷了（還沒棄賽）：先放開油門，等 RACE_DROP_MS 內重連。 */
function drop(r: Room, userId: string) {
  const s = r.seats.find((x) => x.userId === userId); if (!s || s.left) return;
  s.idle = true; setRaceInput(r.state, userId, {});
}
/** 重連：接回同一場（新連線重新收快照、序號重算）；已經棄賽或比賽結束了就回 gone／結果。 */
function resume(r: Room | undefined, m: any) {
  const via = String(m.via ?? ''), cid = Number(m.cid); if (!deps || !via || !Number.isFinite(cid)) return;
  const s = r?.seats.find((x) => x.userId === m.user);
  if (!r || !s) return outConn(via, cid, { t: 'rrace.gone', race_id: String(m.race), user: m.user });
  if (r.ended) return r.final ? outConn(via, cid, { ...r.final, race_id: r.id, user: m.user }) : outConn(via, cid, { t: 'rrace.gone', race_id: r.id, user: m.user });
  if (s.left) return outConn(via, cid, { t: 'rrace.gone', race_id: r.id, user: m.user });
  if (via !== deps.instance()) r.remote = true;
  r.seq.delete(s.userId); s.seenAt = Date.now(); s.idle = false;
  outConn(via, cid, { ...startedMsg(r), t: 'rrace.resumed', race_id: r.id, home: r.home, user: s.userId });
}
/** 比賽中離開：車子放開油門，結束時照樣結算。 */
function quit(r: Room, userId: string) {
  const s = r.seats.find((x) => x.userId === userId); if (!s) return;
  s.left = true; setRaceInput(r.state, userId, {});
  // 離開的人馬上可以再開一場（不用等這場跑完，最多 9 分鐘）；真人都走光 → 這場直接結算
  if (byUser.get(userId) === r.id) byUser.delete(userId);
  settleIfDone(r);
}
/** 家裡在場名單變了：報名中不在家的人退出；負責者換人 → 邀請取消（比賽本身不受影響）。 */
export function onRacePresence(home: string) {
  if (!deps) return;
  const lb = lobbies.get(home); if (!lb) return;
  if (!isAuthority(home)) { lobbies.delete(home); void deps.bus.publish({ t: 'rrace.event', home, kind: 'invite_cancel', invite: lb.invite.id, from: lb.invite.from, code: 'CANCELLED' }).catch(() => {}); return; }
  const here = new Set(deps.presence.users(home).map((u) => u.id));
  for (const u of [lb.invite.from, ...lb.invite.to]) if (!here.has(u)) leaveLobby(home, u);
}
/** 真人都跑完或離開 → 這場就結束（不再等電腦車跑完，家裡的「正在賽車」鎖跟著解開）。 */
function settleIfDone(r: Room) {
  if (r.state.over) return;
  if (r.seats.every((x) => x.left || r.state.cars.find((c) => c.id === x.userId)?.finishedTick != null)) r.state.over = true;
}
/** 安全網：比賽最長 9 分鐘＋倒數；超過還沒結束就強制結算，避免鎖卡住。 */
const STALE_RACE_MS = 10 * 60 * 1000;
const STALE_LOBBY_MS = 2 * 60 * 1000;
const snap = (r: Room) => ({ t: 'rrace.snap', tick: r.state.tick, countdown: r.state.countdown, cars: r.state.cars.map(snapCar), pk: snapPickups(r.state) });
export function stepRaces(now = Date.now()) {
  if (!deps) return;
  stepRooms(now);
  for (const lb of [...lobbies.values()]) if (now - lb.createdAt > STALE_LOBBY_MS) { console.warn('race lobby stale', lb.home); cancelLobby(lb, 'CANCELLED'); }
  for (const lb of [...lobbies.values()]) { if (!isAuthority(lb.home)) onRacePresence(lb.home); else resolveLobby(lb, now); }
  for (const r of rooms.values()) {
    if (r.ended) continue;
    for (const s of r.seats) {
      if (s.left || r.state.cars.find((c) => c.id === s.userId)?.finishedTick != null) continue;
      const last = s.seenAt ?? r.startAt;
      if (now - last > RACE_DROP_MS) { if (s.seenAt === null) s.void = true; quit(r, s.userId); }
      else if (!s.idle && now - last > RACE_IDLE_MS) drop(r, s.userId);
    }
    const target = Math.floor(((now - r.startAt) * RACE_TICK_RATE) / 1000);
    while (r.state.tick < target && !r.state.over) { stepRace(r.state); if (r.state.tick % 2 === 0) outRace(r, snap(r)); }
    settleIfDone(r);
    if (now - r.startAt > STALE_RACE_MS) { console.warn('race stale, force finish', r.id); r.state.over = true; }
    if (r.state.over) void finish(r);
  }
}
export function startRaceLoop() { const t = setInterval(() => stepRaces(), 1000 / RACE_TICK_RATE / 2); t.unref(); return t; }
async function finish(r: Room) {
  if (r.ended || !deps) return; r.ended = true;
  const db = deps.db;
  outRace(r, snap(r));
  const st = r.state, rank = raceRanking(st), season = seasonOf(Date.now());
  const humans = r.seats.filter((x) => !x.void).length;
  const humanRank = rank.filter((c) => !c.ai && c.finishedTick !== null && r.seats.some((x) => x.userId === c.id && !x.void)).map((c) => c.id); // 作廢的座位（沒連上）不算這場的真人
  const results: any[] = [];
  for (const s of r.seats) {
    if (s.void) continue; // 一次都沒連上這場（race.started 沒送到）：不算這場、不動錦標賽
    const car = st.cars.find((c) => c.id === s.userId)!; const pos = rank.indexOf(car) + 1;
    const finished = car.finishedTick !== null, counts = !r.room || r.room.fullLaps;
    const humanPos = humanRank.indexOf(s.userId) + 1; // 房間獎金看「真人之間」的名次（完賽才有）
    const prize = !finished ? 0 : r.room ? roomPrize(humans, humanPos) : prizeFor(pos), pts = finished && counts ? pointsFor(pos) : 0, time = counts ? raceTimeMs(st, car) : null;
    // 錦標賽積分榜：自己＝ME，電腦用名字，其他真人用 user:id
    const ranking = rank.map((c, i) => ({ key: c.id === s.userId ? ME : c.ai ? c.name : `user:${c.id}`, rank: c.finishedTick === null && c.id === s.userId ? RACE_SLOTS : i + 1 }));
    try {
      await tx(db, async (t) => {
        await lockWallets(t, [s.userId]);
        const p = await loadForUpdate(t, s.userId);
        const cupR = settleCup(p.cup, p.unlocked, r.room && !r.room.fullLaps ? '__custom_laps__' : r.track, ranking);
        if (prize > 0) await changeBalance(t, s.userId, prize, 'race_prize', { type: 'race', id: r.id });
        await t.updateTable('race_profiles').set({ unlocked: cupR.unlocked, cup: JSON.stringify(cupR.cup), points: p.points + pts, races: p.races + 1, wins: p.wins + (pos === 1 ? 1 : 0), updated_at: new Date() }).where('user_id', '=', s.userId).execute();
        await t.insertInto('race_results').values({ race_id: r.id, season, track: r.track, user_id: s.userId, rank: pos, time_ms: time, prize, points: pts, condition: condition(car), humans, private: !!r.home || !!r.room, track_ver: TRACK_VERSION }).execute();
        // 比賽之間只修好撞壞的部分：完美度不存檔，下一場回到 100%
        results.push({ user_id: s.userId, rank: pos, prize, points: pts, time_ms: time, condition: condition(car), hits: car.hits, qualified: cupR.qualified, cup_counted: cupR.counted, country_done: cupR.countryDone, champion: cupR.champion, unlocked: cupR.unlocked, cup: cupR.cup, standings: cupR.standings.slice(0, 10) });
      });
    } catch (e) { console.error('race settle failed', e); }
  }
  const ranking = rank.map((c, i) => ({ id: c.id, name: c.name, ai: c.ai, car: c.car, rank: i + 1, time_ms: raceTimeMs(st, c), condition: condition(c) }));
  r.final = { t: 'rrace.ended', track: r.track, ranking, results };
  outRace(r, r.final);
  for (const s of r.seats) if (byUser.get(s.userId) === r.id) byUser.delete(s.userId);
  setTimeout(() => rooms.delete(r.id), RACE_DROP_MS * 2).unref?.(); // 留一下：剛好在結束時斷線的人重連還拿得到結果
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
  for (const r of rooms.values()) if (!r.ended) {
    r.ended = true; r.final = { t: 'rrace.ended', track: r.track, aborted: true, ranking: [], results: [] }; outRace(r, r.final);
    for (const s of r.seats) byUser.delete(s.userId);
    setTimeout(() => rooms.delete(r.id), RACE_DROP_MS * 2).unref?.();
  }
}

// ---------- v27 賽車房（好友跨頁面邀請；開房的執行個體負責這間房，訊息走 NOTIFY） ----------
const rrooms = new Map<string, RaceRoom>();
const ROOM_INTENTS = new Set(['rrace.rjoin', 'rrace.rleave', 'rrace.rconf', 'rrace.rready', 'rrace.rdrop']);
/** 送給一群使用者（不管連在哪個執行個體）：本機先送，再 NOTIFY（帶 src 避免回音重送） */
function outUsers(m: Record<string, unknown>) { deps!.local(m); void deps!.bus.publish({ ...m, src: deps!.instance() }).catch(() => {}); }
const roomNotice = (user: string, code: string) => outUsers({ t: 'rrace.notice', home: null, user, code });
function pushRoom(r: RaceRoom, extraGone: string[] = []) {
  const now = Date.now();
  if (r.members.length && !r.closed) outUsers({ t: 'rrace.room', users: r.members.map((m) => m.user), room: roomView(r, now) });
  const gone = r.closed ? [...r.members.map((m) => m.user), ...extraGone] : extraGone;
  if (gone.length) outUsers({ t: 'rrace.roomgone', users: gone, room: r.id, code: r.closed ?? 'LEFT' });
  if (r.closed) rrooms.delete(r.id);
}
/** 好友＝跟我有「家」關係的人：去過我家、我去過他家、或在彼此的邀請名單裡（目前沒有獨立的好友系統） */
export async function raceFriends(db: Db, userId: string): Promise<string[]> {
  const rows = await sql<{ uid: string }>`
    SELECT v.user_id AS uid FROM home_visits v JOIN homes h ON h.id = v.home_id WHERE h.owner_id = ${userId}
    UNION SELECT h.owner_id FROM home_visits v JOIN homes h ON h.id = v.home_id WHERE v.user_id = ${userId}
    UNION SELECT i.user_id FROM home_invites i JOIN homes h ON h.id = i.home_id WHERE h.owner_id = ${userId}
    UNION SELECT h.owner_id FROM home_invites i JOIN homes h ON h.id = i.home_id WHERE i.user_id = ${userId}`.execute(db as any);
  return [...new Set(rows.rows.map((r) => r.uid))].filter((u) => u !== userId);
}
async function roomName(userId: string) {
  const d = deps!.db as any;
  const u = await d.selectFrom('users').select(['display_name']).where('id', '=', userId).executeTakeFirst();
  const p = await d.selectFrom('pets').select(['name']).where('owner_id', '=', userId).where('status', 'in', ['egg', 'alive']).executeTakeFirst();
  return raceLabel(p?.name, u?.display_name);
}
const parseLaps = (v: unknown) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 && n <= MAX_LAPS ? n : null; };
/** 開房（在收到請求的執行個體上，這台就是這間房的負責者）。回傳房間 id。 */
export async function createRoom(userId: string, trackIn: unknown, lapsIn: unknown, now = Date.now(), game: 'race' | 'stairs' = 'race'): Promise<string> {
  if (!deps) fail('INTERNAL');
  const why = closingCode(now); if (why) fail(why);
  if (byUser.has(userId)) fail('ALREADY_IN_MATCH');
  if (game === 'stairs') { // 下樓梯房：沒有賽道／圈數設定（局長與規則同一般多人下樓梯）
    const r = newRoom(randomUUID(), deps!.instance(), { user: userId, name: await roomName(userId) }, '', 0, now, 'stairs', STAIRS_ROOM_MIN);
    rrooms.set(r.id, r); pushRoom(r); await inviteFriends(r, userId); return r.id;
  }
  const p = await getProfile(deps!.db, userId);
  const t = trackIn ? trackById(String(trackIn)) : cupTrack(p.cup) ?? TRACKS[0]; if (!t) fail('BAD_REQUEST');
  if (t!.countryIdx >= p.unlocked) fail('TRACK_LOCKED');
  const laps = lapsIn === undefined || lapsIn === null ? t!.laps : parseLaps(lapsIn); if (!laps) fail('BAD_REQUEST');
  const r = newRoom(randomUUID(), deps!.instance(), { user: userId, name: await roomName(userId) }, t!.id, laps!, now);
  rrooms.set(r.id, r); pushRoom(r); await inviteFriends(r, userId);
  return r.id;
}
async function inviteFriends(r: RaceRoom, userId: string) {
  try { const to = await raceFriends(deps!.db, userId); if (to.length) outUsers({ t: 'rrace.roominvite', to, room: r.id, inst: r.inst, game: r.game, from: userId, from_name: r.members[0].name, track: r.track, laps: r.laps }); }
  catch (err) { console.error('race room invite failed', err); }
}
/** 還能加入的房：沒關、沒在倒數、沒滿 */
export function roomOpen(r: RaceRoom): boolean {
  return !r.closed && r.countdownAt === null && r.members.length < (r.game === 'stairs' ? STAIRS_ROOM_MAX : MAX_HUMANS);
}
/** 本機負責的房裡，房主是 friends 之一、我不在裡面、還能加入的 */
export function friendRooms(user: string, friends: string[], game?: string): RaceRoom[] {
  const fs = new Set(friends);
  return [...rrooms.values()].filter((r) => roomOpen(r) && fs.has(r.host) && r.host !== user && !r.members.some((m) => m.user === user) && (!game || r.game === game))
    .sort((a, b) => b.createdAt - a.createdAt);
}
const roomListItem = (r: RaceRoom) => ({ room: r.id, inst: r.inst, game: r.game, host: r.host, host_name: r.members.find((m) => m.user === r.host)?.name ?? '', track: r.track, laps: r.laps, members: r.members.length, max: r.game === 'stairs' ? STAIRS_ROOM_MAX : MAX_HUMANS });
/** 各執行個體回答自己負責的房（rrace.rquery 走 NOTIFY 廣播） */
function onRoomQuery(m: any) {
  const user = String(m.user), friends = Array.isArray(m.friends) ? m.friends.map(String) : [];
  if (m.mode === 'list') { outUsers({ t: 'rrace.roomlist', users: [user], inst: deps!.instance(), rooms: friendRooms(user, friends, m.game ? String(m.game) : undefined).map(roomListItem) }); return; }
  const r = friendRooms(user, friends)[0]; // 彈窗一次只放一個：最新開的那間（其餘看選單裡的「好友的房間」）
  if (r) outUsers({ t: 'rrace.roominvite', to: [user], room: r.id, inst: r.inst, game: r.game, from: r.host, from_name: r.members.find((x) => x.user === r.host)?.name ?? '', track: r.track, laps: r.laps });
}
/** 有空了（離開房、房關了、比賽結束、剛連上）→ 再告訴他好友還開著的房；mode=list → 回傳好友的房間清單 */
export async function offerRooms(user: string, mode: 'invite' | 'list' = 'invite', game?: string): Promise<void> {
  if (!deps) return;
  const friends = await raceFriends(deps.db, user);
  const m = { t: 'rrace.rquery', user, friends, mode, game: game ?? null };
  onRoomQuery(m);
  if (!friends.length) return;
  await deps.bus.publish({ ...m, src: deps.instance() }).catch(() => {});
}
function onRoomIntent(m: any) {
  const r = rrooms.get(String(m.room)); const now = Date.now();
  if (!r) { if (m.t === 'rrace.rjoin') roomNotice(m.user, 'ROOM_CLOSED'); if (m.t !== 'rrace.rdrop') outUsers({ t: 'rrace.roomgone', users: [m.user], room: String(m.room), code: 'ROOM_CLOSED' }); return; }
  if (m.t === 'rrace.rjoin') {
    if (byUser.has(m.user)) return roomNotice(m.user, 'ALREADY_IN_MATCH');
    void roomName(m.user).then((name) => { const code = roomJoin(r, { user: m.user, name }, Date.now(), r.game === 'stairs' ? STAIRS_ROOM_MAX : MAX_HUMANS); if (code) return roomNotice(m.user, code); pushRoom(r); }).catch((err) => console.error('race room join failed', err));
    return;
  }
  if (m.t === 'rrace.rleave') { roomLeave(r, m.user, now); return pushRoom(r, [m.user]); }
  if (m.t === 'rrace.rdrop') { roomDrop(r, m.user, now); return pushRoom(r); }
  if (m.t === 'rrace.rconf') {
    if (r.game !== 'race') return roomNotice(m.user, 'BAD_REQUEST');
    const t = m.track ? trackById(String(m.track)) : null; if (m.track && !t) return roomNotice(m.user, 'BAD_REQUEST');
    const laps = m.laps === undefined || m.laps === null ? null : parseLaps(m.laps); if (m.laps != null && !laps) return roomNotice(m.user, 'BAD_REQUEST');
    const code = roomConfig(r, m.user, t?.id ?? null, laps, now); if (code) return roomNotice(m.user, code); return pushRoom(r);
  }
  if (m.t === 'rrace.rready') { const code = roomReady(r, m.user, !!m.ready, now); if (code) return roomNotice(m.user, code); return pushRoom(r); }
}
function stepRooms(now: number) {
  for (const r of [...rrooms.values()]) {
    const before = r.members.map((m) => m.user), host = r.host, cd = r.countdownAt, n = r.members.length;
    const go = roomTick(r, now);
    if (go === 'start') {
      rrooms.delete(r.id);
      const users = r.members.map((m) => m.user).filter((u) => !byUser.has(u));
      const why = closingCode(now);
      if (why || !users.length) { r.closed = why ?? 'EMPTY'; pushRoom(r); continue; }
      if (r.game === 'stairs') {
        const names = new Map(r.members.map((m) => [m.user, m.name]));
        void startRoomStairs(r.id, r.host, users, names).then((res) => {
          for (const d of res.dropped) roomNotice(d.user, d.code);
          outUsers({ t: 'rrace.roomgone', users: before, room: r.id, code: res.ok ? 'STARTED' : res.code ?? 'INTERNAL' });
        }).catch((err) => { console.error('stairs room start failed', err); outUsers({ t: 'rrace.roomgone', users: before, room: r.id, code: 'INTERNAL' }); });
        continue;
      }
      outUsers({ t: 'rrace.roomgone', users: before, room: r.id, code: 'STARTED' });
      void start(null, users.includes(r.host) ? r.host : users[0], users, r.track, null, undefined, { laps: r.laps });
      continue;
    }
    const removed = before.filter((u) => !r.members.some((m) => m.user === u));
    if (r.closed || removed.length || host !== r.host || cd !== r.countdownAt || n !== r.members.length) pushRoom(r, removed);
  }
}
export const _raceRooms = rrooms;
