import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import { ALWAYS_OPEN, makeClock } from '@chick/engine';
import { createDb } from '../src/db';
import { Bus } from '../src/bus';
import { buildApp } from '../src/app';
import { setClock } from '../src/hours';

// 不需要 Postgres：指向沒有服務在聽的埠，模擬休息時段 Cloud SQL 停機
const DEAD_URL = 'postgres://chick:chick@127.0.0.1:1/chick';
const { db, pool } = createDb(DEAD_URL);
const bus = new Bus(DEAD_URL);
const CLOSED = makeClock({ days: [], openMin: 0, closeMin: 1, offsetMin: 480 }); // 永遠不開放
let app: Awaited<ReturnType<typeof buildApp>>['app'];

beforeAll(async () => { ({ app } = await buildApp(db, bus, { logger: false })); });
afterAll(async () => { setClock(ALWAYS_OPEN); await app.close(); await bus.stop(); await db.destroy(); });

describe('boot without a database', () => {
  it('caps the pool at 8 connections', () => {
    expect(pool.options.max).toBe(8);
  });
  it('serves healthz, status and config while the DB is down', async () => {
    setClock(CLOSED);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    const st = await app.inject({ method: 'GET', url: '/api/status' });
    expect(st.statusCode).toBe(200);
    expect(st.json()).toMatchObject({ open: false, opens_at: null, closes_at: null });
    expect(typeof st.json().server_time).toBe('number');
    expect((await app.inject({ method: 'GET', url: '/api/config' })).statusCode).toBe(200);
  });
  it('answers GAME_CLOSED for DB routes while closed', async () => {
    setClock(CLOSED);
    const r = await app.inject({ method: 'GET', url: '/api/me' });
    expect(r.statusCode).toBe(423);
    expect(r.json()).toEqual({ error: 'GAME_CLOSED', opens_at: null });
  });
  it('answers DB_UNAVAILABLE (not a crash or hang) when open but the DB is down', async () => {
    setClock(ALWAYS_OPEN);
    const r = await app.inject({ method: 'GET', url: '/api/me' });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ error: 'DB_UNAVAILABLE' });
  });
  it('the cron endpoint is not blocked by closing time (it runs at 20:05)', async () => {
    setClock(CLOSED);
    const r = await app.inject({ method: 'POST', url: '/api/internal/daily', headers: { authorization: 'Bearer dev-cron' } });
    expect(r.statusCode).toBe(503); // 過了關門檢查，只是這裡的 DB 連不上
  });
  it('a DB that accepts connections but never answers fails within the 5s connect timeout', async () => {
    // 模擬 Cloud SQL 停機時「連得上、但沒回應」：沒有連線逾時的話請求會一直卡著
    const srv = net.createServer(() => {}).listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    const url = `postgres://chick:chick@127.0.0.1:${(srv.address() as net.AddressInfo).port}/chick`;
    const hung = createDb(url), hungBus = new Bus(url);
    const { app: a } = await buildApp(hung.db, hungBus, { logger: false });
    setClock(ALWAYS_OPEN);
    const t0 = Date.now();
    const r = await a.inject({ method: 'GET', url: '/api/me' });
    expect(r.statusCode).toBe(503);
    expect(Date.now() - t0).toBeLessThan(8000);
    await a.close(); await hungBus.stop(); await hung.db.destroy(); srv.close();
  }, 15_000);
  it('the 20:05 daily job releases LISTEN afterwards (even if it fails), but not during open hours', async () => {
    let released = 0;
    const gate = { ensure: async () => {}, release: async () => { released++; } };
    const { app: a } = await buildApp(db, bus, { logger: false, gate });
    const daily = () => a.inject({ method: 'POST', url: '/api/internal/daily', headers: { authorization: 'Bearer dev-cron' } });
    setClock(CLOSED);
    expect((await daily()).statusCode).toBe(500); // 這裡的 DB 連不上，排程本身失敗
    expect(released).toBe(1);
    setClock(ALWAYS_OPEN);
    await daily();
    expect(released).toBe(1); // 開放時間跑排程不能把白天的即時通知關掉
    await a.close();
  });
  it('Bus.start against a stopped DB rejects quickly instead of crashing', async () => {
    const b = new Bus(DEAD_URL);
    await expect(b.start()).rejects.toThrow();
    await b.stop();
  });
  it('closes websockets with GAME_CLOSED while closed', async () => {
    setClock(CLOSED);
    let first: Promise<any> = Promise.resolve(null);
    // injectWS 的假請求沒有 socket；trustProxy 會讀 remoteAddress，所以補上
    const ws = await app.injectWS('/ws', { socket: { remoteAddress: '127.0.0.1' } } as any, { onInit: (s) => { first = new Promise((res) => s.once('message', (d) => res(JSON.parse(String(d))))); } });
    expect(await first).toMatchObject({ type: 'error', code: 'GAME_CLOSED' });
    ws.terminate();
  });
});
