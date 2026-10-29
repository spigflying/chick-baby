// 正式 1v1 格鬥：以家為單位選定 authority，房間本身由 @chick/engine 的決定性模組執行。
import { randomUUID } from 'node:crypto';
import { ARENA_PARAMS, canFightPet, phaseAt, poolShares, SFV, SFVRoom } from '@chick/engine';
import type { Db } from './db';
import type { Bus } from './bus';
import type { PresenceStore, PresenceUser } from './presence';
import { changeBalance, lockWallets } from './core';
import { clock } from './hours';
import { env } from './env';
import { raceBusy } from './racing';
import { mmatches, stairsInviting } from './mstairs';

const INVITE_MS = 10_000;
const START_GUARD_MS = 315_000;
const HOME_COOLDOWN_MS = ARENA_PARAMS.homeCooldownMs;
const STAKE = 20;

interface FightInvite { id: string; home: string; from: string; to: string; fromKey: string; toKey?: string; deadline: number }
interface Player { user: string; pet: string; name: string; control: string }
interface ActiveFight {
  id: string; home: string; players: [Player, Player]; room: any;
  damage: [number, number]; lastHp: [number, number]; settling: boolean; retryAt: number;
  outcome?: { win: number; reason: string }; abortReason?: string;
}
interface Deps {
  db: Db; bus: Bus; presence: PresenceStore; instance: () => string;
  local: (m: any) => void; bench?: (home: string, users: string[]) => void;
}

const invites = new Map<string, FightInvite>();
const fights = new Map<string, ActiveFight>();
const cooldowns = new Map<string, number>();
const starting = new Set<string>();
const reconciled = new Set<string>();
const reconciling = new Set<string>();
let deps: Deps | null = null;

export function initFight1v1(d: Omit<Deps, 'instance'> & { instance?: () => string }) {
  deps = { ...d, instance: d.instance ?? (() => env.instanceId) };
}
export function isFightAuthority(home: string) { return !!deps && deps.presence.instances(home)[0] === deps.instance(); }
export function fightBusy(home: string) { return invites.has(home) || fights.has(home) || starting.has(home) || reconciling.has(home); }
export function inFightAt(home: string, user: string) { return !!fights.get(home)?.players.some((p) => p.user === user); }
export function currentFightTick(home: string | null) { return home ? fights.get(home)?.room.tick ?? null : null; }

function output(m: any) {
  if (!deps) return;
  const msg = { ...m, src: deps.instance() };
  deps.local(msg);
  void deps.bus.publish(msg).catch(() => {});
}
function notice(home: string, user: string, code: string) { output({ t: 'fight.notice', home, user, code }); }
function user(home: string, id: string): PresenceUser | undefined { return deps!.presence.users(home).find((u) => u.id === id); }
function eligible(home: string, id: string) {
  const u = user(home, id);
  return !!u && deps!.presence.hasDesktop(home, id) && canFightPet(u.pet);
}
function ownerBlock(home: string): string | null {
  const owner = deps!.presence.ownerOf(home); if (!owner) return null;
  if (deps!.presence.ownerAway(home)) return 'OWNER_AWAY';
  const u = user(home, owner);
  if (!u) return 'OWNER_OFFLINE';
  if (u.pet?.sleeping) return 'OWNER_SLEEPING';
  if (u.pet?.sick) return 'OWNER_SICK';
  return null;
}
function startBlock(home: string, a: string, b: string, now = Date.now()): string | null {
  const phase = phaseAt(clock(), now);
  if (phase !== 'open') return phase === 'closing' ? 'GAME_CLOSING' : 'GAME_CLOSED';
  const closes = clock().status(now).closes_at;
  if (closes !== null && now + START_GUARD_MS > closes) return 'GAME_CLOSING';
  if ((cooldowns.get(home) ?? 0) > now) return 'HOME_COOLDOWN';
  if (raceBusy(home)) return 'RACE_BUSY';
  if (stairsInviting(home) || mmatches.has(home)) return 'STAIRS_BUSY';
  if (fightBusy(home) && !invites.has(home)) return 'FIGHT_BUSY';
  const ob = ownerBlock(home); if (ob) return ob;
  if (!eligible(home, a) || !eligible(home, b)) return 'NOT_ELIGIBLE';
  return null;
}

/** WS 所在執行個體用；authority 在本機就直接處理，否則走 NOTIFY。 */
export function routeFightIntent(m: any) {
  if (!deps || !m?.home) return;
  if (isFightAuthority(m.home)) handleIntent(m);
  else void deps.bus.publish(m).catch(() => {});
}
export function onFightBus(m: any) {
  if (!deps || !m?.home || !isFightAuthority(m.home)) return;
  if (m.t === 'fight.invite' || m.t === 'fight.reply' || m.t === 'fight.in') handleIntent(m);
}
function handleIntent(m: any) {
  if (m.t === 'fight.invite') invite(m.home, m.user, m.to, Date.now(), m.key);
  else if (m.t === 'fight.reply') reply(m.home, m.user, m.invite, !!m.accept, m.key);
  else if (m.t === 'fight.in') input(m.home, m.user, m);
}

export function invite(home: string, from: string, to: string, now = Date.now(), fromKey = deps?.presence.desktopKey(home, from) ?? '') {
  if (typeof to !== 'string' || to === from) return notice(home, from, 'NO_OPPONENT');
  if (fightBusy(home)) return notice(home, from, 'FIGHT_BUSY');
  const why = startBlock(home, from, to, now); if (why) return notice(home, from, why);
  const inv = { id: randomUUID(), home, from, to, fromKey, deadline: now + INVITE_MS };
  invites.set(home, inv);
  output({ t: 'fight.event', home, kind: 'invite', invite: inv.id, from, from_name: user(home, from)?.display_name ?? '?', to, left_ms: INVITE_MS });
}
export function reply(home: string, who: string, id: string, accept: boolean, key?: string) {
  const inv = invites.get(home);
  if (!inv || inv.id !== id || inv.to !== who) return notice(home, who, 'INVITE_GONE');
  invites.delete(home);
  if (!accept) return output({ t: 'fight.event', home, kind: 'invite_cancel', invite: id, from: inv.from, to: inv.to, code: 'DECLINED' });
  const why = startBlock(home, inv.from, inv.to); if (why) return output({ t: 'fight.event', home, kind: 'invite_cancel', invite: id, from: inv.from, to: inv.to, code: why });
  inv.toKey = key; void start(inv);
}

async function start(inv: FightInvite) {
  if (!deps || starting.has(inv.home) || fights.has(inv.home)) return;
  const blocked = startBlock(inv.home, inv.from, inv.to);
  if (blocked) return output({ t: 'fight.event', home: inv.home, kind: 'invite_cancel', invite: inv.id, from: inv.from, to: inv.to, code: blocked });
  starting.add(inv.home);
  let insertedId: string | null = null;
  try {
    const a = user(inv.home, inv.from)!, b = user(inv.home, inv.to)!;
    const id = randomUUID();
    const players: [Player, Player] = [
      { user: a.id, pet: a.pet!.id, name: a.display_name, control: deps.presence.hasKey(inv.home, inv.fromKey) ? inv.fromKey : deps.presence.desktopKey(inv.home, a.id)! },
      { user: b.id, pet: b.pet!.id, name: b.display_name, control: inv.toKey && deps.presence.hasKey(inv.home, inv.toKey) ? inv.toKey : deps.presence.desktopKey(inv.home, b.id)! },
    ];
    // DB 寫入是開打的前置條件；不能出現有比賽畫面卻無法冪等結算的場次。
    await deps.db.insertInto('fights').values({ id, home_id: inv.home, a_user_id: players[0].user, b_user_id: players[1].user,
      a_pet_id: players[0].pet, b_pet_id: players[1].pet, participants: JSON.stringify(players.map((p) => ({ user_id: p.user, pet_id: p.pet, dmg: 0 }))),
      status: 'playing', instance_id: deps.instance() }).execute();
    insertedId = id;
    if (!isFightAuthority(inv.home) || !eligible(inv.home, inv.from) || !eligible(inv.home, inv.to)) {
      await deps.db.updateTable('fights').set({ status: 'aborted', reason: 'START_CANCELLED', ended_at: new Date() }).where('id', '=', id).where('status', '=', 'playing').execute();
      return output({ t: 'fight.event', home: inv.home, kind: 'invite_cancel', invite: inv.id, from: inv.from, to: inv.to, code: 'NOT_ELIGIBLE' });
    }
    const active: ActiveFight = { id, home: inv.home, players, damage: [0, 0], lastHp: [SFV.HP_MAX, SFV.HP_MAX], settling: false, retryAt: 0, room: null };
    active.room = new (SFVRoom as any)({ matchId: id, now: Date.now(), closesAt: clock().status(Date.now()).closes_at ?? Infinity, users: players.map((p) => p.user),
      onTick: (_tick: number, state: any) => trackDamage(active, state),
      send: (pid: number, msg: any) => { if (pid === 1) roomMessage(active, msg); } });
    fights.set(inv.home, active);
    insertedId = null;
    deps.bench?.(inv.home, players.map((p) => p.user));
    output({ t: 'fight.event', home: inv.home, kind: 'start', fight_id: id, server_time: Date.now(), tick: 0,
      players: players.map((p, i) => ({ user_id: p.user, pet_id: p.pet, name: p.name, pid: i + 1 })), controllers: players.map((p) => p.control) });
    active.room.snapshot();
  } catch (err) {
    console.error('fight start failed', err);
    if (insertedId) await deps.db.updateTable('fights').set({ status: 'aborted', reason: 'START_FAILED', ended_at: new Date() })
      .where('id', '=', insertedId).where('status', '=', 'playing').execute().catch(() => {});
    output({ t: 'fight.event', home: inv.home, kind: 'invite_cancel', invite: inv.id, from: inv.from, to: inv.to, code: 'INTERNAL' });
  } finally { starting.delete(inv.home); }
}
function trackDamage(f: ActiveFight, state: any) {
  const hp: [number, number] = [state.p[0].hp, state.p[1].hp];
  f.damage[1] += Math.max(0, f.lastHp[0] - hp[0]);
  f.damage[0] += Math.max(0, f.lastHp[1] - hp[1]);
  f.lastHp = hp;
}
function roomMessage(f: ActiveFight, msg: any) {
  if (msg.type === 'sfv.ticks') output({ t: 'fight.ticks', home: f.home, fight_id: f.id, from: msg.from, m: msg.m, ack: msg.ack });
  else if (msg.type === 'sfv.snap') output({ t: 'fight.snap', home: f.home, fight_id: f.id, tick: msg.tick, s: msg.s, h: msg.h, ack: msg.ack, late: msg.late });
}
export function input(home: string, who: string, msg: any) {
  const f = fights.get(home); if (!f || f.id !== msg.fight_id) return;
  const pid = f.players.findIndex((p) => p.user === who && p.control === msg.key) + 1; if (!pid) return;
  f.room.receive(pid, { type: 'sfv.input', seq: msg.seq, inputs: msg.inputs }, Date.now());
}

export function fightPool(users: [string, string], damage: [number, number]) {
  const [a, b] = damage;
  return a + b === 0 ? { [users[0]]: 25, [users[1]]: 25 }
    : poolShares({ [users[0]]: a, [users[1]]: b }, 50);
}
function equalOrProportionalPool(f: ActiveFight) {
  return fightPool([f.players[0].user, f.players[1].user], f.damage);
}
async function finish(f: ActiveFight, win = f.room.state.win, reason = 'over') {
  if (!deps || f.settling || Date.now() < f.retryAt) return; f.settling = true;
  f.outcome ??= { win, reason };
  ({ win, reason } = f.outcome);
  const winner = win === 0 || win === 1 ? f.players[win].user : null;
  const loser = win === 0 || win === 1 ? f.players[1 - win].user : null;
  let completed = false;
  try {
    const result = await deps.db.transaction().execute(async (tx) => {
      const parts = f.players.map((p, i) => ({ user_id: p.user, pet_id: p.pet, name: p.name, dmg: f.damage[i], round_wins: f.room.state.w[i], hp: Math.max(0, f.room.state.p[i].hp), forfeit: reason === 'forfeit' && p.user === loser }));
      const row = await tx.updateTable('fights').set({ status: 'done', winner_user_id: winner, reason, ended_at: new Date(),
        a_hp: parts[0].hp, b_hp: parts[1].hp, participants: JSON.stringify(parts) })
        .where('id', '=', f.id).where('status', '=', 'playing').returning('id').executeTakeFirst();
      if (!row) return null;
      const wallets = await lockWallets(tx, f.players.map((p) => p.user));
      const balance = Object.fromEntries(wallets.map((w) => [w.user_id, w.balance]));
      const transfers: Record<string, number> = {};
      if (winner && loser) {
        const amount = Math.max(0, Math.min(STAKE, Math.floor(balance[loser] ?? 0)));
        transfers[loser] = -amount; transfers[winner] = amount;
        if (amount) { await changeBalance(tx, loser, -amount, 'fight', { type: 'fight', id: f.id }); await changeBalance(tx, winner, amount, 'fight', { type: 'fight', id: f.id }); }
      }
      const pool = equalOrProportionalPool(f);
      for (const p of f.players) if (pool[p.user] > 0) await changeBalance(tx, p.user, pool[p.user], 'fight_bonus', { type: 'fight', id: f.id });
      await tx.updateTable('fights').set({ transfer: winner ? transfers[winner] ?? 0 : 0 }).where('id', '=', f.id).execute();
      await tx.insertInto('audit_log').values({ user_id: winner ?? f.players[0].user, action: 'fight.settle', result: 'ok', target_type: 'fight', target_id: f.id,
        detail: JSON.stringify({ home: f.home, winner, loser, reason, transfers, pool, parts }) }).execute();
      return { parts, transfers, pool };
    });
    if (result) output({ t: 'fight.result', home: f.home, fight_id: f.id, winner, draw: !winner, reason,
      parts: result.parts.map((p: any) => ({ ...p, transfer: result.transfers[p.user_id] ?? 0, pool: result.pool[p.user_id] ?? 0,
        delta: (result.transfers[p.user_id] ?? 0) + (result.pool[p.user_id] ?? 0) })) });
    completed = true;
  } catch (err) { console.error('fight settle failed', err); f.retryAt = Date.now() + 1000; }
  finally {
    f.settling = false;
    if (completed) { cooldowns.set(f.home, Date.now() + HOME_COOLDOWN_MS); if (fights.get(f.home) === f) fights.delete(f.home); }
  }
}
async function abort(f: ActiveFight, reason: string) {
  if (!deps || f.settling || Date.now() < f.retryAt) return; f.settling = true; f.room.status = 'aborted';
  f.abortReason ??= reason; reason = f.abortReason;
  let completed = false;
  try {
    const row = await deps.db.updateTable('fights').set({ status: 'aborted', reason, ended_at: new Date() }).where('id', '=', f.id).where('status', '=', 'playing').returning('id').executeTakeFirst();
    if (row) output({ t: 'fight.event', home: f.home, kind: 'ended', fight_id: f.id, aborted: true, reason });
    completed = true;
  } catch (err) { console.error('fight abort failed', err); f.retryAt = Date.now() + 1000; }
  finally {
    f.settling = false;
    if (completed) { cooldowns.set(f.home, Date.now() + HOME_COOLDOWN_MS); if (fights.get(f.home) === f) fights.delete(f.home); }
  }
}

export function stepFights(now = Date.now()) {
  for (const inv of [...invites.values()]) if (now >= inv.deadline) {
    invites.delete(inv.home); output({ t: 'fight.event', home: inv.home, kind: 'invite_cancel', invite: inv.id, from: inv.from, to: inv.to, code: 'TIMEOUT' });
  }
  for (const f of [...fights.values()]) {
    if (!isFightAuthority(f.home)) { void abort(f, 'AUTHORITY_CHANGED'); continue; }
    f.room.update(now);
    if (f.room.status === 'done' && now >= f.retryAt) void finish(f);
    else if (f.room.status === 'aborted' && now >= f.retryAt) void abort(f, 'GAME_CLOSED');
  }
}
export function startFightLoop() { const t = setInterval(() => stepFights(), SFV.TICK_MS / 2); t.unref(); return t; }

/** Presence 變更：玩家最後一條電腦連線離開就判輸；新 authority 會清掉舊 instance 留下的 playing row。 */
export function onFightPresence(home: string) {
  if (!deps) return;
  const f = fights.get(home), inv = invites.get(home);
  if (!isFightAuthority(home)) {
    reconciled.delete(home);
    if (f) void abort(f, 'AUTHORITY_CHANGED');
    if (inv) { invites.delete(home); output({ t: 'fight.event', home, kind: 'invite_cancel', invite: inv.id, from: inv.from, to: inv.to, code: 'CANCELLED' }); }
    return;
  }
  if (!reconciled.has(home) && !f) { reconciled.add(home); reconciling.add(home); void reconcile(home).finally(() => reconciling.delete(home)); }
  if (inv && (!eligible(home, inv.from) || !eligible(home, inv.to))) {
    invites.delete(home); output({ t: 'fight.event', home, kind: 'invite_cancel', invite: inv.id, from: inv.from, to: inv.to, code: 'NOT_ELIGIBLE' });
  }
  if (!f) return;
  if (f.room.status !== 'playing') return; // 比賽已決出結果；等待 DB 結算重試時離線不改判。
  const ok = f.players.map((p) => eligible(home, p.user));
  for (let i = 0; i < 2; i++) if (ok[i] && !deps.presence.hasKey(home, f.players[i].control)) {
    f.players[i].control = deps.presence.desktopKey(home, f.players[i].user)!;
    // 換控制分頁後，新客戶端的 seq 從 1 開始；清掉舊分頁尚未執行的輸入。
    f.room.seq[i] = 0; f.room.inbox[i].clear(); f.room.last[i] = 0; f.room.edgeTick[i] = f.room.tick;
    output({ t: 'fight.event', home, kind: 'control', fight_id: f.id, user: f.players[i].user, pid: i + 1, controller: f.players[i].control });
  }
  if (ok[0] && ok[1]) {
    // 後進家門的連線沒看過最初的 start；重送可冪等套用的 sync，接著立即補一張快照。
    output({ t: 'fight.event', home, kind: 'sync', fight_id: f.id, server_time: Date.now(), tick: f.room.tick,
      players: f.players.map((p, i) => ({ user_id: p.user, pet_id: p.pet, name: p.name, pid: i + 1 })), controllers: f.players.map((p) => p.control) });
    f.room.snapshot();
    return;
  }
  if (!ok[0] && !ok[1]) void abort(f, 'BOTH_LEFT');
  else { f.room.status = 'done'; void finish(f, ok[0] ? 0 : 1, 'forfeit'); }
}
async function reconcile(home: string) {
  if (!deps || !isFightAuthority(home) || fights.has(home)) return;
  try {
    const last = await deps.db.selectFrom('fights').select('ended_at').where('home_id', '=', home).where('ended_at', 'is not', null).orderBy('ended_at', 'desc').executeTakeFirst();
    if (last?.ended_at) cooldowns.set(home, Math.max(cooldowns.get(home) ?? 0, new Date(last.ended_at).getTime() + HOME_COOLDOWN_MS));
    const stale = await deps.db.updateTable('fights').set({ status: 'aborted', reason: 'AUTHORITY_CHANGED', ended_at: new Date() })
      .where('home_id', '=', home).where('status', '=', 'playing').returning('id').execute();
    if (stale.length) cooldowns.set(home, Math.max(cooldowns.get(home) ?? 0, Date.now() + HOME_COOLDOWN_MS));
    for (const row of stale) output({ t: 'fight.event', home, kind: 'ended', fight_id: row.id, aborted: true, reason: 'AUTHORITY_CHANGED' });
  } catch (err) { console.error('fight reconcile failed', err); reconciled.delete(home); }
}
export async function abortFights(reason = 'SERVER_CLOSED') {
  invites.clear();
  await Promise.all([...fights.values()].map((f) => { f.retryAt = 0; return abort(f, reason); }));
}

export const _fightInvites = invites;
export const _fights = fights;
export const _fightCooldowns = cooldowns;
