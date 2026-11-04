import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { makeClock, parseOpenHours, ALWAYS_OPEN } from '@chick/engine';
import { createDb } from '../src/db';
import { migrateToLatest } from '../src/migrations';
import { buildApp } from '../src/app';
import { Bus } from '../src/bus';
import { setClock } from '../src/hours';

const { db } = createDb();
const bus = new Bus();
let app: Awaited<ReturnType<typeof buildApp>>['app'];

beforeAll(async () => {
  await migrateToLatest(db as any);
  await bus.start();
  ({ app } = await buildApp(db, bus, { logger: false, farmEnabled: true }));
});
afterAll(async () => { await app.close(); await bus.stop(); await db.destroy(); });
beforeEach(async () => {
  setClock(ALWAYS_OPEN);
  const t = await sql<{ tablename: string }>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'kysely_%' AND tablename <> 'audit_log'`.execute(db);
  await sql.raw(`ALTER TABLE audit_log DISABLE TRIGGER USER; TRUNCATE ${t.rows.map((r) => `"${r.tablename}"`).join(',')}, audit_log CASCADE; ALTER TABLE audit_log ENABLE TRIGGER USER;`).execute(db);
});

type Client = { cookie: string; id: string; home: string; call: (method: string, url: string, body?: any) => Promise<{ status: number; json: any }> };
let ipSeq = 0;
async function login(name: string, a = app): Promise<Client> {
  const remoteAddress = `10.8.${Math.floor(++ipSeq / 250) % 250}.${ipSeq % 250 + 1}`;
  const r = await a.inject({ method: 'POST', url: '/api/auth/dev', payload: { name }, remoteAddress });
  expect(r.statusCode).toBe(200);
  const cookie = String(r.headers['set-cookie']).split(';')[0];
  const call = async (method: string, url: string, body?: any) => {
    const res = await a.inject({ method: method as any, url, payload: body, headers: { cookie }, remoteAddress });
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };
  const me = await call('GET', '/api/me');
  return { cookie, id: me.json.user.id, home: me.json.home.id, call };
}
const rid = () => randomUUID();
const act = (c: Client, action: any, request_id = rid()) => c.call('POST', '/api/farm/act', { action, request_id });
const help = (c: Client, owner: string, body: any, request_id = rid()) => c.call('POST', `/api/farm/${owner}/help`, { ...body, request_id });
const balance = async (id: string) => (await db.selectFrom('wallets').select('balance').where('user_id', '=', id).executeTakeFirstOrThrow()).balance as number;
const setBalance = (id: string, n: number) => db.updateTable('wallets').set({ balance: n }).where('user_id', '=', id).execute();
async function patchState(id: string, f: (s: any) => void) {
  const row = await db.selectFrom('farms').select('state').where('user_id', '=', id).executeTakeFirstOrThrow();
  const s = row.state as any; f(s);
  await db.updateTable('farms').set({ state: JSON.stringify(s) }).where('user_id', '=', id).execute();
}
const state = async (id: string) => (await db.selectFrom('farms').select('state').where('user_id', '=', id).executeTakeFirstOrThrow()).state as any;
/** 主人種一塊胡蘿蔔（還在長，可以幫忙澆水） */
async function growingCarrot(c: Client, idx = 0) {
  await c.call('GET', `/api/farm/${c.id}`);
  if ((await balance(c.id)) < 6) await setBalance(c.id, 100);
  expect((await act(c, { type: 'plant', idx, crop: 'carrot' })).status).toBe(200);
}

describe('farm flag', () => {
  it('flag off hides farm', async () => {
    const off = (await buildApp(db, bus, { logger: false, farmEnabled: false })).app;
    try {
      const a = await login('flagoff', off);
      expect((await a.call('GET', `/api/farm/${a.id}`)).status).toBe(404);
      expect((await a.call('GET', '/api/config')).json.farm).toBe(false);
    } finally { await off.close(); }
    const b = await login('flagon');
    expect((await b.call('GET', '/api/config')).json.farm).toBe(true);
  });
});

describe('farm owner', () => {
  it('owner creates farm on first read', async () => {
    const a = await login('alice');
    const r = await a.call('GET', `/api/farm/${a.id}`);
    expect(r.status).toBe(200);
    expect(r.json.is_owner).toBe(true);
    expect(r.json.state.level).toBe(1);
    expect(r.json.derived.barn.cap).toBe(50);
    expect(r.json.owner).toEqual({ id: a.id, display_name: 'alice' });
    expect(typeof r.json.server_time).toBe('number');
    expect(await db.selectFrom('farms').select('user_id').where('user_id', '=', a.id).execute()).toHaveLength(1);
  });
  it('plant spends coins via ledger', async () => {
    const a = await login('alice');
    const before = await balance(a.id);
    const r = await act(a, { type: 'plant', idx: 0, crop: 'carrot' });
    expect(r.status).toBe(200);
    expect(r.json.balance).toBe(before - 6);
    expect(r.json.state.fields[0].crop).toBe('carrot');
    const ledger = await db.selectFrom('coin_ledger').selectAll().where('user_id', '=', a.id).where('reason', '=', 'farm_seed').execute();
    expect(ledger.map((l: any) => l.delta)).toEqual([-6]);
    expect(await db.selectFrom('audit_log').select('action').where('action', '=', 'farm.act').where('result', '=', 'ok').execute()).toHaveLength(1);
    await setBalance(a.id, 1);
    const poor = await act(a, { type: 'plant', idx: 1, crop: 'carrot' });
    expect(poor.status).toBe(402); expect(poor.json.error).toBe('INSUFFICIENT_COINS');
    expect((await state(a.id)).fields[1].crop).toBeNull();
  });
  it('rule errors come back as their farm code', async () => {
    const a = await login('alice');
    const r = await act(a, { type: 'plant', idx: 11, crop: 'wheat' });
    expect(r.status).toBe(400); expect(r.json.error).toBe('NOT_UNLOCKED');
    expect((await act(a, { type: 'nope' })).json.error).toBe('BAD_REQUEST');
  });
  it('replayed request_id', async () => {
    const a = await login('alice');
    await act(a, { type: 'plant', idx: 0, crop: 'wheat' });
    await patchState(a.id, (s) => { s.fields[0].ready = Date.now() - 1000; });
    const id = rid();
    const first = await act(a, { type: 'harvest', idx: 0 }, id);
    const second = await act(a, { type: 'harvest', idx: 0 }, id);
    expect(first.status).toBe(200); expect(second.json.replayed).toBe(true);
    expect((await state(a.id)).inv.wheat).toBe(2);
  });
  it('concurrent harvest pays once', async () => {
    const a = await login('alice');
    await act(a, { type: 'plant', idx: 0, crop: 'wheat' });
    await patchState(a.id, (s) => { s.fields[0].ready = Date.now() - 1000; });
    const rs = await Promise.all([act(a, { type: 'harvest', idx: 0 }), act(a, { type: 'harvest', idx: 0 })]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(rs.find((r) => r.status === 400)!.json.error).toBe('NOT_READY');
    expect((await state(a.id)).inv.wheat).toBe(2);
  });
  it('deliver order credits farm_order and level reward', async () => {
    const a = await login('alice');
    await a.call('GET', `/api/farm/${a.id}`);
    let order: any;
    await patchState(a.id, (s) => { order = s.orders[0]; s.inv = {}; for (const it of order.items) s.inv[it.item] = it.qty; s.xp = 29; });
    const before = await balance(a.id);
    const r = await act(a, { type: 'deliver', slot: 0 });
    expect(r.status).toBe(200);
    const ledger = await db.selectFrom('coin_ledger').select(['reason', 'delta']).where('user_id', '=', a.id).where('reason', 'like', 'farm_%').execute();
    expect(ledger).toEqual(expect.arrayContaining([{ reason: 'farm_order', delta: order.coins }, { reason: 'farm_level', delta: 4 }]));
    expect(r.json.balance).toBe(before + order.coins + 4);
    expect(await balance(a.id)).toBe(before + order.coins + 4);
  });
  it('GET refills an order slot once its wait has passed', async () => {
    const a = await login('alice');
    await a.call('GET', `/api/farm/${a.id}`);
    await patchState(a.id, (s) => { s.orders[0] = null; s.orderWait[0] = Date.now() - 1000; });
    const r = await a.call('GET', `/api/farm/${a.id}`);
    expect(r.json.state.orders[0]).not.toBeNull();
    expect(r.json.derived.orders[0]).toHaveProperty('order');
  });
  it('visitor cannot act on others\' farm; visitors do not see the help log', async () => {
    const a = await login('alice'), b = await login('bob');
    await growingCarrot(a);
    expect((await help(b, a.id, { kind: 'water', idx: 0 })).status).toBe(200);
    expect((await act(b, { type: 'harvest', idx: 0 })).json.error).toBe('NOT_READY'); // 作用在 bob 自己的空田
    expect((await state(a.id)).fields[0].crop).toBe('carrot');
    const asB = await b.call('GET', `/api/farm/${a.id}`);
    expect(asB.json.is_owner).toBe(false); expect(asB.json.state.helpLog).toEqual([]);
    expect((await a.call('GET', `/api/farm/${a.id}`)).json.state.helpLog).toHaveLength(1);
    expect((await b.call('GET', `/api/farm/${randomUUID()}`)).status).toBe(404);
  });
  it('closed hours', async () => {
    const a = await login('alice');
    setClock(makeClock(parseOpenHours('sun-sun 00:00-00:01 Asia/Taipei')));
    try { expect((await act(a, { type: 'plant', idx: 0, crop: 'wheat' })).json.error).toBe('GAME_CLOSED'); }
    finally { setClock(ALWAYS_OPEN); }
  });
});

describe('farm help', () => {
  it('help permissions', async () => {
    const a = await login('alice'), b = await login('bob'), c = await login('carol');
    await growingCarrot(a, 0); await growingCarrot(a, 1);
    const ok = await help(b, a.id, { kind: 'water', idx: 0 });
    expect(ok.status).toBe(200); expect(ok.json.friend_pts).toBe(1); expect(ok.json.today).toEqual({ mine: 1, this_farm: 1 });
    const s = await state(a.id);
    expect(s.fields[0].wateredBy).toBe(b.id);
    expect(s.helpLog).toEqual([expect.objectContaining({ by: b.id, name: 'bob', kind: 'water' })]);
    expect((await state(b.id)).friendPts).toBe(1);
    expect((await help(a, a.id, { kind: 'water', idx: 1 })).json.error).toBe('HELP_SELF');
    expect((await a.call('POST', `/api/homes/${a.home}/blacklist`, { share_code: (await c.call('GET', '/api/me')).json.user.share_code, request_id: rid() })).status).toBe(200);
    expect((await help(c, a.id, { kind: 'water', idx: 1 })).json.error).toBe('FORBIDDEN');
    expect((await a.call('PATCH', `/api/homes/${a.home}`, { access_mode: 'closed', request_id: rid() })).status).toBe(200);
    expect((await help(b, a.id, { kind: 'water', idx: 1 })).json.error).toBe('FORBIDDEN');
  });
  it('help daily caps', async () => {
    const helper = await login('helper');
    const owners = [await login('o1'), await login('o2'), await login('o3')];
    for (const o of owners) for (let i = 0; i < 6; i++) await growingCarrot(o, i);
    for (let i = 0; i < 5; i++) expect((await help(helper, owners[0].id, { kind: 'water', idx: i })).status).toBe(200);
    expect((await help(helper, owners[0].id, { kind: 'water', idx: 5 })).json.error).toBe('HELP_FARM_CAP');
    for (let i = 0; i < 5; i++) expect((await help(helper, owners[1].id, { kind: 'water', idx: i })).status).toBe(200);
    expect((await help(helper, owners[2].id, { kind: 'water', idx: 0 })).json.error).toBe('HELP_DAILY_CAP');
    await sql`UPDATE farm_help SET day = day - 1`.execute(db);
    expect((await help(helper, owners[0].id, { kind: 'water', idx: 5 })).status).toBe(200);
  });
  it('friends list shows farms that need help', async () => {
    const a = await login('alice'), b = await login('bob');
    await growingCarrot(a);
    expect((await b.call('GET', `/api/homes/${a.home}`)).status).toBe(200); // 記錄最近拜訪
    const r = await b.call('GET', '/api/farm/friends');
    expect(r.json.farms).toEqual([{ user_id: a.id, display_name: 'alice', level: 1, needs_help: true }]);
  });
  it('farm.updated broadcast', async () => {
    const a = await login('alice'), b = await login('bob');
    await growingCarrot(a);
    const msgs: any[] = [];
    const ws = await app.injectWS('/ws', { headers: { cookie: a.cookie }, socket: { remoteAddress: '127.0.0.1' } } as any, { onInit: (s) => s.on('message', (d) => msgs.push(JSON.parse(String(d)))) });
    try {
      const wait = async (pred: (m: any) => boolean) => {
        for (let i = 0; i < 100; i++) { if (msgs.some(pred)) return; await new Promise((r) => setTimeout(r, 20)); }
        throw new Error('timeout: ' + JSON.stringify(msgs.map((m) => m.type)));
      };
      await wait((m) => m.type === 'hello');
      expect((await help(b, a.id, { kind: 'water', idx: 0 })).status).toBe(200);
      await wait((m) => m.type === 'farm.updated' && m.user === a.id);
    } finally { ws.terminate(); }
  });
});

// ---------- 第二階段 ----------
async function alivePet(c: Client, patch: Record<string, unknown> = {}) {
  const r = await c.call('POST', '/api/pets', { species: 'chicken', name: 'P', request_id: rid() });
  expect(r.status).toBe(200);
  const id = r.json.pet.id;
  await db.updateTable('pets').set({ status: 'alive', born_at: sql`now() - interval '2 minutes'`, hatched_at: sql`now()`, last_simulated_at: sql`now()`, hunger: 30, health: 80, ...patch } as any).where('id', '=', id).execute();
  return id as string;
}
const ledger = async (id: string) => (await db.selectFrom('coin_ledger').select(['reason', 'delta']).where('user_id', '=', id).orderBy('created_at').execute()).map((r: any) => `${r.reason}:${r.delta}`);
async function seller(name = 'sel') {
  const s = await login(name);
  await s.call('GET', `/api/farm/${s.id}`);
  await patchState(s.id, (x) => { x.level = 5; x.inv = { jam: 6, wheat: 2 }; });
  expect((await act(s, { type: 'stallList', slot: 0, item: 'jam', qty: 2, price: 50 })).status).toBe(200);
  return s;
}
const buy = (c: Client, owner: string, slot: number, request_id = rid()) => c.call('POST', `/api/farm/${owner}/buy`, { slot, request_id });

describe('farm phase 2', () => {
  it('owner GET saves the balloon schedule, so viewing does not restart its timer', async () => {
    const a = await login('bal'); await a.call('GET', `/api/farm/${a.id}`);
    await patchState(a.id, (x) => { x.level = 7; });
    const g1 = await a.call('GET', `/api/farm/${a.id}`);
    const saved = (await state(a.id)).balloon;
    expect(saved.crates).toHaveLength(4); expect(saved.leave).toBe(g1.json.state.balloon.leave);
    await new Promise((r) => setTimeout(r, 15));
    expect((await a.call('GET', `/api/farm/${a.id}`)).json.state.balloon.leave).toBe(saved.leave);
  });
  it('expand charges farm_expand', async () => {
    const a = await login('exp'); await a.call('GET', `/api/farm/${a.id}`);
    await patchState(a.id, (x) => { x.level = 7; }); await setBalance(a.id, 500);
    const r = await act(a, { type: 'expand' });
    expect(r.status).toBe(200); expect(r.json.balance).toBe(380); expect(r.json.state.expand).toBe(1);
    expect(await ledger(a.id)).toContain('farm_expand:-120');
  });
  it('stall: list, visitor buys, coins move, both ledgers, seller sees the sale', async () => {
    const s = await seller(); const b = await login('buyer'); await setBalance(b.id, 200);
    const before = await balance(s.id);
    await s.call('PATCH', `/api/homes/${s.home}`, { access_mode: 'closed', request_id: rid() });
    expect((await buy(b, s.id, 0)).json.error).toBe('FORBIDDEN'); // 進不了家
    await s.call('PATCH', `/api/homes/${s.home}`, { access_mode: 'open', request_id: rid() });
    const r = await buy(b, s.id, 0);
    expect(r.status).toBe(200); expect(r.json).toMatchObject({ ok: true, item: 'jam', qty: 2, price: 50, balance: 150 });
    expect(await balance(s.id)).toBe(before + 50);
    expect(await ledger(b.id)).toContain('farm_stall_buy:-50'); expect(await ledger(s.id)).toContain('farm_stall_sale:50');
    expect((await state(b.id)).inv).toEqual({ jam: 2 });
    const own = await s.call('GET', `/api/farm/${s.id}`);
    expect(own.json.state.saleLog).toMatchObject([{ name: 'buyer', item: 'jam', qty: 2, price: 50 }]);
    const vis = await b.call('GET', `/api/farm/${s.id}`);
    expect(vis.json.state.saleLog).toEqual([]); expect(vis.json.state.decoBag).toEqual([]);
    expect((await buy(b, s.id, 0)).json.error).toBe('NO_LISTING');
    expect((await buy(s, s.id, 0)).json.error).toBe('BUY_SELF');
  });
  it('stall buy: two buyers at once, exactly one wins', async () => {
    const s = await seller('sel2');
    const [b1, b2] = [await login('b1'), await login('b2')];
    await setBalance(b1.id, 200); await setBalance(b2.id, 200);
    const rs = await Promise.all([buy(b1, s.id, 0), buy(b2, s.id, 0)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(rs.find((r) => r.status === 400)!.json.error).toBe('NO_LISTING');
    expect(await ledger(s.id)).toEqual(expect.arrayContaining(['farm_stall_sale:50']));
    expect((await ledger(s.id)).filter((x) => x.startsWith('farm_stall_sale'))).toHaveLength(1);
  });
  it('stall buy: daily cap and insufficient coins', async () => {
    const s = await seller('sel3');
    const b = await login('b3'); await b.call('GET', `/api/farm/${b.id}`); await setBalance(b.id, 10);
    expect((await buy(b, s.id, 0)).json.error).toBe('INSUFFICIENT_COINS');
    expect((await state(s.id)).stall[0]).toMatchObject({ item: 'jam' });
    for (let i = 0; i < 10; i++) await db.insertInto('farm_stall_buys' as any).values({ buyer_id: b.id, seller_id: s.id, day: sql`(now() AT TIME ZONE 'Asia/Taipei')::date`, item: 'wheat', qty: 1, price: 1 } as any).execute();
    await setBalance(b.id, 500);
    expect((await buy(b, s.id, 0)).json.error).toBe('BUY_DAILY_CAP');
  });
  it('feed-pet uses a barn item and updates the pet; a sleeping pet is rejected and the item stays', async () => {
    const a = await login('feeder'); await a.call('GET', `/api/farm/${a.id}`);
    expect((await a.call('POST', '/api/farm/feed-pet', { item: 'bread', request_id: rid() })).json.error).toBe('NO_PET');
    const pet = await alivePet(a);
    await patchState(a.id, (x) => { x.inv = { bread: 2, wheat: 1 }; });
    expect((await a.call('POST', '/api/farm/feed-pet', { item: 'wheat', request_id: rid() })).json.error).toBe('NOT_EDIBLE');
    const r = await a.call('POST', '/api/farm/feed-pet', { item: 'bread', request_id: rid() });
    expect(r.status).toBe(200); expect(r.json.pet.hunger).toBeGreaterThanOrEqual(59);
    expect((await state(a.id)).inv).toEqual({ bread: 1, wheat: 1 });
    const ev = await db.selectFrom('pet_events').select(['type', 'payload']).where('pet_id', '=', pet).where('type', '=', 'feed').execute();
    expect(ev.map((e: any) => e.payload.food)).toEqual(['farm:bread']);
    await db.updateTable('pets').set({ sleeping: true } as any).where('id', '=', pet).execute();
    expect((await a.call('POST', '/api/farm/feed-pet', { item: 'bread', request_id: rid() })).json.error).toBe('PET_SLEEPING');
    expect((await state(a.id)).inv).toEqual({ bread: 1, wheat: 1 });
  });
  it('chickWater uses the pet stamina from the DB', async () => {
    const a = await login('chicky'); await growingCarrot(a, 0); await growingCarrot(a, 1); await growingCarrot(a, 2);
    expect((await act(a, { type: 'chickWater', idx: 0 })).json.error).toBe('NO_PET');
    await alivePet(a, { stamina: 35 });
    const g = await a.call('GET', `/api/farm/${a.id}`);
    expect(g.json.derived.chickWater).toEqual({ left: 2, limit: 2 });
    expect((await act(a, { type: 'chickWater', idx: 0 })).status).toBe(200);
    const r = await act(a, { type: 'chickWater', idx: 1 });
    expect(r.status).toBe(200); expect(r.json.derived.chickWater).toEqual({ left: 0, limit: 2 });
    expect((await act(a, { type: 'chickWater', idx: 2 })).json.error).toBe('CHICK_TIRED');
  });
});
