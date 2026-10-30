import { ownedOutfits } from './outfits';
import * as engine from '@chick/engine';
import { clock } from './hours';
import { applyFood, applyOwnerAction, checkFeed, foodById, createRng, GAME, isSpecies, newPet, revive as reviveState, SPECIES, type OwnerAction } from '@chick/engine';
import { sql, type Db, type Tx } from './db';
import { changeBalance, lockWallets, notify, rateLimit, runAction, type ReqCtx } from './core';
import { fail } from './errors';
import { maybeEvolve, insertEvents, loadSettledPet, lockPet, publicPet, rowToState, savePet, settle, stateToRow } from './pets';
import { newShareCode, normalizeShareCode, publicUser, randomSeed } from './util';
import { env } from './env';

// ---------- 使用者 ----------
export async function ensureUser(db: Db, p: { sub: string; email: string | null; name: string; avatar: string | null }) {
  const role = p.email && env.adminEmails.includes(p.email.toLowerCase()) ? 'admin' : 'user';
  return db.transaction().execute(async (tx) => {
    const existing = await tx.selectFrom('users').selectAll().where('google_sub', '=', p.sub).forUpdate().executeTakeFirst();
    if (existing) {
      return tx.updateTable('users').set({ last_login_at: new Date(), email: p.email, role, avatar_url: p.avatar ?? existing.avatar_url })
        .where('id', '=', existing.id).returningAll().executeTakeFirstOrThrow();
    }
    let user: any;
    for (let i = 0; ; i++) {
      const r = await sql<any>`INSERT INTO users (google_sub, email, display_name, avatar_url, share_code, role, last_login_at)
        VALUES (${p.sub}, ${p.email}, ${p.name.slice(0, 40) || '玩家'}, ${p.avatar}, ${newShareCode()}, ${role}, now())
        ON CONFLICT (share_code) DO NOTHING RETURNING *`.execute(tx);
      if (r.rows[0]) { user = r.rows[0]; break; }
      if (i > 5) throw new Error('share code collision');
    }
    await tx.insertInto('wallets').values({ user_id: user.id, balance: 0 }).execute();
    await changeBalance(tx, user.id, GAME.startCoins, 'signup');
    await tx.insertInto('homes').values({ owner_id: user.id, name: `${user.display_name} 的家` }).execute();
    return user;
  });
}

export async function getMe(db: Db, userId: string) {
  const u = await db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirstOrThrow();
  const w = await db.selectFrom('wallets').select('balance').where('user_id', '=', userId).executeTakeFirstOrThrow();
  const home = await db.selectFrom('homes').select(['id', 'name', 'access_mode']).where('owner_id', '=', userId).executeTakeFirstOrThrow();
  const pet = await currentPet(db, userId);
  const outfits = await ownedOutfits(db, userId);
  return { user: { ...publicUser(u), share_code: u.share_code, role: u.role }, wallet: { balance: w.balance }, home, pet, outfits };
}

async function currentPetRow(db: Db | Tx, ownerId: string) {
  return (await db.selectFrom('pets').select(['id']).where('owner_id', '=', ownerId).where('status', 'in', ['egg', 'alive']).executeTakeFirst())
    ?? (await db.selectFrom('pets').select(['id']).where('owner_id', '=', ownerId).orderBy('born_at', 'desc').limit(1).executeTakeFirst());
}
export async function currentPet(db: Db, ownerId: string) {
  const r = await currentPetRow(db, ownerId);
  if (!r) return null;
  return db.transaction().execute(async (tx) => { const x = await loadSettledPet(tx, r.id); return x && publicPet(x.row, x.state); });
}

// ---------- 家與權限 ----------
export async function canEnter(db: Db | Tx, home: any, userId: string) {
  if (home.owner_id === userId) return true;
  const bl = await db.selectFrom('home_blacklist').select('user_id').where('home_id', '=', home.id).where('user_id', '=', userId).executeTakeFirst();
  if (bl) return false;
  if (home.access_mode === 'closed') return false;
  if (home.access_mode === 'invite_only') {
    return !!(await db.selectFrom('home_invites').select('user_id').where('home_id', '=', home.id).where('user_id', '=', userId).executeTakeFirst());
  }
  return true;
}
export async function getHome(db: Db, homeId: string) { return db.selectFrom('homes').selectAll().where('id', '=', homeId).executeTakeFirst(); }

/** 家的完整檢視（包含寵物），同時記錄最近拜訪。 */
export async function viewHome(db: Db, homeId: string, userId: string) {
  const home = await getHome(db, homeId);
  if (!home) fail('NOT_FOUND');
  if (!(await canEnter(db, home!, userId))) fail('FORBIDDEN');
  const owner = await db.selectFrom('users').select(['id', 'display_name', 'avatar_url']).where('id', '=', home!.owner_id).executeTakeFirstOrThrow();
  if (home!.owner_id !== userId) {
    await sql`INSERT INTO home_visits (user_id, home_id, last_visited_at) VALUES (${userId}, ${homeId}, now())
      ON CONFLICT (user_id, home_id) DO UPDATE SET last_visited_at = now()`.execute(db);
  }
  const pet = await currentPet(db, home!.owner_id);
  let visitorStatus = null;
  if (pet && home!.owner_id !== userId) visitorStatus = await visitorCounts(db, pet.id, userId);
  return { home: { id: home!.id, name: home!.name, owner: publicUser(owner), is_owner: home!.owner_id === userId, access_mode: home!.owner_id === userId ? home!.access_mode : undefined }, pet, visitor: visitorStatus };
}
async function visitorCounts(db: Db | Tx, petId: string, userId: string) {
  const r = await sql<{ pet_total: number; mine: number }>`SELECT COALESCE(SUM(count),0)::int AS pet_total, COALESCE(SUM(count) FILTER (WHERE visitor_user_id = ${userId}),0)::int AS mine
    FROM visitor_feed_counters WHERE pet_id = ${petId} AND day = (now() AT TIME ZONE 'Asia/Taipei')::date`.execute(db);
  const x = r.rows[0];
  return { today_pet_total: x.pet_total, today_mine: x.mine, cap_pet: GAME.feed.visitorDailyPerPet, cap_mine: GAME.feed.visitorDailyPerVisitorPerPet };
}

export async function homeByCode(db: Db, code: unknown, userId: string) {
  const c = normalizeShareCode(code); if (!c) fail('NOT_FOUND');
  const u = await db.selectFrom('users').select('id').where('share_code', '=', c!).executeTakeFirst();
  if (!u) fail('NOT_FOUND');
  const home = await db.selectFrom('homes').selectAll().where('owner_id', '=', u!.id).executeTakeFirstOrThrow();
  const owner = await db.selectFrom('users').select(['id', 'display_name', 'avatar_url']).where('id', '=', u!.id).executeTakeFirstOrThrow();
  return { id: home.id, name: home.name, owner: publicUser(owner), can_enter: await canEnter(db, home, userId) };
}
export async function recentHomes(db: Db, userId: string) {
  const rows = await db.selectFrom('home_visits as v').innerJoin('homes as h', 'h.id', 'v.home_id').innerJoin('users as u', 'u.id', 'h.owner_id')
    .select(['h.id', 'h.name', 'h.owner_id', 'h.access_mode', 'u.display_name', 'u.avatar_url', 'v.last_visited_at']).where('v.user_id', '=', userId).orderBy('v.last_visited_at', 'desc').limit(20).execute();
  return Promise.all(rows.map(async (r: any) => ({ id: r.id, name: r.name, owner: publicUser({ id: r.owner_id, display_name: r.display_name, avatar_url: r.avatar_url }), last_visited_at: r.last_visited_at, can_enter: await canEnter(db, r, userId) })));
}
export async function invitedHomes(db: Db, userId: string) {
  const rows = await db.selectFrom('home_invites as i').innerJoin('homes as h', 'h.id', 'i.home_id').innerJoin('users as u', 'u.id', 'h.owner_id')
    .select(['h.id', 'h.name', 'h.owner_id', 'h.access_mode', 'u.display_name', 'u.avatar_url']).where('i.user_id', '=', userId).execute();
  return Promise.all(rows.map(async (r: any) => ({ id: r.id, name: r.name, owner: publicUser({ id: r.owner_id, display_name: r.display_name, avatar_url: r.avatar_url }), can_enter: await canEnter(db, r, userId) })));
}
/** 同事名單只依已驗證的登入信箱判斷，API 不回傳信箱。 */
export async function companyHomes(db: Db, userId: string, online: ReadonlySet<string>) {
  const rows = await db.selectFrom('homes as h').innerJoin('users as u', 'u.id', 'h.owner_id')
    .select(['h.id', 'h.name', 'h.owner_id', 'h.access_mode', 'u.display_name', 'u.avatar_url'])
    .where(sql<string>`lower(split_part(u.email, '@', 2))`, 'in', ['popin.cc', 'broadciel.com'])
    .where('h.owner_id', '!=', userId).orderBy('u.display_name').execute();
  return Promise.all(rows.map(async (r: any) => ({
    id: r.id, name: r.name, owner: publicUser({ id: r.owner_id, display_name: r.display_name, avatar_url: r.avatar_url }),
    online: online.has(r.owner_id), can_enter: await canEnter(db, r, userId),
  })));
}
async function ownHome(db: Db | Tx, homeId: string, userId: string) {
  const h = await db.selectFrom('homes').selectAll().where('id', '=', homeId).executeTakeFirst();
  if (!h) fail('NOT_FOUND'); if (h!.owner_id !== userId) fail('FORBIDDEN');
  return h!;
}
export async function setAccessMode(db: Db, ctx: ReqCtx, homeId: string, mode: unknown, name: unknown, requestId: unknown) {
  if (mode !== undefined && !['open', 'invite_only', 'closed'].includes(mode as string)) fail('BAD_REQUEST');
  return runAction(db, ctx, 'home.update', requestId, { homeId, mode, name }, async (tx) => {
    await ownHome(tx, homeId, ctx.userId);
    const set: Record<string, unknown> = {};
    if (mode) set.access_mode = mode;
    if (typeof name === 'string' && name.trim()) set.name = name.trim().slice(0, 40);
    if (Object.keys(set).length) await tx.updateTable('homes').set(set).where('id', '=', homeId).execute();
    await notify(tx, { t: 'access', home: homeId });
    return { ok: true, access_mode: mode };
  }, { type: 'home', id: homeId });
}
async function resolveTarget(db: Db | Tx, body: any) {
  if (body?.share_code) {
    const c = normalizeShareCode(body.share_code); if (!c) fail('NOT_FOUND');
    const u = await db.selectFrom('users').select('id').where('share_code', '=', c!).executeTakeFirst(); if (!u) fail('NOT_FOUND');
    return u!.id as string;
  }
  if (typeof body?.user_id === 'string') {
    const u = await db.selectFrom('users').select('id').where('id', '=', body.user_id).executeTakeFirst(); if (!u) fail('NOT_FOUND');
    return u!.id as string;
  }
  return fail('BAD_REQUEST');
}
export async function editList(db: Db, ctx: ReqCtx, homeId: string, list: 'home_invites' | 'home_blacklist', op: 'add' | 'remove', body: any) {
  return runAction(db, ctx, `${list}.${op}`, body?.request_id, { homeId, list, op, share_code: body?.share_code, user_id: body?.user_id }, async (tx) => {
    await ownHome(tx, homeId, ctx.userId);
    const target = await resolveTarget(tx, body);
    if (target === ctx.userId) fail('BAD_REQUEST', 'cannot target yourself');
    if (op === 'add') await sql`INSERT INTO ${sql.table(list)} (home_id, user_id) VALUES (${homeId}, ${target}) ON CONFLICT DO NOTHING`.execute(tx);
    else await tx.deleteFrom(list).where('home_id', '=', homeId).where('user_id', '=', target).execute();
    await notify(tx, { t: 'access', home: homeId });
    return { ok: true };
  }, { type: 'home', id: homeId });
}
export async function homeLists(db: Db, homeId: string, userId: string) {
  await ownHome(db, homeId, userId);
  const q = (t: string) => db.selectFrom(`${t} as l`).innerJoin('users as u', 'u.id', 'l.user_id').select(['u.id', 'u.display_name', 'u.avatar_url', 'l.created_at']).where('l.home_id', '=', homeId).execute();
  return { invites: (await q('home_invites')).map((r: any) => ({ ...publicUser(r), since: r.created_at })), blacklist: (await q('home_blacklist')).map((r: any) => ({ ...publicUser(r), since: r.created_at })) };
}
/** 來過 / 餵過我寵物的人（屋主）。 */
export async function homeVisitors(db: Db, homeId: string, userId: string) {
  await ownHome(db, homeId, userId);
  const r = await sql<any>`
    WITH feeds AS (
      SELECT e.actor_user_id AS uid, count(*)::int AS feeds, max(e.created_at) AS last_fed_at
      FROM pet_events e JOIN pets p ON p.id = e.pet_id
      WHERE p.owner_id = ${userId} AND e.type = 'feed' AND e.actor_user_id <> ${userId} GROUP BY 1),
    visits AS (SELECT user_id AS uid, last_visited_at FROM home_visits WHERE home_id = ${homeId})
    SELECT u.id, u.display_name, u.avatar_url, v.last_visited_at, COALESCE(f.feeds,0) AS feeds, f.last_fed_at
    FROM (SELECT uid FROM feeds UNION SELECT uid FROM visits) x JOIN users u ON u.id = x.uid
    LEFT JOIN feeds f ON f.uid = x.uid LEFT JOIN visits v ON v.uid = x.uid
    ORDER BY GREATEST(v.last_visited_at, f.last_fed_at) DESC NULLS LAST LIMIT 100`.execute(db);
  return r.rows.map((x) => ({ user: publicUser(x), last_visited_at: x.last_visited_at, feeds: x.feeds, last_fed_at: x.last_fed_at }));
}
export async function rotateShareCode(db: Db, ctx: ReqCtx, requestId: unknown) {
  return runAction(db, ctx, 'share_code.rotate', requestId, {}, async (tx) => {
    for (let i = 0; i < 6; i++) {
      const code = newShareCode();
      const r = await sql`UPDATE users SET share_code = ${code} WHERE id = ${ctx.userId} AND NOT EXISTS (SELECT 1 FROM users WHERE share_code = ${code})`.execute(tx);
      if (Number(r.numAffectedRows) === 1) return { share_code: code };
    }
    return fail('INTERNAL');
  });
}

// ---------- 寵物 ----------
export async function hatch(db: Db, ctx: ReqCtx, body: any) {
  const species = body?.species; const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 12) : '';
  if (!isSpecies(species) || !name) fail('BAD_REQUEST', 'species and name required');
  return runAction(db, ctx, 'pet.hatch', body?.request_id, { species, name }, async (tx) => {
    await sql`SELECT id FROM users WHERE id = ${ctx.userId} FOR UPDATE`.execute(tx);
    const living = await tx.selectFrom('pets').select('id').where('owner_id', '=', ctx.userId).where('status', 'in', ['egg', 'alive']).executeTakeFirst();
    if (living) fail('ALREADY_HAS_PET');
    const s = newPet(species, Date.now());
    const row = await tx.insertInto('pets').values({ owner_id: ctx.userId, name, ...stateToRow(s) }).returningAll().executeTakeFirstOrThrow();
    const home = await tx.selectFrom('homes').select('id').where('owner_id', '=', ctx.userId).executeTakeFirstOrThrow();
    await notify(tx, { t: 'pet', home: home.id, pet: row.id, ev: { type: 'egg' } });
    return { pet: publicPet(row, s) };
  });
}

async function homeOfOwner(tx: Tx, ownerId: string) { return tx.selectFrom('homes').selectAll().where('owner_id', '=', ownerId).executeTakeFirstOrThrow(); }

/** 餵食：單一 transaction；先鎖付款者錢包，再鎖寵物；結算 → 檢查 → 扣幣/更新/計數/ledger/事件/稽核。 */
export async function feed(db: Db, ctx: ReqCtx, petId: string, foodId: unknown, requestId: unknown) {
  if (!rateLimit(`feed:${ctx.userId}`, GAME.rateLimit.feedPerMinute, 60_000)) fail('RATE_LIMITED');
  const food = foodById(String(foodId));
  return runAction(db, ctx, 'pet.feed', requestId, { petId, foodId }, async (tx) => {
    const pre = await tx.selectFrom('pets').select(['owner_id']).where('id', '=', petId).executeTakeFirst();
    if (!pre) fail('NOT_FOUND');
    const [wallet] = await lockWallets(tx, [ctx.userId]);
    const row = await lockPet(tx, petId);
    const { state } = await settle(tx, row);
    const isOwner = row.owner_id === ctx.userId;
    const home = await homeOfOwner(tx, row.owner_id);
    if (!isOwner && !(await canEnter(tx, home, ctx.userId))) fail('FORBIDDEN');
    const counts = isOwner ? { today_pet_total: 0, today_mine: 0 } : await visitorCounts(tx, petId, ctx.userId);
    const err = checkFeed(state, food, { isOwner, visitorCountPet: counts.today_pet_total, visitorCountMine: counts.today_mine, balance: wallet.balance });
    if (err) { await savePet(tx, petId, state); fail(err); }
    const ev = applyFood(state, food!, Date.now(), createRng(randomSeed()), GAME, clock());
    let balance = wallet.balance;
    if (food!.price > 0) balance = await changeBalance(tx, ctx.userId, -food!.price, 'feed', { type: 'pet', id: petId });
    if (!isOwner) {
      await sql`INSERT INTO visitor_feed_counters (pet_id, visitor_user_id, day, count) VALUES (${petId}, ${ctx.userId}, (now() AT TIME ZONE 'Asia/Taipei')::date, 1)
        ON CONFLICT (pet_id, visitor_user_id, day) DO UPDATE SET count = visitor_feed_counters.count + 1`.execute(tx);
    }
    await insertEvents(tx, petId, [{ type: 'feed', actor: ctx.userId, payload: { food: food!.id, price: food!.price, visitor: !isOwner } }, ...ev.map((e) => ({ type: e.type, at: e.at }))]);
    await savePet(tx, petId, state);
    const actor = await tx.selectFrom('users').select(['id', 'display_name', 'avatar_url']).where('id', '=', ctx.userId).executeTakeFirstOrThrow();
    await notify(tx, { t: 'pet', home: home.id, pet: petId, ev: { type: 'feed', food: food!.id, actor: publicUser(actor) } });
    return { ok: true, pet: publicPet(row, state), balance, food: food!.id, visitor: isOwner ? null : { ...counts, today_pet_total: counts.today_pet_total + 1, today_mine: counts.today_mine + 1 } };
  }, { type: 'pet', id: petId });
}

export async function ownerAction(db: Db, ctx: ReqCtx, petId: string, action: unknown, requestId: unknown) {
  if (!['sleep', 'wake', 'clean', 'doctor'].includes(action as string)) fail('BAD_REQUEST');
  if (!rateLimit(`act:${ctx.userId}`, 30, 60_000)) fail('RATE_LIMITED');
  return runAction(db, ctx, `pet.${action}`, requestId, { petId, action }, async (tx) => {
    const row = await lockPet(tx, petId);
    if (!row) fail('NOT_FOUND');
    if (row.owner_id !== ctx.userId) fail('FORBIDDEN');
    const { state } = await settle(tx, row);
    const err = applyOwnerAction(state, action as OwnerAction);
    if (err) { await savePet(tx, petId, state); fail(err); }
    await insertEvents(tx, petId, [{ type: action as string, actor: ctx.userId }]);
    await savePet(tx, petId, state);
    const home = await homeOfOwner(tx, row.owner_id);
    await notify(tx, { t: 'pet', home: home.id, pet: petId, ev: { type: action } });
    return { ok: true, pet: publicPet(row, state) };
  }, { type: 'pet', id: petId });
}

export async function petEvents(db: Db, petId: string, userId: string, isAdmin = false) {
  const pet = await db.selectFrom('pets').select(['owner_id']).where('id', '=', petId).executeTakeFirst();
  if (!pet) fail('NOT_FOUND'); if (pet!.owner_id !== userId && !isAdmin) fail('FORBIDDEN');
  const rows = await db.selectFrom('pet_events as e').leftJoin('users as u', 'u.id', 'e.actor_user_id')
    .select(['e.id', 'e.type', 'e.payload', 'e.created_at', 'u.id as uid', 'u.display_name', 'u.avatar_url']).where('e.pet_id', '=', petId).orderBy('e.id', 'desc').limit(200).execute();
  return rows.map((r: any) => ({ id: r.id, type: r.type, payload: r.payload, at: r.created_at, actor: r.uid ? publicUser({ id: r.uid, display_name: r.display_name, avatar_url: r.avatar_url }) : null }));
}
export async function myPets(db: Db, userId: string) {
  const rows = await db.selectFrom('pets').select('id').where('owner_id', '=', userId).orderBy('born_at', 'desc').execute();
  return db.transaction().execute(async (tx) => {
    const out = [];
    for (const r of rows) { const x = await loadSettledPet(tx, r.id); if (x) out.push(publicPet(x.row, x.state)); }
    return out;
  });
}

// ---------- 寶（進化）強制觸發：管理員任何寵物；開發模式只能自己的 ----------
export async function forceEvolve(db: Db, ctx: ReqCtx, petId: string, requestId: unknown, admin: boolean) {
  return runAction(db, ctx, admin ? 'admin.evolve' : 'dev.evolve', requestId, { petId }, async (tx) => {
    const row = await lockPet(tx, petId);
    if (!row) fail('NOT_FOUND');
    if (!admin && row.owner_id !== ctx.userId) fail('FORBIDDEN');
    const { state } = await settle(tx, row);
    if (state.status !== 'alive') fail(state.status === 'egg' ? 'PET_EGG' : 'PET_DEAD');
    await savePet(tx, petId, state);
    const bao = row.bao ?? (await maybeEvolve(tx, row, state, Date.now(), true));
    return { ok: true, bao, pet: publicPet(row, state) };
  }, { type: 'pet', id: petId });
}

// ---------- 管理員 ----------
export async function adminUsers(db: Db) {
  const r = await sql<any>`SELECT u.id, u.display_name, u.avatar_url, u.share_code, u.role, u.created_at, u.last_login_at, w.balance,
      (SELECT count(*)::int FROM pets p WHERE p.owner_id = u.id) AS pets,
      (SELECT p.status FROM pets p WHERE p.owner_id = u.id ORDER BY born_at DESC LIMIT 1) AS latest_pet_status
    FROM users u JOIN wallets w ON w.user_id = u.id ORDER BY u.created_at`.execute(db);
  return r.rows; // 不含 email
}
export async function adminUserPets(db: Db, userId: string) {
  const pets = await myPets(db, userId);
  return Promise.all(pets.map(async (p) => ({ ...p, events: (await petEvents(db, p.id, userId, true)).slice(0, 30) })));
}
export async function adminRevive(db: Db, ctx: ReqCtx, petId: string, requestId: unknown) {
  return runAction(db, ctx, 'admin.revive', requestId, { petId }, async (tx) => {
    const row = await lockPet(tx, petId);
    if (!row) fail('NOT_FOUND');
    if (row.status !== 'dead') fail('NOT_DEAD');
    const living = await tx.selectFrom('pets').select('id').where('owner_id', '=', row.owner_id).where('status', 'in', ['egg', 'alive']).executeTakeFirst();
    if (living) fail('OWNER_HAS_LIVING_PET');
    const s = rowToState(row); const now = Date.now();
    reviveState(s, now);
    await savePet(tx, petId, s, { revived_at: new Date(now), revived_by: ctx.userId });
    await insertEvents(tx, petId, [{ type: 'revive', actor: ctx.userId }]);
    const home = await homeOfOwner(tx, row.owner_id);
    await notify(tx, { t: 'pet', home: home.id, pet: petId, ev: { type: 'revive' } });
    return { ok: true, pet: publicPet({ ...row, revived_at: new Date(now) }, s) };
  }, { type: 'pet', id: petId });
}

export function publicConfig() {
  const { FOODS, STAIRS_PARAMS, ENGINE_VERSION } = engine;
  return { species: Object.values(SPECIES), foods: FOODS, game: { timeScale: GAME.timeScale, eggSeconds: GAME.eggSeconds, feed: GAME.feed, stairsMinEnergy: GAME.stairsMinEnergy }, stairs: STAIRS_PARAMS, engine_version: ENGINE_VERSION, dev_login: env.devLogin, google_client_id: env.googleClientId, open_hours: env.openHours || null };
}

export async function dailyMaintenance(db: Db) {
  const ip = await sql`UPDATE audit_log SET ip = NULL WHERE ip IS NOT NULL AND at < now() - interval '30 days'`.execute(db);
  const idem = await sql`DELETE FROM idempotency_keys WHERE created_at < now() - interval '7 days'`.execute(db);
  await sql`DELETE FROM sessions WHERE expires_at < now()`.execute(db);
  return { ip_cleared: Number(ip.numAffectedRows), idempotency_deleted: Number(idem.numAffectedRows) };
}

// ---------- v1.6 下樓梯排行榜 ----------
/** 前 10 名（所有寵物的最深樓層），以及自己（最好的那隻寵物）的名次。同樓層同名次。 */
export async function stairsLeaderboard(db: Db, userId: string, limit = 10) {
  const top = await db.selectFrom('pets').innerJoin('users', 'users.id', 'pets.owner_id')
    .select(['pets.id', 'pets.name', 'pets.species_id as species', 'pets.best_floor', 'pets.status', 'users.display_name', 'pets.owner_id'])
    .where('pets.best_floor', '>', 0).orderBy('pets.best_floor', 'desc').orderBy('pets.born_at', 'asc').limit(limit).execute();
  const rankOf = async (floor: number) => 1 + Number((await db.selectFrom('pets').select((eb: any) => eb.fn.countAll().as('n')).where('best_floor', '>', floor).executeTakeFirst() as any)?.n ?? 0);
  const out = [] as { rank: number; pet_name: string; owner_name: string; species: string; best_floor: number; mine: boolean }[];
  for (const r of top) out.push({ rank: await rankOf(r.best_floor), pet_name: r.name, owner_name: r.display_name, species: r.species, best_floor: r.best_floor, mine: r.owner_id === userId });
  const mineRow = await db.selectFrom('pets').select(['name', 'best_floor']).where('owner_id', '=', userId).orderBy('best_floor', 'desc').limit(1).executeTakeFirst();
  const me = mineRow ? { pet_name: mineRow.name, best_floor: mineRow.best_floor, rank: mineRow.best_floor > 0 ? await rankOf(mineRow.best_floor) : null } : null;
  return { top: out, me };
}
