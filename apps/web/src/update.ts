// v1.6.2 新版本提示：比對前端內嵌的 build id 與伺服器目前部署的 id（不顯示版本號，只顯示更新說明）。
export const SEEN_KEY = 'chick.seenBuild';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export interface ServerRelease { build?: string | null; notes?: string[] }
/** 伺服器的 build 和自己不同 → 有新版本（伺服器沒有 id，例如本機開發 → 不提示）。 */
export const isOutdated = (mine: string, srv: ServerRelease | null | undefined) => !!srv?.build && !!mine && srv.build !== mine;
/** 剛更新完（reload 後）：上次看過的 id 不是現在這個 → 顯示一次「新功能」。全新玩家（沒看過、也沒有舊資料）只記下來不顯示。 */
export function justUpdated(store: Store, mine: string, srv: ServerRelease | null, existingUser: boolean): boolean {
  let seen: string | null = null; try { seen = store.getItem(SEEN_KEY); } catch { /* 隱私模式 */ }
  if (!srv?.build || srv.build !== mine) return false; // 還是舊版（或沒資料）→ 交給「有新版本」流程
  try { store.setItem(SEEN_KEY, mine); } catch { /* */ }
  if (seen === mine) return false;
  return seen !== null || existingUser;
}
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** 小型角落提示（不遮畫面、沒有遮罩、不搶焦點）。kind='new'：有新版本＋更新；'done'：剛更新完的新功能。沒有版本號。 */
export function noticeHtml(kind: 'new' | 'done', notes: string[], open = false): string {
  const title = kind === 'new' ? '有新版本' : '更新完成！新功能';
  const b = (cls: string, attr: string, label: string, aria = '') => `<button type="button" tabindex="-1" class="${cls}" ${attr}${aria ? ` aria-label="${aria}"` : ''}>${label}</button>`;
  const head = `<div class="uh"><span class="ut">${title}</span>${kind === 'new' ? b('go', 'data-reload', '更新') : ''}${notes.length ? b('more', 'data-toggle', open ? '▴' : '▾', '更新內容') : ''}${b('x', 'data-close', '✕', '關閉')}</div>`;
  const list = notes.length && open ? `<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  return head + list;
}
/** 每秒判斷提示要不要出現：比賽／打架／邀請／結算中一律隱藏，結束後再出現；'done' 在可見時累計約 8 秒自動關。 */
export function toastVisible(o: { has: boolean; busy: boolean; closed: boolean }) { return o.has && !o.busy && !o.closed; }
export const DONE_MS = 8000;

/** 接上畫面：檢查時機＝WebSocket 連上、狀態輪詢、分頁回到前景。 */
export function createUpdater(o: { mine: string; busy: () => boolean; existingUser: () => boolean; fetchStatus: () => Promise<ServerRelease | null>; reload?: () => void }) {
  let cur: { kind: 'new' | 'done'; notes: string[]; open: boolean; closed: boolean; visibleMs: number } | null = null;
  let el: HTMLElement | null = null, timer = 0, last = Date.now(), dismissedNew = false;
  const render = () => {
    if (!cur) return;
    if (!el) {
      el = document.createElement('div'); el.className = 'update-toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      // 不搶焦點（方向鍵／空白／F 照常給遊戲）；也不 stopPropagation（idle.ts 看 window 的 pointerdown）
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement; if (!cur) return;
        if (t.closest('[data-reload]')) (o.reload ?? (() => location.reload()))();
        else if (t.closest('[data-toggle]')) { cur.open = !cur.open; render(); }
        else if (t.closest('[data-close]')) { if (cur.kind === 'new') dismissedNew = true; cur.closed = true; tick(); }
      });
      document.body.append(el);
    }
    el.className = `update-toast ${cur.kind}`;
    el.innerHTML = noticeHtml(cur.kind, cur.notes, cur.open);
  };
  const tick = () => {
    const now = Date.now(), dt = now - last; last = now;
    const vis = toastVisible({ has: !!cur, busy: o.busy(), closed: !!cur?.closed });
    if (vis && cur) { if (!el) render(); el!.hidden = false; if (cur.kind === 'done' && (cur.visibleMs += dt) >= DONE_MS) cur.closed = true; }
    else if (el) el.hidden = true;
    if (cur?.closed) { el?.remove(); el = null; cur = null; }
  };
  const ensureTimer = () => { if (!timer) timer = window.setInterval(tick, 500); };
  const set = (kind: 'new' | 'done', notes: string[]) => { if (cur?.kind === 'new' && kind === 'new') return; el?.remove(); el = null; cur = { kind, notes, open: false, closed: false, visibleMs: 0 }; last = Date.now(); ensureTimer(); tick(); };
  return {
    boot(srv: ServerRelease | null) { if (justUpdated(localStorage, o.mine, srv, o.existingUser())) set('done', srv?.notes ?? []); else this.seen(srv); },
    seen(srv: ServerRelease | null) { if (isOutdated(o.mine, srv) && !dismissedNew && cur?.kind !== 'new') set('new', srv?.notes ?? []); },
    async check() { try { this.seen(await o.fetchStatus()); } catch { /* 下次 */ } },
    tick, get state() { return cur ? { kind: cur.kind, visible: !!el && !el.hidden } : null; },
  };
}
