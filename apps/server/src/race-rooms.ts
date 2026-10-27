/**
 * v27 賽車房（純狀態機，不碰網路／資料庫；racing.ts 負責傳送與開賽）。
 * 房主開房、選賽道與圈數；好友收到邀請後加入；每個人按「準備」；全員準備（且都在線）→ 3 秒倒數 → 開賽。
 * 任何變動（有人進出、改賽道／圈數、取消準備、斷線）都會取消倒數；但「準備」只要按一次，除非自己取消，不會被重置。
 * 賽車房開賽後房間留著（下樓梯房仍是開賽即關）：參賽者標成 away（比賽中／看結果），每個人自己按「回到房間」才回到大廳，
 * 回來時準備是空的；只要還有人 away，就不會開始倒數。結果出來後 ROOM_AWAY_MS 還沒回來的人移出房間。
 */
export const ROOM_IDLE_MS = 10 * 60_000, ROOM_DROP_MS = 30_000, ROOM_COUNTDOWN_MS = 3000;
/** 賽完沒按「回到房間」：結果出來後這麼久就移出房間（房間不會被不在的人卡住） */
export const ROOM_AWAY_MS = 3 * 60_000;
export interface RoomMember { user: string; name: string; ready: boolean; online: boolean; joinedAt: number; offAt: number | null;
  /** 在比賽裡／結果畫面，還沒按「回到房間」 */ away?: boolean; /** 比賽結束（結果出來）的時間；null＝比賽還在跑 */ awayAt?: number | null }
export type RoomGame = 'race' | 'stairs';
export interface RaceRoom { id: string; inst: string; game: RoomGame; /** 開跑最少人數（賽車 1、下樓梯 2） */ min: number; host: string; track: string; laps: number; members: RoomMember[]; createdAt: number; touchedAt: number; countdownAt: number | null; closed: string | null; /** 正在跑的那場比賽 id（房間留著） */ raceId?: string | null }

export function newRoom(id: string, inst: string, host: { user: string; name: string }, track: string, laps: number, now: number, game: RoomGame = 'race', min = 1): RaceRoom {
  return { id, inst, game, min, host: host.user, track, laps, members: [{ user: host.user, name: host.name, ready: false, online: true, joinedAt: now, offAt: null }], createdAt: now, touchedAt: now, countdownAt: null, closed: null };
}
/** 全員準備且在線 → 開始倒數；否則取消 */
function recount(r: RaceRoom, now: number) {
  const go = r.members.length >= Math.max(1, r.min) && r.members.every((m) => m.ready && m.online && !m.away);
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
  if (changed) r.countdownAt = null; // 條件變了：保留大家的準備，但倒數重新從 3 秒算，讓大家看得到新條件
  touch(r, now); recount(r, now); return null;
}
export function roomReady(r: RaceRoom, user: string, ready: boolean, now: number): string | null {
  const m = r.members.find((x) => x.user === user); if (!m) return 'NOT_IN_ROOM'; if (r.closed) return 'ROOM_CLOSED';
  if (m.away) { if (r.raceId && m.awayAt == null) return 'ALREADY_IN_MATCH'; m.away = false; m.awayAt = null; } // 結果畫面直接按準備＝回到房間
  m.ready = ready; touch(r, now); recount(r, now); return null;
}
/** 房間開賽：參賽者標成 away、全員準備清空、倒數取消（房間不關） */
export function roomRaceStart(r: RaceRoom, raceId: string, users: string[], now: number) {
  r.raceId = raceId; r.countdownAt = null;
  for (const m of r.members) { m.ready = false; if (users.includes(m.user)) { m.away = true; m.awayAt = null; } }
  touch(r, now);
}
/** 比賽結束（或中止／開不成）：還沒回來的人開始算 ROOM_AWAY_MS */
export function roomRaceEnd(r: RaceRoom, raceId: string | null, now: number) {
  if (raceId !== null && r.raceId !== raceId) return;
  r.raceId = null; for (const m of r.members) if (m.away && m.awayAt == null) m.awayAt = now;
  touch(r, now); recount(r, now);
}
/** 自己按「回到房間」：回到大廳，準備是空的（要再按一次準備） */
export function roomBack(r: RaceRoom, user: string, now: number): string | null {
  const m = r.members.find((x) => x.user === user); if (!m) return 'NOT_IN_ROOM'; if (r.closed) return 'ROOM_CLOSED';
  if (m.away && r.raceId && m.awayAt == null) return 'ALREADY_IN_MATCH';
  m.away = false; m.awayAt = null; m.ready = false; touch(r, now); recount(r, now); return null;
}
/** 斷線：標成離線（保留準備）；ROOM_DROP_MS 內回來（roomJoin）可以接回 */
export function roomDrop(r: RaceRoom, user: string, now: number) {
  const m = r.members.find((x) => x.user === user); if (!m || !m.online) return;
  m.online = false; m.offAt = now; recount(r, now); // 準備保留：短暫斷線回來不用再按一次（離線時不會開跑）
}
/** 每次迴圈：清掉斷線太久的人、閒置太久關房、倒數到了回傳 'start' */
export function roomTick(r: RaceRoom, now: number): 'start' | null {
  if (r.closed) return null;
  for (const m of [...r.members]) if ((!m.online && m.offAt !== null && now - m.offAt > ROOM_DROP_MS) || (m.away && m.awayAt != null && now - m.awayAt > ROOM_AWAY_MS)) roomLeave(r, m.user, now);
  if (r.closed) return null;
  if (r.raceId) return null; // 比賽進行中：不算閒置、不開跑
  if (now - r.touchedAt > ROOM_IDLE_MS) { r.closed = 'EXPIRED'; r.countdownAt = null; return null; }
  return r.countdownAt !== null && now >= r.countdownAt ? 'start' : null;
}
/** 給客戶端的樣子 */
export function roomView(r: RaceRoom, now: number) {
  return { id: r.id, inst: r.inst, game: r.game, min: r.min, host: r.host, track: r.track, laps: r.laps, closed: r.closed, countdown_ms: r.countdownAt === null ? null : Math.max(0, r.countdownAt - now),
    expires_ms: Math.max(0, r.touchedAt + ROOM_IDLE_MS - now), members: r.members.map((m) => ({ user: m.user, name: m.name, ready: m.ready, online: m.online, host: m.user === r.host, away: !!m.away })), racing: !!r.raceId };
}
