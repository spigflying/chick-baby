import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { createDb } from '../src/db';
import { Bus } from '../src/bus';
import { buildApp } from '../src/app';
import { env } from '../src/env';

// 不需要 Postgres：靜態檔、標頭、限流、參數檢查都在碰資料庫之前處理
const DEAD_URL = 'postgres://chick:chick@127.0.0.1:1/chick';
const { db } = createDb(DEAD_URL);
const bus = new Bus(DEAD_URL);
const dist = mkdtempSync(path.join(tmpdir(), 'chick-web-'));
const saved = { webDist: env.webDist, secureCookies: env.secureCookies };
let app: Awaited<ReturnType<typeof buildApp>>['app'];

const put = (rel: string, body: string) => {
  const f = path.join(dist, rel); mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, body); writeFileSync(`${f}.gz`, gzipSync(body)); writeFileSync(`${f}.br`, brotliCompressSync(body));
};

beforeAll(async () => {
  put('index.html', '<!doctype html><title>chick</title>' + 'x'.repeat(2000));
  writeFileSync(path.join(dist, 'build.json'), JSON.stringify({ build: 'abc1234-deadbeef', notes: ['丟大便可以無限丟了', '下樓梯排行榜'] }));
  put('assets/index-abc123.js', 'console.log(1);'.repeat(200));
  env.webDist = dist; env.secureCookies = true;
  ({ app } = await buildApp(db, bus, { logger: false }));
});
afterAll(async () => {
  Object.assign(env, saved);
  await app.close(); await bus.stop(); await db.destroy();
  rmSync(dist, { recursive: true, force: true });
});

describe('security headers', () => {
  it('forbid framing (clickjacking) and MIME sniffing on API and page responses', async () => {
    for (const url of ['/api/status', '/', '/home/abc']) {
      const r = await app.inject({ url });
      expect(r.headers['x-frame-options'], url).toBe('DENY');
      expect(r.headers['content-security-policy'], url).toContain("frame-ancestors 'none'");
      expect(r.headers['x-content-type-options'], url).toBe('nosniff');
      expect(r.headers['strict-transport-security'], url).toMatch(/max-age=\d+/);
    }
  });
});

describe('static files', () => {
  it('serve hashed assets precompressed with a long immutable cache', async () => {
    const r = await app.inject({ url: '/assets/index-abc123.js', headers: { 'accept-encoding': 'gzip, br' } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-encoding']).toBe('br');
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const g = await app.inject({ url: '/assets/index-abc123.js', headers: { 'accept-encoding': 'gzip' } });
    expect(g.headers['content-encoding']).toBe('gzip');
  });
  it('always revalidate index.html (direct and SPA fallback) so a deploy shows up on reload', async () => {
    for (const url of ['/', '/home/abc']) {
      const r = await app.inject({ url, headers: { 'accept-encoding': 'br' } });
      expect(r.statusCode, url).toBe(200);
      expect(r.headers['content-type'], url).toMatch(/text\/html/);
      expect(r.headers['cache-control'], url).toBe('no-cache');
    }
  });
});

describe('client IP behind Cloud Run', () => {
  it('uses the address Google appended (rightmost X-Forwarded-For), so a forged header cannot dodge the rate limit', async () => {
    const hit = (forged: string, real: string) => app.inject({ url: '/api/status', remoteAddress: '169.254.1.1', headers: { 'x-forwarded-for': `${forged}, ${real}` } });
    let last = 0;
    for (let i = 0; i < 301; i++) last = (await hit(`10.0.${i >> 8}.${i & 255}`, '203.0.113.9')).statusCode;
    expect(last).toBe(429);
    expect((await hit('10.9.9.9', '198.51.100.7')).statusCode).toBe(200);
  });
});

describe('path id validation', () => {
  it('rejects a non-UUID :id with 400 before touching the database (no 500 / error log)', async () => {
    for (const url of ['/api/pets/not-a-uuid/events', '/api/homes/abc', '/api/admin/users/1/pets']) {
      const r = await app.inject({ url, remoteAddress: '192.0.2.1' });
      expect(r.statusCode, url).toBe(400);
      expect(r.json(), url).toEqual({ error: 'BAD_REQUEST' });
    }
  });
  it('lets a valid UUID through to the normal checks', async () => {
    const r = await app.inject({ url: '/api/pets/2b9f2a1e-6f1a-4a43-9a3e-0b6f1c2d3e4f/events', remoteAddress: '192.0.2.2' });
    expect(r.statusCode).not.toBe(400);
  });
});

describe('new-version notice (build id + release notes)', () => {
  it('/api/status returns the deployed build id and release notes from dist/build.json (no DB needed)', async () => {
    const r = await app.inject({ url: '/api/status' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ build: 'abc1234-deadbeef', notes: ['丟大便可以無限丟了', '下樓梯排行榜'] });
  });
  it('index.html (and the SPA fallback) is no-cache; hashed assets stay immutable', async () => {
    for (const url of ['/', '/index.html', '/home/abc']) expect((await app.inject({ url })).headers['cache-control'], url).toBe('no-cache');
    expect((await app.inject({ url: '/assets/index-abc123.js' })).headers['cache-control']).toContain('immutable');
  });
  it('readRelease: missing file → null build, no notes', async () => {
    const { readRelease } = await import('../src/app');
    expect(readRelease('/nonexistent')).toEqual({ build: null, notes: [] });
  });
  it('the repo release-notes.json is valid: 1–8 short Chinese lines, no version numbers', async () => {
    const { readFileSync } = await import('node:fs');
    const j = JSON.parse(readFileSync(path.resolve(__dirname, '../release-notes.json'), 'utf8'));
    expect(j.notes.length).toBeGreaterThan(0); expect(j.notes.length).toBeLessThanOrEqual(8);
    for (const n of j.notes) { expect(typeof n).toBe('string'); expect(n.length).toBeLessThan(60); expect(n).not.toMatch(/v\d+\.\d+/i); }
  });
});
