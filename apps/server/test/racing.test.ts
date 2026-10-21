import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDb } from '../src/db';
import { migrateToLatest } from '../src/migrations';
import { buildApp } from '../src/app';
import { Bus } from '../src/bus';
import { fastForwardRace, inRace, startRaceLoop } from '../src/racing';
import { setRaceInput, PARTS, TRACKS } from '@chick/engine';

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

describe('racing (server)', () => {
  it('profile starts with race cash; buy parts tier by tier; cannot overspend; coins untouched', async () => {
    const a = await login('racer1');
    const p = await a.call('GET', '/race/profile');
    expect(p.status).toBe(200); expect(p.json.profile.cash).toBe(3000); expect(p.json.catalog.tracks.length).toBe(TRACKS.length);
    expect((await a.call('POST', '/race/buy', { kind: 'engine', tier: 2 })).json.error).toBe('TIER_LOCKED');
    expect((await a.call('POST', '/race/buy', { kind: 'engine', tier: 1 })).json.error).toBe('INSUFFICIENT_RACE_CASH');
    await db.updateTable('race_profiles').set({ cash: 100000 }).where('user_id', '=', a.id).execute();
    const b = await a.call('POST', '/race/buy', { kind: 'nitro', tier: 1 });
    expect(b.status).toBe(200); expect(b.json.parts.nitro).toBe(1); expect(b.json.cash).toBe(100000 - PARTS.nitro.tiers[1].price);
    const c = await a.call('POST', '/race/buy', { car: 'arrow' }); expect(c.json.car).toBe('arrow'); expect(c.json.cars).toContain('arrow');
  });
  it('full race over ws: lobby → AI fill → in-match → settle prize, damage, unlock, results; then repair', async () => {
    const a = await login('racer2');
    const w = await openWs(a.cookie);
    w.ws.send(JSON.stringify({ type: 'race.join', track: 'jpn' }));
    expect((await w.wait((m) => m.type === 'error')).code).toBe('TRACK_LOCKED');
    w.ws.send(JSON.stringify({ type: 'race.join', track: 'tpe' }));
    await w.wait((m) => m.type === 'race.lobby');
    const st = await w.wait((m) => m.type === 'race.started');
    expect(st.cars.length).toBe(6); expect(st.cars.filter((c: any) => c.ai).length).toBe(5);
    expect(inRace(a.id)).toBe(true);
    w.ws.send(JSON.stringify({ type: 'race.join', track: 'tpe' }));
    expect((await w.wait((m) => m.type === 'error' && m.for === 'race.join' && m.code === 'ALREADY_IN_MATCH')).code).toBe('ALREADY_IN_MATCH');
    await w.wait((m) => m.type === 'race.snap');
    // 玩家：全油門，故意擦撞路邊一下，用掉氮氣
    await fastForwardRace(st.race_id, (s) => setRaceInput(s, a.id, { gas: true, right: s.tick > 100 && s.tick < 130, left: s.tick >= 130 && s.tick < 150, nitro: s.tick % 200 === 199 }));
    const end = await w.wait((m) => m.type === 'race.ended');
    expect(end.ranking.length).toBe(6); expect(end.me.rank).toBeGreaterThan(0);
    const prof = (await a.call('GET', '/race/profile')).json.profile;
    expect(prof.races).toBe(1); expect(prof.cash).toBe(3000 + end.me.prize); expect(prof.damage).toBeGreaterThan(0);
    if (end.me.rank <= 3) expect(prof.unlocked).toBe(2);
    expect(inRace(a.id)).toBe(false);
    const lb = await a.call('GET', '/race/leaderboard/tpe'); expect(lb.json.best[0].name).toBeTruthy();
    const r = await a.call('POST', '/race/repair'); expect(r.status).toBe(200); expect(r.json.damage).toBeLessThan(prof.damage);
    const coins = await db.selectFrom('coin_ledger').selectAll().execute(); expect(coins.filter((x: any) => /race/.test(x.reason)).length).toBe(0);
    w.ws.terminate();
  }, 30000);
});
