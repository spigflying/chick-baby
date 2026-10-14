// v1.4 打架模式（伺服器權威）。每個家由「目前有連線的最小 instance id」負責模擬；
// 輸入與狀態都經過 LISTEN/NOTIFY，所以不論玩家連到哪個執行個體都看到同一場。
import { randomUUID } from 'node:crypto';
import { addFighter, ARENA_PARAMS, cancelFights, canFightPet, createArena, fightTransfer, phaseAt, removeFighter, setArenaInput, stepArena, type ArenaEvent, type ArenaState, type FightEnd } from '@chick/engine';
import type { Db } from './db';
import type { Bus } from './bus';
import { changeBalance, lockWallets } from './core';
import { clock } from './hours';
import { env } from './env';
import type { PresenceStore } from './presence';

const P = ARENA_PARAMS;
const TICK_MS = 1000 / P.tickRate;
export const FIGHT_COIN_CAP = 20;
interface Arena { home: string; state: ArenaState; startAt: number; lastKey?: string; lastSnapAt?: number }
const arenas = new Map<string, Arena>();
const pairCooldown = new Map<string, number>();
const inserts = new Map<string, Promise<unknown>>();
let deps: { db: Db; bus: Bus; presence: PresenceStore; instance: () => string } | null = null;

const pairKey = (a: string, b: string) => [a, b].sort().join('|');
export function isAuthority(home: string) { return !!deps && deps.presence.instances(home)[0] === deps.instance(); }
const pub = (m: Record<string, unknown>) => void deps!.bus.publish(m).catch(() => {});

export function initArena(d: { db: Db; bus: Bus; presence: PresenceStore; instance?: () => string }) {
  deps = { ...d, instance: d.instance ?? (() => env.instanceId) };
}
function petOf(home: string, user: string) { return deps!.presence.users(home).find((u) => u.id === user)?.pet ?? null; }

/** 開打前檢查：開放時間（整場要在關門前結束）、同一對的冷卻、雙方寵物資格。 */
export function canStart(home: string, a: string, b: string, now = Date.now()): string | null {
  const phase = phaseAt(clock(), now);
  if (phase !== 'open') return phase === 'closing' ? 'GAME_CLOSING' : 'GAME_CLOSED';
  const closesAt = clock().status(now).closes_at;
  if (closesAt !== null && now + P.fightTicks * TICK_MS + 2000 > closesAt) return 'GAME_CLOSING';
  if ((pairCooldown.get(pairKey(a, b)) ?? 0) > now) return 'PAIR_COOLDOWN';
  if (!canFightPet(petOf(home, a)) || !canFightPet(petOf(home, b))) return 'NOT_ELIGIBLE';
  return null;
}

/** 每個執行個體都會收到同一則 NOTIFY；只有負責的執行個體處理輸入。 */
export function onArenaBus(m: any) {
  if (!deps || !m?.home) return;
  if (!isAuthority(m.home)) return;
  if (m.t === 'arena.join') join(m.home, m.user);
  else if (m.t === 'arena.in') { const a = arenas.get(m.home); if (a) setArenaInput(a.state, m.user, m); }
  else if (m.t === 'arena.leave') { const a = arenas.get(m.home); if (a) { const e = removeFighter(a.state, m.user); if (e) void settle(a.home, e); snapshot(a); } }
}
function join(home: string, user: string) {
  const pet = petOf(home, user);
  if (!canFightPet(pet)) return pub({ t: 'arena.notice', home, user, code: 'NOT_ELIGIBLE' });
  let a = arenas.get(home);
  if (!a) arenas.set(home, (a = { home, state: createArena(), startAt: Date.now() }));
  const name = deps!.presence.users(home).find((u) => u.id === user)?.display_name ?? '?';
  const x = 8 + ((a.state.fighters.length * 29) % (P.width - P.petW - 16));
  if (!addFighter(a.state, { userId: user, petId: pet!.id, species: pet!.species, name, x })) {
    if (!a.state.fighters.some((f) => f.userId === user)) pub({ t: 'arena.notice', home, user, code: 'ARENA_FULL' });
  }
  snapshot(a);
}
/** 在場名單變了：離開或寵物不再符合資格（睡覺／生病／死亡）的人退出（對戰中 = 判輸）；負責的執行個體換人時取消所有對戰。 */
export function onPresenceChange(home: string) {
  const a = arenas.get(home); if (!a || !deps) return;
  if (!isAuthority(home)) { for (const e of cancelFights(a.state)) void settle(home, e); arenas.delete(home); return; }
  const users = new Map(deps.presence.users(home).map((u) => [u.id, u]));
  for (const f of [...a.state.fighters]) {
    const u = users.get(f.userId);
    if (!u || !canFightPet(u.pet) || u.pet!.id !== f.petId) { const e = removeFighter(a.state, f.userId); if (e) void settle(home, e); }
  }
  snapshot(a);
}

export function snapshotMsg(a: Arena, now = Date.now()) {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    t: 'arena.state', home: a.home, tick: a.state.tick, server_time: now,
    fighters: a.state.fighters.map((f) => ({ u: f.userId, pet: f.petId, sp: f.species, name: f.name, x: r1(f.x), y: r1(f.y), dir: f.dir, atk: f.atk, inv: f.inv, hp: f.hp, fight: f.fightId })),
    fights: a.state.fights.map((x) => ({ id: x.id, a: x.a, b: x.b, left_ms: Math.max(0, Math.round((x.endTick - a.state.tick) * TICK_MS)) })),
    hp_max: P.hpMax,
  };
}
/** 有變化才送（或每 2 秒心跳一次），避免沒人動時一直 NOTIFY。 */
function snapshot(a: Arena, onlyIfChanged = false) {
  const m = snapshotMsg(a), now = Date.now();
  const key = JSON.stringify([m.fighters, m.fights.map((f) => f.id)]);
  if (onlyIfChanged && key === a.lastKey && now - (a.lastSnapAt ?? 0) < 2000) return;
  a.lastKey = key; a.lastSnapAt = now; pub(m);
}

function handle(a: Arena, events: ArenaEvent[]) {
  for (const e of events) {
    if (e.type === 'start') {
      const fa = a.state.fighters.find((f) => f.userId === e.fight.a)!, fb = a.state.fighters.find((f) => f.userId === e.fight.b)!;
      inserts.set(e.fight.id, deps!.db.insertInto('fights').values({ id: e.fight.id, home_id: a.home, a_user_id: fa.userId, b_user_id: fb.userId, a_pet_id: fa.petId, b_pet_id: fb.petId, status: 'playing', instance_id: deps!.instance() }).execute().catch((err) => console.error('fight insert failed', err)));
      pub({ t: 'arena.event', home: a.home, kind: 'start', fight: e.fight.id, a: fa.name, b: fb.name });
    } else if (e.type === 'refused') pub({ t: 'arena.notice', home: a.home, user: e.from, code: e.reason });
    else if (e.type === 'end') void settle(a.home, e);
  }
}

/**
 * 結算：冪等（只有 status = 'playing' 的那一筆會被更新）。單一 transaction：先依 id 排序鎖兩個錢包，
 * 勝方拿走 min(20, 輸家餘額)；平手／取消不轉帳。寫 coin_ledger（reason = fight）與 audit_log。
 */
export async function settle(home: string, e: FightEnd) {
  if (!deps) return null;
  const { db } = deps; const f = e.fight;
  pairCooldown.set(pairKey(f.a, f.b), Date.now() + P.pairCooldownMs);
  await inserts.get(f.id); inserts.delete(f.id);
  try {
    const res = await db.transaction().execute(async (tx) => {
      const status = e.reason === 'cancel' ? 'aborted' : 'done';
      const row = await tx.updateTable('fights').set({ status, a_hp: e.hpA, b_hp: e.hpB, reason: e.reason, ended_at: new Date() })
        .where('id', '=', f.id).where('status', '=', 'playing').returning(['id']).executeTakeFirst();
      if (!row) return null; // 已結算過
      let amount = 0;
      if (status === 'done' && e.winner && e.loser) {
        const w = await lockWallets(tx, [e.winner, e.loser]);
        amount = fightTransfer(w.find((x) => x.user_id === e.loser)?.balance ?? 0, FIGHT_COIN_CAP);
        if (amount > 0) {
          await changeBalance(tx, e.loser, -amount, 'fight', { type: 'fight', id: f.id });
          await changeBalance(tx, e.winner, amount, 'fight', { type: 'fight', id: f.id });
        }
        await tx.updateTable('fights').set({ winner_user_id: e.winner, transfer: amount }).where('id', '=', f.id).execute();
      }
      await tx.insertInto('audit_log').values({ user_id: e.winner ?? f.a, action: 'fight.settle', result: 'ok', target_type: 'fight', target_id: f.id,
        detail: JSON.stringify({ home, a: f.a, b: f.b, winner: e.winner, loser: e.loser, amount, hpA: e.hpA, hpB: e.hpB, reason: e.reason }) }).execute();
      return { amount };
    });
    if (res) pub({ t: 'arena.result', home, fight: f.id, a: f.a, b: f.b, winner: e.winner, loser: e.loser, amount: res.amount, reason: e.reason, hpA: e.hpA, hpB: e.hpB });
    return res;
  } catch (err) { console.error('fight settle failed', err); return null; }
}

export function stepArenas(now = Date.now()) {
  for (const a of [...arenas.values()]) {
    if (!isAuthority(a.home)) { onPresenceChange(a.home); continue; }
    const target = Math.floor((now - a.startAt) / TICK_MS);
    let snap = false;
    while (a.state.tick < target) {
      handle(a, stepArena(a.state, { canStart: (x, y) => canStart(a.home, x, y, now), newId: randomUUID }));
      if (a.state.tick % P.snapshotEvery === 0) snap = true;
    }
    if (snap) snapshot(a, true);
    if (!a.state.fighters.length) { arenas.delete(a.home); snapshot(a); }
  }
}
export function startArenaLoop() { const t = setInterval(() => stepArenas(), TICK_MS / 2); t.unref(); return t; }

/** 20:00 關門 / SIGTERM：取消所有對戰，不轉帳。 */
export async function abortArenas() {
  const all: Promise<unknown>[] = [];
  for (const a of arenas.values()) for (const e of cancelFights(a.state)) all.push(settle(a.home, e));
  arenas.clear();
  await Promise.all(all);
}
export const _arenas = arenas;
