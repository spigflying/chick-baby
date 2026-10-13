import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { createDb } from '../src/db';
import { migrateToLatest } from '../src/migrations';
import { buildApp } from '../src/app';
import { Bus } from '../src/bus';
import { createSolo, finish, handleInput, startStairsLoop, matches } from '../src/stairs';

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
async function login(name: string): Promise<Client> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/dev', payload: { name } });
  expect(r.statusCode).toBe(200);
  const cookie = String(r.headers['set-cookie']).split(';')[0];
  const call = async (method: string, url: string, body?: any) => {
    const res = await app.inject({ method: method as any, url, payload: body, headers: { cookie } });
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
    expect((await act(a, 'wake')).json.error).toBe('NOT_SLEEPING');
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
    const r = await app.inject({ method: 'POST', url: '/api/internal/daily', headers: { 'x-cron-secret': 'test-cron' } });
    expect(r.statusCode).toBe(200);
    const rows = await db.selectFrom('audit_log').select('ip').execute();
    expect(rows.every((x: any) => x.ip === null)).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/internal/daily' })).statusCode).toBe(403);
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
