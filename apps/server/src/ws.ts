import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { Db } from './db';
import { COOKIE, sessionUser } from './auth';
import { env } from './env';
import { AppError } from './errors';
import { canEnter, feed, getHome, ownerAction, viewHome } from './game';
import { rateLimit } from './core';
import { createSolo, currentTick, finish, handleInput, matches, type Match } from './stairs';
import { publicPet, rowToState } from './pets';
import type { Bus } from './bus';
import { publicUser } from './util';
import { phaseAt } from '@chick/engine';
import { clock } from './hours';
import type { DbGate } from './gate';

interface Conn { id: number; ws: WebSocket; user: { id: string; display_name: string; avatar_url: string | null }; homeId: string | null; connectedAt: number; match: Match | null; ip: string; ua: string }
const conns = new Set<Conn>();
// 在場名單：home → (instance:conn) → user；透過 NOTIFY 在所有執行個體間同步
const presence = new Map<string, Map<string, { id: string; display_name: string; avatar_url: string | null }>>();
let seq = 0;

function send(c: Conn, msg: unknown) { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); }
function inHome(homeId: string) { return [...conns].filter((c) => c.homeId === homeId); }
function broadcastPresence(homeId: string) {
  const users = [...(presence.get(homeId)?.values() ?? [])];
  const uniq = [...new Map(users.map((u) => [u.id, u])).values()];
  for (const c of inHome(homeId)) send(c, { type: 'home.presence', home_id: homeId, users: uniq });
}

export function setupWs(app: FastifyInstance, db: Db, bus: Bus, gate: DbGate) {
  bus.on(async (m) => {
    try {
      if (m.t === 'pet') {
        const targets = inHome(m.home); if (!targets.length) return;
        const row = await db.selectFrom('pets').selectAll().where('id', '=', m.pet).executeTakeFirst(); if (!row) return;
        for (const c of targets) send(c, { type: 'pet.updated', home_id: m.home, pet: publicPet(row, rowToState(row)), event: m.ev ?? null });
      } else if (m.t === 'wallet') {
        const targets = [...conns].filter((c) => c.user.id === m.user); if (!targets.length) return;
        const w = await db.selectFrom('wallets').select('balance').where('user_id', '=', m.user).executeTakeFirst();
        for (const c of targets) send(c, { type: 'wallet.updated', balance: w?.balance });
      } else if (m.t === 'access') {
        const home = await getHome(db, m.home); if (!home) return;
        for (const c of inHome(m.home)) if (!(await canEnter(db, home, c.user.id))) { leaveHome(c); send(c, { type: 'home.kicked', home_id: m.home }); }
      } else if (m.t === 'presence') {
        let map = presence.get(m.home); if (!map) presence.set(m.home, (map = new Map()));
        if (m.on) map.set(m.key, m.user); else map.delete(m.key);
        broadcastPresence(m.home);
      }
    } catch (e) { app.log.error(e); }
  });

  function leaveHome(c: Conn) {
    if (!c.homeId) return;
    const home = c.homeId; c.homeId = null;
    void bus.publish({ t: 'presence', home, key: `${env.instanceId}:${c.id}`, on: false });
  }

  app.get('/ws', { websocket: true }, async (socket, req) => {
    const now = Date.now();
    if (!clock().isOpen(now)) { socket.send(JSON.stringify({ type: 'error', code: 'GAME_CLOSED', opens_at: clock().status(now).opens_at })); socket.close(4423, 'closed'); return; }
    try { await gate.ensure(); } catch { socket.send(JSON.stringify({ type: 'error', code: 'DB_UNAVAILABLE' })); socket.close(1013, 'db unavailable'); return; }
    const origin = req.headers.origin;
    const host = req.headers.host;
    const okOrigin = !origin || env.publicOrigins.includes(origin) || origin === `http://${host}` || origin === `https://${host}`;
    const u = okOrigin ? await sessionUser(db, req.cookies[COOKIE]) : null;
    if (!u) { socket.send(JSON.stringify({ type: 'error', code: okOrigin ? 'UNAUTHORIZED' : 'FORBIDDEN' })); socket.close(4401); return; }
    const c: Conn = { id: ++seq, ws: socket, user: publicUser(u), homeId: null, connectedAt: Date.now(), match: null, ip: req.ip, ua: String(req.headers['user-agent'] ?? '') };
    conns.add(c);
    send(c, { type: 'hello', user: c.user, server_time: Date.now(), instance: env.instanceId });
    if (phaseAt(clock(), Date.now()) === 'closing') send(c, { type: 'game.closing', closes_at: clock().status(Date.now()).closes_at });
    socket.on('message', async (raw) => {
      let msg: any; try { msg = JSON.parse(String(raw)); } catch { return; }
      const isInput = msg?.type === 'match.input';
      if (!rateLimit(`ws:${c.id}:${isInput ? 'in' : 'other'}`, isInput ? 35 : 20, 1000)) {
        if (!isInput || Math.random() < 0.1) send(c, { type: 'error', code: 'RATE_LIMITED', request_id: msg?.request_id });
        return;
      }
      const ctx = { userId: c.user.id, ip: c.ip, ua: c.ua };
      try {
        switch (msg.type) {
          case 'time.ping': send(c, { type: 'time.pong', t0: msg.t0, server_time: Date.now(), server_tick: c.match ? currentTick(c.match) : null }); break;
          case 'home.join': {
            const view = await viewHome(db, String(msg.home_id), c.user.id);
            leaveHome(c); c.homeId = view.home.id;
            send(c, { type: 'home.state', ...view });
            await bus.publish({ t: 'presence', home: c.homeId, key: `${env.instanceId}:${c.id}`, on: true, user: c.user });
            break;
          }
          case 'home.leave': leaveHome(c); break;
          case 'pet.action': {
            const r = msg.action === 'feed' ? await feed(db, ctx, String(msg.pet_id), msg.food_id, msg.request_id)
              : await ownerAction(db, ctx, String(msg.pet_id), msg.action, msg.request_id);
            send(c, { type: 'action.result', request_id: msg.request_id, ...r });
            break;
          }
          case 'match.create': {
            if (c.match && !c.match.ended) throw new AppError('ALREADY_IN_MATCH');
            c.match = await createSolo(db, ctx, { userId: c.user.id, send: (m) => send(c, m) }, msg.request_id);
            break;
          }
          case 'match.input': {
            if (!c.match || c.match.ended) return;
            const r = handleInput(c.match, msg);
            if (r.error) send(c, { type: 'error', code: r.error });
            break;
          }
          case 'match.leave': if (c.match && !c.match.ended) await finish(c.match, 'quit'); break;
          default: send(c, { type: 'error', code: 'BAD_REQUEST', message: 'unknown type' });
        }
      } catch (e) {
        const code = e instanceof AppError ? e.code : 'INTERNAL';
        if (!(e instanceof AppError)) app.log.error(e);
        send(c, { type: 'error', code, request_id: msg?.request_id, for: msg?.type });
      }
    });
    socket.on('close', () => {
      leaveHome(c); conns.delete(c);
      if (c.match && !c.match.ended) void finish(c.match, 'quit');
    });
  });

  return {
    /** SIGTERM：請所有客戶端重連到其他執行個體 */
    drain() { for (const c of conns) { send(c, { type: 'server.draining' }); } for (const c of conns) c.ws.close(4000, 'draining'); },
    broadcast(msg: unknown) { for (const c of conns) send(c, msg); },
    /** 關門：送出最後一則訊息後關閉所有連線（客戶端不會自動重連）。 */
    closeAll(msg: unknown, code: number) { for (const c of conns) send(c, msg); for (const c of conns) c.ws.close(code, 'closed'); },
    count: () => conns.size,
  };
}
export { matches };
