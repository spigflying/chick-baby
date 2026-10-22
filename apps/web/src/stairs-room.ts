import type { Live } from './ws';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ERR: Record<string, string> = { ROOM_FULL: '房間滿了', ROOM_STARTING: '房間已經開始了', ROOM_CLOSED: '房間已關閉', NOT_ENOUGH_PLAYERS: '人數不夠（至少 2 隻），沒有開始',
  EXPIRED: '房間太久沒動作，已關閉', EMPTY: '房間沒人了，已關閉' };

const NOTICE: Record<string, string> = { TOO_TIRED: '寵物太累了，沒辦法下樓梯', PET_SLEEPING: '寵物在睡覺', PET_EGG: '還是蛋，不能下樓梯', PET_DEAD: '寵物去當小天使了', NO_PET: '沒有寵物', NOT_FRIEND: '你不是房主的朋友' };
/** v27 下樓梯房：任何畫面都會出現的房間面板（賽車房留在賽車頁裡顯示）。
 *  規則跟「一起下樓梯」一樣（沒有額外設定）；2～6 隻；全員準備 → 3 秒倒數 → 回到寵物頁開始。 */
export function mountStairsRoom(live: Live, myId: () => string | null, goHome: () => void, toast: (s: string) => void) {
  document.querySelectorAll('.sroom').forEach((x) => x.remove());
  const el = document.createElement('div'); el.className = 'sroom'; el.hidden = true; document.body.append(el);
  let ask = false, wentHome = false, max = 6, shown = false;
  const left = (r: any) => r.countdown_ms === null ? null : Math.max(0, Math.ceil((r.countdown_ms - (Date.now() - r.at)) / 1000));
  function render() {
    const r = live.room;
    if (!r || r.game !== 'stairs') { shown = false; el.hidden = true; el.innerHTML = ''; ask = false; wentHome = false; return; }
    const me = myId(), my = r.members.find((m: any) => m.user === me), l = left(r), ready = r.members.filter((m: any) => m.ready).length;
    if (l !== null && !wentHome) { wentHome = true; if (location.pathname !== '/') goHome(); }
    if (l === null) wentHome = false;
    const top = ask ? `<button data-a="ok" class="big race-top-btn">確定準備</button><button data-a="no" class="big race-top-btn">先不要</button>`
      : `<button data-a="leave" class="big race-top-btn">離開房間</button>${my?.ready ? '<button data-a="unready" class="big race-top-btn">取消準備</button>' : '<button data-a="ready" class="big race-top-btn">準備</button>'}`;
    el.hidden = false; shown = true;
    el.innerHTML = `<div class="race-top-row">${top}</div>${ask ? '<p class="room-ask">確定準備好了嗎？全員準備後 3 秒開始。</p>' : ''}
      <h3>「${esc(r.members.find((m: any) => m.host)?.name ?? '')}」的下樓梯房 <span class="muted">${r.members.length}/${max} 隻</span></h3>
      ${l !== null ? `<div class="room-cd"><span>全員準備！</span><b data-cd>${l}</b><span>秒後開始</span></div>` : ''}
      <p class="muted">規則同「一起下樓梯」，撐到最後的贏。至少 ${r.min || 2} 隻才能開始。房間獎金：前三名 ◎150／100／50。</p>
      <h3>成員 <span class="muted">準備 ${ready}/${r.members.length}</span></h3>
      <ul class="room-members">${r.members.map((m: any) => `<li class="${m.ready ? 'ok' : ''} ${m.online ? '' : 'off'}"><span>${esc(m.name)}${m.host ? ' <span class="room-tag">房主</span>' : ''}${m.user === me ? ' <span class="muted">（你）</span>' : ''}</span><span class="room-st">${!m.online ? '斷線中…' : m.ready ? '✔ 準備好了' : '等待中'}</span></li>`).join('')}</ul>`;
  }
  el.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a'); if (!a) return;
    if (a === 'leave') { live.send({ type: 'room.leave' }); live.room = null; render(); return; }
    if (a === 'ready') ask = true;
    else if (a === 'no') ask = false;
    else if (a === 'ok') { ask = false; live.send({ type: 'room.ready', ready: true }); }
    else if (a === 'unready') live.send({ type: 'room.ready', ready: false });
    render();
  });
  live.on((m: any) => {
    if (m.type === 'room.state') { if (m.max) max = m.max; render(); }
    else if (m.type === 'room.gone') { if (shown && m.code && m.code !== 'STARTED') toast(ERR[m.code] ?? '房間已關閉'); render(); }
    else if (m.type === 'race.notice' && !m.home_id && location.pathname !== '/race') toast(ERR[m.code] ?? NOTICE[m.code] ?? '沒辦法加入房間');
  });
  setInterval(() => { const c = el.querySelector('[data-cd]'); if (c && live.room) { const l = left(live.room); if (l !== null) c.textContent = String(l); } }, 200);
  render();
}
