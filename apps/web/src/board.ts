// v1.6 下樓梯排行榜（開始前顯示）：前 5 名＋自己（不在前 5 名時加「…」）。
export interface BoardRow { rank: number; pet_name: string; owner_name: string; species: string; best_floor: number; mine: boolean }
export interface Board { top: BoardRow[]; me: { pet_name: string; best_floor: number; rank: number } | null }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** 開始前只列前 BOARD_TOP 名；自己不在裡面就加「…」再列自己那一行。 */
export const BOARD_TOP = 5;
export function boardRows(b: Board): { rows: BoardRow[]; gap: boolean; me: BoardRow | null } {
  const rows = b.top.slice(0, BOARD_TOP);
  if (!b.me || rows.some((r) => r.mine)) return { rows, gap: false, me: null };
  const mine = b.top.find((r) => r.mine);
  const me: BoardRow = mine ?? { rank: b.me.rank, pet_name: b.me.pet_name, owner_name: '你', species: '', best_floor: b.me.best_floor, mine: true };
  return { rows, gap: me.rank > rows.length + 1, me };
}
const row = (r: BoardRow) => `<div class="wide brow${r.mine ? ' mine' : ''}"><span>${r.rank}. ${esc(r.pet_name)}<small>（${r.mine ? '你' : esc(r.owner_name)}）</small></span><em>${r.best_floor} 樓</em></div>`;
/** 排行榜在中間可捲動；「開始」「返回」固定在畫面底部，永遠看得到。 */
export function boardHtml(b: Board | null, err = false): string {
  let list: string;
  if (!b) list = `<div class="note">${err ? '排行榜載入失敗' : '載入中…'}</div>`;
  else if (!b.top.length && !b.me) list = '<div class="note">還沒有人下過樓梯</div>';
  else {
    const v = boardRows(b);
    list = v.rows.map(row).join('') + (v.me ? (v.gap ? '<div class="bgap">…</div>' : '') + row(v.me) : '');
  }
  return `<div class="board"><div class="mt">— 下樓梯排行榜 —</div><div class="blist">${list}</div><div class="bfoot"><div class="mi on go" data-go="1">▶ 開始</div><div class="mi back">✕ 返回</div></div></div>`;
}
/** 下樓梯結算畫面。time_up = 撐滿 5 分鐘時間到（寵物沒有死）。 */
export function stairsResultHtml(r: { aborted?: boolean; floors: number; coins: number; time_up?: boolean }, wallet: number): string {
  if (r.aborted) return `<div class="mt">— 遊戲中止 —</div><p>伺服器維護中，這場不計分。</p><div class="mi back on">✕ 離開</div>`;
  const head = r.time_up ? `<div class="mt">— 時間到！ —</div><div class="note">撐滿 5 分鐘，好厲害！</div>` : `<div class="mt">— 遊戲結束 —</div>`;
  return `${head}<div class="wide"><b>下了</b><span>${r.floors} 樓</span></div><div class="wide"><b>獲得</b><span>◎${r.coins}</span></div><div class="wide"><b>目前</b><span>◎${wallet}</span></div><div class="mi back on">✕ 離開</div>`;
}
