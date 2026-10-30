import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { createDb } from '../src/db';
import { migrateToLatest } from '../src/migrations';
import { buildApp } from '../src/app';
import { Bus } from '../src/bus';
import { createSolo, finish, handleInput, startStairsLoop, matches } from '../src/stairs';
import { ALWAYS_OPEN, makeClock, STAIRS_PARAMS, STAIRS_CUTOFF_MS, rollBao, lookKey, resolveLook, BAO_POOLS } from '@chick/engine';
import { rowToState } from '../src/pets';
import { handleClosed } from '../src/closing';
import { setClock } from '../src/hours';
import { feed as feedAction } from '../src/game';

const { db } = createDb();
const bus = new Bus();
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let loop: NodeJS.Timeout;

beforeAll(async () => {
  await migrateToLatest(db as any);
  await bus.start();
  ({ app } = await buildApp(db, bus, { logger: false }));
  loop = startStairsLoop(db);
});
afterAll(async () => { clearInterval(loop); await app.close(); await bus.stop(); await db.destroy(); });
beforeEach(async () => {
  const t = await sql<{ tablename: string }>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'kysely_%' AND tablename <> 'audit_log'`.execute(db);
  await sql.raw(`ALTER TABLE audit_log DISABLE TRIGGER USER; TRUNCATE ${t.rows.map((r) => `"${r.tablename}"`).join(',')}, audit_log CASCADE; ALTER TABLE audit_log ENABLE TRIGGER USER;`).execute(db);
});

type Client = { cookie: string; id: string; call: (method: string, url: string, body?: any) => Promise<{ status: number; json: any }> };
let ipSeq = 0;
async function login(name: string): Promise<Client> {
  // 每位測試使用者用不同的來源 IP，避免全域頻率限制（每 IP 每分鐘 300）在整份測試累積
  const remoteAddress = `10.9.${Math.floor(++ipSeq / 250) % 250}.${ipSeq % 250 + 1}`;
  const r = await app.inject({ method: 'POST', url: '/api/auth/dev', payload: { name }, remoteAddress });
  expect(r.statusCode).toBe(200);
  const cookie = String(r.headers['set-cookie']).split(';')[0];
  const call = async (method: string, url: string, body?: any) => {
    const res = await app.inject({ method: method as any, url, payload: body, headers: { cookie }, remoteAddress });
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };
  const me = await call('GET', '/api/me');
  return { cookie, id: me.json.user.id, call };
}
const rid = () => randomUUID();
async function hatchAlive(c: Client, species = 'chicken', patch: Record<string, unknown> = {}) {
  const r = await c.call('POST', '/api/pets', { species, name: 'P' + species, request_id: rid() });
  expect(r.status).toBe(200);
  const id = r.json.pet.id;
  await db.updateTable('pets').set({ status: 'alive', born_at: sql`now() - interval '2 minutes'`, hatched_at: sql`now()`, last_simulated_at: sql`now()`, hunger: 10, health: 80, ...patch } as any).where('id', '=', id).execute();
  return id as string;
}
const feed = (c: Client, pet: string, food: string, request_id = rid()) => c.call('POST', `/api/pets/${pet}/actions`, { action: 'feed', food_id: food, request_id });

describe('auth & profile', () => {
  it('new user gets 20 coins, share code, no email anywhere', async () => {
    const a = await login('alice');
    const me = await a.call('GET', '/api/me');
    expect(me.json.wallet.balance).toBe(20);
    expect(me.json.user.share_code).toMatch(/^[0-9A-Z]{8}$/);
    expect(JSON.stringify(me.json)).not.toContain('@');
    const ledger = await db.selectFrom('coin_ledger').selectAll().where('user_id', '=', a.id).execute();
    expect(ledger.map((l: any) => l.reason)).toEqual(['signup']);
  });
  it('requires a session', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/me' });
    expect(r.statusCode).toBe(401);
  });
  it('admin role comes from ADMIN_EMAILS; admin list has no email', async () => {
    const boss = await login('boss');
    const a = await login('alice');
    expect((await a.call('GET', '/api/admin/users')).status).toBe(403);
    const r = await boss.call('GET', '/api/admin/users');
    expect(r.status).toBe(200);
    expect(r.json.length).toBe(2);
    expect(JSON.stringify(r.json)).not.toContain('@');
  });
});

describe('pets & feeding', () => {
  it('egg hatches after 60s via on-access settle; only one living pet', async () => {
    const a = await login('alice');
    const r = await a.call('POST', '/api/pets', { species: 'dino', name: '小龍', request_id: rid() });
    expect(r.json.pet.status).toBe('egg');
    expect((await a.call('POST', '/api/pets', { species: 'duck', name: 'x', request_id: rid() })).json.error).toBe('ALREADY_HAS_PET');
    await db.updateTable('pets').set({ born_at: sql`now() - interval '61 seconds'`, last_simulated_at: sql`now() - interval '61 seconds'` } as any).execute();
    const me = await a.call('GET', '/api/me');
    expect(me.json.pet.status).toBe('alive');
    expect(me.json.pet.species).toBe('dino');
  });

  it('owner: free rice, fullness-limited; snack only at >=90', async () => {
    const a = await login('alice');
    const pet = await hatchAlive(a, 'chicken', { hunger: 85 });
    expect((await feed(a, pet, 'rice')).status).toBe(200); // 85 -> 100 (capped)
    await db.updateTable('pets').set({ hunger: 100 } as any).where('id', '=', pet).execute();
    expect(['TOO_FULL', 'SNACK_ONLY']).toContain((await feed(a, pet, 'rice')).json.error);
    await db.updateTable('pets').set({ hunger: 92 } as any).where('id', '=', pet).execute();
    expect((await feed(a, pet, 'worm')).json.error).toBe('SNACK_ONLY');
    const r = await feed(a, pet, 'candy');
    expect(r.status).toBe(200);
    expect(r.json.balance).toBe(17);
  });

  it('visitor pays, cannot feed rice, 5/visitor/pet/day, owner sees who fed', async () => {
    const a = await login('alice'); const b = await login('bob');
    const pet = await hatchAlive(a, 'penguin', { hunger: 0 });
    const home = (await a.call('GET', '/api/me')).json.home.id;
    expect((await b.call('GET', `/api/homes/${home}`)).json.pet.id).toBe(pet);
    expect((await feed(b, pet, 'rice')).json.error).toBe('VISITOR_FREE_FOOD');
    await db.updateTable('wallets').set({ balance: 100 }).where('user_id', '=', b.id).execute();
    for (let i = 0; i < 5; i++) { const r = await feed(b, pet, 'candy'); expect(r.status, JSON.stringify(r.json)).toBe(200); }
    expect((await feed(b, pet, 'candy')).json.error).toBe('DAILY_CAP');
    expect((await b.call('GET', '/api/me')).json.wallet.balance).toBe(85);
    const ev = await a.call('GET', `/api/pets/${pet}/events`);
    const feeds = ev.json.filter((e: any) => e.type === 'feed');
    expect(feeds.length).toBe(5);
    expect(feeds[0].actor.display_name).toBe('bob');
    const vis = await a.call('GET', `/api/homes/${home}/visitors`);
    expect(vis.json[0].feeds).toBe(5);
    // 其他人看不到 who-fed / visitors
    expect((await b.call('GET', `/api/homes/${home}/visitors`)).status).toBe(403);
  });

  it('rose tea: visitor pays 500 via the ledger and the pet gets 20 poops (v1.3)', async () => {
    const a = await login('alice'); const b = await login('bob');
    const pet = await hatchAlive(a, 'chicken', { hunger: 30, poop: 0 });
    expect((await feed(b, pet, 'rosetea')).json.error).toBe('INSUFFICIENT_COINS');
    await db.updateTable('wallets').set({ balance: 600 }).where('user_id', '=', b.id).execute();
    const r = await feed(b, pet, 'rosetea');
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.pet.poop).toBe(20);
    expect((await b.call('GET', '/api/me')).json.wallet.balance).toBe(100);
    const led = await db.selectFrom('coin_ledger').select(['reason', 'delta', 'balance_after']).where('user_id', '=', b.id).orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(led).toMatchObject({ reason: 'feed', delta: -500, balance_after: 100 });
  });

  it('20/pet/day total across visitors', async () => {
    const a = await login('alice');
    const pet = await hatchAlive(a, 'duck', { hunger: 0 });
    await sql`INSERT INTO visitor_feed_counters (pet_id, visitor_user_id, day, count)
      SELECT ${pet}, id, (now() AT TIME ZONE 'Asia/Taipei')::date, 5 FROM users WHERE id = ${a.id}`.execute(db); // 模擬已累計
    const vs = await Promise.all(['v1', 'v2', 'v3', 'v4'].map(login));
    await db.updateTable('pets').set({ hunger: 0 } as any).where('id', '=', pet).execute();
    let ok = 0;
    for (const v of vs) for (let i = 0; i < 5; i++) { await db.updateTable('pets').set({ hunger: 0 } as any).where('id', '=', pet).execute(); if ((await feed(v, pet, 'candy')).status === 200) ok++; }
    expect(ok).toBe(15); // 已有 5 次 → 只剩 15 次
  });

  it('visitor snack blocked when health is low', async () => {
    const a = await login('alice'); const b = await login('bob');
    const pet = await hatchAlive(a, 'chicken', { health: 20 });
    await a.call('GET', '/api/me');
    expect((await feed(b, pet, 'candy')).json.error).toBe('LOW_HEALTH_SNACK');
    expect((await feed(b, pet, 'worm')).status).toBe(200);
  });

  it('owner actions: sleep/wake split, clean, doctor; visitors cannot', async () => {
    const a = await login('alice'); const b = await login('bob');
    const pet = await hatchAlive(a, 'chicken', { poop: 2, cleanliness: 30, health: 50 });
    const act = (c: Client, action: string) => c.call('POST', `/api/pets/${pet}/actions`, { action, request_id: rid() });
    expect((await act(b, 'clean')).status).toBe(403);
    { const w = await act(a, 'wake'); expect(w.status).toBe(200); expect(w.json.pet.sleeping).toBe(false); } // 醒著按起床：冪等成功（睡飽自動起床後畫面可能還在睡）
    expect((await act(a, 'sleep')).json.pet.sleeping).toBe(true);
    expect((await act(a, 'sleep')).json.error).toBe('ALREADY_SLEEPING');
    expect((await feed(a, pet, 'rice')).json.error).toBe('PET_SLEEPING');
    expect((await act(a, 'wake')).json.pet.sleeping).toBe(false);
    const c = await act(a, 'clean'); expect(c.json.pet.poop).toBe(0); expect(c.json.pet.cleanliness).toBe(100);
    const d = await act(a, 'doctor'); expect(d.json.pet.health).toBeGreaterThanOrEqual(79);
  });
});

describe('idempotency & wallet', () => {
  it('replays the same request_id without double charging; conflicting body rejected', async () => {
    const a = await login('alice');
    const pet = await hatchAlive(a, 'chicken', { hunger: 0 });
    const id = rid();
    const r1 = await feed(a, pet, 'worm', id);
    const r2 = await feed(a, pet, 'worm', id);
    expect(r1.status).toBe(200); expect(r2.status).toBe(200);
    expect(r2.json.balance).toBe(15);
    expect((await a.call('GET', '/api/me')).json.wallet.balance).toBe(15);
    expect((await feed(a, pet, 'corn', id)).json.error).toBe('IDEMPOTENCY_CONFLICT');
    const led = await db.selectFrom('coin_ledger').select(['delta', 'balance_after']).where('user_id', '=', a.id).orderBy('id').execute();
    expect(led.map((l: any) => l.delta)).toEqual([20, -5]);
  });
  it('insufficient coins', async () => {
    const a = await login('alice');
    const pet = await hatchAlive(a, 'chicken', { hunger: 0 });
    expect((await feed(a, pet, 'cake')).status).toBe(200);
    expect((await feed(a, pet, 'cake')).json.error).toBe('INSUFFICIENT_COINS');
  });
  it('concurrent feeds never overdraw', async () => {
    const a = await login('alice');
    const pet = await hatchAlive(a, 'chicken', { hunger: 0 });
    const rs = await Promise.all([1, 2, 3].map(() => feed(a, pet, 'corn')));
    expect(rs.filter((r) => r.status === 200).length).toBe(2);
    expect((await a.call('GET', '/api/me')).json.wallet.balance).toBe(0);
  });
  it('requires request_id', async () => {
    const a = await login('alice');
    const pet = await hatchAlive(a);
    expect((await a.call('POST', `/api/pets/${pet}/actions`, { action: 'feed', food_id: 'rice' })).status).toBe(400);
  });
});

describe('homes: access modes & blacklist', () => {
  it('lists company homes without codes or emails and marks a user online outside homes', async () => {
    const viewer = await login('viewer'), popin = await login('popin'), broadciel = await login('broadciel'), outsider = await login('outsider');
    await db.updateTable('users').set({ email: 'popin@POPIN.CC' }).where('id', '=', popin.id).execute();
    await db.updateTable('users').set({ email: 'broadciel@broadciel.com' }).where('id', '=', broadciel.id).execute();
    await db.updateTable('users').set({ email: 'outsider@gmail.com' }).where('id', '=', outsider.id).execute();
    const list = async () => (await viewer.call('GET', '/api/homes/company')).json;
    expect((await list()).map((h: any) => h.owner.id).sort()).toEqual([popin.id, broadciel.id].sort());
    expect(JSON.stringify(await list())).not.toContain('@');
    const home = (await popin.call('GET', '/api/me')).json.home.id;
    await popin.call('PATCH', `/api/homes/${home}`, { access_mode: 'closed', request_id: rid() });
    expect((await list()).find((h: any) => h.owner.id === popin.id).can_enter).toBe(false);

    const messages: any[] = [];
    const ws = await app.injectWS('/ws', { headers: { cookie: broadciel.cookie }, socket: { remoteAddress: '127.0.0.1' } } as any, { onInit: (s) => s.on('message', (d) => messages.push(JSON.parse(String(d)))) });
    for (let i = 0; i < 50 && !messages.some((m) => m.type === 'hello'); i++) await new Promise((r) => setTimeout(r, 20));
    expect(messages.some((m) => m.type === 'hello')).toBe(true);
    expect((await list()).find((h: any) => h.owner.id === broadciel.id).online).toBe(true);
    ws.close();
  });

  it('open / invite-only / closed / blacklist', async () => {
    const a = await login('alice'); const b = await login('bob'); const c = await login('carol');
    const me = (await a.call('GET', '/api/me')).json;
    const home = me.home.id;
    const bobCode = (await b.call('GET', '/api/me')).json.user.share_code;
    expect((await b.call('GET', `/api/homes/by-code/${me.user.share_code}`)).json.can_enter).toBe(true);
    expect((await a.call('PATCH', `/api/homes/${home}`, { access_mode: 'invite_only', request_id: rid() })).status).toBe(200);
    expect((await b.call('GET', `/api/homes/${home}`)).status).toBe(403);
    expect((await a.call('POST', `/api/homes/${home}/invites`, { share_code: bobCode, request_id: rid() })).status).toBe(200);
    expect((await b.call('GET', `/api/homes/${home}`)).status).toBe(200);
    expect((await c.call('GET', `/api/homes/${home}`)).status).toBe(403);
    expect((await b.call('GET', '/api/homes/invited')).json[0].id).toBe(home);
    await a.call('PATCH', `/api/homes/${home}`, { access_mode: 'closed', request_id: rid() });
    expect((await b.call('GET', `/api/homes/${home}`)).status).toBe(403);
    await a.call('PATCH', `/api/homes/${home}`, { access_mode: 'open', request_id: rid() });
    expect((await c.call('GET', `/api/homes/${home}`)).status).toBe(200);
    expect((await a.call('POST', `/api/homes/${home}/blacklist`, { share_code: (await c.call('GET', '/api/me')).json.user.share_code, request_id: rid() })).status).toBe(200);
    expect((await c.call('GET', `/api/homes/${home}`)).status).toBe(403);
    expect((await c.call('GET', '/api/homes/recent')).json[0].can_enter).toBe(false);
    // 不可能拉黑/邀請自己
    expect((await a.call('POST', `/api/homes/${home}/blacklist`, { share_code: me.user.share_code, request_id: rid() })).status).toBe(400);
  });
  it('rotating share code invalidates the old one', async () => {
    const a = await login('alice'); const b = await login('bob');
    const old = (await a.call('GET', '/api/me')).json.user.share_code;
    const r = await a.call('POST', '/api/me/share-code/rotate', { request_id: rid() });
    expect(r.json.share_code).not.toBe(old);
    expect((await b.call('GET', `/api/homes/by-code/${old}`)).status).toBe(404);
  });
});

describe('death, archive & admin revive', () => {
  it('neglected pet dies on access, is archived, admin revives', async () => {
    const a = await login('alice'); const boss = await login('boss');
    const pet = await hatchAlive(a, 'dino', { hunger: 0, health: 1, happiness: 0, energy: 0, last_simulated_at: sql`now() - interval '3 hours'` });
    const me = await a.call('GET', '/api/me');
    expect(me.json.pet?.status ?? 'dead').toBe('dead');
    const mine = await a.call('GET', '/api/users/me/pets');
    expect(mine.json[0].status).toBe('dead');
    const list = await boss.call('GET', `/api/admin/users/${a.id}/pets`);
    expect(list.json[0].status).toBe('dead');
    expect(list.json[0].events.some((e: any) => e.type === 'death')).toBe(true);
    expect((await a.call('POST', `/api/admin/pets/${pet}/revive`, { request_id: rid() })).status).toBe(403);
    const r = await boss.call('POST', `/api/admin/pets/${pet}/revive`, { request_id: rid() });
    expect(r.status).toBe(200);
    expect(r.json.pet.status).toBe('alive');
    expect((await a.call('GET', '/api/me')).json.pet.id).toBe(pet);
    const au = await db.selectFrom('audit_log').select('action').where('action', '=', 'admin.revive').execute();
    expect(au.length).toBe(1);
  });
  it('audit log is append-only; daily job nulls old IPs', async () => {
    await login('alice');
    await expect(sql`DELETE FROM audit_log`.execute(db)).rejects.toThrow();
    await sql`ALTER TABLE audit_log DISABLE TRIGGER USER`.execute(db);
    await sql`UPDATE audit_log SET at = now() - interval '31 days'`.execute(db);
    await sql`ALTER TABLE audit_log ENABLE TRIGGER USER`.execute(db);
    const r = await app.inject({ method: 'POST', url: '/api/internal/daily', headers: { authorization: 'Bearer dev-cron' } });
    expect(r.statusCode).toBe(200);
    const rows = await db.selectFrom('audit_log').select('ip').execute();
    expect(rows.every((x: any) => x.ip === null)).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/internal/daily' })).statusCode).toBe(401);
  });
});

describe('stairs (server-authoritative)', () => {
  it('rejects too-early / non-increasing inputs and settles coins = floors', async () => {
    const a = await login('alice');
    const pet = await hatchAlive(a, 'chicken', { energy: 80 });
    const sent: any[] = [];
    const m = await createSolo(db, { userId: a.id }, { userId: a.id, send: (x) => sent.push(x) }, rid());
    expect(sent[0].type).toBe('match.started');
    expect(handleInput(m, { seq: 1, tick: 0, left: true, right: false }).error).toBeUndefined();
    expect(handleInput(m, { seq: 1, tick: 2, left: true, right: false }).error).toBe('BAD_INPUT');
    expect(handleInput(m, { seq: 2, tick: 10_000, left: true, right: false }).error).toBe('INPUT_TOO_EARLY');
    await expect(createSolo(db, { userId: a.id }, { userId: a.id, send: () => {} }, rid())).rejects.toThrow('ALREADY_IN_MATCH');
    m.state.players[0].floor = 7; // 模擬下了 7 樓
    await finish(m, 'quit');
    const end = sent.find((x) => x.type === 'match.ended');
    expect(end.coins).toBe(7);
    expect(end.balance).toBe(27);
    const led = await db.selectFrom('coin_ledger').select(['reason', 'delta']).where('user_id', '=', a.id).orderBy('id').execute();
    expect(led.at(-1)).toMatchObject({ reason: 'stairs_solo', delta: 7 });
    const p = await db.selectFrom('pets').select(['best_floor', 'energy']).where('id', '=', pet).executeTakeFirstOrThrow();
    expect(p.best_floor).toBe(7);
    expect(matches.get(m.id)?.ended).toBe(true);
  });
  it('refuses to start when too tired', async () => {
    const a = await login('alice');
    await hatchAlive(a, 'chicken', { energy: 5 });
    await expect(createSolo(db, { userId: a.id }, { userId: a.id, send: () => {} }, rid())).rejects.toThrow('TOO_TIRED');
  });
});

describe('open hours (v1.2)', () => {
  afterEach(() => setClock(ALWAYS_OPEN));
  const CLOSED = makeClock({ days: [], openMin: 0, closeMin: 1, offsetMin: 480 });
  /** 一個「現在是 12:00，12:03 關門」的時鐘：一定落在快關門（關門前 5 分鐘內）。 */
  function closingSoon() {
    const utcMin = Math.floor((Date.now() % 86_400_000) / 60_000);
    return makeClock({ days: [0, 1, 2, 3, 4, 5, 6], openMin: 0, closeMin: 12 * 60 + 3, offsetMin: 12 * 60 - utcMin });
  }

  it('closed: HTTP answers 423 GAME_CLOSED and the transaction-level check rejects WS writes without side effects', async () => {
    const a = await login('alice');
    const pet = await hatchAlive(a, 'chicken', { hunger: 0 });
    setClock(CLOSED);
    const r = await feed(a, pet, 'rice');
    expect(r.status).toBe(423);
    expect(r.json.error).toBe('GAME_CLOSED');
    // WebSocket 的 pet.action 直接呼叫 game.feed → runAction，不經過 HTTP hook
    await expect(feedAction(db, { userId: a.id }, pet, 'worm', rid())).rejects.toMatchObject({ code: 'GAME_CLOSED' });
    const w = await db.selectFrom('wallets').select('balance').where('user_id', '=', a.id).executeTakeFirstOrThrow();
    expect(w.balance).toBe(20);
    const feeds = await db.selectFrom('pet_events').select('id').where('pet_id', '=', pet).where('type', '=', 'feed').execute();
    expect(feeds).toHaveLength(0);
  });

  it('closing (last 5 minutes): stairs can still start; it is force-ended at the 1-minute cutoff with closing time_up', async () => {
    const a = await login('alice');
    await hatchAlive(a, 'chicken', { energy: 80 });
    const clk = closingSoon(); setClock(clk);
    const sent: any[] = [];
    const m = await createSolo(db, { userId: a.id }, { userId: a.id, send: (x) => sent.push(x) }, rid());
    const closesAt = clk.status(Date.now()).closes_at!;
    expect(m.closingEnd).toBe(true);
    expect(sent[0].closing_end).toBe(true);
    expect(sent[0].ends_at).toBeLessThanOrEqual(closesAt - STAIRS_CUTOFF_MS);
    expect(sent[0].ends_at).toBeGreaterThan(closesAt - STAIRS_CUTOFF_MS - 100);
    expect(sent[0].params.matchMaxTicks).toBe(m.state.params.matchMaxTicks);
    const row = await db.selectFrom('stair_matches').select('config').where('id', '=', m.id).executeTakeFirstOrThrow();
    expect((row.config as any).matchMaxTicks).toBe(m.state.params.matchMaxTicks); // 重播用的參數
    await finish(m, 'quit');
  });
});

describe('review follow-ups (v1.2)', () => {
  afterEach(() => setClock(ALWAYS_OPEN));
  /** 開放中、在 closesAt 關門的假時鐘（毫秒精準，方便測邊界）。 */
  const closesAtClock = (closesAt: number) => ({ ...ALWAYS_OPEN, alwaysOpen: false, isOpen: (t: number) => t < closesAt, status: (t: number) => (t < closesAt ? { open: true, closes_at: closesAt, opens_at: null } : { open: false, closes_at: null, opens_at: null }) });

  it('no fixed 5-minute limit during open hours: far from closing the match only has the 60-minute safety cap', async () => {
    const a = await login('alice');
    await hatchAlive(a, 'chicken', { energy: 80 });
    setClock(closesAtClock(Date.now() + 3 * 3600_000));
    const m = await createSolo(db, { userId: a.id }, { userId: a.id, send: () => {} }, rid());
    expect(m.state.params.matchMaxTicks).toBe(STAIRS_PARAMS.matchMaxTicks);
    expect(m.closingEnd).toBe(false);
    await finish(m, 'quit');
  });
  it('the match ends before the WS connection deadline (not flagged as closing)', async () => {
    const a = await login('alice');
    await hatchAlive(a, 'chicken', { energy: 80 });
    const m = await createSolo(db, { userId: a.id }, { userId: a.id, send: () => {} }, rid(), Date.now() + 10 * 60_000);
    expect(m.startAt + m.state.params.matchMaxTicks * 1000 / 30).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
    expect(m.closingEnd).toBe(false);
    await finish(m, 'quit');
  });
  it('refuses a new match in the last minute before the cutoff (19:58+)', async () => {
    const a = await login('alice');
    await hatchAlive(a, 'chicken', { energy: 80 });
    setClock(closesAtClock(Date.now() + STAIRS_CUTOFF_MS + 60_000 + 200));
    await expect(createSolo(db, { userId: a.id }, { userId: a.id, send: () => {} }, rid())).rejects.toMatchObject({ code: 'GAME_CLOSING' });
  });

  it('20:00: running matches are aborted (no coins) before sockets close, so the disconnect does not settle them', async () => {
    const a = await login('alice');
    await hatchAlive(a, 'chicken', { energy: 80 });
    const log: string[] = [];
    const m = await createSolo(db, { userId: a.id }, { userId: a.id, send: (x: any) => log.push(`conn:${x.type}${x.aborted ? ':aborted' : ''}`) }, rid());
    m.state.players[0].floor = 9;
    const hub = { closeAll: (msg: any, code: number) => { log.push(`closeAll:${msg.type}:${code}`); void finish(m, 'quit').then(() => log.push('finish-after-close')); } };
    const gate = { release: async () => { log.push('release'); } };
    await handleClosed({ db, hub, gate }, 123);
    await new Promise((r) => setTimeout(r, 50));
    expect(log).toEqual(['conn:match.started', 'conn:match.ended:aborted', 'closeAll:game.closed:4423', 'release', 'finish-after-close']);
    const row = await db.selectFrom('stair_matches').select('status').where('id', '=', m.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('aborted');
    const led = await db.selectFrom('coin_ledger').select('reason').where('user_id', '=', a.id).execute();
    expect(led.map((l: any) => l.reason)).toEqual(['signup']);
  });

  it('idempotency: a stored response is replayed after closing; no new audit row; new requests are GAME_CLOSED', async () => {
    const a = await login('alice');
    const pet = await hatchAlive(a, 'chicken', { hunger: 0 });
    const id = rid();
    const first = await feed(a, pet, 'worm', id);
    expect(first.status).toBe(200);
    const audits = async () => (await db.selectFrom('audit_log').select('id').where('request_id', '=', id).execute()).length;
    const before = await audits();
    setClock(closesAtClock(Date.now() - 1)); // 已關門
    const again = await feedAction(db, { userId: a.id }, pet, 'worm', id);
    expect(again).toMatchObject({ ok: true, balance: first.json.balance, replayed: true });
    expect(await audits()).toBe(before);
    await expect(feedAction(db, { userId: a.id }, pet, 'worm', rid())).rejects.toMatchObject({ code: 'GAME_CLOSED' });
    const w = await db.selectFrom('wallets').select('balance').where('user_id', '=', a.id).executeTakeFirstOrThrow();
    expect(w.balance).toBe(first.json.balance);
  });
});

describe('home presence carries pets (v1.3)', () => {
  async function openWs(c: Client) {
    const msgs: any[] = [];
    const ws = await app.injectWS('/ws', { headers: { cookie: c.cookie }, socket: { remoteAddress: '127.0.0.1' } } as any, { onInit: (s) => s.on('message', (d) => msgs.push(JSON.parse(String(d)))) });
    const wait = async (pred: (m: any) => boolean) => {
      for (let i = 0; i < 100; i++) { const m = [...msgs].reverse().find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 20)); }
      throw new Error('timeout: ' + JSON.stringify(msgs.map((m) => m.type)));
    };
    await wait((m) => m.type === 'hello'); // 伺服器的 message handler 在 hello 之後才掛上
    return { ws, msgs, wait };
  }
  const presenceWith = (n: number) => (m: any) => m.type === 'home.presence' && m.users.length === n;
  it('owner and visitor see the same set of pets; updates and leaves propagate', async () => {
    const a = await login('Benson'), b = await login('仲軍'), c = await login('NoPet');
    const petA = await hatchAlive(a, 'chicken');
    const petB = await hatchAlive(b, 'duck');
    const home = (await a.call('GET', '/api/me')).json.home.id;
    const wa = await openWs(a), wb = await openWs(b), wc = await openWs(c);
    wa.ws.send(JSON.stringify({ type: 'home.join', home_id: home }));
    await wa.wait(presenceWith(1));
    wb.ws.send(JSON.stringify({ type: 'home.join', home_id: home }));
    wc.ws.send(JSON.stringify({ type: 'home.join', home_id: home }));
    const pa = await wa.wait(presenceWith(3)), pb = await wb.wait(presenceWith(3)), pc = await wc.wait(presenceWith(3));
    expect(pb.users).toEqual(pa.users); expect(pc.users).toEqual(pa.users);
    const byName = Object.fromEntries(pa.users.map((u: any) => [u.display_name, u]));
    expect(byName['Benson'].pet).toMatchObject({ id: petA, species: 'chicken', status: 'alive' });
    expect(byName['仲軍'].pet).toMatchObject({ id: petB, species: 'duck', status: 'alive', name: 'Pduck' });
    expect(['happy', 'ok', 'sad']).toContain(byName['仲軍'].pet.mood);
    expect(byName['NoPet'].pet).toBeNull();
    // 訪客自己的寵物狀態改變 → 拜訪中的家也更新
    await db.updateTable('pets').set({ status: 'dead', died_at: sql`now()` } as any).where('id', '=', petB).execute();
    const homeB = (await b.call('GET', '/api/me')).json.home.id;
    await bus.publish({ t: 'pet', home: homeB, pet: petB });
    const dead = await wa.wait((m) => m.type === 'home.presence' && m.users.some((u: any) => u.pet?.id === petB && u.pet.status === 'dead'));
    expect(dead.users).toHaveLength(3);
    wb.ws.terminate();
    const left = await wa.wait((m) => m.type === 'home.presence' && m.users.length === 2 && !m.users.some((u: any) => u.id === b.id));
    expect(left.users.map((u: any) => u.display_name).sort()).toEqual(['Benson', 'NoPet']);
    wa.ws.terminate(); wc.ws.terminate();
    await new Promise((r) => setTimeout(r, 300)); // 讓離開的 NOTIFY 在關閉 DB 前送完
  });
});

describe.skip('legacy arena melee mode (removed by home 1v1)', () => {
  let arenaLoop: NodeJS.Timeout;
  beforeAll(async () => { const m = await import('../src/arena'); arenaLoop = m.startArenaLoop(); });
  afterAll(() => clearInterval(arenaLoop));
  afterEach(async () => { setClock(ALWAYS_OPEN); const m = await import('../src/arena'); m._homeCooldown.clear(); });
  async function openWs(c: Client) {
    const msgs: any[] = [];
    const ws = await app.injectWS('/ws', { headers: { cookie: c.cookie }, socket: { remoteAddress: '127.0.0.1' } } as any, { onInit: (s) => s.on('message', (d) => msgs.push(JSON.parse(String(d)))) });
    const wait = async (pred: (m: any) => boolean, what = '') => {
      for (let i = 0; i < 200; i++) { const m = [...msgs].reverse().find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 20)); }
      throw new Error('timeout ' + what + ': ' + JSON.stringify(msgs.slice(-5)));
    };
    await wait((m) => m.type === 'hello');
    return { ws, msgs, wait, send: (m: any) => ws.send(JSON.stringify(m)) };
  }
  /** 主人 a（Benson）+ 訪客 b、d（有寵物）+ 觀眾 c（沒寵物） */
  async function setup(bal: { b?: number; d?: number } = {}, withD = true) {
    const A = await import('../src/arena');
    const a = await login('Benson'), b = await login('仲軍'), c = await login('Spectator');
    const d = withD ? await login('Dora') : null;
    await hatchAlive(a, 'chicken'); await hatchAlive(b, 'duck'); if (d) await hatchAlive(d, 'penguin');
    await db.updateTable('wallets').set({ balance: bal.b ?? 7 }).where('user_id', '=', b.id).execute();
    if (d) await db.updateTable('wallets').set({ balance: bal.d ?? 50 }).where('user_id', '=', d.id).execute();
    const home = (await a.call('GET', '/api/me')).json.home.id;
    const ws = [await openWs(a), await openWs(b), await openWs(c), ...(d ? [await openWs(d)] : [])];
    const [wa, wb, wc, wd] = ws;
    for (const w of ws) w.send({ type: 'home.join', home_id: home });
    await wc.wait((m) => m.type === 'home.presence' && m.users.length === ws.length, 'presence');
    for (const w of ws) w.send({ type: 'arena.join' });
    await wc.wait((m) => m.type === 'arena.notice' && m.code === 'NOT_ELIGIBLE', 'spectator refused');
    await wc.wait((m) => m.type === 'arena.state' && m.fighters.length === ws.length - 1, 'state');
    const arena = A._arenas.get(home)!;
    const F = (u: string) => arena.state.fighters.find((f) => f.userId === u)!;
    const fa = F(a.id), fb = F(b.id);
    fa.x = 40; fb.x = 52; fa.dir = 1; if (d) F(d.id).x = 100;
    const close = async () => { for (const w of ws) w.ws.terminate(); await new Promise((r) => setTimeout(r, 300)); };
    return { A, a, b, c, d, home, wa, wb, wc, wd, arena, F, fa, fb, close };
  }
  const peck = async (w: any) => { w.send({ type: 'arena.input', attack: true }); await new Promise((r) => setTimeout(r, 120)); w.send({ type: 'arena.input', attack: false }); await new Promise((r) => setTimeout(r, 120)); };
  /** v1.6：發起戰鬥 → 其他人回覆（true 參戰／false 觀戰／null 不回）→ 等開打 */
  async function startFight(from: any, replies: [any, boolean | null][], watcher: any) {
    watcher.msgs.length = 0;
    from.send({ type: 'arena.invite' });
    const inv = await watcher.wait((m: any) => m.type === 'arena.event' && m.kind === 'invite', 'invite');
    for (const [w, acc] of replies) if (acc !== null) w.send({ type: 'arena.reply', invite: inv.invite, accept: acc });
    return inv;
  }
  const ready = (f: any, x: number) => Object.assign(f, { inv: 0, x, kx: 0, vy: 0, y: 74, onGround: true, cd: 0 });

  it('the owner can start a melee: all eligible pets join; each loser pays min(20, own balance) once, ledger + audit, idempotent', async () => {
    const { A, a, b, d, home, wa, wb, wc, wd, F, fa, fb, close } = await setup({ b: 7, d: 50 });
    const inv = await startFight(wa, [[wb, true], [wd, true]], wc); // 主人發起
    expect(inv.to.sort()).toEqual([b.id, d!.id].sort());
    const start = await wc.wait((m) => m.type === 'arena.event' && m.kind === 'start', 'start');
    expect(start.names).toHaveLength(3);
    const st = await wc.wait((m) => m.type === 'arena.state' && m.fights.length === 1, 'fight state');
    expect(st.fights[0].parts.sort()).toEqual([a.id, b.id, d!.id].sort());
    expect(st.fights[0].left_ms).toBeGreaterThan(55_000);
    ready(fb, 52); ready(fa, 40); fa.dir = 1; await peck(wa); // 第一下
    // KO b，然後 KO d
    Object.assign(fb, { hp: 5 }); ready(fb, 52); ready(fa, 40); fa.dir = 1;
    await peck(wa);
    await wc.wait((m) => m.type === 'arena.event' && m.kind === 'ko' && m.user === b.id, 'ko b');
    const fd = F(d!.id); Object.assign(fd, { hp: 5 }); ready(fd, 52); ready(fa, 40); fa.dir = 1;
    await peck(wa);
    const fz = await wc.wait((m) => m.type === 'arena.state' && m.frozen, 'frozen');
    expect(fz.fighters.find((x: any) => x.u === d!.id).hp).toBe(0); // 決勝瞬間凍結
    const res = await wc.wait((m) => m.type === 'arena.result', 'result');
    expect(res).toMatchObject({ winner: a.id, amount: 27, reason: 'ko', draw: false });
    expect(res.parts.find((p: any) => p.u === a.id)).toMatchObject({ dmg: 30, pool: 50, transfer: 27, delta: 77 }); // 只有 a 有攻擊分數 → 獎金池全拿
    expect(res.losers.sort()).toEqual([b.id, d!.id].sort());
    const pa = res.parts.find((p: any) => p.u === a.id), pb = res.parts.find((p: any) => p.u === b.id);
    expect(pa).toMatchObject({ delta: 77, hits: 3 }); expect(pb).toMatchObject({ delta: -7, taken: 2, hp: 0 });
    expect((await b.call('GET', '/api/me')).json.wallet.balance).toBe(0);
    expect((await d!.call('GET', '/api/me')).json.wallet.balance).toBe(30);
    expect((await a.call('GET', '/api/me')).json.wallet.balance).toBe(97);
    expect(await db.selectFrom('coin_ledger').select(['delta']).where('reason', '=', 'fight_bonus').execute()).toEqual([{ delta: 50 }]);
    const led = await db.selectFrom('coin_ledger').select(['delta', 'ref_id']).where('reason', '=', 'fight').execute();
    expect(led.map((l: any) => l.delta).sort((x: number, y: number) => x - y)).toEqual([-20, -7, 27]);
    expect(new Set(led.map((l: any) => l.ref_id))).toEqual(new Set([res.fight]));
    const fight = await db.selectFrom('fights').selectAll().where('id', '=', res.fight).executeTakeFirstOrThrow();
    expect(fight).toMatchObject({ status: 'done', winner_user_id: a.id, transfer: 27, home_id: home });
    expect((fight.participants as any[]).length).toBe(3);
    expect(await db.selectFrom('audit_log').select('action').where('action', '=', 'fight.settle').execute()).toHaveLength(1);
    // 冪等：同一場再結算一次不會再轉帳
    const again = { type: 'end' as const, fight: { id: res.fight, startTick: 0, endTick: 1, parts: [] as any[] }, winner: a.id, losers: [b.id, d!.id], draw: false, reason: 'ko' as const, used: {} };
    again.fight.parts = res.parts.map((p: any) => ({ ...p, pet: 'x' }));
    expect(await A.settle(home, again)).toBeNull();
    expect(await db.selectFrom('coin_ledger').select('id').where('reason', '=', 'fight').execute()).toHaveLength(3);
    // 家的冷卻 30 秒
    await new Promise((r) => setTimeout(r, 1700)); // 等凍結結束
    ready(fb, 52); ready(fa, 40); fa.dir = 1;
    wa.send({ type: 'arena.invite' });
    await wa.wait((m) => m.type === 'arena.notice' && m.code === 'HOME_COOLDOWN', 'cooldown');
    await close();
  });
  it('a draw at timeout skips loser transfers but still pays the 50 pool by damage', async () => {
    const { A, a, b, home, wa, wb, arena, fa, fb, close } = await setup({ b: 40 }, false);
    await startFight(wa, [[wb, true]], wa); await wa.wait((m) => m.type === 'arena.event' && m.kind === 'start', 'start');
    ready(fb, 52); ready(fa, 40); fa.dir = 1; await peck(wa); await new Promise((r) => setTimeout(r, 100));
    const fight = arena.state.fights[0]; expect(fight).toBeTruthy();
    fa.hp = fb.hp = 70; fight.endTick = arena.state.tick + 2;
    const res = await wa.wait((m) => m.type === 'arena.result', 'draw');
    expect(res).toMatchObject({ winner: null, draw: true, amount: 0, reason: 'timeout' });
    expect((await b.call('GET', '/api/me')).json.wallet.balance).toBe(40);
    expect((await a.call('GET', '/api/me')).json.wallet.balance).toBe(70); // 20 + 獎金池 50
    expect(res.parts.find((p: any) => p.u === a.id)).toMatchObject({ pool: 50, transfer: 0 });
    void A; void home;
    await close();
  });
  it('refuses to start near closing; 20:00 abort cancels with no transfer', async () => {
    const { A, a, b, home, wa, wb, close } = await setup({ b: 50 }, false);
    expect(A.canStart(home, [a.id, b.id])).toBeNull();
    const utcMin = Math.floor((Date.now() % 86_400_000) / 60_000);
    setClock(makeClock({ days: [0, 1, 2, 3, 4, 5, 6], openMin: 0, closeMin: 12 * 60 + 3, offsetMin: 12 * 60 - utcMin }));
    expect(A.canStart(home, [a.id, b.id])).toBe('GAME_CLOSING');
    setClock(ALWAYS_OPEN);
    await startFight(wa, [[wb, true]], wb);
    await wb.wait((m) => m.type === 'arena.event' && m.kind === 'start', 'start');
    await A.abortArenas();
    const r = await wb.wait((m) => m.type === 'arena.result', 'abort');
    expect(r).toMatchObject({ winner: null, amount: 0, reason: 'cancel' });
    expect((await db.selectFrom('fights').select('status').executeTakeFirstOrThrow()).status).toBe('aborted');
    expect((await b.call('GET', '/api/me')).json.wallet.balance).toBe(50);
    await close();
  });
  it('items: purchase via ledger (idempotent, audited); fights_left drops once per fight where used', async () => {
    const a = await login('Benson');
    await db.updateTable('wallets').set({ balance: 400 }).where('user_id', '=', a.id).execute();
    const req = rid();
    const r1 = await a.call('POST', '/api/items/buy', { item_id: 'sword', request_id: req });
    expect(r1.status).toBe(200); expect(r1.json).toMatchObject({ fights_left: 10, balance: 250 });
    const r2 = await a.call('POST', '/api/items/buy', { item_id: 'sword', request_id: req }); // 重送
    expect(r2.json).toMatchObject({ fights_left: 10, balance: 250, replayed: true });
    expect((await a.call('POST', '/api/items/buy', { item_id: 'kame', request_id: rid() })).status).toBe(402); // 250 < 300
    expect((await a.call('POST', '/api/items/buy', { item_id: 'nope', request_id: rid() })).status).toBe(400);
    expect((await a.call('GET', '/api/me')).json.items).toEqual({ sword: 10 });
    const led = await db.selectFrom('coin_ledger').select(['delta', 'reason', 'ref_id']).where('reason', '=', 'item').execute();
    expect(led).toEqual([{ delta: -150, reason: 'item', ref_id: 'sword' }]);
    expect(await db.selectFrom('audit_log').select('action').where('action', '=', 'item.buy').where('result', '=', 'ok').execute()).toHaveLength(1);
    expect((await a.call('GET', '/api/items')).json.catalog.map((c: any) => [c.id, c.price, c.fights])).toEqual([['sword', 150, 10], ['kame', 300, 5], ['poop', 50, 10]]);
  });
  it('fights_left decrements once for a fight where the sword was swung many times', async () => {
    const { a, b, wa, wb, wc, arena, fa, fb, close } = await setup({ b: 5 }, false);
    await db.updateTable('wallets').set({ balance: 200 }).where('user_id', '=', a.id).execute();
    expect((await a.call('POST', '/api/items/buy', { item_id: 'sword', request_id: rid() })).status).toBe(200);
    for (let i = 0; i < 50 && !(fa.items.sword! > 0); i++) await new Promise((r) => setTimeout(r, 20)); // 道具同步到場上
    expect(fa.items).toEqual({ sword: 10 }); expect(fa.equip).toBe('sword');
    const swing = async () => { wa.send({ type: 'arena.input', item: true, equip: 'sword' }); await new Promise((r) => setTimeout(r, 100)); wa.send({ type: 'arena.input', item: false }); await new Promise((r) => setTimeout(r, 700)); };
    ready(fb, 70); await swing(); // 對戰外揮劍無效
    expect(fb.hp).toBe(100); expect(arena.state.fights).toHaveLength(0);
    await startFight(wa, [[wb, true]], wc); await wc.wait((m) => m.type === 'arena.event' && m.kind === 'start', 'start');
    ready(fb, 70); await swing(); ready(fb, 70); await swing(); ready(fb, 70); await swing();
    Object.assign(fb, { hp: 1 }); ready(fb, 70); await swing();
    await wc.wait((m) => m.type === 'arena.result', 'result');
    await new Promise((r) => setTimeout(r, 200));
    const row = await db.selectFrom('user_items').select('fights_left').where('user_id', '=', a.id).executeTakeFirstOrThrow();
    expect(row.fights_left).toBe(9);
    void b; void arena;
    await close();
  });
  it('invites: no answer within 10s = spectator → cancel when <2; decline; early start when all answered', async () => {
    const { A, a, b, d, wa, wb, wc, wd, arena, close } = await setup({}, true);
    const inv = await startFight(wa, [[wb, false]], wc); // b 觀戰、d 不回
    expect(arena.state.fights).toHaveLength(0);
    A._arenas.get(arena.home)!.invite!.deadline = Date.now(); // 時間到
    const cancel = await wc.wait((m) => m.type === 'arena.event' && m.kind === 'invite_cancel', 'cancel');
    expect(cancel).toMatchObject({ invite: inv.invite, code: 'NOT_ENOUGH' });
    expect(arena.state.fights).toHaveLength(0);
    // 再發起：b 參戰、d 觀戰 → 全部回覆就立刻開打（不用等 10 秒）
    const t0 = Date.now();
    await startFight(wa, [[wb, true], [wd, false]], wc);
    await wc.wait((m) => m.type === 'arena.event' && m.kind === 'start', 'start');
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(arena.state.fights[0].parts.map((p) => p.u).sort()).toEqual([a.id, b.id].sort());
    expect(arena.state.fighters.find((f) => f.userId === d!.id)!.fightId).toBeNull(); // 觀戰
    // 對戰中不能再發起
    wb.send({ type: 'arena.invite' }); await wb.wait((m) => m.type === 'arena.notice' && m.code === 'FIGHT_BUSY', 'busy');
    await close();
  });
  it('owner must be home: owner offline → OWNER_OFFLINE notice, no invite', async () => {
    const { a, wa, wb, wc, close } = await setup({}, true);
    wa.ws.terminate(); wc.msgs.length = 0;
    await wc.wait((m) => m.type === 'home.presence' && !m.users.some((u: any) => u.id === a.id), 'owner gone');
    wb.send({ type: 'arena.invite' });
    await wb.wait((m) => m.type === 'arena.notice' && m.code === 'OWNER_OFFLINE', 'offline');
    expect(wc.msgs.some((m: any) => m.type === 'arena.event' && m.kind === 'invite')).toBe(false);
    await close();
  });
  it('stairs leaderboard: top floors across all pets plus the viewer\'s own rank', async () => {
    const a = await login('Benson'), b = await login('仲軍'), c = await login('Newbie');
    const pa = await hatchAlive(a, 'chicken'), pb = await hatchAlive(b, 'duck');
    await db.updateTable('pets').set({ best_floor: 12 }).where('id', '=', pa).execute();
    await db.updateTable('pets').set({ best_floor: 30 }).where('id', '=', pb).execute();
    const r = await a.call('GET', '/api/leaderboard/stairs');
    expect(r.status).toBe(200);
    expect(r.json.top.map((x: any) => [x.rank, x.pet_name, x.owner_name, x.best_floor, x.mine])).toEqual([[1, 'Pduck', '仲軍', 30, false], [2, 'Pchicken', 'Benson', 12, true]]);
    expect(r.json.me).toMatchObject({ rank: 2, best_floor: 12 });
    expect(JSON.stringify(r.json)).not.toContain('@');
    expect((await c.call('GET', '/api/leaderboard/stairs')).json.me).toBeNull(); // 沒寵物
  });
  it('poop: unlimited throws in a fight, never touches any pet\'s poop count or broadcasts pet updates; fights_left -1 once', async () => {
    const { a, b, wa, wb, wc, arena, fa, close } = await setup({}, false);
    const pets = (await db.selectFrom('pets').select(['id', 'poop']).execute()).map((p) => p.id);
    await db.updateTable('pets').set({ poop: 0 }).execute(); // 地上沒有便便也能丟
    await db.updateTable('wallets').set({ balance: 100 }).where('user_id', '=', a.id).execute();
    expect((await a.call('POST', '/api/items/buy', { item_id: 'poop', request_id: rid() })).status).toBe(200);
    for (let i = 0; i < 50 && !(fa.items.poop! > 0); i++) await new Promise((r) => setTimeout(r, 20));
    await startFight(wa, [[wb, true]], wc); await wc.wait((m) => m.type === 'arena.event' && m.kind === 'start', 'start');
    for (const w of [wa, wb, wc]) w.msgs.length = 0;
    const sn0 = fa.swingN;
    for (let i = 0; i < 5; i++) { wa.send({ type: 'arena.input', item: true, equip: 'poop' }); await new Promise((r) => setTimeout(r, 80)); wa.send({ type: 'arena.input', item: false }); await new Promise((r) => setTimeout(r, 520)); }
    expect(fa.swingN - sn0).toBe(5);
    for (const w of [wa, wb, wc]) expect(w.msgs.some((m: any) => m.type === 'pet.updated')).toBe(false);
    expect((await db.selectFrom('pets').select('poop').where('id', 'in', pets).execute()).map((p) => p.poop)).toEqual(pets.map(() => 0));
    arena.state.fights[0].endTick = arena.state.tick; // 時間到
    await wc.wait((m) => m.type === 'arena.result', 'result'); await new Promise((r) => setTimeout(r, 200));
    expect((await db.selectFrom('user_items').select('fights_left').where('user_id', '=', a.id).where('item_id', '=', 'poop').executeTakeFirstOrThrow()).fights_left).toBe(9);
    void b; await close();
  });
});

describe('home fight 1v1', () => {
  async function openWs(c: Client) {
    const msgs: any[] = [];
    const ws = await app.injectWS('/ws', { headers: { cookie: c.cookie }, socket: { remoteAddress: '127.0.0.1' } } as any,
      { onInit: (s) => s.on('message', (d) => msgs.push(JSON.parse(String(d)))) });
    const wait = async (pred: (m: any) => boolean, what = '') => {
      for (let i = 0; i < 250; i++) { const m = [...msgs].reverse().find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 20)); }
      throw new Error(`timeout ${what}: ${JSON.stringify(msgs.slice(-8))}`);
    };
    await wait((m) => m.type === 'hello', 'hello');
    return { ws, msgs, wait, send: (m: any) => ws.send(JSON.stringify(m)) };
  }

  afterEach(async () => {
    const m = await import('../src/fight1v1');
    m._fightInvites.clear(); m._fights.clear(); m._fightCooldowns.clear(); setClock(ALWAYS_OPEN);
  });

  it('uses targeted desktop consent, pins two players, and a disconnect forfeits with idempotent DB settlement', async () => {
    const a = await login('Benson'), b = await login('仲軍'), spectator = await login('Spectator');
    await hatchAlive(a, 'chicken'); await hatchAlive(b, 'duck');
    await db.updateTable('wallets').set({ balance: 7 }).where('user_id', '=', b.id).execute();
    const home = (await a.call('GET', '/api/me')).json.home.id;
    const wa = await openWs(a), wb = await openWs(b), wc = await openWs(spectator);
    for (const w of [wa, wb]) w.send({ type: 'home.join', home_id: home, touch: false });
    wc.send({ type: 'home.join', home_id: home, touch: true });
    await wa.wait((m) => m.type === 'home.presence' && m.users.length === 3, 'presence');

    wa.send({ type: 'fight.invite', to: b.id });
    const inv = await wb.wait((m) => m.type === 'fight.event' && m.kind === 'invite' && m.to === b.id, 'invite');
    wc.send({ type: 'fight.reply', invite: inv.invite, accept: true });
    await wc.wait((m) => m.type === 'fight.notice' && m.code === 'TOUCH_DEVICE', 'touch refused');
    wb.send({ type: 'fight.reply', invite: inv.invite, accept: true });
    const start = await wa.wait((m) => m.type === 'fight.event' && m.kind === 'start', 'start');
    expect(start.players.map((p: any) => p.user_id)).toEqual([a.id, b.id]);
    expect(start.you_pid).toBe(1);
    expect((await wb.wait((m) => m.type === 'fight.event' && m.kind === 'start', 'opponent start')).you_pid).toBe(2);
    expect((await wc.wait((m) => m.type === 'fight.event' && m.kind === 'start', 'spectator start')).you_pid).toBeNull();
    expect(await db.selectFrom('fights').select(['id', 'status']).where('id', '=', start.fight_id).executeTakeFirstOrThrow()).toEqual({ id: start.fight_id, status: 'playing' });

    wb.ws.terminate();
    const result = await wa.wait((m) => m.type === 'fight.result' && m.fight_id === start.fight_id, 'forfeit result');
    expect(result).toMatchObject({ winner: a.id, draw: false, reason: 'forfeit' });
    expect(result.parts.find((p: any) => p.user_id === a.id)).toMatchObject({ transfer: 7, pool: 25, delta: 32 });
    expect(result.parts.find((p: any) => p.user_id === b.id)).toMatchObject({ transfer: -7, pool: 25, delta: 18, forfeit: true });
    expect((await a.call('GET', '/api/me')).json.wallet.balance).toBe(52);
    expect((await b.call('GET', '/api/me')).json.wallet.balance).toBe(25);
    expect(await db.selectFrom('fights').select(['status', 'winner_user_id']).where('id', '=', start.fight_id).executeTakeFirstOrThrow())
      .toEqual({ status: 'done', winner_user_id: a.id });
    expect(await db.selectFrom('audit_log').select('id').where('action', '=', 'fight.settle').where('target_id', '=', start.fight_id).execute()).toHaveLength(1);
    wa.ws.terminate(); wc.ws.terminate(); await new Promise((r) => setTimeout(r, 300));
  });

  it('removes consumable item HTTP surfaces and /me inventory', async () => {
    const a = await login('Benson');
    expect((await a.call('GET', '/api/items')).status).toBe(404);
    expect((await a.call('POST', '/api/items/buy', { item_id: 'sword', request_id: rid() })).status).toBe(404);
    expect((await a.call('GET', '/api/me')).json).not.toHaveProperty('items');
  });

  it('refund migration pays remaining uses once, clears inventory, and records ledger + audit', async () => {
    const a = await login('Benson');
    await db.insertInto('user_items').values([
      { user_id: a.id, item_id: 'sword', fights_left: 7 },
      { user_id: a.id, item_id: 'kame', fights_left: 2 },
      { user_id: a.id, item_id: 'poop', fights_left: 3 },
    ]).execute();
    const rerun = async () => {
      await sql`DELETE FROM kysely_migration WHERE name = '0010_home_fight_1v1_refund'`.execute(db);
      await migrateToLatest(db as any);
    };
    try {
      await rerun();
      expect((await db.selectFrom('wallets').select('balance').where('user_id', '=', a.id).executeTakeFirstOrThrow()).balance).toBe(260); // 20 + 7×15 + 2×60 + 3×5
      expect((await db.selectFrom('user_items').select('fights_left').where('user_id', '=', a.id).execute()).map((x) => x.fights_left)).toEqual([0, 0, 0]);
      expect(await db.selectFrom('coin_ledger').select(['delta', 'reason']).where('user_id', '=', a.id).where('reason', '=', 'item_refund').execute()).toEqual([{ delta: 240, reason: 'item_refund' }]);
      expect(await db.selectFrom('audit_log').select('detail').where('user_id', '=', a.id).where('action', '=', 'item.refund').execute()).toHaveLength(1);
      await rerun();
      expect((await db.selectFrom('wallets').select('balance').where('user_id', '=', a.id).executeTakeFirstOrThrow()).balance).toBe(260);
      expect(await db.selectFrom('coin_ledger').select('id').where('user_id', '=', a.id).where('reason', '=', 'item_refund').execute()).toHaveLength(1);
    } finally {
      await migrateToLatest(db as any);
    }
  });
});

describe('names (v1.4)', () => {
  it('the user-chosen nickname survives re-login and is what presence shows', async () => {
    const a = await login('Benson');
    expect((await a.call('PATCH', '/api/me', { display_name: '班森', request_id: rid() })).status).toBe(200);
    const again = await login('Benson'); // 同一個帳號再登入（Google 名稱仍是 Benson）
    expect((await again.call('GET', '/api/me')).json.user.display_name).toBe('班森');
  });
});

describe('pet follows its owner (v1.4)', () => {
  async function openWs(c: Client) {
    const msgs: any[] = [];
    const ws = await app.injectWS('/ws', { headers: { cookie: c.cookie }, socket: { remoteAddress: '127.0.0.1' } } as any, { onInit: (s) => s.on('message', (d) => msgs.push(JSON.parse(String(d)))) });
    const wait = async (pred: (m: any) => boolean, what = '') => {
      for (let i = 0; i < 150; i++) { const m = [...msgs].reverse().find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 20)); }
      throw new Error('timeout ' + what + ': ' + JSON.stringify(msgs.slice(-4)));
    };
    await wait((m) => m.type === 'hello');
    return { ws, msgs, wait, send: (m: any) => ws.send(JSON.stringify(m)) };
  }
  it('A visiting B: A is not in their own home and it shows owner_away; returning flips it back live', async () => {
    const a = await login('A'), b = await login('B'), c = await login('C');
    await hatchAlive(a); await hatchAlive(b);
    const homeA = (await a.call('GET', '/api/me')).json.home.id, homeB = (await b.call('GET', '/api/me')).json.home.id;
    const wa = await openWs(a), wc = await openWs(c);
    wc.send({ type: 'home.join', home_id: homeA });
    await wc.wait((m) => m.type === 'home.presence' && m.home_id === homeA && m.owner_away === false, 'offline owner = at home');
    wa.send({ type: 'home.join', home_id: homeB });
    const away = await wc.wait((m) => m.type === 'home.presence' && m.home_id === homeA && m.owner_away === true, 'away');
    expect(away.users.map((u: any) => u.id)).toEqual([c.id]);
    // 第二個分頁回到自己家 → 不算外出
    const wa2 = await openWs(a);
    wa2.send({ type: 'home.join', home_id: homeA });
    const back = await wc.wait((m) => m.type === 'home.presence' && m.home_id === homeA && m.owner_away === false && m.users.some((u: any) => u.id === a.id), 'back');
    expect(back.users.map((u: any) => u.id).sort()).toEqual([a.id, c.id].sort());
    wa2.ws.terminate();
    await wc.wait((m) => m.type === 'home.presence' && m.home_id === homeA && m.owner_away === true && !m.users.some((u: any) => u.id === a.id), 'away again');
    const mark = wc.msgs.length;
    wa.ws.terminate(); // 離線 → 寵物在家
    await wc.wait((m) => wc.msgs.indexOf(m) >= mark && m.type === 'home.presence' && m.home_id === homeA && m.owner_away === false, 'offline');
    wc.ws.terminate();
    await new Promise((r) => setTimeout(r, 300));
  });
});

describe('wake after auto-wake (bug: 睡覺後起不來)', () => {
  it('pressing 起床 after the pet already woke up by itself (energy full) succeeds and returns an awake pet', async () => {
    const a = await login('wakeup'); const id = await hatchAlive(a, 'chicken', { energy: 60 });
    const s = await a.call('POST', `/api/pets/${id}/actions`, { action: 'sleep', request_id: rid() });
    expect(s.status).toBe(200); expect(s.json.pet.sleeping).toBe(true);
    // 兩分鐘前就睡了 → 結算時睡飽自動起床，但畫面還以為在睡
    await db.updateTable('pets').set({ last_simulated_at: sql`now() - interval '2 minutes'` } as any).where('id', '=', id).execute();
    const w = await a.call('POST', `/api/pets/${id}/actions`, { action: 'wake', request_id: rid() });
    expect(w.status).toBe(200); expect(w.json.pet.sleeping).toBe(false);
  });
});

describe('寶 evolution & outfits (v1.7)', () => {
  const evolveDue = (id: string) => db.updateTable('pets').set({ hatched_at: sql`now() - interval '34 hours'`, born_at: sql`now() - interval '35 hours'` } as any).where('id', '=', id).execute();
  it('evolves once after 33 open hours, stored on the pet, event + look in public pet', async () => {
    const a = await login('evoa'); const id = await hatchAlive(a, 'chicken', { strength: 60, hunger: 80 });
    let me = await a.call('GET', '/api/me');
    expect(me.json.pet.bao).toBeNull(); expect(me.json.pet.evolve_at).toBeGreaterThan(Date.now());
    await evolveDue(id);
    me = await a.call('GET', '/api/me');
    const bao = me.json.pet.bao;
    expect(bao.cat).toBe('strength'); expect(BAO_POOLS.strength).toContain(bao.items[0]);
    expect(me.json.pet.look).toBe(resolveLook(bao.items, []).join(','));
    const again = await a.call('GET', '/api/me');
    expect(again.json.pet.bao).toEqual(bao);
    const ev = await db.selectFrom('pet_events').select('type').where('pet_id', '=', id).where('type', '=', 'evolve').execute();
    expect(ev).toHaveLength(1);
  });
  it('evolves again every 77 open hours; offline catch-up applies only the latest roll but counts stages', async () => {
    const a = await login('evore'); const id = await hatchAlive(a, 'chicken', { strength: 60 });
    await evolveDue(id);
    let me = await a.call('GET', '/api/me');
    const first = me.json.pet.bao; expect(me.json.pet.bao_stage).toBe(1);
    expect(me.json.pet.evolve_need_ms).toBe(77 * 3_600_000);
    await db.updateTable('pets').set({ hatched_at: sql`now() - interval '${sql.raw(String(33 + 77 * 2 + 1))} hours'` } as any).where('id', '=', id).execute();
    me = await a.call('GET', '/api/me');
    expect(me.json.pet.bao_stage).toBe(3);
    const mains = first.items.filter((x: string) => !['bow', 'flower', 'leaf', 'double'].includes(x));
    expect(me.json.pet.bao.items.slice().sort().join(',')).not.toBe(first.items.slice().sort().join(','));
    expect(me.json.pet.evolve_done_ms).toBeGreaterThan(0);
    const ev = await db.selectFrom('pet_events').select('type').where('pet_id', '=', id).where('type', '=', 'evolve').execute();
    expect(ev).toHaveLength(2); expect(mains.length).toBeGreaterThan(0);
  });
  it('rerolls deterministically (seed+n) when another living pet already has the exact same set', async () => {
    const a = await login('dupa'); const b = await login('dupb');
    const ida = await hatchAlive(a, 'chicken', { strength: 60 }); const idb = await hatchAlive(b, 'chicken', { strength: 60 });
    const row = await db.selectFrom('pets').selectAll().where('id', '=', ida).executeTakeFirstOrThrow();
    const first = rollBao(ida, rowToState(row), 0);
    await db.updateTable('pets').set({ bao: JSON.stringify({ ...first, key: lookKey(first.items) }), bao_at: new Date() } as any).where('id', '=', idb).execute();
    await evolveDue(ida);
    const me = await a.call('GET', '/api/me');
    expect(me.json.pet.bao.items.slice().sort().join(',')).not.toBe(lookKey(first.items));
    const stored = await db.selectFrom('pets').select('bao').where('id', '=', ida).executeTakeFirstOrThrow();
    expect((stored.bao as any).n).toBeGreaterThan(0);
  });
  it('dev/admin force evolve: dev route for own pet only, admin route needs admin', async () => {
    const a = await login('forcea'); const id = await hatchAlive(a);
    const o = await login('forceo');
    expect((await o.call('POST', `/api/dev/pets/${id}/evolve`, { request_id: rid() })).status).toBe(403);
    expect((await a.call('POST', `/api/admin/pets/${id}/evolve`, { request_id: rid() })).status).toBe(403);
    const r = await a.call('POST', `/api/dev/pets/${id}/evolve`, { request_id: rid() });
    expect(r.status).toBe(200); expect(r.json.bao.items.length).toBeGreaterThan(0); expect(r.json.pet.bao).toBeTruthy();
    const boss = await login('boss'); const id2 = await hatchAlive(boss);
    expect((await boss.call('POST', `/api/admin/pets/${id2}/evolve`, { request_id: rid() })).status).toBe(200);
  });
  it('outfits: buy through the ledger (once per user), auto-wear, toggle; crown replaces head items', async () => {
    const a = await login('outa'); const id = await hatchAlive(a);
    await db.updateTable('pets').set({ bao: JSON.stringify({ items: ['horns', 'bow'], cat: 'strength', care: 100, n: 0, key: 'bow,horns' }) } as any).where('id', '=', id).execute();
    expect((await a.call('POST', '/api/outfits/buy', { outfit_id: 'crown', request_id: rid() })).json.error).toBe('INSUFFICIENT_COINS');
    await db.updateTable('wallets').set({ balance: 1300 }).where('user_id', '=', a.id).execute();
    const r = await a.call('POST', '/api/outfits/buy', { outfit_id: 'crown', request_id: rid() });
    expect(r.status).toBe(200); expect(r.json.balance).toBe(300); expect(r.json.owned).toEqual(['crown']);
    expect(r.json.pet.outfits).toEqual(['crown']); expect(r.json.pet.look).toBe('crown');
    const led = await db.selectFrom('coin_ledger').select(['delta', 'reason']).where('user_id', '=', a.id).where('reason', '=', 'outfit').execute();
    expect(led).toEqual([{ delta: -1000, reason: 'outfit' }]);
    expect((await a.call('POST', '/api/outfits/buy', { outfit_id: 'crown', request_id: rid() })).json.error).toBe('ALREADY_OWNED');
    const off = await a.call('POST', '/api/outfits/wear', { outfit_id: 'crown', on: false, request_id: rid() });
    expect(off.json.pet.look).toBe('horns,bow');
    expect((await a.call('POST', '/api/outfits/wear', { outfit_id: 'shades', on: true, request_id: rid() })).json.error).toBe('NOT_OWNED');
    const s = await a.call('POST', '/api/outfits/buy', { outfit_id: 'shades', request_id: rid() });
    expect(s.json.balance).toBe(100); expect(s.json.pet.look).toBe('shades,horns,bow');
    const cat = await a.call('GET', '/api/outfits');
    expect(cat.json.catalog.map((c: any) => [c.id, c.price])).toEqual([['shades', 200], ['crown', 1000], ['eyepatch', 150], ['paperbag', 180], ['monocle', 250], ['headphones', 300], ['wizard', 500], ['eggshell', 600]]);
    expect((await a.call('GET', '/api/me')).json.outfits.sort()).toEqual(['crown', 'shades']);
  });
  it('v2.0 outfits: the 6 new ones can be bought once, worn and removed; one per slot (head / face); bag hides face items', async () => {
    const a = await login('outv2'); const id = await hatchAlive(a);
    await db.updateTable('pets').set({ bao: JSON.stringify({ items: ['sword', 'heartclip'], cat: 'strength', care: 100, n: 0, key: 'heartclip,sword' }) } as any).where('id', '=', id).execute();
    await db.updateTable('wallets').set({ balance: 5000 }).where('user_id', '=', a.id).execute();
    const w = await a.call('POST', '/api/outfits/buy', { outfit_id: 'wizard', request_id: rid() });
    expect(w.status).toBe(200); expect(w.json.balance).toBe(4500); expect(w.json.pet.outfits).toEqual(['wizard']);
    expect(w.json.pet.look).toBe('wizard,sword'); // 魔法帽擋住頭頂的愛心髮夾
    expect((await a.call('POST', '/api/outfits/buy', { outfit_id: 'wizard', request_id: rid() })).json.error).toBe('ALREADY_OWNED');
    const m = await a.call('POST', '/api/outfits/buy', { outfit_id: 'monocle', request_id: rid() });
    expect(m.json.pet.outfits).toEqual(['wizard', 'monocle']); expect(m.json.pet.look).toBe('wizard,monocle,sword');
    // 同部位只穿一件：耳機（頭）換掉魔法帽、眼罩（臉）換掉單片眼鏡
    const h = await a.call('POST', '/api/outfits/buy', { outfit_id: 'headphones', request_id: rid() });
    expect(h.json.pet.outfits).toEqual(['monocle', 'headphones']);
    const e = await a.call('POST', '/api/outfits/buy', { outfit_id: 'eyepatch', request_id: rid() });
    expect(e.json.pet.outfits).toEqual(['headphones', 'eyepatch']);
    const back = await a.call('POST', '/api/outfits/wear', { outfit_id: 'wizard', on: true, request_id: rid() });
    expect(back.json.pet.outfits).toEqual(['eyepatch', 'wizard']);
    // 紙袋整個罩住：臉上的眼罩不畫（但還是穿著）
    const bag = await a.call('POST', '/api/outfits/buy', { outfit_id: 'paperbag', request_id: rid() });
    expect(bag.json.pet.outfits).toEqual(['eyepatch', 'paperbag']); expect(bag.json.pet.look).toBe('paperbag,sword');
    const off = await a.call('POST', '/api/outfits/wear', { outfit_id: 'paperbag', on: false, request_id: rid() });
    expect(off.json.pet.outfits).toEqual(['eyepatch']); expect(off.json.pet.look).toBe('eyepatch,sword,heartclip');
    const egg = await a.call('POST', '/api/outfits/buy', { outfit_id: 'eggshell', request_id: rid() });
    expect(egg.json.balance).toBe(5000 - 500 - 250 - 300 - 150 - 180 - 600);
    expect((await a.call('GET', '/api/outfits')).json.owned.sort()).toEqual(['eggshell', 'eyepatch', 'headphones', 'monocle', 'paperbag', 'wizard']);
    const led = await db.selectFrom('coin_ledger').select('delta').where('user_id', '=', a.id).where('reason', '=', 'outfit').execute();
    expect(led.map((r: any) => r.delta).sort((x: number, y: number) => x - y)).toEqual([-600, -500, -300, -250, -180, -150]);
  });
});
