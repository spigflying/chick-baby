// M2 多人下樓梯（requirements §4.4、§5.0）：以家為單位的邀請 → 開始 → 推擠出局 → 結算；離開、互斥、關門中止。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { createDb } from '../src/db';
import { migrateToLatest } from '../src/migrations';
import { buildApp } from '../src/app';
import { Bus } from '../src/bus';
import { startStairsLoop } from '../src/stairs';
import { startArenaLoop, _arenas } from '../src/arena';
import { finish, mmatches, startMStairsLoop, _lobbies, _mstairsDeps } from '../src/mstairs';
import { handleClosed } from '../src/closing';
import { ALWAYS_OPEN, STAIRS_PARAMS } from '@chick/engine';
import { setClock } from '../src/hours';

const { db } = createDb();
const bus = new Bus();
let app: Awaited<ReturnType<typeof buildApp>>['app'];
const loops: NodeJS.Timeout[] = [];
beforeAll(async () => {
  await migrateToLatest(db as any);
  await bus.start();
  ({ app } = await buildApp(db, bus, { logger: false }));
  loops.push(startStairsLoop(db), startArenaLoop(), startMStairsLoop());
});
afterAll(async () => { loops.forEach(clearInterval); await app.close(); await bus.stop(); await db.destroy(); });
beforeEach(async () => {
  const t = await sql<{ tablename: string }>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'kysely_%' AND tablename <> 'audit_log'`.execute(db);
  await sql.raw(`ALTER TABLE audit_log DISABLE TRIGGER USER; TRUNCATE ${t.rows.map((r) => `"${r.tablename}"`).join(',')}, audit_log CASCADE; ALTER TABLE audit_log ENABLE TRIGGER USER;`).execute(db);
});
afterEach(() => { setClock(ALWAYS_OPEN); mmatches.clear(); _lobbies.clear(); _arenas.clear(); });

type Client = { cookie: string; id: string; call: (method: string, url: string, body?: any) => Promise<{ status: number; json: any }> };
let ipSeq = 0;
async function login(name: string): Promise<Client> {
  const remoteAddress = `10.8.${Math.floor(++ipSeq / 250) % 250}.${ipSeq % 250 + 1}`;
  const r = await app.inject({ method: 'POST', url: '/api/auth/dev', payload: { name }, remoteAddress });
  const cookie = String(r.headers['set-cookie']).split(';')[0];
  const call = async (method: string, url: string, body?: any) => {
    const res = await app.inject({ method: method as any, url, payload: body, headers: { cookie }, remoteAddress });
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };
  return { cookie, id: (await call('GET', '/api/me')).json.user.id, call };
}
async function hatchAlive(c: Client, species = 'chicken', patch: Record<string, unknown> = {}) {
  const r = await c.call('POST', '/api/pets', { species, name: 'P' + species, request_id: randomUUID() });
  const id = r.json.pet.id as string;
  await db.updateTable('pets').set({ status: 'alive', born_at: sql`now() - interval '2 minutes'`, hatched_at: sql`now()`, last_simulated_at: sql`now()`, hunger: 80, health: 90, energy: 80, ...patch } as any).where('id', '=', id).execute();
  return id;
}
async function openWs(c: Client) {
  const msgs: any[] = [];
  const ws = await app.injectWS('/ws', { headers: { cookie: c.cookie }, socket: { remoteAddress: '127.0.0.1' } } as any, { onInit: (s) => s.on('message', (d) => msgs.push(JSON.parse(String(d)))) });
  const wait = async (pred: (m: any) => boolean, what = '') => {
    for (let i = 0; i < 250; i++) { const m = msgs.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 20)); }
    throw new Error('timeout ' + what + ': ' + JSON.stringify(msgs.slice(-6)).slice(0, 1500));
  };
  await wait((m) => m.type === 'hello');
  return { ws, msgs, wait, send: (m: any) => ws.send(JSON.stringify(m)) };
}
type W = Awaited<ReturnType<typeof openWs>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 主人 a + 訪客 b、c（有寵物）+ d（沒寵物），全部在 a 家。 */
async function setup(patch: Record<string, Record<string, unknown>> = {}) {
  const a = await login('Amy'), b = await login('Bob'), c = await login('Cat'), d = await login('Dog');
  const pa = await hatchAlive(a, 'chicken', patch.a), pb = await hatchAlive(b, 'duck', patch.b), pc = await hatchAlive(c, 'penguin', patch.c);
  const home = (await a.call('GET', '/api/me')).json.home.id as string;
  const ws = [await openWs(a), await openWs(b), await openWs(c), await openWs(d)];
  for (const w of ws) w.send({ type: 'home.join', home_id: home });
  await ws[3].wait((m) => m.type === 'home.presence' && m.users.length === 4, 'presence');
  const close = async () => { for (const w of ws) w.ws.terminate(); await sleep(300); };
  return { a, b, c, d, pa, pb, pc, home, wa: ws[0], wb: ws[1], wc: ws[2], wd: ws[3], close };
}
/** a 發起，replies 依序回覆，等 match.started。 */
async function startMatch(from: W, replies: [W, boolean][], all: W[]) {
  for (const w of all) w.msgs.length = 0;
  from.send({ type: 'stairs.invite' });
  const inv = await from.wait((m) => m.type === 'stairs.event' && m.kind === 'invite', 'invite');
  for (const [w, acc] of replies) w.send({ type: 'stairs.reply', invite: inv.invite, accept: acc });
  return inv;
}

describe('multi-player stairs (M2)', () => {
  it('home-based invite → start → a push kill → ranked settlement (◎5 + (n − rank) × 3), ledger, DB rows, audit, idempotent', async () => {
    const { a, b, c, d, pa, pb, home, wa, wb, wc, wd, close } = await setup({ a: { strength: 30, weight: 25 } });
    const inv = await startMatch(wa, [[wb, true], [wc, false]], [wa, wb, wc, wd]);
    expect(inv.to.sort()).toEqual([b.id, c.id].sort()); // 沒寵物的 d 不會被邀請
    expect(inv.from_name).toBe('Pchicken（Amy）');
    await wd.wait((m) => m.type === 'stairs.event' && m.kind === 'invite', 'd sees the invite banner');
    const st = await wa.wait((m) => m.type === 'match.started', 'started a');
    const stb = await wb.wait((m) => m.type === 'match.started', 'started b');
    expect(st).toMatchObject({ mode: 'multi', home_id: home, match_id: stb.match_id });
    expect(st.players.map((p: any) => p.user_id).sort()).toEqual([a.id, b.id].sort());
    expect(st.players.find((p: any) => p.user_id === a.id)).toMatchObject({ pet_id: pa, name: 'Pchicken（Amy）', strength: 30, weight: 25 });
    const ev = await wc.wait((m) => m.type === 'stairs.event' && m.kind === 'start', 'c sees start');
    expect(ev.users.sort()).toEqual([a.id, b.id].sort());
    expect(wc.msgs.some((m) => m.type === 'match.started')).toBe(false);
    const row = await db.selectFrom('stair_matches').selectAll().where('id', '=', st.match_id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ mode: 'multi', home_id: home, host_user_id: a.id, status: 'playing' });
    expect(await db.selectFrom('stair_match_players').select('user_id').where('match_id', '=', st.match_id).execute()).toHaveLength(2);
    // 快照只送給參賽者，last_processed_seq 是自己的
    wa.send({ type: 'match.input', match_id: st.match_id, seq: 1, tick: 0, left: true, right: false });
    const snap = await wa.wait((m) => m.type === 'match.snapshot' && m.last_processed_seq === 1, 'snapshot with my seq');
    expect(snap.state.players).toHaveLength(2);
    await wb.wait((m) => m.type === 'match.snapshot' && m.last_processed_seq === 0, 'b snapshot');
    expect(wc.msgs.some((m) => m.type === 'match.snapshot')).toBe(false);
    wa.send({ type: 'match.input', match_id: st.match_id, seq: 1, tick: 5, left: false, right: false });
    await wa.wait((m) => m.type === 'stairs.notice' && m.code === 'BAD_INPUT', 'seq must increase');
    // b 被 a 推下去：最後推的人在 60 tick 內 → 擊殺算 a
    const mm = mmatches.get(home)!;
    const sb = mm.state.players.find((p) => p.petId === pb)!;
    Object.assign(sb, { lastPushBy: pa, lastPushTick: mm.state.tick, y: STAIRS_PARAMS.height + 5, on: null });
    const endA = await wa.wait((m) => m.type === 'match.ended', 'ended a');
    const endB = await wb.wait((m) => m.type === 'match.ended', 'ended b');
    expect(endA.me).toMatchObject({ user_id: a.id, rank: 1, coins: 8 });
    expect(endB.me).toMatchObject({ user_id: b.id, rank: 2, coins: 5, cause: 'fell', killed_by: pa, killed_by_name: 'Pchicken（Amy）' });
    expect(endA.players.map((p: any) => p.rank)).toEqual([1, 2]);
    const led = await db.selectFrom('coin_ledger').select(['user_id', 'delta', 'ref_id']).where('reason', '=', 'stairs_match').execute();
    expect(led.map((l: any) => [l.user_id, l.delta]).sort()).toEqual([[a.id, 8], [b.id, 5]].sort());
    expect(new Set(led.map((l: any) => l.ref_id))).toEqual(new Set([st.match_id]));
    const players = await db.selectFrom('stair_match_players').selectAll().where('match_id', '=', st.match_id).execute();
    expect(players.find((p: any) => p.user_id === b.id)).toMatchObject({ rank: 2, eliminated_by_pet_id: pa, coins_awarded: 5 });
    expect(players.find((p: any) => p.user_id === a.id)).toMatchObject({ rank: 1, eliminated_by_pet_id: null, coins_awarded: 8 });
    expect((await db.selectFrom('stair_matches').select('status').where('id', '=', st.match_id).executeTakeFirstOrThrow()).status).toBe('done');
    expect(await db.selectFrom('audit_log').select('action').where('action', '=', 'stairs.finish_multi').execute()).toHaveLength(1);
    const pets = await db.selectFrom('pets').select(['id', 'energy', 'counters']).where('id', 'in', [pa, pb]).execute();
    for (const p of pets) { expect(p.energy).toBeLessThan(80); expect((p.counters as any).plays).toBe(1); }
    expect(await db.selectFrom('pet_events').select('type').where('type', '=', 'stairs_match').execute()).toHaveLength(2);
    // 冪等：再結算一次沒有作用
    expect(await finish(mm, 'over')).toBeNull();
    mm.ended = false; expect(await finish(mm, 'over')).toBeNull(); // status 已不是 playing
    expect(await db.selectFrom('coin_ledger').select('id').where('reason', '=', 'stairs_match').execute()).toHaveLength(2);
    expect((await a.call('GET', '/api/me')).json.wallet.balance).toBe(28);
    void d; await close();
  });

  it('leaving (disconnect / Esc) is an elimination; the last one standing wins; 3-player rewards', async () => {
    const { a, b, c, home, wa, wb, wc, wd, close } = await setup();
    await startMatch(wa, [[wb, true], [wc, true]], [wa, wb, wc, wd]);
    const st = await wa.wait((m) => m.type === 'match.started', 'started');
    expect(st.players).toHaveLength(3);
    await wa.wait((m) => m.type === 'match.snapshot' && m.tick > 2, 'running');
    wc.ws.terminate(); // 斷線＝出局
    for (let i = 0; i < 100 && mmatches.get(home)?.state.players.filter((p) => p.alive).length !== 2; i++) await sleep(20);
    const left = mmatches.get(home)!.state.players.find((p) => p.cause === 'left')!;
    expect(left.alive).toBe(false); expect(left.killedBy).toBeNull();
    expect(mmatches.get(home)!.state.over).toBe(false);
    await sleep(200); // 晚幾個 tick 再走（同一 tick 出局會比樓層）
    wa.send({ type: 'match.leave', match_id: st.match_id }); // a 按 Esc
    const end = await wb.wait((m) => m.type === 'match.ended', 'ended');
    expect(end.me).toMatchObject({ user_id: b.id, rank: 1, coins: 11 });
    const ranks = Object.fromEntries(end.players.map((p: any) => [p.user_id, [p.rank, p.coins, p.cause]]));
    expect(ranks[a.id]).toEqual([2, 8, 'left']); expect(ranks[c.id]).toEqual([3, 5, 'left']);
    await close();
  });

  it('checks: no one to play with, busy home, tired pets dropped at start, solo while in a multi match, fights excluded', async () => {
    const { a, b, home, wa, wb, wc, wd, close } = await setup({ c: { energy: 5 } });
    wd.send({ type: 'stairs.invite' });
    await wd.wait((m) => m.type === 'stairs.notice' && m.code === 'NOT_ELIGIBLE', 'no pet');
    // c 太累：開始時被移出（TOO_TIRED），a、b 照常開始
    await startMatch(wa, [[wb, true], [wc, true]], [wa, wb, wc, wd]);
    wb.send({ type: 'stairs.invite' });
    await wb.wait((m) => m.type === 'stairs.notice' && m.code === 'STAIRS_BUSY', 'busy');
    await wc.wait((m) => m.type === 'stairs.notice' && m.code === 'TOO_TIRED', 'c dropped');
    const st = await wa.wait((m) => m.type === 'match.started', 'started');
    expect(st.players.map((p: any) => p.user_id).sort()).toEqual([a.id, b.id].sort());
    // 比賽中不能開單人局（同一條連線、別的連線都不行）
    wa.send({ type: 'match.create', request_id: randomUUID() });
    await wa.wait((m) => m.type === 'error' && m.code === 'ALREADY_IN_MATCH', 'solo blocked (same conn)');
    const wa2 = await openWs(a); wa2.send({ type: 'match.create', request_id: randomUUID() });
    await wa2.wait((m) => m.type === 'error' && m.code === 'ALREADY_IN_MATCH', 'solo blocked (db check)');
    // 參賽者暫時不在打架場地；arena.join 被忽略
    wa.send({ type: 'arena.join' }); wb.send({ type: 'arena.join' }); wc.send({ type: 'arena.join' });
    await sleep(300);
    const fighters = _arenas.get(home)?.state.fighters.map((f) => f.userId) ?? [];
    expect(fighters).not.toContain(a.id); expect(fighters).not.toContain(b.id);
    wa2.ws.terminate(); await close();
  });

  it('an invite that ends with fewer than 2 players is cancelled; the host can cancel', async () => {
    const { wa, wb, wc, wd, close } = await setup();
    await startMatch(wa, [[wb, false], [wc, false]], [wa, wb, wc, wd]);
    const cancel = await wa.wait((m) => m.type === 'stairs.event' && m.kind === 'invite_cancel', 'cancel');
    expect(cancel.code).toBe('NOT_ENOUGH_PLAYERS');
    await startMatch(wb, [], [wa, wb, wc, wd]);
    wb.send({ type: 'stairs.cancel' });
    expect((await wd.wait((m) => m.type === 'stairs.event' && m.kind === 'invite_cancel', 'host cancel')).code).toBe('CANCELLED');
    expect(await db.selectFrom('stair_matches').select('id').execute()).toHaveLength(0);
    await close();
  });

  it('works through LISTEN/NOTIFY too (players on other instances), and 20:00 closing aborts without rewards', async () => {
    const deps = _mstairsDeps()!; const local = deps.local; deps.local = undefined; // 強制走 NOTIFY
    try {
      const { home, wa, wb, wc, wd, close } = await setup();
      await startMatch(wa, [[wb, true], [wc, true]], [wa, wb, wc, wd]);
      const st = await wb.wait((m) => m.type === 'match.started', 'started via notify');
      await wb.wait((m) => m.type === 'match.snapshot' && m.tick > 2, 'snapshots via notify');
      await handleClosed({ db, hub: { closeAll() {} }, gate: { release: async () => {} } }, null);
      const end = await wb.wait((m) => m.type === 'match.ended', 'aborted');
      expect(end.aborted).toBe(true);
      expect((await db.selectFrom('stair_matches').select('status').where('id', '=', st.match_id).executeTakeFirstOrThrow()).status).toBe('aborted');
      expect(await db.selectFrom('coin_ledger').select('id').where('reason', '=', 'stairs_match').execute()).toHaveLength(0);
      expect(mmatches.has(home)).toBe(false);
      await close();
    } finally { deps.local = local; }
  });
});
