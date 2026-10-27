import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { createDb } from '../src/db';
import { migrateToLatest } from '../src/migrations';
import { createRoom, initRacing, offerRooms, onRaceBus, stepRaces, _raceRooms, MAX_HUMANS } from '../src/racing';
import { initMStairs } from '../src/mstairs';
import { ROOM_COUNTDOWN_MS } from '../src/race-rooms';

// 好友的房間：離開房／房關了／剛連上 → 再邀請；選單清單（room.list）
const { db } = createDb();
const sent: any[] = [], pub: any[] = [];
beforeAll(async () => {
  await migrateToLatest(db as any);
  const bus = { publish: async (m: any) => { pub.push(m); } } as any, presence = { users: () => [], instances: () => ['i1'] } as any;
  initMStairs({ db, bus, presence, instance: () => 'i1' });
  initRacing({ db, bus, presence, instance: () => 'i1', local: (m) => sent.push(m) });
});
afterAll(async () => { await db.destroy(); });
async function user(name: string) {
  const id = randomUUID();
  await sql`INSERT INTO users (id, google_sub, display_name, share_code) VALUES (${id}, ${'g-' + id}, ${name}, ${id.slice(0, 12)})`.execute(db);
  await sql`INSERT INTO wallets (user_id, balance) VALUES (${id}, 0) ON CONFLICT DO NOTHING`.execute(db);
  await sql`INSERT INTO homes (owner_id, name) VALUES (${id}, ${name + '家'})`.execute(db);
  return id;
}
const visit = (u: string, owner: string) => sql`INSERT INTO home_visits (user_id, home_id) SELECT ${u}, id FROM homes WHERE owner_id = ${owner}`.execute(db);
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const invitesTo = (u: string, from = 0) => sent.slice(from).filter((m) => m.t === 'rrace.roominvite' && m.to.length === 1 && m.to[0] === u);
const listFor = (u: string, from = 0) => sent.slice(from).filter((m) => m.t === 'rrace.roomlist' && m.users[0] === u);
const join = async (room: string, u: string) => { onRaceBus({ t: 'rrace.rjoin', inst: 'i1', room, user: u }); await wait(); };

describe('friends\u2019 open rooms are offered again', () => {
  it('reported case: B leaves A\u2019s room and opens room B → A gets room B once A is free', async () => {
    const a = await user('阿明'), b = await user('小華'); await visit(b, a);
    const ra = await createRoom(a, 'tw1', 3); await join(ra, b);
    onRaceBus({ t: 'rrace.rleave', inst: 'i1', room: ra, user: b });
    const rb = await createRoom(b, 'tw2', 3);
    // A 還在 A 房：建立時的邀請照常送（ws.ts 會因為 A 在房裡擋掉彈窗）
    const n = sent.length;
    onRaceBus({ t: 'rrace.rleave', inst: 'i1', room: ra, user: a }); // A 也離開 → A 房關了
    expect(_raceRooms.has(ra)).toBe(false);
    await offerRooms(a); // ws.ts 收到 roomgone 後對有空的人呼叫
    const inv = invitesTo(a, n); expect(inv).toHaveLength(1); expect(inv[0]).toMatchObject({ room: rb, inst: 'i1', from: b, from_name: '小華', track: 'tw2' });
    expect(pub.some((m) => m.t === 'rrace.rquery' && m.user === a && m.friends.includes(b))).toBe(true); // 也問別台執行個體
  });
  it('both in their own rooms: whoever leaves first gets the other\u2019s room; list shows it with host/track/laps/count', async () => {
    const a = await user('A1'), b = await user('B1'); await visit(a, b);
    const ra = await createRoom(a, 'tw1', 2), rb = await createRoom(b, 'tw3', 4);
    let n = sent.length; await offerRooms(a, 'list', 'race');
    expect(listFor(a, n)[0].rooms).toEqual([{ room: rb, inst: 'i1', game: 'race', host: b, host_name: 'B1', track: 'tw3', laps: 4, members: 1, max: MAX_HUMANS }]);
    onRaceBus({ t: 'rrace.rleave', inst: 'i1', room: rb, user: b });
    n = sent.length; await offerRooms(b); expect(invitesTo(b, n)[0]).toMatchObject({ room: ra, from: a });
  });
  it('no re-offer of closed, full, counting-down or started rooms', async () => {
    const me = await user('Me'), h = [await user('H1'), await user('H2'), await user('H3'), await user('H4')];
    for (const x of h) await visit(me, x);
    const closed = await createRoom(h[0], 'tw1', 3); onRaceBus({ t: 'rrace.rleave', inst: 'i1', room: closed, user: h[0] });
    const full = await createRoom(h[1], 'tw1', 3); for (let i = 1; i < MAX_HUMANS; i++) await join(full, await user('F' + i));
    expect(_raceRooms.get(full)!.members.length).toBe(MAX_HUMANS);
    const cd = await createRoom(h[2], 'tw1', 3); onRaceBus({ t: 'rrace.rready', inst: 'i1', room: cd, user: h[2], ready: true });
    expect(_raceRooms.get(cd)!.countdownAt).not.toBeNull();
    const started = await createRoom(h[3], 'tw1', 1); onRaceBus({ t: 'rrace.rready', inst: 'i1', room: started, user: h[3], ready: true });
    stepRaces(Date.now() + ROOM_COUNTDOWN_MS + 10); await wait(200);
    expect(_raceRooms.get(started)!.raceId).toBeTruthy(); // 房間留著但比賽中，不推薦
    const n = sent.length; await offerRooms(me); await offerRooms(me, 'list', 'race');
    expect(invitesTo(me, n)).toHaveLength(0); expect(listFor(me, n)[0].rooms).toEqual([]);
  });
  it('exclusions: own room, a room I\u2019m already in, and non-friends\u2019 rooms are not offered', async () => {
    const me = await user('Me2'), f = await user('Friend'), stranger = await user('路人'); await visit(me, f);
    await createRoom(stranger, 'tw1', 3);
    const fr = await createRoom(f, 'tw1', 3); await join(fr, me);
    let n = sent.length; await offerRooms(me); await offerRooms(me, 'list', 'race');
    expect(invitesTo(me, n)).toHaveLength(0); expect(listFor(me, n)[0].rooms).toEqual([]);
    onRaceBus({ t: 'rrace.rleave', inst: 'i1', room: fr, user: me });
    await createRoom(me, 'tw1', 3); // 自己的房不算
    n = sent.length; await offerRooms(me, 'list', 'race');
    expect(listFor(me, n)[0].rooms.map((r: any) => r.room)).toEqual([fr]);
  });
  it('a query from another instance is answered for this instance\u2019s rooms; echoes are ignored', async () => {
    const me = await user('Remote'), f = await user('F2'); await visit(me, f);
    const fr = await createRoom(f, 'tw1', 3);
    let n = sent.length; onRaceBus({ t: 'rrace.rquery', user: me, friends: [f], mode: 'list', game: 'race', src: 'i2' });
    expect(listFor(me, n)[0]).toMatchObject({ inst: 'i1' }); expect(listFor(me, n)[0].rooms[0].room).toBe(fr);
    n = sent.length; onRaceBus({ t: 'rrace.rquery', user: me, friends: [f], mode: 'invite', src: 'i1' });
    expect(sent.length).toBe(n);
  });
});
