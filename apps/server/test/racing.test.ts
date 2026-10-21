import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDb } from '../src/db';
import { migrateToLatest } from '../src/migrations';
import { buildApp } from '../src/app';
import { Bus } from '../src/bus';
import { fastForwardRace, inRace, startRaceLoop } from '../src/racing';
import { partPrice, prizeFor, RACE_SLOTS, seasonOf, setRaceInput, TRACKS } from '@chick/engine';
import { CLOSING_GUARD_MS } from '../src/racing';

const { db } = createDb();
const bus = new Bus();
let app: Awaited<ReturnType<typeof buildApp>>['app'];
beforeAll(async () => { await migrateToLatest(db as any); await bus.start(); ({ app } = await buildApp(db, bus, { logger: false })); loop = startRaceLoop(); });
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
  const bal = async (id: string) => Number((await sql<any>`SELECT balance FROM wallets WHERE user_id=${id}`.execute(db)).rows[0].balance);
  it('TG2 shop in pet coins: buy any tier directly, switching discards (full price, no refund), stock is free; car + paint free', async () => {
    const a = await login('racer1');
    const p = await a.call('GET', '/race/profile');
    expect(p.status).toBe(200); expect(p.json.profile.cash).toBeUndefined(); expect(p.json.profile.season).toBe(seasonOf(Date.now()));
    expect(p.json.catalog.tracks.length).toBe(TRACKS.length); expect(p.json.catalog.slots).toBe(20); expect(p.json.catalog.max_out_cost).toBe(9080);
    const b0 = await bal(a.id);
    expect((await a.call('POST', '/race/buy', { kind: 'engine', tier: 3 })).json.error).toBe('INSUFFICIENT_COINS');
    await sql`UPDATE wallets SET balance = 5000 WHERE user_id = ${a.id}`.execute(db);
    const e3 = await a.call('POST', '/race/buy', { kind: 'engine', tier: 3 }); // 直接買 3 階
    expect(e3.status).toBe(200); expect(e3.json.parts.engine).toBe(3); expect(e3.json.balance).toBe(5000 - 3200);
    expect((await a.call('POST', '/race/buy', { kind: 'engine', tier: 3 })).json.error).toBe('ALREADY_OWNED');
    const e1 = await a.call('POST', '/race/buy', { kind: 'engine', tier: 1 }); // 降級：全額、不退錢
    expect(e1.json.parts.engine).toBe(1); expect(e1.json.balance).toBe(5000 - 3200 - partPrice('engine', 1)!);
    const e0 = await a.call('POST', '/race/buy', { kind: 'engine', tier: 0 }); // 原廠標準免費
    expect(e0.json.parts.engine).toBe(0); expect(e0.json.balance).toBe(e1.json.balance);
    const led = await sql<any>`SELECT reason, delta FROM coin_ledger WHERE user_id=${a.id} AND reason='race_part' ORDER BY created_at`.execute(db);
    expect(led.rows.map((r: any) => Number(r.delta))).toEqual([-3200, -1200]);
    const c = await a.call('POST', '/race/buy', { car: 'f1', paint: 7 }); expect(c.json.car).toBe('f1'); expect(c.json.paint).toBe(7);
    expect((await a.call('POST', '/race/buy', { paint: 8 })).status).toBe(400);
    expect((await a.call('POST', '/race/exchange', { dir: 'in', coins: 1 })).status).toBe(404);
    expect(b0).toBeGreaterThanOrEqual(0);
  });
  it('season rollover archives and resets points/unlocks, keeps cash+parts', async () => {
    const a = await login('racer4'); await a.call('GET', '/race/profile');
    await db.updateTable('race_profiles').set({ season: '2000-01', points: 99, unlocked: 3, parts: JSON.stringify({ engine: 2 }) } as any).where('user_id', '=', a.id).execute();
    const p = (await a.call('GET', '/race/profile')).json.profile;
    expect(p.points).toBe(0); expect(p.unlocked).toBe(1); expect(p.parts.engine).toBe(2);
    const arch = await (db as any).selectFrom('race_seasons').selectAll().where('user_id', '=', a.id).execute();
    expect(arch[0].season).toBe('2000-01'); expect(arch[0].points).toBe(99);
  });
  it('solo race (no home needed): 20 cars, 19 grey AI, human starts last; settles flat prize + points + cup', async () => {
    const a = await login('racer2');
    const w = await openWs(a.cookie);
    w.ws.send(JSON.stringify({ type: 'race.solo', track: 'jp1' }));
    expect((await w.wait((m) => m.type === 'error')).code).toBe('TRACK_LOCKED');
    w.ws.send(JSON.stringify({ type: 'race.solo' })); // 預設＝目前錦標賽站
    const st = await w.wait((m) => m.type === 'race.started');
    expect(st.track).toBe('tw1'); expect(st.cars.length).toBe(RACE_SLOTS); expect(st.cars.filter((c: any) => c.ai).length).toBe(19);
    expect(st.cars.every((c: any) => !c.ai || c.car === 'ai')).toBe(true);
    expect(st.cars[st.cars.length - 1].id).toBe(a.id);
    expect(inRace(a.id)).toBe(true);
    w.ws.send(JSON.stringify({ type: 'race.solo' })); expect((await w.wait((m) => m.type === 'error' && m.code === 'ALREADY_IN_MATCH')).for).toBe('race.solo');
    await fastForwardRace(st.race_id, drive(a.id));
    const end = await w.wait((m) => m.type === 'race.ended');
    expect(end.ranking.length).toBe(20); expect(end.me.prize).toBe(prizeFor(end.me.rank)); expect(end.me.qualified).toBe(end.me.rank <= 10);
    expect(end.me.condition).toBeGreaterThan(0);
    const b0 = await bal(a.id);
    const prof = (await a.call('GET', '/race/profile')).json.profile;
    expect(prof.races).toBe(1); expect(end.me.prize).toBeLessThanOrEqual(60);
    const pz = await sql<any>`SELECT COALESCE(SUM(delta),0)::int AS n FROM coin_ledger WHERE user_id=${a.id} AND reason='race_prize'`.execute(db); expect(pz.rows[0].n).toBe(end.me.prize); expect(b0).toBeGreaterThanOrEqual(end.me.prize);
    const lb = (await a.call('GET', '/race/leaderboard/tw1')).json; expect(lb.best.length).toBe(end.me.time_ms === null ? 0 : 1); expect(lb.championship.length).toBe(1);
    expect(inRace(a.id)).toBe(false); w.ws.close();
  });
  it('home invite (same flow as multi stairs): accept / decline; accepted race together, AI fill to 20; alone = solo', async () => {
    const a = await login('host'), b = await login('friend'), c = await login('shy');
    const home = (await a.call('GET', '/me')).json.home.id;
    const wa = await openWs(a.cookie), wb = await openWs(b.cookie), wc = await openWs(c.cookie);
    wa.ws.send(JSON.stringify({ type: 'race.invite' })); expect((await wa.wait((m) => m.type === 'error')).code).toBe('NOT_IN_HOME');
    for (const w of [wa, wb, wc]) w.ws.send(JSON.stringify({ type: 'home.join', home_id: home }));
    await wc.wait((m) => m.type === 'home.presence' && m.users.length === 3);
    wa.ws.send(JSON.stringify({ type: 'race.invite' }));
    const inv = await wb.wait((m) => m.type === 'race.event' && m.kind === 'invite');
    expect(inv.from).toBe(a.id); expect(inv.to.sort()).toEqual([b.id, c.id].sort()); expect(inv.track).toBe('tw1');
    await wc.wait((m) => m.type === 'race.event' && m.kind === 'invite');
    // 邀請中：同一個家不能再開下樓梯
    wb.ws.send(JSON.stringify({ type: 'stairs.invite' })); const sn = await wb.wait((m) => m.type === 'stairs.notice' || (m.type === 'error' && m.for === 'stairs.invite')); expect(sn.code).toBe('FIGHT_BUSY');
    wb.ws.send(JSON.stringify({ type: 'race.reply', invite: inv.invite, accept: true }));
    wc.ws.send(JSON.stringify({ type: 'race.reply', invite: inv.invite, accept: false }));
    const st = await wa.wait((m) => m.type === 'race.started'); await wb.wait((m) => m.type === 'race.started');
    const humans = st.cars.filter((x: any) => !x.ai).map((x: any) => x.id).sort();
    expect(humans).toEqual([a.id, b.id].sort()); expect(st.cars.length).toBe(20);
    const ev = await wc.wait((m) => m.type === 'race.event' && m.kind === 'start'); expect(ev.users.sort()).toEqual(humans);
    expect(wc.msgs.some((m) => m.type === 'race.started')).toBe(false);
    await fastForwardRace(st.race_id, (s) => { drive(a.id)(s); drive(b.id)(s); });
    const ea = await wa.wait((m) => m.type === 'race.ended'), eb = await wb.wait((m) => m.type === 'race.ended');
    expect(ea.me.user_id).toBe(a.id); expect(eb.me.user_id).toBe(b.id);
    // 家裡只剩自己 → 邀請直接變單人
    wa.msgs.length = 0; wb.ws.terminate(); wc.ws.terminate();
    await wa.wait((m) => m.type === 'home.presence' && m.users.length === 1); wa.ws.send(JSON.stringify({ type: 'race.invite' }));
    const solo = await wa.wait((m) => m.type === 'race.started'); expect(solo.cars.filter((x: any) => !x.ai).length).toBe(1);
    await fastForwardRace(solo.race_id); await wa.wait((m) => m.type === 'race.ended');
    wa.ws.close();
  });
  it('closing guard constant is 8 minutes', () => { expect(CLOSING_GUARD_MS).toBe(480000); });
});
