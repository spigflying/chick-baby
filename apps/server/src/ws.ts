import { createPrivate, joinPrivate, joinRace, leaveRace, privateRoomOf, raceInput, startPrivate } from './racing';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { Db } from './db';
import { COOKIE, sessionUser } from './auth';
import { env } from './env';
import { AppError } from './errors';
import { canEnter, currentPet, feed, getHome, ownerAction, viewHome } from './game';
import { PresenceStore, petSummary, PRESENCE_REFRESH_MS, type PresenceUser } from './presence';
import { benchFighters, fightBusy, inFightAt, initArena, onArenaBus, onPresenceChange } from './arena';
import { initMStairs, onMStairsBus, onMStairsPresence, toAuthority } from './mstairs';
import { rateLimit } from './core';
import { createSolo, currentTick, finish, handleInput, matches, type Match } from './stairs';
import { publicPet, rowToState } from './pets';
import type { Bus } from './bus';
import { isUuid, publicUser } from './util';
import { phaseAt } from '@chick/engine';
import { clock } from './hours';
import type { DbGate } from './gate';

interface Conn { presenceUser?: PresenceUser; id: number; ws: WebSocket; user: { id: string; display_name: string; avatar_url: string | null }; homeId: string | null; connectedAt: number; match: Match | null; ip: string; ua: string;
  /** M2：這條連線正在玩的多人局（在哪個家、哪一局） */
  mm: { home: string; id: string } | null }
const conns = new Set<Conn>();
// 在場名單：home → (instance:conn) → user；透過 NOTIFY 在所有執行個體間同步
const presence = new PresenceStore();
let seq = 0;

function send(c: Conn, msg: unknown) { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); }
function inHome(homeId: string) { return [...conns].filter((c) => c.homeId === homeId); }
function broadcastPresence(homeId: string) {
  const users = presence.users(homeId);
  // v1.4：主人在別人家（而且沒有分頁在自己家）→ 寵物跟著主人外出，自己家顯示「主人外出中」（不透露在誰家）
  const owner_away = presence.ownerAway(homeId);
  for (const c of inHome(homeId)) send(c, { type: 'home.presence', home_id: homeId, users, owner_away });
}
/** 某人的位置變了：除了那個家，也重送他自己家的狀態（外出中／回來了）。 */
function presenceChanged(homes: string[], userIds: string[]) {
  const all = new Set(homes);
  for (const u of userIds) { const h = presence.homeOf(u); if (h) all.add(h); }
  for (const h of all) { broadcastPresence(h); onPresenceChange(h); onMStairsPresence(h); }
}
/** WS 連線的期限（Cloud Run 60 分鐘）：比賽要在那之前時間到。 */
const connDeadline = (c: Conn) => c.connectedAt + 58 * 60_000;
/** M2 多人下樓梯：負責的執行個體送出的訊息 → 轉給這個執行個體上的連線。 */
function forwardMStairs(m: any) {
  const { t, home, ...rest } = m;
  if (t === 'mstairs.event') for (const c of inHome(home)) send(c, { type: 'stairs.event', home_id: home, ...rest });
  else if (t === 'mstairs.notice') { for (const c of inHome(home)) if (c.user.id === m.user) send(c, { type: 'stairs.notice', home_id: home, code: m.code }); }
  else if (t === 'mstairs.started') {
    const ids = new Set((m.players as { user_id: string }[]).map((p) => p.user_id));
    for (const c of inHome(home)) if (ids.has(c.user.id) && !(c.match && !c.match.ended)) { c.mm = { home, id: m.match_id }; send(c, { type: 'match.started', mode: 'multi', home_id: home, ...rest }); }
  } else if (t === 'mstairs.snap') {
    for (const c of conns) if (c.mm?.id === m.match_id) send(c, { type: 'match.snapshot', mode: 'multi', match_id: m.match_id, tick: m.tick, state: m.state, last_processed_seq: m.seqs?.[c.user.id] ?? 0, late: m.late?.[c.user.id] ?? 0 });
  } else if (t === 'mstairs.ended') {
    for (const c of conns) if (c.mm?.id === m.match_id) { c.mm = null; send(c, { type: 'match.ended', mode: 'multi', home_id: home, ...rest, me: (m.players ?? []).find((p: any) => p.user_id === c.user.id) ?? null }); }
  }
}

export function setupWs(app: FastifyInstance, db: Db, bus: Bus, gate: DbGate) {
  initArena({ db, bus, presence });
  initMStairs({ db, bus, presence, local: forwardMStairs, inFight: inFightAt, fightBusy, bench: benchFighters });
  bus.on(async (m) => {
    try {
      if (typeof m.t === 'string' && m.t.startsWith('mstairs.')) { onMStairsBus(m); forwardMStairs(m); return; }
      if (typeof m.t === 'string' && m.t.startsWith('arena.')) {
        onArenaBus(m);
        const { t, home, ...rest } = m;
        if (t === 'arena.notice') { for (const c of inHome(home)) if (c.user.id === m.user) send(c, { type: t, home_id: home, code: m.code }); }
        else if (t === 'arena.state' || t === 'arena.event' || t === 'arena.result') for (const c of inHome(home)) send(c, { type: t, home_id: home, ...rest });
        return;
      }
      if (m.t === 'pet') {
        onArenaBus(m); // 丟大便的彈藥（地上的便便數）
        const targets = inHome(m.home); const visiting = presence.hasPet(m.pet);
        if (!targets.length && !visiting) return;
        const row = await db.selectFrom('pets').selectAll().where('id', '=', m.pet).executeTakeFirst(); if (!row) return;
        const pub = publicPet(row, rowToState(row));
        for (const c of targets) send(c, { type: 'pet.updated', home_id: m.home, pet: pub, event: m.ev ?? null });
        // 這隻寵物的主人正在拜訪別人家：同步更新那些家的在場寵物（每個執行個體都收到同一則 NOTIFY，結果一致）
        const sum = petSummary(pub);
        for (const c of conns) if (c.presenceUser && c.presenceUser.pet?.id === m.pet) c.presenceUser = { ...c.presenceUser, pet: sum }; // 心跳也帶最新的寵物
        if (visiting) for (const h of presence.updatePet(m.pet, sum)) { broadcastPresence(h); onPresenceChange(h); }
      } else if (m.t === 'wallet') {
        const targets = [...conns].filter((c) => c.user.id === m.user); if (!targets.length) return;
        const w = await db.selectFrom('wallets').select('balance').where('user_id', '=', m.user).executeTakeFirst();
        for (const c of targets) send(c, { type: 'wallet.updated', balance: w?.balance });
      } else if (m.t === 'access') {
        const home = await getHome(db, m.home); if (!home) return;
        for (const c of inHome(m.home)) if (!(await canEnter(db, home, c.user.id))) { leaveHome(c); send(c, { type: 'home.kicked', home_id: m.home }); }
      } else if (m.t === 'presence') {
        if (m.owner) presence.setOwner(m.home, m.owner);
        const uid = m.user?.id ?? m.uid;
        if (m.refresh) { if (presence.touch(m.home, m.key, m.user)) presenceChanged([m.home], [uid]); }
        else { presence.set(m.home, m.key, m.on ? m.user : null); presenceChanged([m.home], uid ? [uid] : []); }
      }
    } catch (e) { app.log.error(e); }
  });

  function leaveHome(c: Conn) {
    if (!c.homeId) return;
    const home = c.homeId; c.homeId = null; c.presenceUser = undefined;
    void bus.publish({ t: 'presence', home, key: `${env.instanceId}:${c.id}`, on: false, uid: c.user.id });
  }

  // 在場心跳：每 30 秒重送自己這個執行個體的連線（新啟動的執行個體因此也會知道）；
  // 75 秒沒刷新的連線視為已離開（執行個體當掉或 SIGTERM 時 NOTIFY 沒送出）。
  const hb = setInterval(() => {
    for (const c of conns) if (c.homeId && c.presenceUser) {
      const home = presence.ownerOf(c.homeId);
      void bus.publish({ t: 'presence', home: c.homeId, owner: home ?? undefined, key: `${env.instanceId}:${c.id}`, on: true, refresh: true, user: c.presenceUser }).catch(() => {});
    }
  }, PRESENCE_REFRESH_MS);
  hb.unref();
  const sweep = setInterval(() => { const hit = presence.sweep(); if (hit.length) presenceChanged([...hit, ...new Set([...conns].map((c) => c.homeId).filter((h): h is string => !!h))], []); }, 15_000);
  sweep.unref();
  app.addHook('onClose', async () => { clearInterval(hb); clearInterval(sweep); });

  app.get('/ws', { websocket: true }, async (socket, req) => {
    const now = Date.now();
    if (!clock().isOpen(now)) { socket.send(JSON.stringify({ type: 'error', code: 'GAME_CLOSED', opens_at: clock().status(now).opens_at })); socket.close(4423, 'closed'); return; }
    try { await gate.ensure(); } catch { socket.send(JSON.stringify({ type: 'error', code: 'DB_UNAVAILABLE' })); socket.close(1013, 'db unavailable'); return; }
    const origin = req.headers.origin;
    const host = req.headers.host;
    const okOrigin = !origin || env.publicOrigins.includes(origin) || origin === `http://${host}` || origin === `https://${host}`;
    const u = okOrigin ? await sessionUser(db, req.cookies[COOKIE]) : null;
    if (!u) { socket.send(JSON.stringify({ type: 'error', code: okOrigin ? 'UNAUTHORIZED' : 'FORBIDDEN' })); socket.close(4401); return; }
    const c: Conn = { id: ++seq, ws: socket, user: publicUser(u), homeId: null, connectedAt: Date.now(), match: null, ip: req.ip, ua: String(req.headers['user-agent'] ?? ''), mm: null };
    conns.add(c);
    send(c, { type: 'hello', user: c.user, server_time: Date.now(), instance: env.instanceId });
    if (phaseAt(clock(), Date.now()) === 'closing') send(c, { type: 'game.closing', closes_at: clock().status(Date.now()).closes_at });
    socket.on('message', async (raw) => {
      let msg: any; try { msg = JSON.parse(String(raw)); } catch { return; }
      const isInput = msg?.type === 'match.input' || msg?.type === 'arena.input' || msg?.type === 'race.input';
      if (!rateLimit(`ws:${c.id}:${isInput ? 'in' : 'other'}`, isInput ? 35 : 20, 1000)) {
        if (!isInput || Math.random() < 0.1) send(c, { type: 'error', code: 'RATE_LIMITED', request_id: msg?.request_id });
        return;
      }
      const ctx = { userId: c.user.id, ip: c.ip, ua: c.ua };
      try {
        switch (msg.type) {
          case 'time.ping': send(c, { type: 'time.pong', t0: msg.t0, server_time: Date.now(), server_tick: c.match ? currentTick(c.match) : null }); break;
          case 'home.join': {
            if (!isUuid(msg.home_id)) throw new AppError('BAD_REQUEST');
            const view = await viewHome(db, String(msg.home_id), c.user.id);
            if (c.mm && c.mm.home !== view.home.id) { toAuthority({ t: 'mstairs.leave', home: c.mm.home, user: c.user.id }); c.mm = null; } // 換到別的家＝出局
            leaveHome(c); c.homeId = view.home.id;
            send(c, { type: 'home.state', ...view });
            const pet = petSummary(view.home.is_owner ? view.pet : await currentPet(db, c.user.id));
            presence.setOwner(view.home.id, view.home.owner.id);
            c.presenceUser = { ...c.user, pet };
            await bus.publish({ t: 'presence', home: c.homeId, owner: view.home.owner.id, key: `${env.instanceId}:${c.id}`, on: true, user: c.presenceUser });
            break;
          }
          case 'home.leave': leaveHome(c); break;
          // v1.4 打架模式：意圖一律經過 NOTIFY 交給負責這個家的執行個體
          case 'arena.invite': {
            if (!c.homeId) throw new AppError('NOT_IN_HOME');
            await bus.publish({ t: 'arena.invite', home: c.homeId, user: c.user.id });
            break;
          }
          case 'arena.reply': {
            if (!c.homeId || typeof msg.invite !== 'string' || msg.invite.length > 40) return;
            await bus.publish({ t: 'arena.reply', home: c.homeId, user: c.user.id, invite: msg.invite, accept: !!msg.accept });
            break;
          }
          case 'arena.join': case 'arena.leave': {
            if (!c.homeId) throw new AppError('NOT_IN_HOME');
            await bus.publish({ t: msg.type, home: c.homeId, user: c.user.id });
            break;
          }
          case 'arena.input': {
            if (!c.homeId) return;
            await bus.publish({ t: 'arena.in', home: c.homeId, user: c.user.id, left: !!msg.left, right: !!msg.right, jump: !!msg.jump, attack: !!msg.attack, upAtk: !!msg.upAtk, item: !!msg.item, equip: typeof msg.equip === 'string' ? msg.equip.slice(0, 10) : null });
            break;
          }
          case 'pet.action': {
            if (!isUuid(msg.pet_id)) throw new AppError('BAD_REQUEST');
            const r = msg.action === 'feed' ? await feed(db, ctx, String(msg.pet_id), msg.food_id, msg.request_id)
              : await ownerAction(db, ctx, String(msg.pet_id), msg.action, msg.request_id);
            send(c, { type: 'action.result', request_id: msg.request_id, ...r });
            break;
          }
          case 'match.create': {
            if ((c.match && !c.match.ended) || c.mm) throw new AppError('ALREADY_IN_MATCH');
            c.match = await createSolo(db, ctx, { userId: c.user.id, send: (m) => send(c, m) }, msg.request_id, connDeadline(c));
            break;
          }
          case 'match.input': {
            if (c.mm) { toAuthority({ t: 'mstairs.in', home: c.mm.home, user: c.user.id, seq: msg.seq, tick: msg.tick, left: !!msg.left, right: !!msg.right }); return; }
            if (!c.match || c.match.ended) return;
            const r = handleInput(c.match, msg);
            if (r.error) send(c, { type: 'error', code: r.error });
            break;
          }
          case 'match.leave':
            if (c.mm) toAuthority({ t: 'mstairs.leave', home: c.mm.home, user: c.user.id });
            else if (c.match && !c.match.ended) await finish(c.match, 'quit');
            break;
          // M2 多人下樓梯：意圖交給負責這個家的執行個體
          case 'stairs.invite': case 'stairs.reply': case 'stairs.cancel': {
            if (!c.homeId) throw new AppError('NOT_IN_HOME');
            if ((c.match && !c.match.ended) || c.mm) throw new AppError('ALREADY_IN_MATCH');
            toAuthority({ t: `mstairs.${msg.type.slice(7)}`, home: c.homeId, user: c.user.id, invite: typeof msg.invite === 'string' ? msg.invite.slice(0, 40) : null, accept: !!msg.accept, deadline: connDeadline(c) });
            break;
          }
          // ---- 賽車模式 ----
          case 'race.join': case 'race.create': {
            if ((c.match && !c.match.ended) || c.mm) throw new AppError('ALREADY_IN_MATCH');
            const rc = { userId: c.user.id, name: String((c.user as any).display_name ?? '玩家').slice(0, 12), send: (m: unknown) => send(c, m) };
            if (msg.type === 'race.create') { const code = await createPrivate(db, rc, msg.track); send(c, { type: 'race.room', code }); }
            else if (msg.code) await joinPrivate(db, rc, msg.code);
            else await joinRace(db, rc, msg.track);
            break;
          }
          case 'race.start': startPrivate(c.user.id); break;
          case 'race.invite': { // 用分享碼邀請朋友進自己的私人房（對方要在線上、同一個執行個體）
            const room = privateRoomOf(c.user.id); if (!room) throw new AppError('ROOM_NOT_FOUND');
            const to = await (db as any).selectFrom('users').select('id').where('share_code', '=', String(msg.share_code ?? '').toUpperCase().slice(0, 16)).executeTakeFirst();
            if (!to) throw new AppError('NOT_FOUND');
            let n = 0; for (const o of conns) if (o.user.id === to.id) { send(o, { type: 'race.invited', from: (c.user as any).display_name, code: room.code, track: room.track }); n++; }
            send(c, { type: 'race.invite_sent', online: n > 0 });
            break;
          }
          case 'race.input': raceInput(c.user.id, msg); break;
          case 'race.leave': leaveRace(c.user.id); break;
          default: send(c, { type: 'error', code: 'BAD_REQUEST', message: 'unknown type' });
        }
      } catch (e) {
        const code = e instanceof AppError ? e.code : 'INTERNAL';
        if (!(e instanceof AppError)) app.log.error(e);
        send(c, { type: 'error', code, request_id: msg?.request_id, for: msg?.type });
      }
    });
    socket.on('close', () => {
      if (c.mm) toAuthority({ t: 'mstairs.leave', home: c.mm.home, user: c.user.id });
      leaveRace(c.user.id);
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
