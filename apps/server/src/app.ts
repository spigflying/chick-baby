import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimitPlugin from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Db } from './db';
import { env } from './env';
import { AppError, fail } from './errors';
import { authHook, COOKIE, createSession, destroySession, requireAdmin, verifyGoogle } from './auth';
import * as g from './game';
import { audit, rateLimit } from './core';
import { setupWs } from './ws';
import type { Bus } from './bus';

export async function buildApp(db: Db, bus: Bus, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true, bodyLimit: 64 * 1024 });
  await app.register(cookie);
  await app.register(rateLimitPlugin, { global: true, max: 300, timeWindow: '1 minute', errorResponseBuilder: () => ({ statusCode: 429, error: 'RATE_LIMITED' }) });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message !== err.code ? err.message : undefined });
    if ((err as any).statusCode === 429) { void audit(db, { userId: req.user?.id, ip: req.ip }, 'rate_limited', 'error:RATE_LIMITED', { detail: { url: req.url } }).catch(() => {}); return reply.status(429).send({ error: 'RATE_LIMITED' }); }
    req.log.error(err);
    return reply.status((err as any).statusCode ?? 500).send({ error: 'INTERNAL' });
  });

  const ctx = (req: FastifyRequest) => ({ userId: req.user!.id, ip: req.ip, ua: String(req.headers['user-agent'] ?? '') });
  const auth = authHook(db);

  app.get('/healthz', async () => ({ ok: true, instance: env.instanceId }));

  await app.register(async (api) => {
    // ---- 登入 ----
    api.post('/auth/google', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const { credential } = (req.body ?? {}) as any;
      if (typeof credential !== 'string') fail('BAD_REQUEST');
      const p = await verifyGoogle(credential);
      const user = await g.ensureUser(db, p);
      await createSession(db, user.id, reply);
      await audit(db, { userId: user.id, ip: req.ip, ua: String(req.headers['user-agent'] ?? '') }, 'auth.google', 'ok');
      return { ok: true };
    });
    if (env.devLogin) {
      // 只在 DEV_LOGIN=1 時存在：本機開發用，免 Google
      api.post('/auth/dev', async (req, reply) => {
        const { name } = (req.body ?? {}) as any;
        if (typeof name !== 'string' || !/^[\w\u4e00-\u9fff-]{1,20}$/.test(name)) fail('BAD_REQUEST');
        const user = await g.ensureUser(db, { sub: `dev:${name}`, email: `${name}@dev.local`, name, avatar: null });
        await createSession(db, user.id, reply);
        await audit(db, { userId: user.id, ip: req.ip }, 'auth.dev', 'ok');
        return { ok: true };
      });
    }
    api.post('/auth/logout', async (req, reply) => { await destroySession(db, req.cookies[COOKIE]); reply.clearCookie(COOKIE, { path: '/' }); return { ok: true }; });
    api.get('/config', async () => g.publicConfig());

    // ---- 需要登入 ----
    await api.register(async (a) => {
      a.addHook('preHandler', auth);
      a.get('/me', async (req) => g.getMe(db, req.user!.id));
      a.patch('/me', async (req) => {
        const { display_name, request_id } = (req.body ?? {}) as any;
        if (typeof display_name !== 'string' || !display_name.trim() || display_name.length > 20) fail('BAD_REQUEST');
        const { runAction } = await import('./core');
        return runAction(db, ctx(req), 'me.update', request_id, { display_name }, async (tx) => {
          await tx.updateTable('users').set({ display_name: display_name.trim() }).where('id', '=', req.user!.id).execute();
          return { ok: true, display_name: display_name.trim() };
        });
      });
      a.post('/me/share-code/rotate', async (req) => g.rotateShareCode(db, ctx(req), (req.body as any)?.request_id));
      a.get('/homes/by-code/:code', async (req) => g.homeByCode(db, (req.params as any).code, req.user!.id));
      a.get('/homes/recent', async (req) => g.recentHomes(db, req.user!.id));
      a.get('/homes/invited', async (req) => g.invitedHomes(db, req.user!.id));
      a.get('/homes/:id', async (req) => g.viewHome(db, (req.params as any).id, req.user!.id));
      a.patch('/homes/:id', async (req) => { const b = (req.body ?? {}) as any; return g.setAccessMode(db, ctx(req), (req.params as any).id, b.access_mode, b.name, b.request_id); });
      a.get('/homes/:id/lists', async (req) => g.homeLists(db, (req.params as any).id, req.user!.id));
      for (const [route, table] of [['invites', 'home_invites'], ['blacklist', 'home_blacklist']] as const) {
        a.post(`/homes/:id/${route}`, async (req) => g.editList(db, ctx(req), (req.params as any).id, table, 'add', req.body));
        a.delete(`/homes/:id/${route}`, async (req) => g.editList(db, ctx(req), (req.params as any).id, table, 'remove', req.body));
      }
      a.get('/homes/:id/visitors', async (req) => g.homeVisitors(db, (req.params as any).id, req.user!.id));
      a.post('/pets', async (req) => g.hatch(db, ctx(req), req.body));
      a.post('/pets/:id/actions', async (req) => {
        const b = (req.body ?? {}) as any; const id = (req.params as any).id;
        return b.action === 'feed' ? g.feed(db, ctx(req), id, b.food_id, b.request_id) : g.ownerAction(db, ctx(req), id, b.action, b.request_id);
      });
      a.get('/pets/:id/events', async (req) => g.petEvents(db, (req.params as any).id, req.user!.id));
      a.get('/users/me/pets', async (req) => g.myPets(db, req.user!.id));
      // ---- 管理員 ----
      await a.register(async (ad) => {
        ad.addHook('preHandler', requireAdmin);
        ad.get('/admin/users', async () => g.adminUsers(db));
        ad.get('/admin/users/:id/pets', async (req) => g.adminUserPets(db, (req.params as any).id));
        ad.post('/admin/pets/:id/revive', async (req) => g.adminRevive(db, ctx(req), (req.params as any).id, (req.body as any)?.request_id));
      });
    });
    // ---- 排程（Cloud Scheduler）----
    api.post('/internal/daily', async (req) => {
      if (!env.cronSecret || req.headers['x-cron-secret'] !== env.cronSecret) fail('FORBIDDEN');
      return g.dailyMaintenance(db);
    });
  }, { prefix: '/api' });

  const hub = setupWs(app, db, bus);

  // 靜態前端（正式環境單一容器）
  const webDist = env.webDist || path.resolve(process.cwd(), '../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: 'NOT_FOUND' });
    });
  }
  void rateLimit;
  return { app, hub };
}
