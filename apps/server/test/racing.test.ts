import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDb } from '../src/db';
import { migrateToLatest } from '../src/migrations';
import { buildApp } from '../src/app';
import { Bus } from '../src/bus';
import { fastForwardRace, inRace, startRaceLoop } from '../src/racing';
import { partPrice, prizeFor, RACE_SLOTS, seasonOf, setRaceInput, TRACKS } from '@chick/engine';
import { CLOSING_GUARD_MS } from '../src/racing';

process.env.RACE_LOBBY_MS = '300';
const { db } = createDb();
const bus = new Bus();
let app: Awaited<ReturnType<typeof buildApp>>['app'];
beforeAll(async () => { await migrateToLatest(db as any); await bus.start(); ({ app } = await buildApp(db, bus, { logger: false })); loop = startRaceLoop(db); });
let loop: NodeJS.Timeout;
afterAll(async () => { clearInterval(loop); await app.close(); await bus.stop(); await db.destroy(); });
beforeEach(async () => {
  const t = await sql<{ tablename: string }>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'kysely_%' AND tablename <> 'audit_log'`.execute(db);
  await sql.raw(`ALTER TABLE audit_log DISABLE TRIGGER USER; TRUNCATE ${t.rows.map((r) => `"${r.tablename}"`).join(',')}, audit_log CASCADE; ALTER TABLE audit_log ENABLE TRIGGER USER;`).execute(db);
});
let ip = 0;
async function login(name: string) {
  const remoteAddress = `10.8.0.${++ip}`;
  const r = await app.inject({ method: 'POST', url: '/api/auth/dev', payload: { name }, remoteAddress });
  const cookie = String(r.headers['set-cookie']).split(';')[0];
  const id = r.json().user?.id ?? (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json().user.id;
  const call = async (method: string, url: string, body?: any) => { const x = await app.inject({ method: method as any, url: '/api' + url, headers: { cookie }, payload: body, remoteAddress }); return { status: x.statusCode, json: x.json() }; };
  return { cookie, id, call };
}
async function openWs(cookie: string) {
  const msgs: any[] = [];
  const ws = await app.injectWS('/ws', { headers: { cookie }, socket: { remoteAddress: '127.0.0.1' } } as any, { onInit: (s) => s.on('message', (d) => msgs.push(JSON.parse(String(d)))) });
  const wait = async (pred: (m: any) => boolean) => { for (let i = 0; i < 150; i++) { const m = [...msgs].reverse().find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timeout ' + JSON.stringify(msgs.map((m) => m.type))); };
  await wait((m) => m.type === 'hello');
  return { ws, msgs, wait };
}


const drive = (id: string) => (s: any) => { const c = s.cars.find((x: any) => x.id === id); setRaceInput(s, id, { gas: true, left: c.x > 0.2, right: c.x < -0.2, nitro: s.tick % 200 === 50 }); };
describe('racing (server) v5', () => {
  it('profile/cash, tier-by-tier parts, car + paint', async () => {
    const a = await login('racer1');
    const p = await a.call('GET', '/race/profile');
    expect(p.status).toBe(200); expect(p.json.profile.cash).toBe(15000); expect(p.json.profile.season).toBe(seasonOf(Date.now()));
    expect(p.json.catalog.tracks.length).toBe(TRACKS.length); expect(p.json.catalog.slots).toBe(20);
    expect((await a.call('POST', '/race/buy', { kind: 'engine', tier: 2 })).json.error).toBe('TIER_LOCKED');
    expect((await a.call('POST', '/race/buy', { kind: 'engine', tier: 1 })).json.error).toBe('INSUFFICIENT_RACE_CASH');
    const b = await a.call('POST', '/race/buy', { kind: 'nitro', tier: 1 });
    expect(b.json.parts.nitro).toBe(1); expect(b.json.cash).toBe(15000 - partPrice('nitro', 1)!);
    await db.updateTable('race_profiles').set({ cash: 100000 }).where('user_id', '=', a.id).execute();
    const c = await a.call('POST', '/race/buy', { car: 'arrow', paint: 3 }); expect(c.json.car).toBe('arrow'); expect(c.json.paint).toBe(3);
    expect((await a.call('POST', '/race/repair')).status).toBe(404);
  });
  it('exchange coins <-> cash with daily 50 cap each way', async () => {
    const a = await login('racer3');
    await sql`UPDATE wallets SET balance = 1000 WHERE user_id = ${a.id}`.execute(db);
    const bal0 = Number((await sql<any>`SELECT balance FROM wallets WHERE user_id=${a.id}`.execute(db)).rows[0].balance);
    const r = await a.call('POST', '/race/exchange', { dir: 'in', coins: 30 });
    expect(r.status).toBe(200); expect(r.json.profile.cash).toBe(15000 + 30 * 500); expect(r.json.balance).toBe(bal0 - 30);
    expect((await a.call('POST', '/race/exchange', { dir: 'in', coins: 21 })).json.error).toBe('EXCHANGE_CAP');
    expect((await a.call('POST', '/race/exchange', { dir: 'in', coins: 20 })).status).toBe(200);
    const o = await a.call('POST', '/race/exchange', { dir: 'out', coins: 10 });
    expect(o.json.profile.cash).toBe(15000 + 50 * 500 - 10000); expect(o.json.balance).toBe(bal0 - 50 + 10);
    expect((await a.call('POST', '/race/exchange', { dir: 'out', coins: 0 })).status).toBe(400);
  });
  it('season rollover archives and resets points/unlocks, keeps cash+parts', async () => {
    const a = await login('racer4'); await a.call('GET', '/race/profile');
    await db.updateTable('race_profiles').set({ season: '2000-01', points: 99, unlocked: 3, cash: 77777, parts: JSON.stringify({ engine: 2 }) } as any).where('user_id', '=', a.id).execute();
    const p = (await a.call('GET', '/race/profile')).json.profile;
    expect(p.points).toBe(0); expect(p.unlocked).toBe(1); expect(p.cash).toBe(77777); expect(p.parts.engine).toBe(2);
    const arch = await (db as any).selectFrom('race_seasons').selectAll().where('user_id', '=', a.id).execute();
    expect(arch[0].season).toBe('2000-01'); expect(arch[0].points).toBe(99);
  });
  it('public race: 20 cars, humans start last, settles flat prize + points + cup', async () => {
    const a = await login('racer2');
    const w = await openWs(a.cookie);
    w.ws.send(JSON.stringify({ type: 'race.join', track: 'jp1' }));
    expect((await w.wait((m) => m.type === 'error')).code).toBe('TRACK_LOCKED');
    w.ws.send(JSON.stringify({ type: 'race.join', track: 'tw1' }));
    await w.wait((m) => m.type === 'race.lobby');
    const st = await w.wait((m) => m.type === 'race.started');
    expect(st.cars.length).toBe(RACE_SLOTS); expect(st.cars.filter((c: any) => c.ai).length).toBe(19);
    expect(st.cars[st.cars.length - 1].id).toBe(a.id);
    expect(inRace(a.id)).toBe(true);
    await fastForwardRace(st.race_id, drive(a.id));
    const end = await w.wait((m) => m.type === 'race.ended');
    expect(end.ranking.length).toBe(20); expect(end.me.prize).toBe(prizeFor(end.me.rank)); expect(end.me.qualified).toBe(end.me.rank <= 10);
    expect(end.me.condition).toBeGreaterThan(0);
    const prof = (await a.call('GET', '/race/profile')).json.profile;
    expect(prof.races).toBe(1); expect(prof.cash).toBe(15000 + end.me.prize);
    const lb = (await a.call('GET', '/race/leaderboard/tw1')).json; expect(lb.best.length).toBe(end.me.time_ms === null ? 0 : 1); expect(lb.championship.length).toBe(1);
    expect(inRace(a.id)).toBe(false); w.ws.close();
  });
  it('private room: create code, friend joins + invite, host starts', async () => {
    const a = await login('host'), b = await login('friend');
    const wa = await openWs(a.cookie), wb = await openWs(b.cookie);
    wa.ws.send(JSON.stringify({ type: 'race.create', track: 'tw1' }));
    const { code } = await wa.wait((m) => m.type === 'race.room'); expect(code).toMatch(/^[A-Z0-9]{6}$/);
    const sc = (await (db as any).selectFrom('users').select('share_code').where('id', '=', b.id).executeTakeFirst()).share_code;
    wa.ws.send(JSON.stringify({ type: 'race.invite', share_code: sc }));
    const inv = await wb.wait((m) => m.type === 'race.invited'); expect(inv.code).toBe(code);
    wb.ws.send(JSON.stringify({ type: 'race.join', code }));
    await wa.wait((m) => m.type === 'race.lobby' && m.players.length === 2);
    wb.ws.send(JSON.stringify({ type: 'race.start' })); expect((await wb.wait((m) => m.type === 'error')).code).toBe('FORBIDDEN');
    wa.ws.send(JSON.stringify({ type: 'race.start' }));
    const st = await wa.wait((m) => m.type === 'race.started'); expect(st.cars.filter((c: any) => !c.ai).length).toBe(2);
    await fastForwardRace(st.race_id, (s) => { drive(a.id)(s); drive(b.id)(s); });
    await wb.wait((m) => m.type === 'race.ended');
    wa.ws.close(); wb.ws.close();
  });
  it('closing guard constant is 8 minutes', () => { expect(CLOSING_GUARD_MS).toBe(480000); });
});
