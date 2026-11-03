// 小雞農場（docs/superpowers/specs/2026-11-03-farm-design.md）：一人一座農場，整座存成 farms.state jsonb。
// 規則全部在 @chick/engine 的 farm.ts；這裡只負責權限、上鎖、金幣帳本、幫忙上限與通知。
import { applyFarm, applyHelp, describeFarm, FarmError, FARM, loadFarm, newFarm, type FarmAction, type FarmState, type HelpAction } from '@chick/engine';
import { sql, type Db, type Tx } from './db';
import { changeBalance, lockWallets, notify, rateLimit, runAction, type ReqCtx } from './core';
import { fail } from './errors';
import { canEnter, invitedHomes, recentHomes } from './game';
import { clock } from './hours';
import { randomSeed } from './util';

const TPE_DAY = sql`(now() AT TIME ZONE 'Asia/Taipei')::date`;

/** 把引擎的規則錯誤轉成 API 錯誤碼（400）。 */
function rules<T>(f: () => T): T {
  try { return f(); } catch (e) { if (e instanceof FarmError) fail(e.code); throw e; }
}

/** 鎖住這個人的農場（沒有就建立）。 */
async function lockFarm(tx: Tx, userId: string, now: number): Promise<FarmState> {
  await tx.insertInto('farms').values({ user_id: userId, state: JSON.stringify(newFarm(randomSeed(), now, clock())) }).onConflict((oc) => oc.doNothing()).execute();
  const row = await tx.selectFrom('farms').select('state').where('user_id', '=', userId).forUpdate().executeTakeFirstOrThrow();
  return loadFarm(row.state, now, clock());
}
async function saveFarm(tx: Tx, userId: string, s: FarmState) {
  await tx.updateTable('farms').set({ state: JSON.stringify(s), updated_at: new Date() }).where('user_id', '=', userId).execute();
}
async function homeOf(db: Db | Tx, ownerId: string) {
  return db.selectFrom('homes').selectAll().where('owner_id', '=', ownerId).executeTakeFirst();
}
async function ownerInfo(db: Db | Tx, userId: string) {
  const u = await db.selectFrom('users').select(['id', 'display_name']).where('id', '=', userId).executeTakeFirstOrThrow();
  return { id: u.id as string, display_name: u.display_name as string };
}
function payload(owner: { id: string; display_name: string }, viewerId: string, s: FarmState, now: number) {
  const isOwner = owner.id === viewerId;
  return { owner, is_owner: isOwner, state: isOwner ? s : { ...s, helpLog: [] }, derived: describeFarm(s, now, clock()), server_time: now };
}

/** GET /api/farm/:id：主人第一次讀時建立農場；訪客要進得了主人的家。 */
export async function getFarm(db: Db, ownerId: string, viewerId: string) {
  const now = Date.now();
  if (ownerId === viewerId) {
    const s = await db.transaction().execute((tx) => lockFarm(tx, ownerId, now));
    return payload(await ownerInfo(db, ownerId), viewerId, s, now);
  }
  const home = await homeOf(db, ownerId);
  if (!home) fail('NOT_FOUND');
  if (!(await canEnter(db, home, viewerId))) fail('FORBIDDEN');
  const row = await db.selectFrom('farms').select('state').where('user_id', '=', ownerId).executeTakeFirst();
  if (!row) fail('NOT_FOUND');
  return payload(await ownerInfo(db, ownerId), viewerId, loadFarm(row!.state, now, clock()), now);
}

/** POST /api/farm/act：主人對自己農場的所有動作。 */
export async function farmAct(db: Db, ctx: ReqCtx, action: unknown, requestId: unknown) {
  if (!rateLimit(`farm.act:${ctx.userId}`, 60, 60_000)) fail('RATE_LIMITED');
  return runAction(db, ctx, 'farm.act', requestId, { action }, async (tx) => {
    const now = Date.now();
    const [wallet] = await lockWallets(tx, [ctx.userId]);
    const s = await lockFarm(tx, ctx.userId, now);
    const out = rules(() => applyFarm(s, action as FarmAction, now, clock()));
    const spend = out.ledger.filter((l) => l.delta < 0).reduce((x, l) => x - l.delta, 0);
    if (spend > (wallet?.balance ?? 0)) fail('INSUFFICIENT_COINS');
    for (const l of out.ledger) await changeBalance(tx, ctx.userId, l.delta, l.reason, { type: 'farm', id: ctx.userId });
    await saveFarm(tx, ctx.userId, s);
    const home = await homeOf(tx, ctx.userId);
    await notify(tx, { t: 'farm', user: ctx.userId, home: home?.id ?? null });
    const w = await tx.selectFrom('wallets').select('balance').where('user_id', '=', ctx.userId).executeTakeFirstOrThrow();
    return { ...payload(await ownerInfo(tx, ctx.userId), ctx.userId, s, now), balance: w.balance as number, leveled: out.leveled };
  }, { type: 'farm', id: ctx.userId });
}

/** POST /api/farm/:id/help：訪客幫澆水或救枯樹。 */
export async function farmHelp(db: Db, ctx: ReqCtx, ownerId: string, body: any, requestId: unknown) {
  if (!rateLimit(`farm.help:${ctx.userId}`, 20, 60_000)) fail('RATE_LIMITED');
  const a: HelpAction = body?.kind === 'water' ? { kind: 'water', idx: body?.idx } : { kind: body?.kind } as HelpAction;
  return runAction(db, ctx, 'farm.help', requestId, { owner: ownerId, help: a }, async (tx) => {
    if (ownerId === ctx.userId) fail('HELP_SELF');
    const home = await homeOf(tx, ownerId);
    if (!home) fail('NOT_FOUND');
    if (!(await canEnter(tx, home, ctx.userId))) fail('FORBIDDEN');
    const exists = await tx.selectFrom('farms').select('user_id').where('user_id', '=', ownerId).executeTakeFirst();
    if (!exists) fail('NOT_FOUND');
    const now = Date.now();
    // 依 user_id 排序上鎖兩座農場（同一個幫忙的人的請求也因此排隊，每日上限不會被併發繞過）
    const locked: Record<string, FarmState> = {};
    for (const id of [ownerId, ctx.userId].sort()) locked[id] = await lockFarm(tx, id, now);
    const counts = await sql<{ mine: number; this_farm: number }>`SELECT count(*)::int AS mine, count(*) FILTER (WHERE owner_id = ${ownerId})::int AS this_farm
      FROM farm_help WHERE helper_id = ${ctx.userId} AND day = ${TPE_DAY}`.execute(tx).then((r) => r.rows[0]);
    if (counts.mine >= FARM.help.perDay) fail('HELP_DAILY_CAP');
    if (counts.this_farm >= FARM.help.perFarm) fail('HELP_FARM_CAP');
    const me = await ownerInfo(tx, ctx.userId);
    rules(() => applyHelp(locked[ownerId], a, { id: me.id, name: me.display_name }, now, clock()));
    locked[ctx.userId].friendPts += FARM.help.friendPoints;
    await saveFarm(tx, ownerId, locked[ownerId]);
    await saveFarm(tx, ctx.userId, locked[ctx.userId]);
    await tx.insertInto('farm_help').values({ helper_id: ctx.userId, owner_id: ownerId, day: TPE_DAY, kind: a.kind, target: a.kind === 'water' ? a.idx : 0 }).execute();
    await notify(tx, { t: 'farm', user: ownerId, home: home!.id });
    return { ok: true, friend_pts: locked[ctx.userId].friendPts, today: { mine: counts.mine + 1, this_farm: counts.this_farm + 1 } };
  }, { type: 'farm', id: ownerId });
}

/** GET /api/farm/friends：最近拜訪過的家、邀請我的家，主人有農場的。 */
export async function farmFriends(db: Db, userId: string) {
  const homes = [...(await recentHomes(db, userId)), ...(await invitedHomes(db, userId))].filter((h) => h.can_enter && h.owner.id !== userId);
  const ids = [...new Set(homes.map((h) => h.owner.id as string))];
  if (!ids.length) return { farms: [] };
  const rows = await db.selectFrom('farms as f').innerJoin('users as u', 'u.id', 'f.user_id').select(['f.user_id', 'f.state', 'u.display_name']).where('f.user_id', 'in', ids).execute();
  const now = Date.now();
  const byId = new Map(rows.map((r: any) => [r.user_id, r]));
  return {
    farms: ids.filter((id) => byId.has(id)).map((id) => {
      const r: any = byId.get(id); const s = loadFarm(r.state, now, clock());
      return { user_id: id, display_name: r.display_name as string, level: s.level, needs_help: describeFarm(s, now, clock()).needsHelp };
    }),
  };
}
