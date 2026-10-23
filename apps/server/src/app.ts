import { buyCar, buyPart, getProfile as getRaceProfile, raceCatalog, raceLeaderboard } from './racing';
import { buyOutfit, outfitCatalog, ownedOutfits, wearOutfit } from './outfits';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimitPlugin from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from './db';
import { env } from './env';
import { AppError, fail } from './errors';
import { authHook, COOKIE, createSession, destroySession, requireAdmin, verifyGoogle } from './auth';
import * as g from './game';
import { audit, rateLimit } from './core';
import { isUuid } from './util';
import { setupWs } from './ws';
import { buyItem, itemCatalog, listItems } from './items';
import { inFight } from './arena';
import type { Bus } from './bus';
import { clock } from './hours';
import { createDbGate, type DbGate } from './gate';
import { requireCronOidc, type IdTokenVerifier } from './cron-auth';

/** 前端建置時寫的 dist/build.json（build id＋更新說明）；本機開發沒有就是 null。 */
export function readRelease(dir: string): { build: string | null; notes: string[] } {
  try { const j = JSON.parse(readFileSync(path.join(dir, 'build.json'), 'utf8')); return { build: typeof j.build === 'string' ? j.build : null, notes: Array.isArray(j.notes) ? j.notes.map(String) : [] }; }
  catch { return { build: null, notes: [] }; }
}
export async function buildApp(db: Db, bus: Bus, opts: { logger?: boolean; gate?: DbGate; cronVerifier?: IdTokenVerifier; release?: { build: string | null; notes: string[] } } = {}) {
  const release = opts.release ?? readRelease(env.webDist || path.resolve(process.cwd(), '../web/dist'));
  const gate = opts.gate ?? createDbGate(db, bus);
  // Cloud Run（網域對應、沒有負載平衡器）：只信任緊鄰的那一層，req.ip = Google 附加在 X-Forwarded-For 最右邊的真實來源。
  // trustProxy: true 會取最左邊（客戶端自己填的）→ 可偽造 IP 繞過限流、汙染稽核紀錄。
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: (_addr: string, hop: number) => hop === 0, bodyLimit: 64 * 1024 });
  await app.register(cookie);
  await app.register(rateLimitPlugin, { global: true, max: 300, timeWindow: '1 minute', errorResponseBuilder: () => ({ statusCode: 429, error: 'RATE_LIMITED' }) });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  // 安全標頭：禁止被 iframe 嵌入（點擊劫持騙買道具）、禁止 MIME 猜測；正式環境（HTTPS）加 HSTS
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-frame-options', 'DENY');
    reply.header('content-security-policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    if (env.secureCookies) reply.header('strict-transport-security', 'max-age=15552000');
    return payload;
  });

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
    // ---- 開放時間與資料庫閘門（requirements §4.7）----
    // v1.6.2：目前部署的前端 build id（內部比對用）＋更新說明；前端發現不一致就提示「有新版本，請更新」
    api.get('/status', async () => { const now = Date.now(); return { ...clock().status(now), server_time: now, build: release.build, notes: release.notes }; });
    const NO_DB = new Set(['/api/status', '/api/config']);
    // 路徑上的 :id 都是 uuid 欄位：格式不對直接 400，不要丟給 Postgres 變成 500（還會寫 error log）
    api.addHook('onRequest', async (req, reply) => {
      const id = (req.params as { id?: unknown } | undefined)?.id;
      if (id !== undefined && !isUuid(id)) return reply.code(400).send({ error: 'BAD_REQUEST' });
    });
    api.addHook('onRequest', async (req, reply) => {
      const url = req.url.split('?')[0];
      if (NO_DB.has(url)) return;
      const now = Date.now();
      if (url !== '/api/internal/daily' && !clock().isOpen(now)) return reply.code(423).send({ error: 'GAME_CLOSED', opens_at: clock().status(now).opens_at });
      try { await gate.ensure(); } catch (e) { req.log.warn({ err: e }, 'database unavailable'); return reply.code(503).send({ error: 'DB_UNAVAILABLE' }); }
    });
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
      // ---- v1.5 道具 ----
      // ---- 賽車模式（零件用寵物金幣買、獎金直接發寵物金幣）----
      a.get('/race/profile', async (req) => ({ catalog: raceCatalog(), profile: await getRaceProfile(db, req.user!.id) }));
      a.post('/race/buy', async (req) => { const b = (req.body ?? {}) as any; return b.car !== undefined || b.paint !== undefined ? buyCar(db, ctx(req), b.car, b.paint) : buyPart(db, ctx(req), b.kind, b.tier); });
      a.get('/race/leaderboard/:track', async (req) => raceLeaderboard(db, (req.params as any).track));
      a.get('/leaderboard/stairs', async (req) => g.stairsLeaderboard(db, req.user!.id));
      a.get('/items', async (req) => ({ catalog: itemCatalog(), items: await listItems(db, req.user!.id) }));
      a.post('/items/buy', async (req) => { const b = (req.body ?? {}) as any; return buyItem(db, ctx(req), b.item_id, b.request_id, inFight); });
      // ---- v1.7 服飾（皇冠、墨鏡）----
      a.get('/outfits', async (req) => ({ catalog: outfitCatalog(), owned: await ownedOutfits(db, req.user!.id) }));
      a.post('/outfits/buy', async (req) => { const b = (req.body ?? {}) as any; return buyOutfit(db, ctx(req), b.outfit_id, b.request_id); });
      a.post('/outfits/wear', async (req) => { const b = (req.body ?? {}) as any; return wearOutfit(db, ctx(req), b.outfit_id, b.on, b.request_id); });
      // 本機開發（DEV_LOGIN=1）：讓自己的寵物馬上進化，方便測試
      if (env.devLogin) a.post('/dev/pets/:id/evolve', async (req) => g.forceEvolve(db, ctx(req), (req.params as any).id, (req.body as any)?.request_id, false));
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
        ad.post('/admin/pets/:id/evolve', async (req) => g.forceEvolve(db, ctx(req), (req.params as any).id, (req.body as any)?.request_id, true));
        ad.post('/admin/pets/:id/revive', async (req) => g.adminRevive(db, ctx(req), (req.params as any).id, (req.body as any)?.request_id));
      });
    });
    // ---- 排程（Cloud Scheduler）----
    // 以 Google OIDC ID token 驗證（Scheduler --oidc-service-account-email），見 cron-auth.ts
    api.post('/internal/daily', { preHandler: (req) => requireCronOidc(req, opts.cronVerifier) }, async () => {
      try { return await g.dailyMaintenance(db); }
      // 休息時段（20:05）跑完就停止 LISTEN：20:15 資料庫關機後不要一直重連
      finally { if (!clock().isOpen(Date.now())) await gate.release(); }
    });
  }, { prefix: '/api' });

  const hub = setupWs(app, db, bus, gate);

  // 靜態前端（正式環境單一容器）
  const webDist = env.webDist || path.resolve(process.cwd(), '../web/dist');
  if (existsSync(webDist)) {
    // 建置時已先壓好 .br/.gz（apps/web/scripts/compress.mjs）；/assets/ 檔名帶 hash → 長快取，其餘（index.html）每次重新驗證
    const assets = `${path.sep}assets${path.sep}`;
    await app.register(fastifyStatic, {
      root: webDist, wildcard: false, preCompressed: true, cacheControl: false,
      setHeaders: (res, file) => res.setHeader('cache-control', file.includes(assets) ? 'public, max-age=31536000, immutable' : 'no-cache'),
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
        // 離線賽車試玩：獨立 HTML，不走 SPA；關門／DB 停機也能開（靜態檔不經 API 閘門）
        const pathOnly = req.url.split('?')[0];
        if (pathOnly === '/race-demo' || pathOnly === '/race-demo/') return reply.sendFile('race-demo.html');
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'NOT_FOUND' });
    });
  }
  void rateLimit;
  return { app, hub, gate };
}
