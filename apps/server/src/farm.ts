// 小雞農場（docs/superpowers/specs/2026-11-03-farm-design.md）：一人一座農場，整座存成 farms.state jsonb。
// 規則全部在 @chick/engine 的 farm.ts；這裡只負責權限、上鎖、金幣帳本、幫忙上限與通知。
import {
  applyFarm, applyFood, applyHelp, checkFeed, createRng, describeFarm, FarmError, FARM, GAME, loadFarm, newFarm, stallBuy, takeFarmFood, visitCollect,
  type FarmAction, type FarmCtx, type FarmState, type HelpAction, type VisitCollectAction,
} from '@chick/engine';
import { sql, type Db, type Tx } from './db';
import { changeBalance, lockWallets, notify, rateLimit, runAction, type ReqCtx } from './core';
import { fail } from './errors';
import { canEnter, invitedHomes, recentHomes } from './game';
import { clock } from './hours';
import { publicUser, randomSeed } from './util';
import { insertEvents, lockPet, publicPet, savePet, settle } from './pets';

const TPE_DAY = sql`(now() AT TIME ZONE 'Asia/Taipei')::date`;
/** 台北日期 YYYY-MM-DD（小雞澆水每天的次數）。 */
const tpeDay = (now: number) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);

/** 主人目前的寵物（活著或還是蛋的那隻）。 */
async function currentPetId(db: Db | Tx, ownerId: string) {
  return (await db.selectFrom('pets').select('id').where('owner_id', '=', ownerId).where('status', 'in', ['egg', 'alive']).executeTakeFirst())?.id as string | undefined;
}
/** 小雞澆水要的寵物狀態；lock＝在 transaction 裡上鎖並結算（離線死掉的寵物不能澆水），否則只讀現在的列（畫面顯示用）。 */
async function farmCtx(db: Db | Tx, ownerId: string, now: number, lock: boolean): Promise<FarmCtx> {
  const day = tpeDay(now);
  const id = await currentPetId(db, ownerId);
  if (!id) return { day };
  if (lock) {
    const row = await lockPet(db as Tx, id);
    const { state } = await settle(db as Tx, row);
    await savePet(db as Tx, id, state);
    return { day, pet: { alive: state.status === 'alive', stamina: state.stamina } };
  }
  const r = await db.selectFrom('pets').select(['status', 'stamina']).where('id', '=', id).executeTakeFirstOrThrow();
  return { day, pet: { alive: r.status === 'alive', stamina: Number(r.stamina) } };
}

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
function payload(owner: { id: string; display_name: string }, viewerId: string, s: FarmState, now: number, ctx: FarmCtx = {}) {
  const isOwner = owner.id === viewerId;
  return {
    owner, is_owner: isOwner, state: isOwner ? s : { ...s, helpLog: [], saleLog: [], decoBag: [] },
    derived: describeFarm(s, now, clock(), isOwner ? ctx : {}), server_time: now,
  };
}

/** GET /api/farm/:id：主人第一次讀時建立農場；訪客要進得了主人的家。 */
export async function getFarm(db: Db, ownerId: string, viewerId: string) {
  const now = Date.now();
  if (ownerId === viewerId) {
    // 讀的時候也存回去：熱氣球第一次排班（arrive＝現在）、訂單補格都要落地，不然每次打開計時都重來
    const s = await db.transaction().execute(async (tx) => { const x = await lockFarm(tx, ownerId, now); await saveFarm(tx, ownerId, x); return x; });
    return payload(await ownerInfo(db, ownerId), viewerId, s, now, await farmCtx(db, ownerId, now, false));
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
    // 寵物只有小雞澆水才上鎖（鎖的順序：錢包 → 農場 → 寵物，跟 feed-pet 一樣）
    const fctx = await farmCtx(tx, ctx.userId, now, (action as FarmAction)?.type === 'chickWater');
    const out = rules(() => applyFarm(s, action as FarmAction, now, clock(), fctx));
    const spend = out.ledger.filter((l) => l.delta < 0).reduce((x, l) => x - l.delta, 0);
    if (spend > (wallet?.balance ?? 0)) fail('INSUFFICIENT_COINS');
    for (const l of out.ledger) await changeBalance(tx, ctx.userId, l.delta, l.reason, { type: 'farm', id: ctx.userId });
    await saveFarm(tx, ctx.userId, s);
    const home = await homeOf(tx, ctx.userId);
    await notify(tx, { t: 'farm', user: ctx.userId, home: home?.id ?? null });
    const w = await tx.selectFrom('wallets').select('balance').where('user_id', '=', ctx.userId).executeTakeFirstOrThrow();
    return { ...payload(await ownerInfo(tx, ctx.userId), ctx.userId, s, now, fctx), balance: w.balance as number, leveled: out.leveled };
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

/** POST /api/farm/:id/collect：進得了主人家的訪客，可把成熟資源收進自己的倉庫。 */
export async function farmVisitCollect(db: Db, ctx: ReqCtx, ownerId: string, action: unknown, requestId: unknown) {
  if (!rateLimit(`farm.collect:${ctx.userId}`, 60, 60_000)) fail('RATE_LIMITED');
  return runAction(db, ctx, 'farm.collect', requestId, { owner: ownerId, action }, async (tx) => {
    if (ownerId === ctx.userId) fail('BAD_REQUEST');
    const home = await homeOf(tx, ownerId);
    if (!home) fail('NOT_FOUND');
    if (!(await canEnter(tx, home, ctx.userId))) fail('FORBIDDEN');
    const exists = await tx.selectFrom('farms').select('user_id').where('user_id', '=', ownerId).executeTakeFirst();
    if (!exists) fail('NOT_FOUND');
    const now = Date.now();
    await lockWallets(tx, [ctx.userId]);
    // 固定順序鎖兩座農場；並發採同一格只會有一人成功，倉庫滿則兩邊都不變。
    const locked: Record<string, FarmState> = {};
    for (const id of [ownerId, ctx.userId].sort()) locked[id] = await lockFarm(tx, id, now);
    const got = rules(() => visitCollect(locked[ownerId], locked[ctx.userId], action as VisitCollectAction, now, clock()));
    const me = await ownerInfo(tx, ctx.userId);
    const log = locked[ownerId].helpLog;
    log.push({ by: me.id, name: me.display_name, kind: 'collect', item: got.item, qty: got.qty, at: now });
    if (log.length > FARM.help.logMax) log.splice(0, log.length - FARM.help.logMax);
    let balance: number | undefined;
    for (const l of got.ledger) balance = await changeBalance(tx, ctx.userId, l.delta, l.reason, { type: 'farm', id: ownerId });
    await saveFarm(tx, ownerId, locked[ownerId]);
    await saveFarm(tx, ctx.userId, locked[ctx.userId]);
    await notify(tx, { t: 'farm', user: ownerId, home: home!.id });
    await notify(tx, { t: 'farm', user: ctx.userId, home: (await homeOf(tx, ctx.userId))?.id ?? null });
    return { ok: true, item: got.item, qty: got.qty, leveled: got.leveled, balance };
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

/** POST /api/farm/:id/buy：訪客買小攤。金幣從買的人轉給主人；兩座農場、兩個錢包都依 id 排序上鎖，同一格只會賣出一次。 */
export async function farmBuy(db: Db, ctx: ReqCtx, sellerId: string, slot: unknown, requestId: unknown) {
  if (!rateLimit(`farm.buy:${ctx.userId}`, 20, 60_000)) fail('RATE_LIMITED');
  return runAction(db, ctx, 'farm.buy', requestId, { seller: sellerId, slot }, async (tx) => {
    if (sellerId === ctx.userId) fail('BUY_SELF');
    const home = await homeOf(tx, sellerId);
    if (!home) fail('NOT_FOUND');
    if (!(await canEnter(tx, home, ctx.userId))) fail('FORBIDDEN');
    const exists = await tx.selectFrom('farms').select('user_id').where('user_id', '=', sellerId).executeTakeFirst();
    if (!exists) fail('NOT_FOUND');
    const now = Date.now();
    const wallets = await lockWallets(tx, [ctx.userId, sellerId]);
    const locked: Record<string, FarmState> = {};
    for (const id of [sellerId, ctx.userId].sort()) locked[id] = await lockFarm(tx, id, now);
    const n = await sql<{ n: number }>`SELECT count(*)::int AS n FROM farm_stall_buys WHERE buyer_id = ${ctx.userId} AND day = ${TPE_DAY}`.execute(tx).then((r) => r.rows[0].n);
    if (n >= FARM.stall.buysPerDay) fail('BUY_DAILY_CAP');
    const listing = locked[sellerId].stall[Number.isInteger(slot) ? (slot as number) : -1];
    const mine = wallets.find((w: any) => w.user_id === ctx.userId) ?? wallets[0];
    if (listing && listing.price > (mine?.balance ?? 0)) fail('INSUFFICIENT_COINS');
    const me = await ownerInfo(tx, ctx.userId);
    const got = rules(() => stallBuy(locked[sellerId], locked[ctx.userId], slot as number, { id: me.id, name: me.display_name }, now));
    const balance = await changeBalance(tx, ctx.userId, -got.price, 'farm_stall_buy', { type: 'farm', id: sellerId });
    await changeBalance(tx, sellerId, got.price, 'farm_stall_sale', { type: 'farm', id: ctx.userId });
    await saveFarm(tx, sellerId, locked[sellerId]);
    await saveFarm(tx, ctx.userId, locked[ctx.userId]);
    await tx.insertInto('farm_stall_buys').values({ buyer_id: ctx.userId, seller_id: sellerId, day: TPE_DAY, item: got.item, qty: got.qty, price: got.price }).execute();
    await notify(tx, { t: 'farm', user: sellerId, home: home!.id });
    return { ok: true, balance, ...got };
  }, { type: 'farm', id: sellerId });
}

/** POST /api/farm/feed-pet：拿倉庫的東西餵自己目前的寵物（不花金幣）。跟蛋殼的餵食走同一套檢查和效果。 */
export async function farmFeedPet(db: Db, ctx: ReqCtx, item: unknown, requestId: unknown) {
  if (!rateLimit(`feed:${ctx.userId}`, GAME.rateLimit.feedPerMinute, 60_000)) fail('RATE_LIMITED');
  return runAction(db, ctx, 'farm.feedPet', requestId, { item }, async (tx) => {
    const now = Date.now();
    const s = await lockFarm(tx, ctx.userId, now);
    const petId = await currentPetId(tx, ctx.userId);
    if (!petId) fail('NO_PET');
    const food = rules(() => takeFarmFood(s, item));
    const row = await lockPet(tx, petId!);
    const { state } = await settle(tx, row);
    const err = checkFeed(state, food, { isOwner: true, visitorCountPet: 0, visitorCountMine: 0, balance: 0 });
    if (err) fail(err); // 整個 transaction 取消：東西留在倉庫
    const ev = applyFood(state, food, now, createRng(randomSeed()), GAME, clock());
    await insertEvents(tx, petId!, [{ type: 'feed', actor: ctx.userId, payload: { food: food.id, price: 0, visitor: false } }, ...ev.map((e) => ({ type: e.type, at: e.at }))]);
    await savePet(tx, petId!, state);
    await saveFarm(tx, ctx.userId, s);
    const home = await homeOf(tx, ctx.userId);
    const actor = await tx.selectFrom('users').select(['id', 'display_name', 'avatar_url']).where('id', '=', ctx.userId).executeTakeFirstOrThrow();
    await notify(tx, { t: 'pet', home: home!.id, pet: petId, ev: { type: 'feed', food: food.id, actor: publicUser(actor) } });
    await notify(tx, { t: 'farm', user: ctx.userId, home: home!.id });
    return { ok: true, pet: publicPet(row, state), state: s, derived: describeFarm(s, now, clock(), await farmCtx(tx, ctx.userId, now, false)) };
  }, { type: 'farm', id: ctx.userId });
}
