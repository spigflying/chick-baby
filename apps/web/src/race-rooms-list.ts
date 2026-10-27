/** 好友的房間（賽車選單）：每台執行個體各回一份 room.list，用 inst 合併 */
export interface FriendRoom { room: string; inst: string; game: string; host: string; host_name: string; track: string; laps: number; members: number; max: number }
export type RoomLists = Map<string, FriendRoom[]>;
export function mergeRoomList(lists: RoomLists, inst: unknown, rooms: unknown): FriendRoom[] {
  if (typeof inst === 'string') lists.set(inst, Array.isArray(rooms) ? (rooms as FriendRoom[]).filter((r) => r && typeof r.room === 'string') : []);
  return [...lists.values()].flat();
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export function friendRoomsHtml(rooms: FriendRoom[], trackLabel: (id: string) => string, loading = false): string {
  const items = rooms.map((r) => `<li class="room-friend"><span><b>${esc(r.host_name)}</b> 的房間<br><span class="muted">${esc(trackLabel(r.track))}・${Number(r.laps) || 0} 圈・${r.members}/${r.max} 人</span></span><button data-rjoin="${esc(r.room)}" data-rinst="${esc(r.inst)}">加入</button></li>`).join('');
  return `<h3>好友的房間 <button id="rrefresh" class="room-refresh">重新整理</button></h3>` +
    (items ? `<ul class="room-friends">${items}</ul>` : `<p class="muted">${loading ? '查詢中…' : '目前沒有好友開著的房間。好友開房時你會收到邀請。'}</p>`);
}
