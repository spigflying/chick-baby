import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TokenPayload } from 'google-auth-library';
import { ALWAYS_OPEN } from '@chick/engine';
import { createDb } from '../src/db';
import { migrateToLatest } from '../src/migrations';
import { buildApp } from '../src/app';
import { Bus } from '../src/bus';
import { setClock } from '../src/hours';
import type { IdTokenVerifier } from '../src/cron-auth';

const AUD = 'https://chick.test';
const SA = 'chick-scheduler@test.iam.gserviceaccount.com';
const good: TokenPayload = { iss: 'https://accounts.google.com', sub: '1', aud: AUD, email: SA, email_verified: true, iat: 0, exp: 0 };
// 假的 verifier：依 token 字串回傳不同 payload，模擬 OAuth2Client.verifyIdToken
const payloads: Record<string, TokenPayload> = {
  good, 'wrong-aud': { ...good, aud: 'https://evil.test' }, 'wrong-email': { ...good, email: 'someone@evil.test' },
  unverified: { ...good, email_verified: false },
};
const verifier = vi.fn<IdTokenVerifier>(async (token) => { const p = payloads[token]; if (!p) throw new Error('bad signature'); return p; });

const { db } = createDb();
const bus = new Bus(process.env.DATABASE_URL!);
let app: Awaited<ReturnType<typeof buildApp>>['app'];
beforeAll(async () => { await migrateToLatest(db as any); setClock(ALWAYS_OPEN); ({ app } = await buildApp(db, bus, { logger: false, cronVerifier: verifier })); });
afterAll(async () => { await app.close(); await bus.stop(); await db.destroy(); });

const daily = (authorization?: string) => app.inject({ method: 'POST', url: '/api/internal/daily', headers: authorization === undefined ? {} : { authorization } });

describe('cron endpoint Google OIDC auth', () => {
  it('accepts a valid Scheduler ID token and verifies against CRON_OIDC_AUDIENCE', async () => {
    verifier.mockClear();
    expect((await daily('Bearer good')).statusCode).toBe(200);
    expect(verifier).toHaveBeenCalledWith('good', AUD);
  });
  it('rejects a token for the wrong audience with 403', async () => {
    expect((await daily('Bearer wrong-aud')).statusCode).toBe(403);
  });
  it('rejects a token for the wrong service account with 403', async () => {
    expect((await daily('Bearer wrong-email')).statusCode).toBe(403);
  });
  it('rejects a token whose email is not verified with 403', async () => {
    expect((await daily('Bearer unverified')).statusCode).toBe(403);
  });
  it('rejects an invalid (unverifiable) token with 401', async () => {
    expect((await daily('Bearer forged')).statusCode).toBe(401);
  });
  it('rejects missing or malformed Authorization headers with 401 without calling the verifier', async () => {
    verifier.mockClear();
    for (const h of [undefined, '', 'good', 'Basic good', 'Bearer', 'Bearer ', 'Bearer a b']) expect((await daily(h)).statusCode).toBe(401);
    expect(verifier).not.toHaveBeenCalled();
  });
  it('no longer accepts the old shared-secret header', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/internal/daily', headers: { 'x-cron-secret': 'test-cron' } });
    expect(r.statusCode).toBe(401);
  });
});
