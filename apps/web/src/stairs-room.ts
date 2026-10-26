import type { Live } from './ws';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ERR: Record<string, string> = { ROOM_FULL: '房間滿了', ROOM_STARTING: '房間已經開始了', ROOM_CLOSED: '房間已關閉', NOT_ENOUGH_PLAYERS: '人數不夠（至少 2 隻），沒有開始',
  EXPIRED: '房間太久沒動作，已關閉', EMPTY: '房間沒人了，已關閉' };

const NOTICE: Record<string, string> = { TOO_TIRED: '寵物太累了，沒辦法下樓梯', PET_SLEEPING: '寵物在睡覺', PET_EGG: '還是蛋，不能下樓梯', PET_DEAD: '寵物去當小天使了', NO_PET: '沒有寵物', NOT_FRIEND: '你不是房主的朋友' };
/** v27 下樓梯房頁（/stairs-room）：跟賽車房大廳一樣是獨立畫面。上方按鈕（離開房間／準備）、成員、規則；
 *  規則同「一起下樓梯」（沒有額外設定）；2～6 隻；全員準備 → 3 秒倒數 → 回到寵物頁開始。 */
export function stairsRoomPage(root: HTMLElement, live: Live | null, myId: string, goHome: () => void, toast: (s: string) => void): () => void {
  root.innerHTML = `<main class="page nosel-btns"><div class="panel sroom-page" id="srp"></div></main>`;
  const el = root.querySelector('#srp') as HTMLElement;
  let ask = false, wentHome = false, max = 6, shown = false;
  const left = (r: any) => r.countdown_ms === null ? null : Math.max(0, Math.ceil((r.countdown_ms - (Date.now() - r.at)) / 1000));
  function render() {
    const r = live?.room;
    if (!r || r.game !== 'stairs') {
      shown = false; ask = false;
      el.innerHTML = `<div class="race-top-row"><button data-a="home" class="big race-top-btn">回我的家</button></div><h3>下樓梯房</h3><p class="muted">你現在不在任何下樓梯房。到寵物頁的「樓梯」→「開房間（邀朋友）」開一間，或等朋友邀請。</p>`;
      return;
    }
    shown = true;
    const my = r.members.find((m: any) => m.user === myId), l = left(r), ready = r.members.filter((m: any) => m.ready).length;
    if (l !== null && !wentHome) { wentHome = true; window.setTimeout(() => { if (location.pathname === '/stairs-room') goHome(); }, Math.max(0, (l - 1) * 1000)); }
    if (l === null) wentHome = false;
    const top = ask ? `<button data-a="ok" class="big race-top-btn">確定準備</button><button data-a="no" class="big race-top-btn">先不要</button>`
      : `<button data-a="leave" class="big race-top-btn">離開房間</button>${my?.ready ? '<button data-a="unready" class="big race-top-btn">取消準備</button>' : '<button data-a="ready" class="big race-top-btn">準備</button>'}`;
    el.innerHTML = `<div class="race-top-row">${top}</div>${ask ? '<p class="room-ask">確定準備好了嗎？全員準備後 3 秒開始。</p>' : ''}
      <h3 class="sroom-title">「${esc(r.members.find((m: any) => m.host)?.name ?? '')}」的下樓梯房 <span class="muted">${r.members.length}/${max} 隻</span></h3>
      ${l !== null ? `<div class="room-cd"><span>全員準備！</span><b data-cd>${l}</b><span>秒後開始</span></div>` : ''}
      <h3>成員 <span class="muted">準備 ${ready}/${r.members.length}</span></h3>
      <ul class="room-members">${r.members.map((m: any) => `<li class="${m.ready ? 'ok' : ''} ${m.online ? '' : 'off'}"><span>${esc(m.name)}${m.host ? ' <span class="room-tag">房主</span>' : ''}${m.user === myId ? ' <span class="muted">（你）</span>' : ''}</span><span class="room-st">${!m.online ? '斷線中…' : m.ready ? '✔ 準備好了' : '等待中'}</span></li>`).join('')}</ul>
      <h3>規則</h3>
      <ul class="sroom-rules"><li>玩法同「一起下樓梯」：←→ 移動，撐到最後的贏。</li><li>至少 ${r.min || 2} 隻、最多 ${max} 隻；寵物要醒著、有體力。</li><li>房間獎金：前三名 ◎150／100／50。</li><li>全員準備後倒數 3 秒，會自動回到寵物頁開始。</li></ul>
      <p class="muted">房間 ${Math.ceil(r.expires_ms / 60000)} 分鐘內沒有動作會自動關閉。房主離開時交給最早加入的人。</p>`;
  }
  el.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a'); if (!a) return;
    if (a === 'home') { goHome(); return; }
    if (a === 'leave') { live?.send({ type: 'room.leave' }); if (live) live.room = null; goHome(); return; }
    if (a === 'ready') ask = true;
    else if (a === 'no') ask = false;
    else if (a === 'ok') { ask = false; live?.send({ type: 'room.ready', ready: true }); }
    else if (a === 'unready') live?.send({ type: 'room.ready', ready: false });
    render();
  });
  const off = live?.on((m: any) => {
    if (m.type === 'room.state') { if (m.max) max = m.max; render(); }
    else if (m.type === 'room.gone') { if (shown && m.code && m.code !== 'STARTED') toast(ERR[m.code] ?? '房間已關閉'); render(); }
    else if (m.type === 'race.notice' && !m.home_id) toast(ERR[m.code] ?? NOTICE[m.code] ?? '沒辦法加入房間');
  });
  const t = window.setInterval(() => { const c = el.querySelector('[data-cd]'); if (c && live?.room) { const l = left(live.room); if (l !== null) c.textContent = String(l); } }, 200);
  render();
  return () => { off?.(); clearInterval(t); };
}
