// v1.5 打架模式 v2（混戰）。每個家由「目前有連線的最小 instance id」負責模擬；
// 輸入與狀態都經過 LISTEN/NOTIFY，所以不論玩家連到哪個執行個體都看到同一場。
import { spriteKey } from './pets';
import { randomUUID } from 'node:crypto';
import { addFighter, ARENA_PARAMS, cancelFights, canFightPet, createArena, createInvite, inviteOutcome, meleeTransfers, poolShares, replyInvite, startFightWith, type Invite, phaseAt, removeFighter, setArenaInput, setFighterItems, stepArena, type ArenaEvent, type ArenaState, type FightEnd, type ItemId } from '@chick/engine';
import type { Db } from './db';
import type { Bus } from './bus';
import { changeBalance, lockWallets, notify } from './core';
import { clock } from './hours';
import { env } from './env';
import type { PresenceStore } from './presence';
import { listItems } from './items';
import { inStairs, stairsInviting } from './mstairs';

const P = ARENA_PARAMS;
const TICK_MS = 1000 / P.tickRate;
export const FIGHT_COIN_CAP = 20;
/** 決勝瞬間凍結畫面（伺服器暫停模擬）多久 */
export const FREEZE_MS = 1500;
interface Arena { home: string; state: ArenaState; startAt: number; invite?: Invite; lastKey?: string; lastSnapAt?: number; frozenUntil?: number; frozenTick?: number }
const arenas = new Map<string, Arena>();
const homeCooldown = new Map<string, number>();
const inserts = new Map<string, Promise<unknown>>();
let deps: { db: Db; bus: Bus; presence: PresenceStore; instance: () => string } | null = null;

export function isAuthority(home: string) { return !!deps && deps.presence.instances(home)[0] === deps.instance(); }
const pub = (m: Record<string, unknown>) => void deps!.bus.publish(m).catch(() => {});

export function initArena(d: { db: Db; bus: Bus; presence: PresenceStore; instance?: () => string }) {
  deps = { ...d, instance: d.instance ?? (() => env.instanceId) };
}
function petOf(home: string, user: string) { return deps!.presence.users(home).find((u) => u.id === user)?.pet ?? null; }
/** 這位使用者正在（本執行個體負責的）某場對戰中嗎？買道具時用。 */
export function inFight(user: string) { for (const a of arenas.values()) if (a.state.fighters.some((f) => f.userId === user && f.fightId)) return true; return false; }
/** M2 多人下樓梯用：這個家裡這個人正在對戰中？這個家有邀請或對戰進行中？ */
export function inFightAt(home: string, user: string) { return !!arenas.get(home)?.state.fighters.some((f) => f.userId === user && f.fightId); }
export function fightBusy(home: string) { const a = arenas.get(home); return !!a && (!!a.invite || a.state.fights.length > 0); }
/** 多人下樓梯開始：參賽者暫時退出打架場地（不在對戰中，所以不會判輸）；比完客戶端會自動重新加入。 */
export function benchFighters(home: string, users: string[]) {
  const a = arenas.get(home); if (!a) return;
  for (const u of users) { const e = removeFighter(a.state, u); if (e) onEnd(a, e); }
  snapshot(a);
}

/** 開打前檢查：開放時間（整場要在關門前結束）、家的冷卻（上一場結束後 30 秒）、所有參賽寵物資格。 */
export function canStart(home: string, users: string[], now = Date.now()): string | null {
  const phase = phaseAt(clock(), now);
  if (phase !== 'open') return phase === 'closing' ? 'GAME_CLOSING' : 'GAME_CLOSED';
  const closesAt = clock().status(now).closes_at;
  if (closesAt !== null && now + P.fightTicks * TICK_MS + 2000 > closesAt) return 'GAME_CLOSING';
  if ((homeCooldown.get(home) ?? 0) > now) return 'HOME_COOLDOWN';
  if (users.length < 2 || users.some((u) => !canFightPet(petOf(home, u)))) return 'NOT_ELIGIBLE';
  return null;
}

/** v1.6：在別人家打架需要主人在家、寵物醒著且沒生病。 */
export function ownerBlock(home: string): string | null {
  const owner = deps!.presence.ownerOf(home); if (!owner) return null;
  if (deps!.presence.ownerAway(home)) return 'OWNER_AWAY';
  const u = deps!.presence.users(home).find((x) => x.id === owner);
  if (!u) return 'OWNER_OFFLINE';
  if (u.pet?.sleeping) return 'OWNER_SLEEPING';
  if (u.pet?.sick) return 'OWNER_SICK';
  return null;
}
/** 每個執行個體都會收到同一則 NOTIFY；只有負責的執行個體處理輸入。 */
export function onArenaBus(m: any) {
  if (!deps) return;
  if (m?.t === 'arena.items') { for (const a of arenas.values()) if (isAuthority(a.home) && a.state.fighters.some((f) => f.userId === m.user)) void listItems(deps.db, m.user).then((it) => { setFighterItems(a.state, m.user, it); snapshot(a); }).catch(() => {}); return; }
  if (!m?.home || !isAuthority(m.home)) return;
  if (m.t === 'arena.join') void join(m.home, m.user);
  else if (m.t === 'arena.invite') invite(m.home, m.user);
  else if (m.t === 'arena.reply') { const a = arenas.get(m.home); if (a?.invite && a.invite.id === m.invite && replyInvite(a.invite, m.user, !!m.accept)) { pub({ t: 'arena.event', home: a.home, kind: 'reply', invite: a.invite.id, user: m.user, accept: !!m.accept }); resolveInvite(a); } }
  else if (m.t === 'arena.in') { const a = arenas.get(m.home); if (a) setArenaInput(a.state, m.user, m); }
  else if (m.t === 'arena.leave') { const a = arenas.get(m.home); if (a) { const e = removeFighter(a.state, m.user); if (e) onEnd(a, e); snapshot(a); } }
}
async function join(home: string, user: string) {
  const pet = petOf(home, user);
  if (!canFightPet(pet)) return pub({ t: 'arena.notice', home, user, code: 'NOT_ELIGIBLE' });
  if (inStairs(home, user)) return; // 下樓梯中：比完再回來
  const items = await listItems(deps!.db, user).catch(() => ({}));
  let a = arenas.get(home);
  if (!a) { arenas.set(home, (a = { home, state: createArena(), startAt: Date.now() })); }
  // 顯示用：寵物名（主人暱稱）；暱稱是使用者自訂的 display_name
  const nick = deps!.presence.users(home).find((u) => u.id === user)?.display_name ?? '?';
  const name = `${pet!.name}（${nick}）`;
  const x = 8 + ((a.state.fighters.length * 29) % (P.width - P.petW - 16));
  if (!addFighter(a.state, { userId: user, petId: pet!.id, species: spriteKey(pet!), name, x, items })) {
    if (!a.state.fighters.some((f) => f.userId === user)) pub({ t: 'arena.notice', home, user, code: 'ARENA_FULL' });
    else setFighterItems(a.state, user, items);
  }
  snapshot(a);
}
/** v1.6 發起戰鬥：邀請場上其他合格寵物的主人；10 秒內回覆，沒回覆＝觀戰。 */
export function invite(home: string, user: string, now = Date.now()) {
  const a = arenas.get(home);
  const me = a?.state.fighters.find((f) => f.userId === user);
  if (!a || !me) return pub({ t: 'arena.notice', home, user, code: 'NOT_ELIGIBLE' });
  if (a.state.fights.length || a.invite) return pub({ t: 'arena.notice', home, user, code: 'FIGHT_BUSY' });
  if (stairsInviting(home)) return pub({ t: 'arena.notice', home, user, code: 'STAIRS_BUSY' });
  const ob = ownerBlock(home); if (ob) return pub({ t: 'arena.notice', home, user, code: ob });
  const others = a.state.fighters.filter((f) => f.userId !== user && canFightPet(petOf(home, f.userId))).map((f) => f.userId);
  const why = canStart(home, [user, ...others], now);
  if (why && why !== 'NOT_ELIGIBLE') return pub({ t: 'arena.notice', home, user, code: why });
  if (!others.length) return pub({ t: 'arena.notice', home, user, code: 'NO_OPPONENT' });
  a.invite = createInvite(randomUUID(), user, others, now);
  pub({ t: 'arena.event', home, kind: 'invite', invite: a.invite.id, from: user, from_name: me.name, to: a.invite.to, left_ms: P.inviteMs });
}
/** 全部回覆或時間到：發起人＋接受者開打（至少 2 隻，且仍在場、仍合格），否則取消。 */
function resolveInvite(a: Arena, now = Date.now()) {
  const inv = a.invite; if (!inv) return;
  const o = inviteOutcome(inv, now); if (!o.done) return;
  a.invite = undefined;
  const parts = (o.participants ?? []).filter((u) => a.state.fighters.some((f) => f.userId === u) && canFightPet(petOf(a.home, u)));
  const why = parts.length >= 2 ? canStart(a.home, parts, now) : 'NOT_ENOUGH';
  const fight = why ? null : startFightWith(a.state, parts, randomUUID());
  if (!fight) return pub({ t: 'arena.event', home: a.home, kind: 'invite_cancel', invite: inv.id, from: inv.from, code: why ?? 'NOT_ENOUGH' });
  handle(a, [{ type: 'start', fight }]);
  snapshot(a);
}
/** 在場名單變了：離開或寵物不再符合資格（睡覺／生病／死亡）的人退出（對戰中 = 判輸）；負責的執行個體換人時取消所有對戰。 */
export function onPresenceChange(home: string) {
  const a = arenas.get(home); if (!a || !deps) return;
  if (!isAuthority(home)) { for (const e of cancelFights(a.state)) void settle(home, e); arenas.delete(home); return; }
  const users = new Map(deps.presence.users(home).map((u) => [u.id, u]));
  for (const f of [...a.state.fighters]) {
    const u = users.get(f.userId);
    if (!u || !canFightPet(u.pet) || u.pet!.id !== f.petId) { const e = removeFighter(a.state, f.userId); if (e) onEnd(a, e); }
  }
  snapshot(a);
}

export function snapshotMsg(a: Arena, now = Date.now()) {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    t: 'arena.state', home: a.home, tick: a.state.tick, server_time: now, frozen: !!a.frozenUntil && a.frozenUntil > now,
    cooldown_ms: Math.max(0, (homeCooldown.get(a.home) ?? 0) - now), invite: a.invite ? { id: a.invite.id, from: a.invite.from, to: a.invite.to, left_ms: Math.max(0, a.invite.deadline - now) } : null,
    fighters: a.state.fighters.map((f) => ({ u: f.userId, pet: f.petId, sp: f.species, name: f.name, x: r1(f.x), y: r1(f.y), dir: f.dir, atk: f.atk, inv: f.inv, hp: f.hp, fight: f.fightId,
      out: f.out, sw: f.swing, sn: f.swingN, hn: f.hitN, hd: f.hitDmg, chg: f.charge, eq: f.equip, items: f.items, slip: f.slip > 0 })),
    fights: a.state.fights.map((x) => ({ id: x.id, parts: x.parts.map((p) => p.u), left_ms: Math.max(0, Math.round((x.endTick - a.state.tick) * TICK_MS)) })),
    proj: a.state.proj.map((p) => ({ x: r1(p.x), y: r1(p.y) })),
    hp_max: P.hpMax,
  };
}
/** 有變化才送（或每 2 秒心跳一次），避免沒人動時一直 NOTIFY。 */
function snapshot(a: Arena, onlyIfChanged = false) {
  const m = snapshotMsg(a), now = Date.now();
  const key = JSON.stringify([m.fighters, m.fights.map((f) => f.id), m.proj, m.frozen, !!m.cooldown_ms, m.invite?.id]);
  if (onlyIfChanged && key === a.lastKey && now - (a.lastSnapAt ?? 0) < 2000) return;
  a.lastKey = key; a.lastSnapAt = now; pub(m);
}

/** 決勝瞬間：先送出凍結的快照（HP 等還沒重置前的畫面），再暫停模擬 FREEZE_MS，然後結算。 */
function onEnd(a: Arena, e: FightEnd, frozen?: ReturnType<typeof snapshotMsg>) {
  if (e.reason !== 'cancel') {
    a.frozenUntil = Date.now() + FREEZE_MS; a.frozenTick = a.state.tick;
    if (frozen) pub({ ...frozen, frozen: true });
  }
  void settle(a.home, e);
}
function handle(a: Arena, events: ArenaEvent[]) {
  for (const e of events) {
    if (e.type === 'start') {
      const parts = e.fight.parts;
      inserts.set(e.fight.id, deps!.db.insertInto('fights').values({ id: e.fight.id, home_id: a.home, a_user_id: parts[0].u, b_user_id: parts[1].u, a_pet_id: parts[0].pet, b_pet_id: parts[1].pet,
        participants: JSON.stringify(parts.map((p) => ({ user_id: p.u, pet_id: p.pet }))), status: 'playing', instance_id: deps!.instance() }).execute().catch((err) => console.error('fight insert failed', err)));
      pub({ t: 'arena.event', home: a.home, kind: 'start', fight: e.fight.id, names: parts.map((p) => p.name), a: parts[0].name, b: parts[1].name });
    } else if (e.type === 'refused') pub({ t: 'arena.notice', home: a.home, user: e.from, code: e.reason });
    else if (e.type === 'ko') pub({ t: 'arena.event', home: a.home, kind: 'ko', fight: e.fightId, user: e.user });
  }
}

/**
 * 結算：冪等（只有 status = 'playing' 的那一筆會被更新）。單一 transaction：依 id 排序鎖所有參賽者的錢包，
 * 每個輸家付 min(20, 自己的餘額) 給贏家；平手／取消不轉帳。寫 coin_ledger（reason = fight）、
 * 用到的道具各扣 1 場（取消的對戰不扣）、audit_log。
 */
export async function settle(home: string, e: FightEnd) {
  if (!deps) return null;
  const { db } = deps; const f = e.fight;
  homeCooldown.set(home, Date.now() + P.homeCooldownMs);
  await inserts.get(f.id); inserts.delete(f.id);
  try {
    const res = await db.transaction().execute(async (tx) => {
      const status = e.reason === 'cancel' ? 'aborted' : 'done';
      const parts = f.parts.map((p) => ({ user_id: p.u, pet_id: p.pet, name: p.name, dmg: p.dmg, hits: p.hits, taken: p.taken, hp: p.hp, out: p.out, forfeit: p.forfeit }));
      const row = await tx.updateTable('fights').set({ status, a_hp: f.parts[0]?.hp, b_hp: f.parts[1]?.hp, reason: e.reason, ended_at: new Date(), participants: JSON.stringify(parts) })
        .where('id', '=', f.id).where('status', '=', 'playing').returning(['id']).executeTakeFirst();
      if (!row) return null; // 已結算過
      let deltas: Record<string, number> = {}; let pool: Record<string, number> = {};
      if (status === 'done') {
        const w = await lockWallets(tx, f.parts.map((p) => p.u)); // 依 id 排序上鎖
        // 1) 輸家各付 min(20, 自己餘額) 給贏家（平手跳過）
        if (e.winner && e.losers.length) {
          deltas = meleeTransfers(e, Object.fromEntries(w.map((x) => [x.user_id, x.balance])), FIGHT_COIN_CAP);
          for (const u of [...Object.keys(deltas)].sort()) if (u !== e.winner && deltas[u] < 0) await changeBalance(tx, u, deltas[u], 'fight', { type: 'fight', id: f.id });
          if (deltas[e.winner] > 0) await changeBalance(tx, e.winner, deltas[e.winner], 'fight', { type: 'fight', id: f.id });
        }
        // 2) v1.6 系統獎金池 50：依攻擊分數（造成的總傷害）比例分配（平手也發）
        pool = poolShares(Object.fromEntries(f.parts.map((p) => [p.u, p.dmg])), P.bonusPool);
        for (const u of Object.keys(pool).sort()) if (pool[u] > 0) await changeBalance(tx, u, pool[u], 'fight_bonus', { type: 'fight', id: f.id });
        await tx.updateTable('fights').set({ winner_user_id: e.winner, transfer: e.winner ? deltas[e.winner] ?? 0 : 0 }).where('id', '=', f.id).execute();
      }
      const usedRows: { user: string; item: ItemId }[] = [];
      if (status === 'done') for (const [u, items] of Object.entries(e.used)) for (const it of items) {
        const r = await tx.updateTable('user_items').set((eb: any) => ({ fights_left: eb('fights_left', '-', 1), updated_at: new Date() }))
          .where('user_id', '=', u).where('item_id', '=', it).where('fights_left', '>', 0).returning('fights_left').executeTakeFirst();
        if (r) usedRows.push({ user: u, item: it });
      }
      for (const u of new Set(usedRows.map((r) => r.user))) await notify(tx, { t: 'arena.items', user: u });
      await tx.insertInto('audit_log').values({ user_id: e.winner ?? f.parts[0]?.u ?? null, action: 'fight.settle', result: 'ok', target_type: 'fight', target_id: f.id,
        detail: JSON.stringify({ home, parts: f.parts.map((p) => p.u), winner: e.winner, losers: e.losers, deltas, pool, draw: e.draw, reason: e.reason, used: usedRows }) }).execute();
      return { deltas, pool, amount: e.winner ? deltas[e.winner] ?? 0 : 0 };
    });
    if (res) pub({ t: 'arena.result', home, fight: f.id, winner: e.winner, winner_name: f.parts.find((p) => p.u === e.winner)?.name ?? null, losers: e.losers, draw: e.draw, amount: res.amount, reason: e.reason,
      parts: f.parts.map((p) => ({ u: p.u, name: p.name, dmg: p.dmg, hits: p.hits, taken: p.taken, hp: p.hp, out: p.out, forfeit: p.forfeit, transfer: res.deltas[p.u] ?? 0, pool: res.pool[p.u] ?? 0, delta: (res.deltas[p.u] ?? 0) + (res.pool[p.u] ?? 0) })) });
    return res;
  } catch (err) { console.error('fight settle failed', err); return null; }
}

export function stepArenas(now = Date.now()) {
  for (const a of [...arenas.values()]) {
    if (!isAuthority(a.home)) { onPresenceChange(a.home); continue; }
    if (a.frozenUntil) {
      if (a.frozenUntil > now) continue;
      // 解凍：凍結期間不追 tick
      a.startAt = now - a.state.tick * TICK_MS; a.frozenUntil = undefined; a.frozenTick = undefined; snapshot(a);
    }
    if (a.invite) resolveInvite(a, now);
    const target = Math.floor((now - a.startAt) / TICK_MS);
    let snap = false;
    while (a.state.tick < target && !a.frozenUntil) {
      const before = a.state.fights.length ? snapshotMsg(a) : null;
      const ev = stepArena(a.state, { canStart: (users) => canStart(a.home, users, now), newId: randomUUID });
      handle(a, ev);
      for (const e of ev) if (e.type === 'end') {
        // 決勝那一刻的畫面：重置 HP 前的狀態 = 用參賽者最後的 HP 疊在本 tick 位置上
        const fz = snapshotMsg(a); const hp = new Map(e.fight.parts.map((p) => [p.u, p]));
        fz.fighters = fz.fighters.map((x) => { const p = hp.get(x.u); return p ? { ...x, hp: p.hp, out: p.out, fight: e.fight.id } : x; });
        fz.fights = [{ id: e.fight.id, parts: e.fight.parts.map((p) => p.u), left_ms: before?.fights[0]?.left_ms ?? 0 }];
        onEnd(a, e, fz);
      }
      if (a.state.tick % P.snapshotEvery === 0) snap = true;
    }
    if (snap && !a.frozenUntil) snapshot(a, true);
    if (!a.state.fighters.length) { arenas.delete(a.home); snapshot(a); }
  }
}
export function startArenaLoop() { const t = setInterval(() => stepArenas(), TICK_MS / 2); t.unref(); return t; }

/** 20:00 關門 / SIGTERM：取消所有對戰，不轉帳。 */
export async function abortArenas() {
  const all: Promise<unknown>[] = [];
  for (const a of arenas.values()) a.invite = undefined;
  for (const a of arenas.values()) for (const e of cancelFights(a.state)) all.push(settle(a.home, e));
  arenas.clear();
  await Promise.all(all);
}
export const _arenas = arenas;
export const _homeCooldown = homeCooldown;
