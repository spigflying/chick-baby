// v1.6 下樓梯排行榜（開始前顯示）：全部寵物最佳樓層前 10 名＋自己的名次。
export interface BoardRow { rank: number; pet_name: string; owner_name: string; species: string; best_floor: number; mine: boolean }
export interface Board { top: BoardRow[]; me: { pet_name: string; best_floor: number; rank: number } | null }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export function boardHtml(b: Board | null, err = false): string {
  const rows = !b ? `<div class="note">${err ? '排行榜載入失敗' : '載入中…'}</div>`
    : b.top.length ? b.top.map((r) => `<div class="wide brow${r.mine ? ' mine' : ''}"><span>${r.rank}. ${esc(r.pet_name)}<small>（${esc(r.owner_name)}）</small></span><em>${r.best_floor} 樓</em></div>`).join('')
      : '<div class="note">還沒有人下過樓梯</div>';
  const me = b?.me ? `<div class="wide brow me"><span>你：${esc(b.me.pet_name)} 第 ${b.me.rank} 名</span><em>${b.me.best_floor} 樓</em></div>` : '';
  return `<div class="mt">— 下樓梯排行榜 —</div>${rows}${me}<div class="mi on go" data-go="1">▶ 開始</div><div class="mi back">✕ 返回</div>`;
}
