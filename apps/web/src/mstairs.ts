import { coinHtml } from './sprites';
// M2 多人下樓梯（以家為單位）：邀請視窗、提示文字、結算畫面、其他寵物的插值。
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const STAIRS_NOTICE: Record<string, string> = {
  STAIRS_BUSY: '已經有人發起或正在一起下樓梯',
  FIGHT_BUSY: '有人在打架，等一下再一起下樓梯',
  IN_FIGHT: '對戰中不能下樓梯',
  NOT_ELIGIBLE: '寵物要醒著才能下樓梯',
  NO_OPPONENT: '這裡沒有可以一起玩的寵物',
  NOT_ENOUGH_PLAYERS: '參加的不到 2 隻，取消',
  MATCH_FULL: '已經 6 隻了，下次早點按',
  CANCELLED: '一起下樓梯取消了',
  GAME_CLOSING: '快關門了，不能開新局',
  GAME_CLOSED: '休息時間，不能下樓梯',
  TOO_TIRED: '太累了，想睡覺…（精力不到 15）',
  PET_SLEEPING: '噓…牠在睡覺',
  PET_EGG: '蛋蛋還在孵化中…',
  PET_DEAD: '寵物去當小天使了…',
  NO_PET: '沒有寵物不能下樓梯',
  ALREADY_IN_MATCH: '已經在遊戲中',
  INTERNAL: '伺服器出錯了，稍後再試',
};
export const stairsNotice = (code: string) => STAIRS_NOTICE[code] ?? code;

export interface StairsInvite { id: string; from: string; from_name: string; to: string[]; until: number; answered: boolean; count: number }
export function inviteHtml(v: StairsInvite, now: number): string {
  const s = Math.max(0, Math.ceil((v.until - now) / 1000));
  return `<div class="it">${esc(v.from_name)} 邀大家一起下樓梯！</div><div class="ib"><button data-sacc="1">參加</button><button data-sacc="0">不要</button></div><div class="ic">${s} 秒後自動不參加</div>`;
}

/** 名次的中文說法。 */
export const rankText = (r: number) => `第 ${r} 名`;
/** 名字是「寵物名（暱稱）」，結算畫面很窄，只留寵物名。 */
const petOnly = (n: string) => n.split('（')[0];
const causeText = (p: MultiResultRow) => p.cause === 'left' ? '離開' : p.cause === 'hp' ? '沒血了' : p.cause === 'fell' ? '掉下去' : '';
export interface MultiResultRow { user_id: string; name: string; num: number; rank: number; floor: number; coins: number; cause: string | null }
/** 多人局結算畫面：所有人的名次、樓層、怎麼出局，加上自己拿到的金幣（餘額由上方列的 wallet.updated 更新，這裡不顯示，避免先顯示舊值）。 */
export function multiResultHtml(r: { aborted?: boolean; error?: string; time_up?: boolean; closing?: boolean; players: MultiResultRow[]; me: MultiResultRow | null }): string {
  if (r.aborted || r.error) return `<div class="mt">— 遊戲中止 —</div><p>${r.error ? '結算失敗，這場不計分。' : '伺服器維護中，這場不計分。'}</p><div class="mi back on">✕ 離開</div>`;
  const head = r.time_up ? (r.closing ? '— 快關門了，時間到！ —' : '— 時間到！ —') : '— 一起下樓梯 —';
  // 出局原因另起一行（名字長時不會被截掉）
  const rows = r.players.map((p) => `<div class="wide brow${p.user_id === r.me?.user_id ? ' mine' : ''}"><span>${p.rank}. ${esc(p.name)}</span><em>${p.floor} 樓 +${p.coins}</em></div>${causeText(p) ? `<div class="bwhy">${esc(causeText(p))}</div>` : ''}`).join('');
  const mine = r.me ? `<div class="wide"><b>${rankText(r.me.rank)}</b><span>${coinHtml(r.me.coins)}</span></div>` : '';
  return `<div class="board"><div class="mt">${head}</div><div class="blist">${rows}</div>${mine}<div class="mi back on">✕ 離開</div></div>`;
}

/** 其他寵物：在兩個快照之間插值（t = 0 → 上一個、1 → 最新）。新出現的直接用最新位置。 */
export interface Pos { x: number; y: number }
export function lerpPos(prev: Pos | undefined, cur: Pos, t: number): Pos {
  if (!prev) return cur;
  const k = Math.max(0, Math.min(1, t));
  // 差太多（瞬移、重生）就不插值
  if (Math.abs(cur.x - prev.x) > 24 || Math.abs(cur.y - prev.y) > 24) return cur;
  return { x: prev.x + (cur.x - prev.x) * k, y: prev.y + (cur.y - prev.y) * k };
}
/** 下樓梯中的提示（畫面下方訊息列）。 */
export function multiStatus(alive: number, meAlive: boolean): string {
  return meAlive ? `←→ 移動，撐到最後！剩 ${alive} 隻` : `出局了…看大家玩（剩 ${alive} 隻）`;
}
