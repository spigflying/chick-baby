import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { createDb } from '../src/db';
import { migrateToLatest } from '../src/migrations';
import { createRoom, initRacing, onRaceBus, raceFriends, stepRaces, _raceRooms, inRace, fastForwardRace } from '../src/racing';
import { initMStairs, mmatches, finish as finishStairs } from '../src/mstairs';
import { leaveStairs } from '@chick/engine';
import { ROOM_COUNTDOWN_MS, ROOM_AWAY_MS } from '../src/race-rooms';

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
    const st = last('rrace.started'); expect(st.users.sort()).toEqual([a, b].sort()); expect(st.laps).toBe(1);
    expect(_raceRooms.has(id)).toBe(true); expect(inRace(a) && inRace(b)).toBe(true); // 賽車房：開賽後房間留著
    expect(last('rrace.room').room.members.every((m: any) => m.away && !m.ready)).toBe(true);
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
    expect(last('rrace.started').laps).toBe(2);
  });
  it('room stays after the race: each player presses back himself; countdown waits for everyone; stats in results; absent players dropped', async () => {
    const a = await user('久留', '雞'), b = await user('超級無敵長長長長長長長的名字', '鴨鴨鴨鴨鴨鴨鴨鴨');
    const id = await createRoom(a, 'tw1', 1);
    onRaceBus({ t: 'rrace.rjoin', inst: 'i1', room: id, user: b }); await new Promise((r) => setTimeout(r, 100));
    onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: a, ready: true }); onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: b, ready: true });
    stepRaces(Date.now() + ROOM_COUNTDOWN_MS + 10); await new Promise((r) => setTimeout(r, 300));
    const raceId = last('rrace.started').race_id, room = _raceRooms.get(id)!;
    expect(room.raceId).toBe(raceId); expect(last('rrace.room').room.racing).toBe(true);
    onRaceBus({ t: 'rrace.rback', inst: 'i1', room: id, user: a }); expect(last('rrace.notice')).toMatchObject({ user: a, code: 'ALREADY_IN_MATCH' }); // 比賽中不能回房
    await fastForwardRace(raceId, (s) => { for (const c of s.cars) if (!c.ai) { c.speed = 400; } });
    const ended = last('rrace.ended'); expect(ended.room).toBe(id);
    for (const c of ended.ranking) { expect(typeof c.ob).toBe('number'); expect(typeof c.pk).toBe('number'); expect(c.top).toBeGreaterThan(0); expect(c.avg).toBeGreaterThan(0); }
    expect(ended.results.length).toBe(2); // 結算照常
    const v = last('rrace.room').room; expect(v.racing).toBe(false); expect(v.members.every((m: any) => m.away)).toBe(true); expect(v.host).toBe(a);
    onRaceBus({ t: 'rrace.rback', inst: 'i1', room: id, user: a });
    expect(last('rrace.room').room.members.find((m: any) => m.user === a)).toMatchObject({ away: false, ready: false });
    onRaceBus({ t: 'rrace.rconf', inst: 'i1', room: id, user: a, laps: 2 }); onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: a, ready: true });
    expect(last('rrace.room').room.countdown_ms).toBeNull(); // b 還在看結果：不倒數
    onRaceBus({ t: 'rrace.rback', inst: 'i1', room: id, user: b }); expect(last('rrace.room').room.countdown_ms).toBeNull(); // b 回來但還沒準備
    onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: b, ready: true }); expect(last('rrace.room').room.countdown_ms).toBeGreaterThan(ROOM_COUNTDOWN_MS - 200);
    stepRaces(Date.now() + ROOM_COUNTDOWN_MS + 10); await new Promise((r) => setTimeout(r, 300));
    const r2 = last('rrace.started'); expect(r2.race_id).not.toBe(raceId); expect(r2.laps).toBe(2);
    await fastForwardRace(r2.race_id, (s) => { for (const c of s.cars) if (!c.ai) { c.speed = 400; } });
    onRaceBus({ t: 'rrace.rback', inst: 'i1', room: id, user: a }); // b 一直沒回來 → 3 分鐘後移出
    stepRaces(Date.now() + ROOM_AWAY_MS + 1000);
    expect(_raceRooms.get(id)!.members.map((m) => m.user)).toEqual([a]); expect(last('rrace.roomgone')).toMatchObject({ users: [b], room: id });
    const rows = await sql<{ n: number }>`SELECT count(*)::int AS n FROM race_results WHERE race_id IN (${raceId}, ${r2.race_id})`.execute(db); expect(rows.rows[0].n).toBe(4);
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
  it('stairs room: start failure (not enough eligible pets) keeps the room with everyone back in the lobby', async () => {
    const a = await user('F1', '雞'), b = await user('F2', '鴨');
    const id = await createRoom(a, null, null, Date.now(), 'stairs');
    onRaceBus({ t: 'rrace.rjoin', inst: 'i1', room: id, user: b }); await new Promise((r) => setTimeout(r, 100));
    await db.updateTable('pets').set({ status: 'dead' } as any).where('owner_id', '=', b).execute();
    onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: a, ready: true }); onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: b, ready: true });
    stepRaces(Date.now() + ROOM_COUNTDOWN_MS + 10);
    for (let i = 0; i < 40 && _raceRooms.get(id)?.raceId; i++) await new Promise((r) => setTimeout(r, 100));
    const v = last('rrace.room').room; expect(v.racing).toBe(false); expect(v.members.every((x: any) => !x.away && !x.ready)).toBe(true);
    expect(sent.some((x) => x.t === 'rrace.notice' && x.code === 'NOT_ENOUGH_PLAYERS')).toBe(true);
  });
  it('stairs room: 2 ready → multiplayer stairs starts (room match, NOTIFY to members) and pays 150/100', async () => {
    const a = await user('S1', '雞'), b = await user('S2', '鴨');
    const id = await createRoom(a, null, null, Date.now(), 'stairs');
    expect(last('rrace.room').room).toMatchObject({ game: 'stairs', min: 2 });
    onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: a, ready: true }); expect(last('rrace.room').room.countdown_ms).toBeNull(); // 1 人不能開
    onRaceBus({ t: 'rrace.rjoin', inst: 'i1', room: id, user: b }); await new Promise((r) => setTimeout(r, 100));
    onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: b, ready: true });
    onRaceBus({ t: 'rrace.rconf', inst: 'i1', room: id, user: a, track: 'tw2' }); expect(last('rrace.notice')).toMatchObject({ code: 'BAD_REQUEST' });
    stepRaces(Date.now() + ROOM_COUNTDOWN_MS + 10);
    for (let i = 0; i < 40 && !pub.some((m) => m.t === 'mstairs.started'); i++) await new Promise((r) => setTimeout(r, 100));
    const st = [...pub].reverse().find((m) => m.t === 'mstairs.started');  expect(st).toBeTruthy(); expect(st.home).toBe(`room:${id}`); expect(st.users.sort()).toEqual([a, b].sort()); expect(st.inst).toBe('i1');
    const m = mmatches.get(`room:${id}`)!; expect(m.room).toEqual({ inst: 'i1' });
    // 房間留著：成員都在、標成 away、比賽中
    expect(_raceRooms.has(id)).toBe(true); expect(_raceRooms.get(id)!.raceId).toBe(m.id);
    expect(last('rrace.room').room).toMatchObject({ racing: true, host: a }); expect(last('rrace.room').room.members.every((x: any) => x.away && !x.ready)).toBe(true);
    onRaceBus({ t: 'rrace.rback', inst: 'i1', room: id, user: a }); expect(last('rrace.notice')).toMatchObject({ user: a, code: 'ALREADY_IN_MATCH' });
    const loser = m.seats.find((x) => x.userId === b)!; leaveStairs(m.state, loser.petId);
    const out = (await finishStairs(m, 'quit'))!; const coins = Object.fromEntries(out.map((o) => [o.user_id, o.coins]));
    expect(coins[a]).toBe(150); expect(coins[b]).toBe(100);
    for (const o of out) { expect(typeof o.survived_ms).toBe('number'); expect(o.max_hp).toBeGreaterThan(0); expect(o.hp).toBeGreaterThanOrEqual(0); }
    const ended = [...pub].reverse().find((x) => x.t === 'mstairs.ended'); expect(ended.players[0].survived_ms).toBeTypeOf('number');
    const v = last('rrace.room').room; expect(v.racing).toBe(false); expect(v.members.every((x: any) => x.away)).toBe(true);
    onRaceBus({ t: 'rrace.rback', inst: 'i1', room: id, user: a }); onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: a, ready: true });
    expect(last('rrace.room').room.countdown_ms).toBeNull(); // b 還在看結果
    onRaceBus({ t: 'rrace.rback', inst: 'i1', room: id, user: b }); expect(last('rrace.room').room.members.find((x: any) => x.user === b)).toMatchObject({ away: false, ready: false });
    onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: b, ready: true }); expect(last('rrace.room').room.countdown_ms).toBeGreaterThan(0);
    onRaceBus({ t: 'rrace.rready', inst: 'i1', room: id, user: b, ready: false }); // 這次不開，測 3 分鐘移出
    const r = _raceRooms.get(id)!; r.members.find((x) => x.user === b)!.away = true; r.members.find((x) => x.user === b)!.awayAt = Date.now();
    stepRaces(Date.now() + ROOM_AWAY_MS + 1000); expect(_raceRooms.get(id)!.members.map((x) => x.user)).toEqual([a]);
  });
});
