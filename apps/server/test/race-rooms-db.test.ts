import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { createDb } from '../src/db';
import { migrateToLatest } from '../src/migrations';
import { createRoom, initRacing, onRaceBus, raceFriends, stepRaces, _raceRooms, inRace } from '../src/racing';
import { ROOM_COUNTDOWN_MS } from '../src/race-rooms';

const { db } = createDb();
const sent: any[] = [], pub: any[] = [];
beforeAll(async () => {
  await migrateToLatest(db as any);
  initRacing({ db, bus: { publish: async (m: any) => { pub.push(m); } } as any, presence: { users: () => [], instances: () => ['i1'] } as any, instance: () => 'i1', local: (m) => sent.push(m) });
});
afterAll(async () => { await db.destroy(); });
async function user(name: string, pet?: string) {
  const id = randomUUID();
  await sql`INSERT INTO users (id, google_sub, display_name, share_code) VALUES (${id}, ${'g-' + id}, ${name}, ${id.slice(0, 12)})`.execute(db);
  await sql`INSERT INTO homes (owner_id, name) VALUES (${id}, ${name + '家'})`.execute(db);
  if (pet) await sql`INSERT INTO pets (owner_id, species_id, name, status, born_at, last_simulated_at, hunger, happiness, energy, cleanliness, health, strength, speed, stamina, weight, personality, counters)
    VALUES (${id}, 'chicken', ${pet}, 'alive', now(), now(), 1,1,1,1,1,1,1,1,1, 'calm', '{}'::jsonb)`.execute(db);
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
    const id = await createRoom(a, 'tw1', undefined); expect(_raceRooms.get(id)!.laps).toBe(3);
    const n = sent.length; onRaceBus({ t: 'rrace.rleave', inst: 'other', room: id, user: a }); expect(sent.length).toBe(n);
  });
});
