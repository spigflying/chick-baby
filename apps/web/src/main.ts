import { stairsRoomPage } from './stairs-room';
import { trackById } from '@chick/engine';
import { blip, presenceDiff } from './visitors';
import './style.css';
import { api, act, errText, ApiError } from './api';
import { Live } from './ws';
import { racePage } from './race';
let pageOff: (() => void) | null = null;
import { Device } from './device';
import { drawShell } from './shell';
import { coinHtml, spriteCanvas, speciesSprite, SPECIES_LABEL, PAL, spr, sw, sh } from './sprites';
import { watchIdle } from './idle';
import { createUpdater, SEEN_KEY } from './update';
import { PET_CACHE_KEY } from './sleep';
import { formatCountdown, formatOpensAt, closedLine, loadPetCache, savePetCache, sleepSprite } from './sleep';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const app = $('#app');

let cfg: any; let me: any = null; let live: Live | null = null; let device: Device | null = null; let presence: any[] = []; let presenceSeen = false;
let wallet = 0;
let idleOff: (() => void) | null = null;
let sleepTimer = 0; let sleepAnim = 0;

function toast(t: string) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.append(d); setTimeout(() => d.remove(), 2600); }
function nav(path: string, replace = false) { if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path); void route(); }
window.addEventListener('popstate', () => void route());
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a[data-nav]') as HTMLAnchorElement | null;
  if (a) { e.preventDefault(); nav(a.getAttribute('href')!); }
});
const fmtTime = (t: any) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function renderBar() {
  const bar = $('#bar');
  if (!me) { bar.hidden = true; return; }
  bar.hidden = false;
  const p = location.pathname;
  const link = (href: string, t: string, on: boolean) => `<a data-nav href="${href}" class="${on ? 'on' : ''}">${t}</a>`;
  bar.innerHTML = `<span class="who">🐣 <b>${esc(me.user.display_name)}</b></span><span class="coin" id="barCoins">${coinHtml(wallet)}</span><span>分享碼 <span class="code">${esc(me.user.share_code)}</span></span>
    <nav>${link('/', '我的家', p === '/')}${link('/visit', '去拜訪', p === '/visit' || p.startsWith('/home/'))}${link('/race', '賽車', p === '/race')}${link('/settings', '家的設定', p === '/settings')}${me.user.role === 'admin' ? link('/admin', '管理', p === '/admin') : ''}<a href="#" id="logout">登出</a></nav>`;
  $('#logout').onclick = async (e) => { e.preventDefault(); await api('POST', '/auth/logout'); live?.stop(); live = null; idleOff?.(); idleOff = null; me = null; nav('/', true); };
}
function setWallet(n: number) { wallet = n; const c = document.getElementById('barCoins'); if (c) c.innerHTML = coinHtml(n); device?.renderTop(); }

// ---------- 登入 ----------
async function loginPage() {
  $('#bar').hidden = true;
  app.innerHTML = `<main class="page"><div class="device" id="lobbyDev"><canvas class="shell"></canvas><div class="inner"><div class="brand">CHICK♥BABY</div>
    <div class="lcd"><div class="lcd-top"><span>多人版</span><span>M1</span></div><div class="scr" style="display:flex;justify-content:center;gap:8%;padding:12% 0;background:var(--g3)" id="lobbyPets"></div><p class="msg">登入後就能孵蛋、拜訪朋友的家！</p></div></div></div>
    <div class="panel login"><h2>登入</h2><div class="gsi" id="gsi"></div><div id="gsiNote" class="muted"></div>
    <div id="devBox" hidden><h3>開發用登入（DEV_LOGIN=1）</h3><form id="devForm" class="row"><input name="name" placeholder="名字，例如 alice" pattern="[\\w\\-\\u4e00-\\u9fff]{1,20}" required><button>登入</button></form>
    <p class="muted">名字 <code>dev-admin</code> 會是管理員（ADMIN_EMAILS）。</p></div>
    <p class="muted">我們不會公開你的 Email，其他玩家只看得到暱稱與分享碼。</p></div></main>`;
  drawShell(document.querySelector('#lobbyDev canvas.shell') as HTMLCanvasElement);
  for (const s of ['chicken', 'duck', 'penguin', 'dino']) { const c = spriteCanvas(speciesSprite(s, 1), 1); c.style.height = '34%'; c.style.minHeight = '28px'; c.title = SPECIES_LABEL[s]; $('#lobbyPets').append(c); }
  if (cfg.dev_login) {
    $('#devBox').hidden = false;
    ($('#devForm') as HTMLFormElement).onsubmit = async (e) => {
      e.preventDefault();
      const name = ((e.target as HTMLFormElement).elements.namedItem('name') as HTMLInputElement).value.trim();
      try { await api('POST', '/auth/dev', { name }); await boot(); } catch (er) { toast(errText(er)); }
    };
  }
  if (cfg.google_client_id) {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => {
      const google = (window as any).google;
      google.accounts.id.initialize({ client_id: cfg.google_client_id, callback: async (r: any) => { try { await api('POST', '/auth/google', { credential: r.credential }); await boot(); } catch (e) { toast(errText(e)); } } });
      google.accounts.id.renderButton($('#gsi'), { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular', locale: 'zh-TW' });
    };
    document.head.append(s);
  } else $('#gsiNote').textContent = '（尚未設定 GOOGLE_CLIENT_ID，Google 登入未啟用）';
}

// ---------- 家（自己 / 別人）----------
async function homePage(homeId: string) {
  device?.destroy();
  app.innerHTML = `<main class="page"><div class="presrow" id="presRow"></div><div id="devSlot"></div><div class="panel" id="side"></div></main>`;
  device = new Device({ me: me.user, cfg, live: live!, wallet: () => wallet, setWallet, toast, goHome: () => nav('/') });
  $('#devSlot').replaceWith(device.el);
  try {
    const view = await api('GET', `/homes/${homeId}`);
    device.setHome(view);
    presence = []; presenceSeen = false;
    live!.joinHome(view.home.id);
    renderSide(view);
  } catch (e) {
    app.innerHTML = `<main class="page"><div class="panel"><h2>進不去</h2><p>${esc(errText(e))}</p><p>這個家可能只限邀請、已關閉，或你在黑名單裡。</p><a class="btn" data-nav href="/">回我的家</a></div></main>`;
    device?.destroy(); device = null;
  }
}
async function renderSide(view: any) {
  const side = document.getElementById('side'); if (!side) return;
  const owner = view.home.is_owner;
  const link = `${location.origin}/h/${me.user.share_code}`;
  side.innerHTML = `<h2>${owner ? '我的家' : esc(view.home.owner.display_name) + ' 的家'}</h2>
    <h3>現在在這裡</h3><div class="presence" id="pres"><span class="muted">—</span></div>
    ${owner ? `<h3>分享</h3><p>把分享碼 <span class="code">${esc(me.user.share_code)}</span> 給朋友，或傳連結：<br><span class="muted">${esc(link)}</span></p>
      <p>存取：<b>${({ open: '公開', invite_only: '只限邀請', closed: '關閉' } as any)[view.home.access_mode]}</b>（<a data-nav href="/settings">設定</a>）</p>
      <h3>誰餵了我的寵物</h3><ul id="fedList"><li class="muted">載入中…</li></ul>`
    : `<p>訪客只能餵食（要付金幣，米粒不行）。每天每隻寵物：你最多 ${cfg.game.feed.visitorDailyPerVisitorPerPet} 次、全部訪客共 ${cfg.game.feed.visitorDailyPerPet} 次。</p>`}
  `;
  renderPresence();
  if (owner && view.pet) {
    try {
      const evs = await api('GET', `/pets/${view.pet.id}/events`);
      const feeds = evs.filter((e: any) => e.type === 'feed' && e.payload?.visitor);
      const ul = document.getElementById('fedList');
      if (ul) ul.innerHTML = feeds.length ? feeds.slice(0, 15).map((e: any) => `<li><span>${esc(e.actor?.display_name ?? '?')} 餵了 ${esc(cfg.foods.find((f: any) => f.id === e.payload.food)?.name ?? e.payload.food)}</span><span class="muted">${fmtTime(e.at)}</span></li>`).join('') : '<li class="muted">還沒有訪客餵過</li>';
    } catch { /* ignore */ }
  } else if (owner) { const ul = document.getElementById('fedList'); if (ul) ul.innerHTML = '<li class="muted">還沒有寵物</li>'; }
}
function renderPresence() {
  const row = document.getElementById('presRow');
  if (row) row.innerHTML = `<b>現在在這裡</b> ${presence.map((u) => `<span>${esc(u.display_name)}${u.id === me.user.id ? '（你）' : ''}</span>`).join('')}`;
  const el = document.getElementById('pres'); if (!el) return;
  el.innerHTML = presence.length ? presence.map((u) => `<span>${esc(u.display_name)}${u.id === me.user.id ? '（你）' : ''}</span>`).join('') : '<span class="muted">—</span>';
}

// ---------- 拜訪 ----------
async function visitPage() {
  live?.joinHome(null);
  app.innerHTML = `<main class="page"><div class="panel"><h2>去拜訪</h2>
    <form id="codeForm" class="row"><input name="code" placeholder="輸入朋友的分享碼（8 碼）" maxlength="12" required><button>找</button></form><div id="found"></div>
    <h3>最近去過</h3><ul id="recent"><li class="muted">載入中…</li></ul>
    <h3>邀請我的家</h3><ul id="invited"><li class="muted">載入中…</li></ul></div></main>`;
  const homeLi = (h: any, extra = '') => `<li><span>${esc(h.owner.display_name)} 的家 ${extra}</span>${h.can_enter ? `<a class="btn" data-nav href="/home/${h.id}">進去</a>` : '<span class="muted">不能進入</span>'}</li>`;
  ($('#codeForm') as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    const code = ((e.target as HTMLFormElement).elements.namedItem('code') as HTMLInputElement).value.trim();
    try { const h = await api('GET', `/homes/by-code/${encodeURIComponent(code)}`); $('#found').innerHTML = `<ul>${homeLi(h)}</ul>`; }
    catch (er) { $('#found').innerHTML = `<p class="muted">${esc(errText(er))}</p>`; }
  };
  const [recent, invited] = await Promise.all([api('GET', '/homes/recent'), api('GET', '/homes/invited')]);
  $('#recent').innerHTML = recent.length ? recent.map((h: any) => homeLi(h, `<span class="muted">${fmtTime(h.last_visited_at)}</span>`)).join('') : '<li class="muted">還沒拜訪過</li>';
  $('#invited').innerHTML = invited.length ? invited.map((h: any) => homeLi(h)).join('') : '<li class="muted">沒有</li>';
}
async function shareLink(code: string) {
  try { const h = await api('GET', `/homes/by-code/${encodeURIComponent(code)}`); if (h.id === me.home.id) return nav('/', true); nav(`/home/${h.id}`, true); }
  catch (e) { app.innerHTML = `<main class="page"><div class="panel"><h2>找不到</h2><p>分享碼 ${esc(code)}：${esc(errText(e))}</p><a class="btn" data-nav href="/">回我的家</a></div></main>`; }
}

// ---------- 家的設定 ----------
async function settingsPage() {
  live?.joinHome(null);
  const meNow = await api('GET', '/me'); me = meNow; setWallet(meNow.wallet.balance);
  const home = meNow.home;
  app.innerHTML = `<main class="page"><div class="panel"><h2>家的設定</h2>
    <h3>誰可以進來</h3><div class="modes">
      ${[['open', '公開（預設）：知道分享碼的人都能來'], ['invite_only', '只限邀請：只有邀請名單上的人'], ['closed', '關閉：誰都不能來']].map(([v, t]) => `<label><input type="radio" name="mode" value="${v}" ${home.access_mode === v ? 'checked' : ''}> ${t}</label>`).join('')}</div>
    <h3>暱稱</h3><form id="nameForm" class="row"><input name="n" value="${esc(meNow.user.display_name)}" maxlength="20" required><button>儲存</button></form>
    <h3>分享碼</h3><p><span class="code" id="code">${esc(meNow.user.share_code)}</span> <button class="alt" id="rotate">換一組</button></p><p class="muted">換碼後舊的碼和連結就失效。</p>
    </div>
    <div class="panel"><h2>名單</h2>
    <h3>邀請名單</h3><form class="row" data-list="invites"><input name="c" placeholder="對方的分享碼" required><button>邀請</button></form><ul id="invites"></ul>
    <h3>黑名單</h3><form class="row" data-list="blacklist"><input name="c" placeholder="對方的分享碼" required><button class="red">封鎖</button></form><ul id="blacklist"></ul>
    <p class="muted">黑名單優先於任何模式，被封鎖的人會立刻被請出去。</p></div>
    <div class="panel"><h2>訪客紀錄</h2><ul id="visitors"></ul><h3>我的寵物檔案</h3><ul id="archive"></ul></div></main>`;
  document.querySelectorAll<HTMLInputElement>('input[name=mode]').forEach((r) => r.onchange = async () => {
    try { await act('PATCH', `/homes/${home.id}`, { access_mode: r.value }); toast('已更新'); } catch (e) { toast(errText(e)); }
  });
  ($('#nameForm') as HTMLFormElement).onsubmit = async (e) => { e.preventDefault(); const n = (($('#nameForm') as HTMLFormElement).elements.namedItem('n') as HTMLInputElement).value.trim(); try { await act('PATCH', '/me', { display_name: n }); me.user.display_name = n; renderBar(); toast('已儲存'); } catch (er) { toast(errText(er)); } };
  $('#rotate').onclick = async () => { if (!confirm('確定要換分享碼？舊的碼會失效。')) return; try { const r = await act('POST', '/me/share-code/rotate'); me.user.share_code = r.share_code; $('#code').textContent = r.share_code; renderBar(); } catch (e) { toast(errText(e)); } };
  const loadLists = async () => {
    const l = await api('GET', `/homes/${home.id}/lists`);
    for (const k of ['invites', 'blacklist'] as const) {
      $('#' + k).innerHTML = l[k].length ? l[k].map((u: any) => `<li><span>${esc(u.display_name)}</span><button class="alt" data-rm="${k}" data-id="${u.id}">移除</button></li>`).join('') : '<li class="muted">（空）</li>';
    }
    document.querySelectorAll<HTMLElement>('[data-rm]').forEach((b) => b.onclick = async () => { try { await act('DELETE', `/homes/${home.id}/${b.dataset.rm}`, { user_id: b.dataset.id }); await loadLists(); } catch (e) { toast(errText(e)); } });
  };
  document.querySelectorAll<HTMLFormElement>('form[data-list]').forEach((f) => f.onsubmit = async (e) => {
    e.preventDefault(); const c = (f.elements.namedItem('c') as HTMLInputElement);
    try { await act('POST', `/homes/${home.id}/${f.dataset.list}`, { share_code: c.value.trim() }); c.value = ''; await loadLists(); } catch (er) { toast(errText(er)); }
  });
  await loadLists();
  const [vis, pets] = await Promise.all([api('GET', `/homes/${home.id}/visitors`), api('GET', '/users/me/pets')]);
  $('#visitors').innerHTML = vis.length ? vis.map((v: any) => `<li><span>${esc(v.user.display_name)} <span class="muted">${v.last_visited_at ? fmtTime(v.last_visited_at) : ''}</span></span><span>餵了 ${v.feeds} 次</span></li>`).join('') : '<li class="muted">還沒有訪客</li>';
  $('#archive').innerHTML = pets.length ? pets.map((p: any) => `<li><span>${esc(p.name)}（${SPECIES_LABEL[p.species]}）</span><span class="pill ${p.status}">${({ egg: '蛋', alive: '活著', dead: '天堂' } as any)[p.status]}</span></li>`).join('') : '<li class="muted">（空）</li>';
}

// ---------- 管理員 ----------
async function adminPage() {
  live?.joinHome(null);
  if (me.user.role !== 'admin') { app.innerHTML = '<main class="page"><div class="panel"><h2>403</h2><p>只有管理員可以看。</p></div></main>'; return; }
  app.innerHTML = `<main class="page"><div class="panel" style="max-width:none"><h2>管理：所有使用者</h2><table id="users"></table></div><div class="panel" style="max-width:none" id="petsPanel" hidden><h2 id="petsTitle">寵物</h2><table id="pets"></table></div></main>`;
  const users = await api('GET', '/admin/users');
  $('#users').innerHTML = '<tr><th>暱稱</th><th>分享碼</th><th>角色</th><th>金幣</th><th>寵物</th><th></th></tr>' + users.map((u: any) =>
    `<tr><td>${esc(u.display_name)}</td><td><span class="code">${esc(u.share_code)}</span></td><td>${u.role}</td><td>◎${u.balance}</td><td>${u.pets} ${u.latest_pet_status ? `<span class="pill ${u.latest_pet_status}">${u.latest_pet_status}</span>` : ''}</td><td><button class="alt" data-u="${u.id}" data-n="${esc(u.display_name)}">看寵物</button></td></tr>`).join('');
  const showPets = async (uid: string, name: string) => {
    const pets = await api('GET', `/admin/users/${uid}/pets`);
    $('#petsPanel').hidden = false; $('#petsTitle').textContent = `${name} 的寵物（含已死亡）`;
    $('#pets').innerHTML = '<tr><th>名字</th><th>種類</th><th>狀態</th><th>出生</th><th>死亡</th><th></th></tr>' + pets.map((p: any) =>
      `<tr><td>${esc(p.name)}</td><td>${SPECIES_LABEL[p.species]}</td><td><span class="pill ${p.status}">${p.status}</span>${p.revived_at ? ' <span class="muted">(復活過)</span>' : ''}</td><td>${fmtTime(p.born_at)}</td><td>${p.died_at ? fmtTime(p.died_at) + ' ' + esc(p.death_cause) : ''}</td>
      <td>${p.status === 'dead' ? `<button class="red" data-revive="${p.id}">復活</button>` : ''}</td></tr>`).join('');
    document.querySelectorAll<HTMLElement>('[data-revive]').forEach((b) => b.onclick = async () => {
      try { await act('POST', `/admin/pets/${b.dataset.revive}/revive`); toast('已復活'); await adminPage(); await showPets(uid, name); } catch (e) { toast(errText(e)); }
    });
  };
  document.querySelectorAll<HTMLElement>('[data-u]').forEach((b) => b.onclick = () => void showPets(b.dataset.u!, b.dataset.n!));
}

// ---------- 休息時段（requirements §4.7）----------
function sleepPage(st: { opens_at: number | null; server_time?: number }) {
  live?.stop(); live = null; idleOff?.(); idleOff = null; device?.destroy(); device = null;
  $('#bar').hidden = true;
  const skew = st.server_time ? st.server_time - Date.now() : 0; // 伺服器時間 − 本地時間
  // v1.5：蛋殼畫面＋自己的寵物在睡覺（從 localStorage 快取畫；不打 API、不開 WebSocket）
  const sp = sleepSprite(loadPetCache(localStorage));
  app.innerHTML = `<main class="page"><div class="device" id="sleepDev"><canvas class="shell"></canvas><div class="inner"><div class="brand">CHICK♥BABY</div>
    <div class="lcd"><div class="lcd-top"><span>${esc(sp.name || '小雞')}</span><span>💤</span></div><div class="scr"><canvas class="screen" id="sleepScr" width="120" height="100"></canvas></div>
    <p class="msg" id="closedLine">${esc(closedLine(st.opens_at))}</p></div></div></div>
    <div class="panel"><h2>小雞睡覺中</h2><p>${st.opens_at ? `下次開放：<b>${esc(formatOpensAt(st.opens_at))}</b>` : '目前沒有排定的開放時間'}</p>
    <p id="countdown" style="font-size:1.6em"></p><p class="muted">平日 09:00–20:00 開放。休息時段時間是暫停的：寵物不會餓、不會生病。</p></div></main>`;
  drawShell(document.querySelector('#sleepDev canvas.shell') as HTMLCanvasElement);
  const cv = document.getElementById('sleepScr') as HTMLCanvasElement, g = cv.getContext('2d')!;
  let fr = 0;
  const draw = () => {
    if (!cv.isConnected) { clearInterval(sleepAnim); return; }
    const f = Math.floor(fr++ / 8) % 2, GROUND = 86;
    g.fillStyle = PAL[2]; g.fillRect(0, 0, 120, 100); // 夜間：關燈的背景
    g.fillStyle = PAL[1]; g.fillRect(0, GROUND, 120, 1);
    for (let i = 0; i < 120; i += 6) g.fillRect(i, GROUND + 2 + ((i / 6) % 2), 2, 1);
    const w = sw(sp.sprite), h = sh(sp.sprite), x = Math.round(60 - w / 2), y = GROUND - h;
    spr(g, sp.sprite, x, y + (sp.egg ? 0 : f));
    // Zzz 往上飄
    for (let k = 0; k < 3; k++) { const t = (fr + k * 16) % 48; spr(g, 'z', x + w + 2 + k * 4 + Math.round(Math.sin(t / 6)), y - 4 - t / 2.4); }
  };
  clearInterval(sleepAnim); draw(); sleepAnim = window.setInterval(draw, 66);
  clearInterval(sleepTimer);
  const opensAt = st.opens_at; if (!opensAt) return;
  const tick = () => {
    const left = opensAt - (Date.now() + skew);
    const el = document.getElementById('countdown'); if (el) el.textContent = formatCountdown(left);
    if (left <= 0) { clearInterval(sleepTimer); setTimeout(() => location.reload(), Math.random() * 20_000); } // 分散重新整理，避免同時湧入
  };
  tick(); sleepTimer = window.setInterval(tick, 1000);
}
async function goSleep() { try { sleepPage(await api('GET', '/status')); } catch { sleepPage({ opens_at: null }); } }

// ---------- 路由 ----------
async function route() {
  if (!me) return loginPage();
  renderBar();
  const p = location.pathname;
  if (!p.startsWith('/home/') && p !== '/') { device?.destroy(); device = null; }
  pageOff?.(); pageOff = null;
  let m: RegExpMatchArray | null;
  if (p === '/race') { pageOff = racePage(app, live, me, toast); return; }
  if (p === '/stairs-room') { pageOff = stairsRoomPage(app, live, me.user.id, () => nav('/'), toast); return; }
  if (p === '/') return homePage(me.home.id);
  if ((m = p.match(/^\/home\/([0-9a-f-]{36})$/))) return homePage(m[1]);
  if ((m = p.match(/^\/h\/([^/]+)$/))) return shareLink(decodeURIComponent(m[1]));
  if (p === '/visit') return visitPage();
  if (p === '/settings') return settingsPage();
  if (p === '/admin') return adminPage();
  nav('/', true);
}
// v1.6.2 新版本提示：WS 連上、狀態輪詢（3 分鐘）、分頁回到前景時比對 build id
const updater = createUpdater({
  mine: __BUILD_ID__,
  busy: () => !!device?.stairs || !!live?.inFight || !!live?.inMatch,
  existingUser: () => { try { return !!localStorage.getItem(PET_CACHE_KEY) || !!localStorage.getItem(SEEN_KEY); } catch { return false; } },
  fetchStatus: () => api('GET', '/status'),
});
(window as any).__updater = updater;
document.addEventListener('visibilitychange', () => { if (!document.hidden) void updater.check(); });
window.addEventListener('focus', () => void updater.check());
setInterval(() => { if (!document.hidden) void updater.check(); }, 3 * 60_000);
/** v27 好友開賽車房：任何頁面上方跳出橫幅，一鍵加入（60 秒後自動收起；同時只顯示最新一則） */
let roomPop: HTMLElement | null = null, roomPopT = 0;
function showRoomInvite(m: any) {
  if (live?.room || live?.inMatch) return;
  roomPop?.remove(); clearTimeout(roomPopT);
  const el = document.createElement('div'); el.className = 'room-pop';
  el.innerHTML = `<div class="room-pop-txt">${m.game === 'stairs' ? `<b>「${escHtml(m.from_name)}」的下樓梯房</b><span>一起下樓梯・前三名 ◎150／100／50</span>` : `<b>「${escHtml(m.from_name)}」的賽車房</b><span>${escHtml(trackName(m.track))}・${Number(m.laps) || 3} 圈</span>`}</div><button class="room-pop-go">加入</button><button class="room-pop-x" aria-label="關閉">✕</button>`;
  const close = () => { el.remove(); if (roomPop === el) roomPop = null; clearTimeout(roomPopT); };
  (el.querySelector('.room-pop-go') as HTMLElement).onclick = () => { if (!live?.send({ type: 'room.join', room: m.room, inst: m.inst })) { toast('連線中，請稍候'); return; } close(); const to = m.game === 'stairs' ? '/stairs-room' : '/race'; if (location.pathname !== to) nav(to); };
  (el.querySelector('.room-pop-x') as HTMLElement).onclick = close;
  document.body.append(el); roomPop = el; roomPopT = window.setTimeout(close, 60_000);
}
const trackName = (id: string) => trackById(id)?.name ?? id;
const escHtml = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
let lastStairsRoom: string | null = null;
function startLive() {
  live?.stop();
  live = new Live();
  live.onStatus = (s) => {
    if (s === 'unauthorized') { me = null; void route(); }
    else if (s === 'closed') void goSleep();
    else if (s === 'online') void updater.check();
    else if (s === 'paused') toast('閒置中，已暫停連線；回來點一下畫面就會繼續');
  };
  live.on((m) => {
    if (m.type === 'home.presence' && device?.home && m.home_id === device.home.id) {
      const d = presenceDiff(presenceSeen ? presence : null, m.users, me.user.id);
      presence = m.users; presenceSeen = true; renderPresence(); device.setPresence(m.users, !!m.owner_away);
      const msg = [...d.joined.map((n) => `${n} 來了`), ...d.left.map((n) => `${n} 離開了`)].join('、');
      if (msg) toast(msg);
      if (d.joined.length || d.left.length) blip(d.joined.length > 0);
    }
    else if (m.type === 'home.state' && device?.home && m.home.id === device.home.id) device.setHome(m);
    else if (m.type === 'home.kicked' && device?.home?.id === m.home_id) { toast('主人變更了存取設定，你被請出去了'); nav('/'); }
    else if (m.type === 'wallet.updated') setWallet(m.balance);
    // 一起賽車開跑（在家裡接受邀請的）：帶到賽車頁，頁面接手這場比賽
    else if (m.type === 'room.state' && m.room?.game === 'stairs' && m.room.id !== lastStairsRoom) { lastStairsRoom = m.room.id; if (location.pathname !== '/stairs-room' && m.room.countdown_ms === null) nav('/stairs-room'); }
    else if (m.type === 'race.started' && location.pathname !== '/race') { (window as any).__pendingRace = m; live!.inLobby = false; nav('/race'); }
    else if (m.type === 'room.invite') showRoomInvite(m);
    else if (m.type === 'game.closing') toast('小雞 5 分鐘後要睡覺囉～');
  });
  live.start();
  idleOff?.(); idleOff = watchIdle(live);
}
async function boot() {
  const st = await api('GET', '/status').catch(() => null);
  updater.boot(st);
  if (st && !st.open) return sleepPage(st); // 休息時段：不連資料庫、不開 WebSocket
  cfg = cfg ?? await api('GET', '/config');
  try { me = await api('GET', '/me'); setWallet(me.wallet.balance); savePetCache(localStorage, me.pet); startLive(); }
  catch (e) {
    if (e instanceof ApiError && e.code === 'GAME_CLOSED') return goSleep();
    if (!(e instanceof ApiError && e.status === 401)) toast(errText(e)); me = null;
  }
  await route();
}
void boot();
