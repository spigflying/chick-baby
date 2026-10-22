/**
 * v27 賽車房（純狀態機，不碰網路／資料庫；racing.ts 負責傳送與開賽）。
 * 房主開房、選賽道與圈數；好友收到邀請後加入；每個人按「準備」；全員準備（且都在線）→ 3 秒倒數 → 開賽。
 * 任何變動（有人進出、改賽道／圈數、取消準備、斷線）都會取消倒數。
 */
export const ROOM_IDLE_MS = 10 * 60_000, ROOM_DROP_MS = 30_000, ROOM_COUNTDOWN_MS = 3000;
export interface RoomMember { user: string; name: string; ready: boolean; online: boolean; joinedAt: number; offAt: number | null }
export interface RaceRoom { id: string; inst: string; host: string; track: string; laps: number; members: RoomMember[]; createdAt: number; touchedAt: number; countdownAt: number | null; closed: string | null }

export function newRoom(id: string, inst: string, host: { user: string; name: string }, track: string, laps: number, now: number): RaceRoom {
  return { id, inst, host: host.user, track, laps, members: [{ user: host.user, name: host.name, ready: false, online: true, joinedAt: now, offAt: null }], createdAt: now, touchedAt: now, countdownAt: null, closed: null };
}
/** 全員準備且在線 → 開始倒數；否則取消 */
function recount(r: RaceRoom, now: number) {
  const go = r.members.length > 0 && r.members.every((m) => m.ready && m.online);
  r.countdownAt = go ? (r.countdownAt ?? now + ROOM_COUNTDOWN_MS) : null;
}
const touch = (r: RaceRoom, now: number) => { r.touchedAt = now; };
export function roomJoin(r: RaceRoom, who: { user: string; name: string }, now: number, max: number): string | null {
  if (r.closed) return 'ROOM_CLOSED';
  const m = r.members.find((x) => x.user === who.user);
  if (m) { m.online = true; m.offAt = null; touch(r, now); recount(r, now); return null; }
  if (r.members.length >= max) return 'ROOM_FULL';
  if (r.countdownAt !== null && now >= r.countdownAt - 500) return 'ROOM_STARTING';
  r.members.push({ user: who.user, name: who.name, ready: false, online: true, joinedAt: now, offAt: null });
  touch(r, now); recount(r, now); return null;
}
/** 離開：房主走了 → 交給最早加入、仍在線的人（沒有在線的就給最早加入的）；沒人了 → 關房 */
export function roomLeave(r: RaceRoom, user: string, now: number): void {
  const before = r.members.length; r.members = r.members.filter((m) => m.user !== user); if (r.members.length === before) return;
  if (!r.members.length) { r.closed = 'EMPTY'; r.countdownAt = null; return; }
  if (r.host === user) { const next = [...r.members].sort((a, b) => Number(b.online) - Number(a.online) || a.joinedAt - b.joinedAt)[0]; r.host = next.user; }
  touch(r, now); recount(r, now);
}
export function roomConfig(r: RaceRoom, user: string, track: string | null, laps: number | null, now: number): string | null {
  if (r.closed) return 'ROOM_CLOSED';
  if (user !== r.host) return 'NOT_HOST';
  let changed = false;
  if (track && track !== r.track) { r.track = track; changed = true; }
  if (laps && laps !== r.laps) { r.laps = laps; changed = true; }
  if (changed) for (const m of r.members) m.ready = false; // 條件變了：大家重新確認
  touch(r, now); recount(r, now); return null;
}
export function roomReady(r: RaceRoom, user: string, ready: boolean, now: number): string | null {
  const m = r.members.find((x) => x.user === user); if (!m) return 'NOT_IN_ROOM'; if (r.closed) return 'ROOM_CLOSED';
  m.ready = ready; touch(r, now); recount(r, now); return null;
}
/** 斷線：標成離線、取消準備；ROOM_DROP_MS 內回來（roomJoin）可以接回 */
export function roomDrop(r: RaceRoom, user: string, now: number) {
  const m = r.members.find((x) => x.user === user); if (!m || !m.online) return;
  m.online = false; m.offAt = now; m.ready = false; recount(r, now);
}
/** 每次迴圈：清掉斷線太久的人、閒置太久關房、倒數到了回傳 'start' */
export function roomTick(r: RaceRoom, now: number): 'start' | null {
  if (r.closed) return null;
  for (const m of [...r.members]) if (!m.online && m.offAt !== null && now - m.offAt > ROOM_DROP_MS) roomLeave(r, m.user, now);
  if (r.closed) return null;
  if (now - r.touchedAt > ROOM_IDLE_MS) { r.closed = 'EXPIRED'; r.countdownAt = null; return null; }
  return r.countdownAt !== null && now >= r.countdownAt ? 'start' : null;
}
/** 給客戶端的樣子 */
export function roomView(r: RaceRoom, now: number) {
  return { id: r.id, inst: r.inst, host: r.host, track: r.track, laps: r.laps, closed: r.closed, countdown_ms: r.countdownAt === null ? null : Math.max(0, r.countdownAt - now),
    expires_ms: Math.max(0, r.touchedAt + ROOM_IDLE_MS - now), members: r.members.map((m) => ({ user: m.user, name: m.name, ready: m.ready, online: m.online, host: m.user === r.host })) };
}
