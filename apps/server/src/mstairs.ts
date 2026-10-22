// M2 多人下樓梯（requirements §4.4、§5.0）。以家為單位：在場的人發起 → 其他人 15 秒內回覆 → 發起人＋參加者（2–6 隻）開始。
// 同打架模式：每個家由「目前有連線的最小 instance id」負責模擬；意圖與狀態經過 LISTEN/NOTIFY，
// 這個家只有自己一個執行個體時直接在本機處理（不走 NOTIFY）。
import { randomUUID } from 'node:crypto';
import { applyStairsResult, checkStairsStart, createInvite, createStairs, ENGINE_VERSION, inviteOutcome, leaveStairs, multiStairsCoins, phaseAt, replyInvite, setInput,
  stairsRanking, stairsTimeUp, stepStairs, STAIRS_CUTOFF_MS, STAIRS_MIN_START_MS, STAIRS_MULTI, STAIRS_PARAMS, type Invite, type StairsState } from '@chick/engine';
import type { Db } from './db';
import type { Bus } from './bus';
import type { PresenceStore, PresenceUser } from './presence';
import { changeBalance, lockWallets, notify } from './core';
import { insertEvents, lockPet, petLook, savePet, settle, spriteKey } from './pets';
import { randomSeed, stableHash } from './util';
import { env } from './env';
import { clock } from './hours';

const P = STAIRS_PARAMS;
const TICK_MS = 1000 / P.tickRate;
/** match.started 送出後多久開始第 0 tick（同單人；再長的話倒數中按鍵會超過「目前 tick + 緩衝 + 15」被拒絕）。 */
const START_DELAY_MS = 500;
/** 正在進行（或當掉沒收尾）的局：開始時間在這之內才算「已經在比賽中」。 */
const ACTIVE_WINDOW_MS = 61 * 60_000;

interface PendingInput { tick: number; seq: number; left: boolean; right: boolean }
interface Seat { userId: string; petId: string; name: string; sp: string; num: number; pending: PendingInput[]; lastSeq: number; lastProcessedSeq: number; late: number }
export interface MMatch { id: string; home: string; host: string; state: StairsState; startAt: number; closingEnd: boolean; seats: Seat[]; ended: boolean;
  /** v27 下樓梯房開的局：home 是虛擬鍵 'room:<id>'，由開房的執行個體負責；獎勵改成前三名 150／100／50 */
  room?: { inst: string } }
interface Lobby { home: string; invite: Invite; deadlines: Map<string, number> }
const lobbies = new Map<string, Lobby>();
/** home → 進行中的多人局 */
export const mmatches = new Map<string, MMatch>();
const starting = new Set<string>();

interface Deps {
  db: Db; bus: Bus; presence: PresenceStore; instance: () => string;
  /** 只有自己一個執行個體時，送出的訊息直接交給本機（ws.ts 轉給連線） */
  local?: (m: any) => void;
  /** 打架模式（arena.ts）：這個人正在對戰中？這個家有邀請或對戰進行中？開始時把參賽者移出打架場地 */
  inFight?: (home: string, user: string) => boolean; fightBusy?: (home: string) => boolean; bench?: (home: string, users: string[]) => void;
}
let deps: Deps | null = null;
export function initMStairs(d: Omit<Deps, 'instance'> & { instance?: () => string }) { deps = { ...d, instance: d.instance ?? (() => env.instanceId) }; }

const isAuthority = (home: string) => !!deps && deps.presence.instances(home)[0] === deps.instance();
/** 送給這個家的所有執行個體（只有自己一個時直接本機處理）。 */
function out(m: Record<string, unknown> & { home: string }) {
  if (m.home.startsWith('room:')) { void deps!.bus.publish(m).catch(() => {}); return; } // v27 房間局：成員可能在任何執行個體 → 一律 NOTIFY（本機也從 LISTEN 收）
  const inst = deps!.presence.instances(m.home);
  if (deps!.local && inst.length === 1 && inst[0] === deps!.instance()) deps!.local(m);
  else void deps!.bus.publish(m).catch(() => {});
}
/** 送給負責這個家的執行個體（自己就是 → 直接處理）。 */
export function toAuthority(m: Record<string, unknown> & { t: string; home: string; inst?: string }) {
  if (!deps) return;
  if (m.inst ? m.inst === deps.instance() : isAuthority(m.home)) onMStairsBus(m); else void deps.bus.publish(m).catch(() => {});
}
const notice = (home: string, user: string, code: string) => out({ t: 'mstairs.notice', home, user, code });
const okPet = (p: PresenceUser['pet'] | undefined) => !!p && p.status === 'alive' && !p.sleeping;
const label = (u: PresenceUser) => `${u.pet?.name ?? '?'}（${u.display_name}）`;
/** 這位使用者正在這個家的多人下樓梯比賽中？打架模式用（比賽中的寵物暫時退出打架場地）。 */
export function inStairs(home: string, user: string) {
  const m = mmatches.get(home);
  return !!m && !m.ended && m.seats.some((s) => s.userId === user);
}
export const stairsInviting = (home: string) => lobbies.has(home) || starting.has(home);

/** 19:58 起不能開新局（19:59 時間到），同單人。 */
function closingBlock(now: number): string | null {
  if (phaseAt(clock(), now) === 'closed') return 'GAME_CLOSED';
  const closesAt = clock().status(now).closes_at;
  if (closesAt !== null && now + START_DELAY_MS + STAIRS_MIN_START_MS > closesAt - STAIRS_CUTOFF_MS) return 'GAME_CLOSING';
  return null;
}

/** 每個執行個體都收到同一則 NOTIFY；只有負責的執行個體處理意圖。 */
export function onMStairsBus(m: any) {
  if (!deps || !m?.home || typeof m.t !== 'string') return;
  if (!['mstairs.invite', 'mstairs.reply', 'mstairs.cancel', 'mstairs.in', 'mstairs.leave'].includes(m.t) || !(m.inst ? m.inst === deps.instance() : isAuthority(m.home))) return;
  const deadline = Number.isFinite(m.deadline) ? Number(m.deadline) : Infinity;
  if (m.t === 'mstairs.invite') invite(m.home, m.user, deadline);
  else if (m.t === 'mstairs.reply') reply(m.home, m.user, String(m.invite), !!m.accept, deadline);
  else if (m.t === 'mstairs.cancel') { const lb = lobbies.get(m.home); if (lb && lb.invite.from === m.user) cancelLobby(lb, 'CANCELLED'); }
  else if (m.t === 'mstairs.in') { const x = mmatches.get(m.home); const seat = x?.seats.find((s) => s.userId === m.user); if (x && seat && !x.ended) { const r = handleSeatInput(x, seat, m); if (r.error) notice(m.home, m.user, r.error); } }
  else if (m.t === 'mstairs.leave') leave(m.home, m.user);
}

export function invite(home: string, user: string, deadline = Infinity, now = Date.now()) {
  const why = closingBlock(now); if (why) return notice(home, user, why);
  if (lobbies.has(home) || starting.has(home) || mmatches.has(home)) return notice(home, user, 'STAIRS_BUSY');
  if (deps!.fightBusy?.(home)) return notice(home, user, 'FIGHT_BUSY');
  const users = deps!.presence.users(home), me = users.find((u) => u.id === user);
  if (!me || !okPet(me.pet)) return notice(home, user, 'NOT_ELIGIBLE');
  if (deps!.inFight?.(home, user)) return notice(home, user, 'IN_FIGHT');
  const others = users.filter((u) => u.id !== user && okPet(u.pet) && !deps!.inFight?.(home, u.id)).map((u) => u.id);
  if (!others.length) return notice(home, user, 'NO_OPPONENT');
  const inv = createInvite(randomUUID(), user, others, now, STAIRS_MULTI.inviteMs);
  lobbies.set(home, { home, invite: inv, deadlines: new Map([[user, deadline]]) });
  out({ t: 'mstairs.event', home, kind: 'invite', invite: inv.id, from: user, from_name: label(me), to: inv.to, left_ms: STAIRS_MULTI.inviteMs, max: STAIRS_MULTI.maxPlayers });
}
function reply(home: string, user: string, id: string, accept: boolean, deadline: number) {
  const lb = lobbies.get(home); if (!lb || lb.invite.id !== id) return;
  const full = accept && lb.invite.accepted.length + 1 >= STAIRS_MULTI.maxPlayers;
  if (full) notice(home, user, 'MATCH_FULL');
  if (!replyInvite(lb.invite, user, accept && !full)) return;
  if (accept && !full) lb.deadlines.set(user, deadline);
  out({ t: 'mstairs.event', home, kind: 'reply', invite: id, user, accept: accept && !full, count: lb.invite.accepted.length + 1 });
  resolveLobby(lb);
}
function cancelLobby(lb: Lobby, code: string) {
  if (lobbies.get(lb.home) !== lb) return;
  lobbies.delete(lb.home);
  out({ t: 'mstairs.event', home: lb.home, kind: 'invite_cancel', invite: lb.invite.id, from: lb.invite.from, code });
}
/** 全部回覆或時間到：發起人＋參加者（仍在場、寵物仍合格）至少 2 隻就開始，否則取消。 */
function resolveLobby(lb: Lobby, now = Date.now()) {
  const o = inviteOutcome(lb.invite, now); if (!o.done) return;
  const present = new Map(deps!.presence.users(lb.home).map((u) => [u.id, u]));
  const parts = (o.participants ?? []).filter((u) => okPet(present.get(u)?.pet) && !deps!.inFight?.(lb.home, u));
  if (parts.length < STAIRS_MULTI.minPlayers || !parts.includes(lb.invite.from)) return cancelLobby(lb, 'NOT_ENOUGH_PLAYERS');
  lobbies.delete(lb.home);
  void start(lb.home, lb.invite, parts, lb.deadlines);
}

/** 開始：transaction 內重新檢查每隻寵物（精力、醒著、沒有在別場），不合格的移出；剩不到 2 隻就取消。 */
async function start(home: string, inv: Invite, users: string[], deadlines: Map<string, number>) {
  const { db, presence } = deps!;
  starting.add(home);
  try {
    const why = closingBlock(Date.now());
    if (why) return out({ t: 'mstairs.event', home, kind: 'invite_cancel', invite: inv.id, from: inv.from, code: why });
    const seed = randomSeed();
    const res = await db.transaction().execute(async (tx) => {
      const rows = await tx.selectFrom('pets').select(['id', 'owner_id']).where('owner_id', 'in', users).where('status', 'in', ['egg', 'alive']).orderBy('id').execute();
      const busy = new Set((await tx.selectFrom('stair_match_players').innerJoin('stair_matches', 'stair_matches.id', 'stair_match_players.match_id').select('stair_match_players.user_id')
        .where('stair_match_players.user_id', 'in', users).where('stair_matches.status', '=', 'playing').where('stair_matches.started_at', '>', new Date(Date.now() - ACTIVE_WINDOW_MS)).execute()).map((r: any) => r.user_id));
      const ok: { user: string; pet: string; speed: number; stamina: number }[] = [];
      const dropped: { user: string; code: string }[] = [];
      for (const r of rows) {
        if (busy.has(r.owner_id)) { dropped.push({ user: r.owner_id, code: 'ALREADY_IN_MATCH' }); continue; }
        const row = await lockPet(tx, r.id);
        const { state } = await settle(tx, row);
        await savePet(tx, row.id, state);
        const err = checkStairsStart(state);
        if (err) dropped.push({ user: r.owner_id, code: err });
        else ok.push({ user: r.owner_id, pet: row.id, speed: state.speed, stamina: state.stamina });
      }
      for (const u of users) if (!rows.some((r: any) => r.owner_id === u)) dropped.push({ user: u, code: 'NO_PET' });
      if (ok.length < STAIRS_MULTI.minPlayers || !ok.some((o) => o.user === inv.from)) return { ok: null, dropped };
      const m = await tx.insertInto('stair_matches').values({ mode: 'multi', home_id: home, host_user_id: inv.from, status: 'playing', instance_id: deps!.instance(), seed, engine_version: ENGINE_VERSION, config: JSON.stringify(P), started_at: new Date() })
        .returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('stair_match_players').values(ok.map((o) => ({ match_id: m.id, user_id: o.user, pet_id: o.pet }))).execute();
      return { ok, id: m.id as string, dropped };
    });
    for (const d of res.dropped) notice(home, d.user, d.code);
    if (!res.ok) return out({ t: 'mstairs.event', home, kind: 'invite_cancel', invite: inv.id, from: inv.from, code: 'NOT_ENOUGH_PLAYERS' });
    const startAt = Date.now() + START_DELAY_MS;
    const closesAt = clock().status(startAt).closes_at;
    const cutoff = closesAt === null ? Infinity : closesAt - STAIRS_CUTOFF_MS;
    const endAt = Math.min(cutoff, ...res.ok.map((o) => deadlines.get(o.user) ?? Infinity));
    const ticks = Math.max(1, Math.min(P.matchMaxTicks, Math.floor((endAt - startAt) / TICK_MS)));
    const mp = { ...P, matchMaxTicks: ticks };
    await db.updateTable('stair_matches').set({ config: JSON.stringify(mp) }).where('id', '=', res.id!).execute();
    const pu = new Map(presence.users(home).map((u) => [u.id, u]));
    // 依 pet id 排序（引擎的玩家順序）；畫面編號 1–n
    const seats: Seat[] = res.ok.map((o, i) => {
      const u = pu.get(o.user);
      return { userId: o.user, petId: o.pet, name: u ? label(u) : '?', sp: u?.pet ? spriteKey(u.pet) : 'chicken', num: i + 1, pending: [], lastSeq: 0, lastProcessedSeq: 0, late: 0 };
    });
    const m: MMatch = { id: res.id!, home, host: inv.from, state: createStairs(seed, res.ok.map((o) => ({ petId: o.pet, speed: o.speed, stamina: o.stamina })), mp),
      startAt, closingEnd: ticks < P.matchMaxTicks && endAt === cutoff, seats, ended: false };
    mmatches.set(home, m);
    deps!.bench?.(home, seats.map((s) => s.userId));
    out({ t: 'mstairs.started', home, match_id: m.id, seed, engine_version: ENGINE_VERSION, config_hash: stableHash(mp), start_tick: 0, server_time_at_start: startAt, params: mp,
      ends_at: startAt + ticks * TICK_MS, closing_end: m.closingEnd,
      players: res.ok.map((o, i) => ({ user_id: o.user, pet_id: o.pet, name: seats[i].name, sp: seats[i].sp, num: seats[i].num, speed: o.speed, stamina: o.stamina })) });
    out({ t: 'mstairs.event', home, kind: 'start', invite: inv.id, match_id: m.id, users: seats.map((s) => s.userId), names: seats.map((s) => s.name) });
  } catch (err) {
    console.error('multi stairs start failed', err);
    out({ t: 'mstairs.event', home, kind: 'invite_cancel', invite: inv.id, from: inv.from, code: 'INTERNAL' });
  } finally { starting.delete(home); }
}

export const currentTick = (m: MMatch, now = Date.now()) => Math.floor((now - m.startAt) / TICK_MS);
/** 同單人（requirements §5.3）：seq 遞增、超前太多拒絕、遲到改在下一個 tick 套用並記 late；每位玩家各自計算。 */
export function handleSeatInput(m: MMatch, seat: Seat, msg: any) {
  const seq = Number(msg.seq), tick = Number(msg.tick);
  if (!Number.isInteger(seq) || !Number.isInteger(tick) || seq <= seat.lastSeq) return { error: 'BAD_INPUT' };
  if (tick > currentTick(m) + P.inputBufferTicks + 15) return { error: 'INPUT_TOO_EARLY' };
  seat.lastSeq = seq;
  let at = tick;
  if (tick <= m.state.tick) { at = m.state.tick + 1; seat.late++; }
  seat.pending.push({ tick: at, seq, left: !!msg.left, right: !!msg.right });
  return { late: at !== tick };
}
/** 比賽中離開（按離開／離開這個家／斷線）＝當下出局；報名中＝退出（發起人退出＝取消）。 */
export function leave(home: string, user: string) {
  const m = mmatches.get(home), seat = m?.seats.find((s) => s.userId === user);
  if (m && seat && !m.ended) { leaveStairs(m.state, seat.petId); return; }
  const lb = lobbies.get(home); if (!lb) return;
  if (lb.invite.from === user) return cancelLobby(lb, 'CANCELLED');
  if (lb.invite.accepted.includes(user)) { lb.invite.accepted = lb.invite.accepted.filter((u) => u !== user); lb.invite.declined.push(user); out({ t: 'mstairs.event', home, kind: 'reply', invite: lb.invite.id, user, accept: false, count: lb.invite.accepted.length + 1 }); }
  else if (replyInvite(lb.invite, user, false)) out({ t: 'mstairs.event', home, kind: 'reply', invite: lb.invite.id, user, accept: false, count: lb.invite.accepted.length + 1 });
  resolveLobby(lb);
}
/** 在場名單變了：不在這個家的人出局／退出報名；負責的執行個體換人 → 這一局中止、報名取消。 */
export function onMStairsPresence(home: string) {
  if (!deps) return;
  const m = mmatches.get(home), lb = lobbies.get(home);
  if (!m && !lb) return;
  if (!isAuthority(home)) { if (m && !m.ended) void abort(m); if (lb) { lobbies.delete(home); void deps.bus.publish({ t: 'mstairs.event', home, kind: 'invite_cancel', invite: lb.invite.id, from: lb.invite.from, code: 'CANCELLED' }).catch(() => {}); } return; }
  const here = new Map(deps.presence.users(home).map((u) => [u.id, u]));
  if (m && !m.ended) for (const s of m.seats) if (!here.has(s.userId) || here.get(s.userId)!.pet?.id !== s.petId) leaveStairs(m.state, s.petId);
  if (lb) for (const u of [lb.invite.from, ...lb.invite.to]) if (!here.has(u)) leave(home, u);
}

export function snapMsg(m: MMatch) {
  return { t: 'mstairs.snap', home: m.home, match_id: m.id, tick: m.state.tick, state: m.state,
    seqs: Object.fromEntries(m.seats.map((s) => [s.userId, s.lastProcessedSeq])), late: Object.fromEntries(m.seats.map((s) => [s.userId, s.late])) };
}
export function stepMStairs(now = Date.now()) {
  if (!deps) return;
  for (const lb of [...lobbies.values()]) { if (!isAuthority(lb.home)) onMStairsPresence(lb.home); else resolveLobby(lb, now); }
  for (const m of [...mmatches.values()]) {
    if (m.ended) continue;
    if (m.room ? m.room.inst !== deps.instance() : !isAuthority(m.home)) { void abort(m); continue; }
    const target = currentTick(m, now);
    while (m.state.tick < target && !m.state.over) {
      const next = m.state.tick + 1;
      for (const s of m.seats) {
        s.pending.sort((a, b) => a.tick - b.tick || a.seq - b.seq);
        while (s.pending.length && s.pending[0].tick <= next) { const i = s.pending.shift()!; setInput(m.state, s.petId, i.left, i.right); s.lastProcessedSeq = i.seq; }
      }
      stepStairs(m.state);
      if (m.state.tick % P.snapshotEvery === 0 || m.state.over) out(snapMsg(m));
    }
    if (m.state.over) void finish(m, 'over'); // 也包含開始前就有人走掉、只剩 1 隻
  }
}
export function startMStairsLoop() { const t = setInterval(() => stepMStairs(), TICK_MS / 2); t.unref(); return t; }

/**
 * 結算（冪等：只有 status = 'playing' 的那一筆會更新）。單一 transaction：依 user id 排序鎖所有錢包，再依 pet id 排序鎖寵物；
 * 每位：消耗與成長同單人（用自己的樓層），金幣 ◎5 + (人數 − 名次) × 3（寵物還活著才發），coin_ledger reason = stairs_match。
 */
export async function finish(m: MMatch, reason: 'over' | 'quit') {
  if (m.ended || !deps) return null; m.ended = true;
  const { db } = deps;
  const rank = new Map(stairsRanking(m.state).map((r) => [r.petId, r]));
  const n = m.seats.length;
  try {
    const results = await db.transaction().execute(async (tx) => {
      const row0 = await tx.updateTable('stair_matches').set({ status: 'done', ended_at: new Date() }).where('id', '=', m.id).where('status', '=', 'playing').returning('id').executeTakeFirst();
      if (!row0) return null; // 已結算或已中止
      await lockWallets(tx, m.seats.map((s) => s.userId));
      const homes = new Map((await tx.selectFrom('homes').select(['id', 'owner_id']).where('owner_id', 'in', m.seats.map((s) => s.userId)).execute()).map((h: any) => [h.owner_id, h.id]));
      const list: { user_id: string; pet_id: string; name: string; num: number; rank: number; floor: number; coins: number; cause: string | null }[] = [];
      for (const s of [...m.seats].sort((a, b) => (a.petId < b.petId ? -1 : 1))) {
        const r = rank.get(s.petId)!;
        const row = await lockPet(tx, s.petId);
        const { state } = await settle(tx, row);
        let coins = 0;
        if (state.status === 'alive') { applyStairsResult(state, r.floor, undefined, m.state.tick); coins = m.room ? (ROOM_PRIZES[r.rank - 1] ?? 0) : multiStairsCoins(n, r.rank); }
        await savePet(tx, s.petId, state);
        if (coins > 0) await changeBalance(tx, s.userId, coins, 'stairs_match', { type: 'stair_match', id: m.id });
        await insertEvents(tx, s.petId, [{ type: 'stairs_match', actor: s.userId, payload: { match_id: m.id, floors: r.floor, rank: r.rank, players: n, coins, reason, cause: r.cause } }]);
        await tx.updateTable('stair_match_players').set({ rank: r.rank, floors: r.floor, eliminated_at_tick: r.diedAtTick ?? m.state.tick, coins_awarded: coins })
          .where('match_id', '=', m.id).where('user_id', '=', s.userId).execute();
        const h = homes.get(s.userId); if (h) await notify(tx, { t: 'pet', home: h, pet: s.petId, ev: { type: 'stairs_match', floors: r.floor, rank: r.rank } });
        list.push({ user_id: s.userId, pet_id: s.petId, name: s.name, num: s.num, rank: r.rank, floor: r.floor, coins, cause: r.cause });
      }
      await tx.insertInto('audit_log').values({ user_id: m.host, action: 'stairs.finish_multi', result: 'ok', target_type: 'stair_match', target_id: m.id,
        detail: JSON.stringify({ home: m.home, reason, players: list.map((o) => ({ user: o.user_id, rank: o.rank, floors: o.floor, coins: o.coins })), late: Object.fromEntries(m.seats.map((s) => [s.userId, s.late])) }) }).execute();
      return list.sort((a, b) => a.rank - b.rank || a.num - b.num);
    });
    if (results) out({ t: 'mstairs.ended', home: m.home, match_id: m.id, final_tick: m.state.tick, time_up: stairsTimeUp(m.state), closing: m.closingEnd && stairsTimeUp(m.state), players: results });
    return results;
  } catch (err) {
    console.error('multi stairs finish failed', err);
    out({ t: 'mstairs.ended', home: m.home, match_id: m.id, error: 'INTERNAL', players: [] });
    return null;
  } finally { if (mmatches.get(m.home) === m) mmatches.delete(m.home); }
}

/** 中止（負責的執行個體換人、SIGTERM、20:00）：標記 aborted，不發獎勵、不扣精力。 */
async function abort(m: MMatch) {
  if (m.ended || !deps) return; m.ended = true;
  if (mmatches.get(m.home) === m) mmatches.delete(m.home);
  await deps.db.updateTable('stair_matches').set({ status: 'aborted', ended_at: new Date() }).where('id', '=', m.id).where('status', '=', 'playing').execute().catch(() => {});
  // 可能已經不是負責的執行個體了：一律走 NOTIFY，讓連在其他執行個體上的玩家也收到
  await deps.bus.publish({ t: 'mstairs.ended', home: m.home, match_id: m.id, aborted: true, players: [] }).catch(() => {});
  deps.local?.({ t: 'mstairs.ended', home: m.home, match_id: m.id, aborted: true, players: [] });
}
export async function abortMStairs() {
  lobbies.clear();
  await Promise.all([...mmatches.values()].map((m) => abort(m)));
}
export const _lobbies = lobbies;
/** v27 房間獎勵（賽車房、下樓梯房共用）：前三名 ◎150／100／50 */
export const ROOM_PRIZES = [150, 100, 50];
export const STAIRS_ROOM_MAX = STAIRS_MULTI.maxPlayers, STAIRS_ROOM_MIN = STAIRS_MULTI.minPlayers;
/**
 * v27 下樓梯房開局：沒有「家」與在場名單，名字／精靈直接查資料庫；虛擬 home 鍵 'room:<房間 id>'，
 * 由呼叫的執行個體（開房的那台）負責模擬。檢查同一般多人局（寵物合格、沒有在別場），不到 2 隻就不開。
 */
export async function startRoomStairs(roomId: string, host: string, users: string[], names: Map<string, string>): Promise<{ ok: boolean; code?: string; dropped: { user: string; code: string }[] }> {
  if (!deps) return { ok: false, code: 'INTERNAL', dropped: [] };
  const { db } = deps, home = `room:${roomId}`;
  const why = closingBlock(Date.now()); if (why) return { ok: false, code: why, dropped: [] };
  const seed = randomSeed();
  const hostHome = (await db.selectFrom('homes').select('id').where('owner_id', '=', host).executeTakeFirst())?.id ?? null;
  const res = await db.transaction().execute(async (tx) => {
    const rows = await tx.selectFrom('pets').select(['id', 'owner_id']).where('owner_id', 'in', users).where('status', 'in', ['egg', 'alive']).orderBy('id').execute();
    const busy = new Set((await tx.selectFrom('stair_match_players').innerJoin('stair_matches', 'stair_matches.id', 'stair_match_players.match_id').select('stair_match_players.user_id')
      .where('stair_match_players.user_id', 'in', users).where('stair_matches.status', '=', 'playing').where('stair_matches.started_at', '>', new Date(Date.now() - ACTIVE_WINDOW_MS)).execute()).map((r: any) => r.user_id));
    const ok: { user: string; pet: string; speed: number; stamina: number; sp: string }[] = [], dropped: { user: string; code: string }[] = [];
    for (const r of rows) {
      if (busy.has(r.owner_id)) { dropped.push({ user: r.owner_id, code: 'ALREADY_IN_MATCH' }); continue; }
      const row = await lockPet(tx, r.id); const { state } = await settle(tx, row); await savePet(tx, row.id, state);
      const err = checkStairsStart(state);
      if (err) dropped.push({ user: r.owner_id, code: err }); else ok.push({ user: r.owner_id, pet: row.id, speed: state.speed, stamina: state.stamina, sp: spriteKey({ species: (row as any).species_id, look: petLook(row) }) });
    }
    for (const u of users) if (!rows.some((r: any) => r.owner_id === u)) dropped.push({ user: u, code: 'NO_PET' });
    if (ok.length < STAIRS_MULTI.minPlayers) return { ok: null, dropped };
    const m = await tx.insertInto('stair_matches').values({ mode: 'multi', home_id: hostHome, host_user_id: host, status: 'playing', instance_id: deps!.instance(), seed, engine_version: ENGINE_VERSION, config: JSON.stringify(P), started_at: new Date() } as any)
      .returning('id').executeTakeFirstOrThrow();
    await tx.insertInto('stair_match_players').values(ok.map((o) => ({ match_id: m.id, user_id: o.user, pet_id: o.pet }))).execute();
    return { ok, id: m.id as string, dropped };
  });
  if (!res.ok) return { ok: false, code: 'NOT_ENOUGH_PLAYERS', dropped: res.dropped };
  const startAt = Date.now() + START_DELAY_MS, closesAt = clock().status(startAt).closes_at;
  const endAt = closesAt === null ? Infinity : closesAt - STAIRS_CUTOFF_MS;
  const ticks = Math.max(1, Math.min(P.matchMaxTicks, Math.floor((endAt - startAt) / TICK_MS)));
  const mp = { ...P, matchMaxTicks: ticks };
  await db.updateTable('stair_matches').set({ config: JSON.stringify(mp) }).where('id', '=', res.id!).execute();
  const seats: Seat[] = res.ok.map((o, i) => ({ userId: o.user, petId: o.pet, name: names.get(o.user) ?? '?', sp: o.sp, num: i + 1, pending: [], lastSeq: 0, lastProcessedSeq: 0, late: 0 }));
  const m: MMatch = { id: res.id!, home, host, state: createStairs(seed, res.ok.map((o) => ({ petId: o.pet, speed: o.speed, stamina: o.stamina })), mp), startAt, closingEnd: ticks < P.matchMaxTicks, seats, ended: false, room: { inst: deps.instance() } };
  mmatches.set(home, m);
  out({ t: 'mstairs.started', home, inst: deps.instance(), users: seats.map((x) => x.userId), match_id: m.id, seed, engine_version: ENGINE_VERSION, config_hash: stableHash(mp), start_tick: 0, server_time_at_start: startAt, params: mp,
    ends_at: startAt + ticks * TICK_MS, closing_end: m.closingEnd, room: true,
    players: res.ok.map((o, i) => ({ user_id: o.user, pet_id: o.pet, name: seats[i].name, sp: seats[i].sp, num: seats[i].num, speed: o.speed, stamina: o.stamina })) });
  return { ok: true, dropped: res.dropped };
}
export const _mstairsDeps = () => deps;
