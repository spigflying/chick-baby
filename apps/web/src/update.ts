// v1.6.2 新版本提示：比對前端內嵌的 build id 與伺服器目前部署的 id（不顯示版本號，只顯示更新說明）。
export const SEEN_KEY = 'chick.seenBuild';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export interface ServerRelease { build?: string | null; notes?: string[] }
/** 伺服器的 build 和自己不同 → 有新版本（伺服器沒有 id，例如本機開發 → 不提示）。 */
export const isOutdated = (mine: string, srv: ServerRelease | null | undefined) => !!srv?.build && !!mine && srv.build !== mine;
/** 要不要現在顯示：對戰中／下樓梯中先不打擾，結束後再顯示。 */
export function noticeAction(o: { outdated: boolean; busy: boolean; shown: boolean }): 'show' | 'wait' | 'none' {
  if (!o.outdated || o.shown) return 'none';
  return o.busy ? 'wait' : 'show';
}
/** 剛更新完（reload 後）：上次看過的 id 不是現在這個 → 顯示一次「新功能」。全新玩家（沒看過、也沒有舊資料）只記下來不顯示。 */
export function justUpdated(store: Store, mine: string, srv: ServerRelease | null, existingUser: boolean): boolean {
  let seen: string | null = null; try { seen = store.getItem(SEEN_KEY); } catch { /* 隱私模式 */ }
  if (!srv?.build || srv.build !== mine) return false; // 還是舊版（或沒資料）→ 交給「有新版本」流程
  try { store.setItem(SEEN_KEY, mine); } catch { /* */ }
  if (seen === mine) return false;
  return seen !== null || existingUser;
}
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** 通知內容（沒有版本號）。kind='new'：有新版本＋立即更新；'done'：剛更新完的新功能。 */
export function noticeHtml(kind: 'new' | 'done', notes: string[]): string {
  const title = kind === 'new' ? '有新版本，請更新' : '更新完成！新功能';
  const list = notes.length ? `<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  const btns = kind === 'new' ? '<div class="ub"><button class="go" data-reload>立即更新</button><button class="later" data-close>稍後</button></div>' : '<div class="ub"><button class="go" data-close>好</button></div>';
  return `<div class="ut">${title}</div>${list}${btns}`;
}

/** 接上畫面：檢查時機＝WebSocket 連上、狀態輪詢、分頁回到前景。 */
export function createUpdater(o: { mine: string; busy: () => boolean; existingUser: () => boolean; fetchStatus: () => Promise<ServerRelease | null>; reload?: () => void }) {
  let shown = false, pending: ServerRelease | null = null, waitTimer = 0, el: HTMLElement | null = null;
  const close = () => { el?.remove(); el = null; };
  const render = (kind: 'new' | 'done', notes: string[]) => {
    close();
    el = document.createElement('div'); el.className = `update-notice ${kind}`; el.setAttribute('role', 'alertdialog');
    el.innerHTML = noticeHtml(kind, notes);
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-reload]')) (o.reload ?? (() => location.reload()))();
      else if (t.closest('[data-close]')) close();
    });
    document.body.append(el);
    if (kind === 'done') setTimeout(() => { if (el?.classList.contains('done')) close(); }, 12_000);
  };
  const tryShow = () => {
    const a = noticeAction({ outdated: !!pending, busy: o.busy(), shown });
    if (a === 'show' && pending) { shown = true; clearInterval(waitTimer); render('new', pending.notes ?? []); }
    else if (a === 'wait' && !waitTimer) waitTimer = window.setInterval(tryShow, 2000);
  };
  return {
    /** 開機時：如果是剛更新完就顯示一次新功能。 */
    boot(srv: ServerRelease | null) { if (justUpdated(localStorage, o.mine, srv, o.existingUser())) render('done', srv?.notes ?? []); else this.seen(srv); },
    seen(srv: ServerRelease | null) { if (isOutdated(o.mine, srv)) { pending = srv; tryShow(); } },
    async check() { try { this.seen(await o.fetchStatus()); } catch { /* 下次 */ } },
    get shown() { return shown; },
  };
}
