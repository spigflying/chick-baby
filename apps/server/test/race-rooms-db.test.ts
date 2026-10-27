import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { createDb } from '../src/db';
import { migrateToLatest } from '../src/migrations';
import { createRoom, initRacing, onRaceBus, raceFriends, stepRaces, _raceRooms, inRace, fastForwardRace } from '../src/racing';
import { initMStairs, mmatches, finish as finishStairs } from '../src/mstairs';
import { leaveStairs } from '@chick/engine';
import { ROOM_COUNTDOWN_MS } from '../src/race-rooms';

const { db } = createDb();
const sent: any[] = [], pub: any[] = [];
beforeAll(async () => {
  await migrateToLatest(db as any);
  initMStairs({ db, bus: { publish: async (m: any) => { pub.push(m); } } as any, presence: { users: () => [], instances: () => ['i1'] } as any, instance: () => 'i1' });
  initRacing({ db, bus: { publish: async (m: any) => { pub.push(m); } } as any, presence: { users: () => [], instances: () => ['i1'] } as any, instance: () => 'i1', local: (m) => sent.push(m) });
});
afterAll(async () => { await db.destroy(); });
async function user(name: string, pet?: string) {
  const id = randomUUID();
  await sql`INSERT INTO users (id, google_sub, display_name, share_code) VALUES (${id}, ${'g-' + id}, ${name}, ${id.slice(0, 12)})`.execute(db);
  await sql`INSERT INTO wallets (user_id, balance) VALUES (${id}, 0) ON CONFLICT DO NOTHING`.execute(db);
  await sql`INSERT INTO homes (owner_id, name) VALUES (${id}, ${name + '家'})`.execute(db);
  if (pet) await sql`INSERT INTO pets (owner_id, species_id, name, status, born_at, last_simulated_at, hunger, happiness, energy, cleanliness, health, strength, speed, stamina, weight, personality, counters)
    VALUES (${id}, 'chicken', ${pet}, 'alive', now(), now(), 80,80,80,80,80,10,10,10,30, 'calm', '{}'::jsonb)`.execute(db);
  return id;
}
const visit = (u: string, owner: string) => sql`INSERT INTO home_visits (user_id, home_id) SELECT ${u}, id FROM homes WHERE owner_id = ${owner}`.execute(db);
const last = (t: string) => [...sent].reverse().find((m) => m.t === t);

describe('race rooms over the race authority (real schema)', () => {
  it('create → friend invite → join → ready → countdown → race starts with chosen laps (friendly)', async () => {
    const a = await user('阿明', '小雞'), b = await user('小華', '鴨鴨'), stranger = await user('路人');
    await visit(b, a);
    expect(await raceFriends(db, a)).toEqual([b]);
    const id = await createRoom(a, 'tw1', 1);
    expect(last('rrace.room').room).toMatchObject({ id, inst: 'i1', host: a, track: 'tw1', laps: 1 });
    expect(last('rrace.room').room.members[0].name).toBe('小雞（阿明）');
    const inv = last('rrace.roominvite'); expect(inv.to).toEqual([b]); expect(inv.to).not.toContain(stranger); expect(inv.from_name).toBe('小雞（阿明）');
    onRaceBus({ t: 'rrace.rjoin', inst: 'i1', room: id, user: b }); await new Promise((r) => setTimeout(r, 100));
    expect(last('rrace.room').users).toEqual([a, b]);
    onRaceBus({ t: 'rrace.rconf', inst: 'i1', room: id, user: b, laps: 4 }); expect(last('rrace.notice')).toMatchObject({ user: b, code: 'NOT_HOST' });
    onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: a, ready: true });
    onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: b, ready: true });
    const cd = last('rrace.room').room.countdown_ms; expect(cd).toBeGreaterThan(ROOM_COUNTDOWN_MS - 200);
    stepRaces(Date.now() + ROOM_COUNTDOWN_MS + 10); await new Promise((r) => setTimeout(r, 300));
    expect(last('rrace.roomgone')).toMatchObject({ room: id, code: 'STARTED' });
    const st = last('rrace.started'); expect(st.users.sort()).toEqual([a, b].sort()); expect(st.laps).toBe(1);
    expect(_raceRooms.has(id)).toBe(false); expect(inRace(a) && inRace(b)).toBe(true);
    expect(pub.some((m) => m.t === 'rrace.started')).toBe(true); // 房間開的比賽一定 NOTIFY（成員可能在別的執行個體）
  });
  it('ready once: host changing laps keeps everyone ready and the race still starts (no second ready)', async () => {
    const a = await user('O1', '雞'), b = await user('O2', '鴨');
    const id = await createRoom(a, 'tw1', 1);
    onRaceBus({ t: 'rrace.rjoin', inst: 'i1', room: id, user: b }); await new Promise((r) => setTimeout(r, 100));
    onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: a, ready: true }); onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: b, ready: true });
    onRaceBus({ t: 'rrace.rconf', inst: 'i1', room: id, user: a, laps: 2 });
    const v = last('rrace.room').room; expect(v.laps).toBe(2); expect(v.members.every((m: any) => m.ready)).toBe(true); expect(v.countdown_ms).toBeGreaterThan(ROOM_COUNTDOWN_MS - 200);
    stepRaces(Date.now() + ROOM_COUNTDOWN_MS + 10); await new Promise((r) => setTimeout(r, 300));
    expect(last('rrace.roomgone')).toMatchObject({ room: id, code: 'STARTED' }); expect(last('rrace.started').laps).toBe(2);
  });
  it('host leaves → host moves to the remaining member; last leaves → room gone', async () => {
    const a = await user('A'), b = await user('B');
    const id = await createRoom(a, 'tw1', 3);
    onRaceBus({ t: 'rrace.rjoin', inst: 'i1', room: id, user: b }); await new Promise((r) => setTimeout(r, 100));
    onRaceBus({ t: 'rrace.rleave', inst: 'i1', room: id, user: a });
    expect(last('rrace.room').room.host).toBe(b); expect(last('rrace.roomgone')).toMatchObject({ users: [a], code: 'LEFT' });
    onRaceBus({ t: 'rrace.rleave', inst: 'i1', room: id, user: b });
    expect(last('rrace.roomgone')).toMatchObject({ users: [b], code: 'EMPTY' }); expect(_raceRooms.has(id)).toBe(false);
    onRaceBus({ t: 'rrace.rjoin', inst: 'i1', room: id, user: a }); expect(last('rrace.notice')).toMatchObject({ user: a, code: 'ROOM_CLOSED' });
  });
  it('rejects bad laps and locked tracks; intents for other instances are ignored', async () => {
    const a = await user('C');
    await expect(createRoom(a, 'tw1', 9)).rejects.toThrow('BAD_REQUEST');
    await expect(createRoom(a, 'jp4', 3)).rejects.toThrow();
    const id = await createRoom(a, 'tw1', undefined); expect(_raceRooms.get(id)!.laps).toBe(4); // default = track laps (tw1 = 4)
    const n = sent.length; onRaceBus({ t: 'rrace.rleave', inst: 'other', room: id, user: a }); expect(sent.length).toBe(n);
  });
  it('room race pays humans 150/100 (top 3 among humans), custom laps: no points / best time', async () => {
    const a = await user('R1', '雞'), b = await user('R2', '鴨');
    const id = await createRoom(a, 'tw1', 1);
    onRaceBus({ t: 'rrace.rjoin', inst: 'i1', room: id, user: b }); await new Promise((r) => setTimeout(r, 100));
    onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: a, ready: true }); onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: b, ready: true });
    stepRaces(Date.now() + ROOM_COUNTDOWN_MS + 10); await new Promise((r) => setTimeout(r, 300));
    const raceId = last('rrace.started').race_id;
    await fastForwardRace(raceId, (s) => { for (const c of s.cars) if (!c.ai) { c.speed = 400; } });
    const res = last('rrace.ended').results; const pr = Object.fromEntries(res.map((x: any) => [x.user_id, x]));
    expect([pr[a].prize, pr[b].prize].sort((x, y) => y - x)).toEqual([150, 100]);
    expect(pr[a].points).toBe(0); expect(pr[b].points).toBe(0);
    const rows = await sql<{ time_ms: number | null; private: boolean }>`SELECT time_ms, private FROM race_results WHERE race_id = ${raceId}`.execute(db);
    expect(rows.rows.every((r) => r.time_ms === null && r.private)).toBe(true);
  });
  it('solo room race (1 human) pays 50 to the finisher', async () => {
    const a = await user('S1', '雞');
    const id = await createRoom(a, 'tw1', 1);
    onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: a, ready: true });
    stepRaces(Date.now() + ROOM_COUNTDOWN_MS + 10); await new Promise((r) => setTimeout(r, 300));
    const raceId = last('rrace.started').race_id;
    await fastForwardRace(raceId, (s) => { for (const c of s.cars) if (!c.ai) { c.speed = 400; } });
    const res = last('rrace.ended').results; expect(res.find((x: any) => x.user_id === a).prize).toBe(50);
  });
  it('stairs room: 2 ready → multiplayer stairs starts (room match, NOTIFY to members) and pays 150/100', async () => {
    const a = await user('S1', '雞'), b = await user('S2', '鴨');
    const id = await createRoom(a, null, null, Date.now(), 'stairs');
    expect(last('rrace.room').room).toMatchObject({ game: 'stairs', min: 2 });
    onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: a, ready: true }); expect(last('rrace.room').room.countdown_ms).toBeNull(); // 1 人不能開
    onRaceBus({ t: 'rrace.rjoin', inst: 'i1', room: id, user: b }); await new Promise((r) => setTimeout(r, 100));
    onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: b, ready: true });
    onRaceBus({ t: 'rrace.rconf', inst: 'i1', room: id, user: a, track: 'tw2' }); expect(last('rrace.notice')).toMatchObject({ code: 'BAD_REQUEST' });
    stepRaces(Date.now() + ROOM_COUNTDOWN_MS + 10); await new Promise((r) => setTimeout(r, 500));
    const st = [...pub].reverse().find((m) => m.t === 'mstairs.started'); if (!st) console.log(sent.slice(-5)); expect(st).toBeTruthy(); expect(st.home).toBe(`room:${id}`); expect(st.users.sort()).toEqual([a, b].sort()); expect(st.inst).toBe('i1');
    expect(last('rrace.roomgone')).toMatchObject({ code: 'STARTED' });
    const m = mmatches.get(`room:${id}`)!; expect(m.room).toEqual({ inst: 'i1' });
    const loser = m.seats.find((x) => x.userId === b)!; leaveStairs(m.state, loser.petId);
    const out = (await finishStairs(m, 'quit'))!; const coins = Object.fromEntries(out.map((o) => [o.user_id, o.coins]));
    expect(coins[a]).toBe(150); expect(coins[b]).toBe(100);
  });
});
