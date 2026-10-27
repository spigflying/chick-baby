/** 結果畫面：每位選手兩行（名字自己一行、完整換行；下一行時間＋統計），名字不會蓋到秒數。 */
export interface ResultRow { id: string; name: string; ai?: boolean; rank: number; time_ms: number | null; ob?: number; pk?: number; avg?: number; top?: number }
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const fmtTime = (ms: number | null) => ms === null ? '未完賽' : `${Math.floor(ms / 60000)}'${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}"${String(Math.floor(ms / 10) % 100).padStart(2, '0')}`;
export const hasStats = (c: ResultRow) => typeof c.avg === 'number';
export function statsLine(c: ResultRow) {
  return hasStats(c) ? `撞路障 ${c.ob ?? 0}・吃加速 ${c.pk ?? 0}・平均 ${c.avg} km/h・最高 ${c.top} km/h` : '';
}
export function resultsListHtml(rows: ResultRow[], meId: string) {
  return `<ol class="results results2">${rows.map((c) => `<li class="${c.id === meId ? 'me' : ''}"><div class="rr-name"><b>${c.rank}.</b> ${esc(c.name)}${c.ai ? ' <span class="muted">電腦</span>' : ''}${c.id === meId ? ' <span class="muted">（你）</span>' : ''}</div><div class="rr-line"><span class="rr-time">${fmtTime(c.time_ms)}</span>${hasStats(c) ? `<span class="rr-st">${esc(statsLine(c))}</span>` : ''}</div></li>`).join('')}</ol>`;
}
/** 原生 240×200 畫面：名字只能用到 maxW 寬，太長就截斷加「…」（完整名字在下方 HTML 列表） */
export function fitName(measure: (s: string) => number, name: string, maxW: number) {
  if (measure(name) <= maxW) return name;
  const ch = [...name]; while (ch.length > 1 && measure(ch.join('') + '…') > maxW) ch.pop();
  return ch.join('') + '…';
}
