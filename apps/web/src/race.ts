/** 賽車模式頁面：錦標賽選單、車庫、比賽（WS 即時多人，伺服器權威）、結果。 */
import { tabNav } from './race-nav';
import { mergeRoomList, friendRoomsHtml, type FriendRoom, type RoomLists } from './race-rooms-list';
import { statusHtml, mountStatus } from './race-status';
import { raceOrder, kmhShown } from './race-gfx';
import { fitScale } from './race-fit';
import { api, errText } from './api';
import type { Live } from './ws';
import { pickupShare } from '@chick/engine';
import { createRace, stepRace, trackSegs, SEG_LEN, raceRanking, trackById, CARS, PARTS, PART_KINDS, TRACKS, COUNTRIES, carStats, fillField, cupTrack, prizeFor, PRIZES, POINTS, ME, PAINT_NAMES, MAX_OUT_COST, PRICE_DIVISOR, QUALIFY_RANK, RACES_PER_COUNTRY, RACE_SLOTS, NITRO_PER_RACE, type RaceState, type PartKind } from '@chick/engine';
import { drawShop, newShop, shopHit, shopMove, isPaint, SHOP_SCREENS } from './race-shop';
import { drawRace, carCanvas, text, textW, zh, zhW, panel, drawMinimap, W, H, G, type ViewCar } from './race-gfx';
import { SnapClock, bracket } from './race-interp';
import { cupSel, saveRace, savedRace, type SavedRace } from './race-nav';

const segAt = (id: string, z: number) => { const s = trackSegs(id); return s[((Math.floor(z / SEG_LEN) % s.length) + s.length) % s.length].curve; };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
let hitAc: AudioContext | null = null;
/** v15 撞擊音：短促的雜訊＋低頻方波，力道越大越響越長。靜音（localStorage chick.mute = '1'）或瀏覽器擋住就略過。 */
function hitSound(strength: number) {
  try {
    if (localStorage.getItem('chick.mute') === '1') return;
    hitAc = hitAc ?? new AudioContext(); const ac = hitAc, t = ac.currentTime, k = Math.max(0.3, Math.min(1, strength / 8)), dur = 0.08 + 0.14 * k;
    const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const n = ac.createBufferSource(), g = ac.createGain(), o = ac.createOscillator(), og = ac.createGain();
    n.buffer = buf; g.gain.value = 0.05 + 0.07 * k; n.connect(g).connect(ac.destination); n.start(t);
    o.type = 'square'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(55, t + dur);
    og.gain.setValueAtTime(0.04 * k, t); og.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(og).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch { /* ignore */ }
}
const money = (n: number) => '◎' + Math.round(n).toLocaleString('en-US');
/** 畫布字型沒有 ◎，畫面裡用「N 金幣」 */
const coinTxt = (n: number) => `${Math.round(n)} 金幣`;
const fmtMs = (ms: number | null) => ms === null ? '—' : `${Math.floor(ms / 60000)}'${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}"${String(Math.floor(ms / 10) % 100).padStart(2, '0')}`;
const WEATHER: Record<string, string> = { clear: '晴', rain: '雨', night: '夜', snow: '雪', fog: '霧' };
const ERR: Record<string, string> = { ROOM_FULL: '房間滿了', ROOM_CLOSED: '房間已經關了', ROOM_STARTING: '這間房正要開跑，來不及加入', ALREADY_IN_ROOM: '你已經在別的房間了', NOT_HOST: '只有房主可以改', NOT_IN_ROOM: '你不在這間房裡', TRACK_LOCKED: '這個國家還沒解鎖（拿下前一國的國家冠軍）', INSUFFICIENT_COINS: '金幣不夠（去下樓梯賺吧）', ALREADY_OWNED: '已經裝著這個了', ALREADY_IN_MATCH: '你正在另一場比賽中', RACE_CLOSING: '快關門了，關門前 8 分鐘不開新比賽', GAME_CLOSING: '快關門了', GAME_CLOSED: '現在沒有開放', INTERNAL: '伺服器出錯了，稍後再試', BAD_REQUEST: '請求有誤，重新整理頁面再試一次' };

interface Snap { at: number; tick: number; countdown: number; cars: Map<string, any[]>; pk?: number[] }
export function racePage(root: HTMLElement, live: Live | null, me: any, toast: (s: string) => void): () => void {
  root.innerHTML = `<main class="page race-page nosel">
    <div class="race-dev"><div class="lcd race-lcd"><canvas id="rc" width="${W}" height="${H}"></canvas><p class="msg" id="rmsg">選一條賽道開始比賽！</p></div>
      <div class="race-pad" id="rpad">
        <button data-k="left" aria-label="左">◀</button><button data-k="right" aria-label="右">▶</button>
        <span class="sp"></span>
        <button data-k="nitro" class="n2o">N2O</button><button data-k="brake">煞車</button><button data-k="gas" class="gas">油門</button>
      </div>
      <div class="race-pad shop-pad" id="spad" hidden>
        <button data-s="prev" aria-label="上一類">◀類</button><button data-s="left" aria-label="左">←</button><button data-s="up" aria-label="上">↑</button><button data-s="down" aria-label="下">↓</button><button data-s="right" aria-label="右">→</button><button data-s="next" aria-label="下一類">類▶</button>
        <span class="sp"></span><button data-s="back">B</button><button data-s="ok" class="gas">A 確定</button>
      </div>
      <p class="muted race-keys" id="skeys" hidden>改裝店：←→↑↓ 選格子（撞到邊換類別）、Q/E 或 PageUp/PageDown 換類別、Enter/Z 確定、Esc/X 取消；也可以直接點畫面</p>
      <p class="muted race-keys" id="rkeys">鍵盤：←→ 轉向、↑/Z 油門、↓/X 煞車、空白鍵 氮氣</p>
    </div>
    <div class="panel race-panel"><h2>賽車錦標賽</h2>
      <div class="tabs" id="rtabs"><button data-t="cup" class="on">錦標賽</button><button data-t="garage">車庫</button><button data-t="status">狀態</button><button data-t="board">排行榜</button></div>
      <div id="rbody"></div></div></main>`;
  const cv = root.querySelector('#rc') as HTMLCanvasElement, x = cv.getContext('2d')!; x.imageSmoothingEnabled = false;
  // v24：整數倍縮放（裝置像素），置中；k<2 時維持填滿寬度
  const fit = () => { const box = cv.parentElement!, f = fitScale(box.clientWidth, window.devicePixelRatio || 1); cv.style.width = f.k ? `${f.cssW}px` : ''; cv.style.margin = f.k ? '0 auto' : ''; };
  const ro = new ResizeObserver(fit); ro.observe(cv.parentElement!); fit();
  const body = root.querySelector('#rbody') as HTMLElement, msg = root.querySelector('#rmsg') as HTMLElement;
  let prof: any = null, cat: any = null, tab = 'cup', sel = 'tw1', coins = 0;
  const shop = newShop();
  let mode: 'menu' | 'lobby' | 'race' | 'results' = 'menu';
  let attract: RaceState | null = null, frame = 0, raf = 0, dead = false;
  let race: { id: string; inst: string; track: string; laps: number; len: number; cars: any[]; snaps: Snap[]; ended: any | null; pickups: [number, number, number, number?][] } | null = null;
  const keys = { gas: false, brake: false, left: false, right: false, nitro: false };
  let seq = 0, lastSent = '', sendTimer = 0; let lobbyPlayers: string[] = [], lobbyStarts = 0;
  /** 單人出發的賽道跟著目前錦標賽站（手動點了別條賽道就不跟） */
  let followCup = true;
  /** v27 賽車房：開房表單、按了準備等確認、表單裡選的賽道／圈數 */
  const roomLists: RoomLists = new Map(); let friendRooms: FriendRoom[] = [], friendAsked = false;
  const askRooms = () => { if (!live?.room && live?.send({ type: 'room.list' })) { roomLists.clear(); friendAsked = true; } };
  let roomForm = false, readyAsk = false, roomTrack = '', roomLaps = 3;
  /** 斷線重連中：要接回的比賽（等伺服器回 race.started(resumed)／race.ended／race.gone） */
  let resuming: SavedRace | null = null, resumeT = 0;

  const setMatch = (on: boolean) => { if (live) live.inMatch = on; };
  async function load() {
    try { const [r, m] = await Promise.all([api('GET', '/race/profile'), api('GET', '/me')]); prof = r.profile; cat = r.catalog; coins = m.wallet?.balance ?? 0; } catch (e) { toast(errText(e)); }
    if (prof) sel = cupSel(sel, followCup, prof.cup_track ?? null, prof.unlocked, (id) => trackById(id)?.countryIdx ?? null);
    renderPanel();
  }
  function setAttract() { attract = createRace(7, sel, fillField([])); attract.countdown = 0; }
  // ---------- 面板 ----------
  function renderPanel() {
    root.querySelectorAll('#rtabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === tab));
    const inShop = shopOn(); (root.querySelector('#rpad') as HTMLElement).hidden = inShop; (root.querySelector('#rkeys') as HTMLElement).hidden = inShop;
    (root.querySelector('#spad') as HTMLElement).hidden = !inShop; (root.querySelector('#skeys') as HTMLElement).hidden = !inShop;
    if (inShop && shop.cur < 0) setCat(shop.cat);
    if (!prof) { body.innerHTML = '<p class="muted">載入中…</p>'; return; }
    if (mode === 'results' && race?.ended && !race.ended.aborted) return showResults(race.ended);
    const head = `<p class="race-cash">金幣 <b>${money(coins)}</b>　積分 <b>${prof.points}</b>　勝場 ${prof.wins}/${prof.races}<br><span class="muted">賽季 ${esc(prof.season)}（每月重置積分與解鎖，獎金和零件保留）</span></p>`;
    if (mode === 'menu' && live?.room?.game === 'race') return renderRoom(head);
    if (mode === 'menu' && roomForm) return renderRoomForm(head);
    if (mode === 'lobby' || mode === 'race') {
      body.innerHTML = `<button id="rleave" class="race-top-btn">離開比賽</button>` + head + `<p>${mode === 'lobby' ? '準備發車…' : '比賽進行中…'}</p>`;
      (body.querySelector('#rleave') as HTMLElement).onclick = leave;
      return;
    }
    if (tab === 'cup') {
      const ct = cupTrack(prof.cup); const st = Object.entries(prof.cup.points ?? {}).sort((a: any, b: any) => b[1] - a[1]) as [string, number][];
      body.innerHTML = `<div class="race-top-row"><button id="rgo" class="big race-top-btn">單人出發：${esc(trackById(sel)!.name)}</button><button id="rroom" class="big race-top-btn">開房間</button></div>` + head +
        friendRoomsHtml(friendRooms, (id) => { const t = trackById(id); return t ? `${t.country}・${t.name}` : id; }, friendAsked && !friendRooms.length && !roomLists.size) +
        COUNTRIES.map((c, ci) => { const lock = ci >= prof.unlocked; return `<h3>${lock ? '🔒 ' : ''}${esc(c.name)}${ci === prof.cup.country ? ' <span class="muted">← 目前</span>' : ''}</h3><ul class="tracks">${c.tracks.map((id) => { const t = trackById(id)!, cur = ct?.id === id; return `<li class="${t.id === sel ? 'sel' : ''} ${lock ? 'lock' : ''}" data-tr="${t.id}"><span>${t.raceIdx + 1}. <b>${esc(t.name)}</b> <span class="muted">${WEATHER[t.weather]}・${t.laps} 圈</span></span><span>${cur ? '錦標賽站' : ''}</span></li>`; }).join('')}</ul>`; }).join('') +
        `<p class="muted">從最後一名起跑，共 ${RACE_SLOTS} 台。前 ${QUALIFY_RANK} 名晉級下一站；前 6 名有獎金 ${PRIZES.map(money).join('/')} 和積分 ${POINTS.join('/')}。每個國家 ${RACES_PER_COUNTRY} 站，國家積分第一解鎖下一國。</p>
        ${st.length ? `<h3>${esc(COUNTRIES[prof.cup.country]?.name)} 國家積分（第 ${prof.cup.race + 1} 站）</h3>${standingsHtml(st)}` : ''}
        <p class="muted">想和朋友一起跑？到家裡按「玩 → 一起賽車」，在場的人會收到邀請（跟一起下樓梯一樣）；空位由灰色電腦車補滿 ${RACE_SLOTS} 台。</p>`;
      body.querySelectorAll('li[data-tr]').forEach((li) => (li as HTMLElement).onclick = () => { const id = (li as HTMLElement).dataset.tr!; if (trackById(id)!.countryIdx >= prof.unlocked) return toast(ERR.TRACK_LOCKED); sel = id; followCup = id === cupTrack(prof.cup)?.id; setAttract(); renderPanel(); });
      (body.querySelector('#rgo') as HTMLElement).onclick = () => join();
      (body.querySelector('#rrefresh') as HTMLElement).onclick = () => { askRooms(); renderPanel(); };
      body.querySelectorAll('[data-rjoin]').forEach((b) => (b as HTMLElement).onclick = () => { const el = b as HTMLElement; if (!live?.send({ type: 'room.join', room: el.dataset.rjoin, inst: el.dataset.rinst })) return toast('連線中，請稍候'); msg.textContent = '加入房間中…'; });
      (body.querySelector('#rroom') as HTMLElement).onclick = () => { roomForm = true; roomTrack = sel; roomLaps = trackById(sel)?.laps ?? 3; renderPanel(); };
    } else if (tab === 'garage') {
      const st = carStats(prof.parts, prof.car);
      body.innerHTML = head + `<h3>改裝店（在左邊畫面裡）</h3><p class="muted">8 類零件＋塗裝，共 9 個畫面，用 ◀類／類▶ 換類別。每類任選一階直接買（不用照順序）；換別的階（包括降級）舊零件丟掉、全額付款、不退錢。全部 3 階共 ${money(MAX_OUT_COST)}（TG2 原價 ÷${PRICE_DIVISOR}）。氮氣升級只加強力道和時間，每場一律 ${NITRO_PER_RACE} 次；雨胎下雨／下雪時自動換上。</p>
        <p class="muted">目前：極速 ${Math.round(kmhShown(st.topSpeed))} km/h（雨胎／乾地胎再各 +${Math.round(kmhShown(st.tireTopWet))}／+${Math.round(kmhShown(st.tireTopDry))}）・加速 ${st.accel.toFixed(0)}・抓地 ${st.grip.toFixed(2)}／雨 ${st.wetGrip.toFixed(2)}・裝甲 前${Math.round(st.armor.F * 100)}／後${Math.round(st.armor.R * 100)}／側${Math.round(st.armor.S * 100)}%・塗裝 ${esc(PAINT_NAMES[prof.paint] ?? '')}</p>
        <h3>車款 <span class="muted">外觀，免費隨意換</span></h3><ul>${CARS.map((c) => `<li><span><canvas class="mini" data-car="${c.id}" width="34" height="22"></canvas> <b>${esc(c.name)}</b> <span class="muted">${esc(c.desc ?? '')}</span></span>${prof.car === c.id ? '<span>使用中</span>' : `<button data-car-buy="${c.id}">換這台</button>`}</li>`).join('')}</ul>`;
      body.querySelectorAll('canvas.mini').forEach((c) => { const cx = (c as HTMLCanvasElement).getContext('2d')!; cx.fillStyle = G[0]; cx.fillRect(0, 0, 34, 22); cx.drawImage(carCanvas((c as HTMLElement).dataset.car!, prof.paint, {}, 1), 1, 1); });
      body.querySelectorAll('[data-car-buy]').forEach((b) => (b as HTMLElement).onclick = () => buy({ car: (b as HTMLElement).dataset.carBuy }));
    } else if (tab === 'status') {
      body.innerHTML = head + statusHtml(prof); mountStatus(body, prof);
    } else {
      body.innerHTML = head + `<select id="rlbt">${TRACKS.map((t) => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.country)}・${esc(t.name)}</option>`).join('')}</select><div id="rlb" class="muted">載入中…</div>`;
      const sl = body.querySelector('#rlbt') as HTMLSelectElement; sl.onchange = () => loadBoard(sl.value); void loadBoard(sel);
    }
  }
  async function loadBoard(id: string) {
    try { const r = await api('GET', `/race/leaderboard/${id}`); const el = body.querySelector('#rlb'); if (!el) return;
      el.innerHTML = `<h3>最快完賽</h3><ol>${r.best.map((b: any) => `<li><span>${esc(b.name)}</span><span>${fmtMs(b.time_ms)}</span></li>`).join('') || '<li class="muted">還沒有人跑完</li>'}</ol><h3>錦標賽積分</h3><ol>${r.championship.map((b: any) => `<li><span>${esc(b.name)}</span><span>${b.points} 分</span></li>`).join('')}</ol>`;
    } catch (e) { toast(errText(e)); }
  }
  async function buy(b: any) { try { const r = await api('POST', '/race/buy', b); if (typeof r.balance === 'number') coins = r.balance; prof = { ...prof, ...r }; shop.confirm = false; note(b.kind ? '換裝好了！' : b.paint !== undefined ? `換成${PAINT_NAMES[b.paint]}色了！` : '換好了！'); renderPanel(); } catch (e) { shop.confirm = false; const m = ERR[(e as any).code] ?? errText(e); note(m); toast(m); } }
  // ---------- 改裝店（畫布內） ----------
  function shopOn() { return !!prof && tab === 'garage' && mode === 'menu'; }
  function note(s: string) { shop.note = s; shop.noteT = frame + 50; }
  function setCat(c: number) { shop.cat = (c + SHOP_SCREENS) % SHOP_SCREENS; shop.confirm = false; shop.note = ''; shop.cur = isPaint(shop.cat) ? prof.paint : prof.parts[PART_KINDS[shop.cat]]; }
  function shopAct(a: string) {
    if (!shopOn()) return;
    if (a === 'prev' || a === 'next') return setCat(shop.cat + (a === 'next' ? 1 : -1));
    if (a === 'back') { shop.confirm = false; shop.note = ''; return; }
    if (a === 'ok') {
      if (isPaint(shop.cat)) { if (shop.cur !== prof.paint) void buy({ paint: shop.cur }); return; }
      const k = PART_KINDS[shop.cat] as PartKind, t = PARTS[k].tiers[shop.cur];
      if (prof.parts[k] === shop.cur) return note(ERR.ALREADY_OWNED);
      if (t.price > coins) return note(ERR.INSUFFICIENT_COINS);
      if (!shop.confirm) { shop.confirm = true; shop.note = ''; return; }
      return void buy({ kind: k, tier: shop.cur });
    }
    const edge = shopMove(shop, a as any); if (edge) { setCat(shop.cat + (edge === 'next' ? 1 : -1)); if (edge === 'prev') shop.cur = isPaint(shop.cat) ? 3 : 1; else shop.cur = 0; }
  }
  root.querySelectorAll('#rtabs button').forEach((b) => (b as HTMLElement).onclick = () => { const r = tabNav(mode, (b as HTMLElement).dataset.t!); tab = r.tab; mode = r.mode; if (r.clearRace) race = null; renderPanel(); });

  // ---------- v27 賽車房 ----------
  const lapOpts = (cur: number) => [1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === cur ? 'selected' : ''}>${n} 圈</option>`).join('');
  const trackOpts = (cur: string) => TRACKS.filter((t) => t.countryIdx < prof.unlocked).map((t) => `<option value="${t.id}" ${t.id === cur ? 'selected' : ''}>${esc(t.country)}・${esc(t.name)}（${WEATHER[t.weather]}）</option>`).join('');
  function renderRoomForm(head: string) {
    body.innerHTML = `<div class="race-top-row"><button id="rmk" class="big race-top-btn">建立房間</button><button id="rmx" class="big race-top-btn">取消</button></div>` + head +
      `<h3>開房間</h3><label class="room-field">賽道 <select id="rmt">${trackOpts(roomTrack)}</select></label><label class="room-field">圈數 <select id="rml">${lapOpts(roomLaps)}</select></label>
      <p class="muted">建立後，好友（去過彼此家裡、或在邀請名單裡的人）不管在哪個畫面都會收到邀請。最多 ${8} 位玩家，其餘由電腦車補滿。房間比賽獎金：2 位以上真人時前三名 ◎150／100／50、只有自己一人時完賽 ◎50（取代一般獎金）；圈數跟賽道預設不同時不算積分、錦標賽與最快時間。</p>`;
    (body.querySelector('#rmt') as HTMLSelectElement).onchange = (e) => { roomTrack = (e.target as HTMLSelectElement).value; roomLaps = trackById(roomTrack)?.laps ?? roomLaps; renderPanel(); };
    (body.querySelector('#rml') as HTMLSelectElement).onchange = (e) => { roomLaps = Number((e.target as HTMLSelectElement).value); };
    (body.querySelector('#rmx') as HTMLElement).onclick = () => { roomForm = false; renderPanel(); };
    (body.querySelector('#rmk') as HTMLElement).onclick = () => { if (!live?.send({ type: 'room.create', track: roomTrack, laps: roomLaps })) return toast('連線中，請稍候'); msg.textContent = '開房中…'; };
  }
  const roomLeft = (r: any) => r.countdown_ms === null ? null : Math.max(0, Math.ceil((r.countdown_ms - (Date.now() - r.at)) / 1000));
  function renderRoom(head: string) {
    const r = live!.room, my = r.members.find((m: any) => m.user === me.user.id), host = r.host === me.user.id, t = trackById(r.track)!, left = roomLeft(r);
    const top = readyAsk ? `<button id="rrok" class="big race-top-btn">確定準備</button><button id="rrno" class="big race-top-btn">先不要</button>`
      : `<button id="rrlv" class="big race-top-btn">離開房間</button>${my?.ready ? '<button id="rrun" class="big race-top-btn">取消準備</button>' : '<button id="rrdy" class="big race-top-btn">準備</button>'}`;
    const ready = r.members.filter((m: any) => m.ready).length;
    body.innerHTML = `<div class="race-top-row">${top}</div>${readyAsk ? '<p class="room-ask">確定準備好了嗎？全員準備後 3 秒開跑。</p>' : ''}` + head +
      `<h3>${esc(r.members.find((m: any) => m.host)?.name ?? '')} 的賽車房 <span class="muted">${r.members.length}/8 人</span></h3>
      ${left !== null ? `<div class="room-cd"><span>全員準備！</span><b id="rcd">${left}</b><span>秒後開跑</span></div>` : ''}
      <div class="room-cfg">${host ? `<label class="room-field">賽道 <select id="rct">${trackOpts(r.track)}</select></label><label class="room-field">圈數 <select id="rcl">${lapOpts(r.laps)}</select></label>`
        : `<p>賽道：<b>${esc(t.country)}・${esc(t.name)}</b>（${WEATHER[t.weather]}）・<b>${r.laps}</b> 圈 <span class="muted">（房主決定）</span></p>`}
        <p class="muted">房間獎金：2 位以上真人時前三名 ◎150／100／50；只有自己一人時完賽 ◎50${r.laps !== t.laps ? '；圈數跟賽道預設不同，不算積分、錦標賽與最快時間' : ''}</p></div>
      <h3>成員 <span class="muted">準備 ${ready}/${r.members.length}</span></h3>
      <ul class="room-members">${r.members.map((m: any) => `<li class="${m.ready ? 'ok' : ''} ${m.online ? '' : 'off'}"><span>${esc(m.name)}${m.host ? ' <span class="room-tag">房主</span>' : ''}${m.user === me.user.id ? ' <span class="muted">（你）</span>' : ''}</span><span class="room-st">${!m.online ? '斷線中…' : m.ready ? '✔ 準備好了' : '等待中'}</span></li>`).join('')}</ul>
      <p class="muted">房間 ${Math.ceil(r.expires_ms / 60000)} 分鐘內沒有動作會自動關閉。房主離開時交給最早加入的人。</p>`;
    const on = (id: string, f: () => void) => { const el = body.querySelector(id) as HTMLElement | null; if (el) el.onclick = f; };
    on('#rrlv', () => { live?.send({ type: 'room.leave' }); live!.room = null; readyAsk = false; msg.textContent = '已離開房間'; renderPanel(); });
    on('#rrdy', () => { readyAsk = true; renderPanel(); });
    on('#rrno', () => { readyAsk = false; renderPanel(); });
    on('#rrok', () => { readyAsk = false; live?.send({ type: 'room.ready', ready: true }); });
    on('#rrun', () => live?.send({ type: 'room.ready', ready: false }));
    const ct = body.querySelector('#rct') as HTMLSelectElement | null; if (ct) ct.onchange = () => live?.send({ type: 'room.config', track: ct.value });
    const cl = body.querySelector('#rcl') as HTMLSelectElement | null; if (cl) cl.onchange = () => live?.send({ type: 'room.config', laps: Number(cl.value) });
  }
  askRooms(); const roomListT = window.setInterval(() => { if (mode === 'menu' && tab === 'cup' && !live?.room && !roomForm && !document.hidden) askRooms(); }, 15_000); // 好友的房間：定期更新
  const roomTick = window.setInterval(() => { const el = body.querySelector('#rcd'); if (el && live?.room) { const l = roomLeft(live.room); if (l !== null) el.textContent = String(l); } }, 200);
  // ---------- 連線 ----------
  function join() {
    if (mode !== 'menu') return; // 已經在準備／比賽中：不重複開
    if (!live?.send({ type: 'race.solo', track: sel })) return toast('連線中，請稍候');
    mode = 'lobby'; setMatch(true); lobbyPlayers = [me.user.display_name]; lobbyStarts = live.serverNow() + 1000; msg.textContent = '準備發車…'; renderPanel(); // 倒數跟 drawWait 一樣用伺服器時間
  }
  /** 離開：連著就用目前這場；重連中還沒接回，就帶上比賽 id 讓伺服器知道是哪一場 */
  const leaveMsg = () => { const r = race ? { id: race.id, inst: race.inst } : resuming; return r ? { type: 'race.leave', race_id: r.id, inst: r.inst } : { type: 'race.leave' }; };
  function leave() { live?.send(leaveMsg()); stopResume(); saveRace(null); race = null; mode = 'menu'; setMatch(false); msg.textContent = '已離開比賽'; renderPanel(); }
  function onStarted(m: any) {
    stopResume(); race = { id: m.race_id, inst: m.inst, track: m.track, laps: m.laps, len: m.len, cars: m.cars, snaps: [], ended: null, pickups: Array.isArray(m.pickups) ? m.pickups : [] }; saveRace({ id: m.race_id, inst: m.inst });
    clock.reset(); lastHitT = -1; mode = 'race'; setMatch(true); const hum = m.cars.filter((c: any) => !c.ai).length;
    lobbyPlayers = m.cars.filter((c: any) => !c.ai).map((c: any) => c.name); // 第一張快照到之前的資訊卡（從家裡來的也有名單）
    msg.textContent = m.resumed ? '接回比賽了！' : `${trackById(m.track)!.name}・${hum > 1 ? `${hum} 位玩家＋` : ''}電腦 ${m.cars.length - hum} 台・${m.laps} 圈・氮氣 ${NITRO_PER_RACE} 次`; renderPanel();
  }
  // ---------- 斷線重連：接回同一場（伺服器等 30 秒，超過才算棄賽） ----------
  function stopResume() { resuming = null; clearTimeout(resumeT); }
  function tryResume() {
    if (!resuming || !live?.send({ type: 'race.resume', race_id: resuming.id, inst: resuming.inst })) return; // 還沒連上：等 hello 再送
    clearTimeout(resumeT); resumeT = window.setTimeout(() => { if (resuming) gone('連不回剛才的比賽'); }, 8000); // 開賽的伺服器不在了就不會回
  }
  function gone(text: string) { stopResume(); saveRace(null); race = null; mode = 'menu'; setMatch(false); msg.textContent = text; toast(text); renderPanel(); void load(); }
  const off = live?.on((m) => {
    if (m.type === 'hello') { // 重新連上（新連線還沒接上比賽）
      const r = resuming ?? (race && mode === 'race' ? { id: race.id, inst: race.inst } : null);
      if (r) { resuming = r; msg.textContent = '重新連線，接回比賽中…'; tryResume(); }
    }
    if (m.type === 'race.gone' && resuming && m.race_id === resuming.id) return gone('斷線太久，這場比賽算棄賽了');
    if (m.type === 'race.ended' && !race && resuming && m.race_id === resuming.id) // 重新整理後才收到結果：沒有畫面資料，只顯示結果
      race = { id: m.race_id, inst: resuming.inst, track: m.track ?? sel, laps: 0, len: 1, cars: [], snaps: [], ended: null, pickups: [] };
    if (m.type === 'room.state') { roomForm = false; if (live?.room?.game === 'race' && trackById(live.room.track) && sel !== live.room.track) { sel = live.room.track; followCup = false; } if (live?.room?.members?.find((x: any) => x.user === me.user.id)?.ready) readyAsk = false; if (mode === 'menu') { msg.textContent = live?.room?.countdown_ms != null ? '全員準備，即將開跑！' : '賽車房：大家按「準備」就開跑'; renderPanel(); } }
    if (m.type === 'room.list') { friendRooms = mergeRoomList(roomLists, m.inst, m.rooms); if (mode === 'menu' && tab === 'cup' && !live?.room && !roomForm) renderPanel(); }
    if (m.type === 'hello' || m.type === 'room.gone') askRooms();
    if (m.type === 'room.gone') { readyAsk = false; if (m.code !== 'STARTED' && mode === 'menu') { msg.textContent = ({ EXPIRED: '房間閒置太久，已經關閉', ROOM_CLOSED: '房間已經關了', LEFT: '已離開房間', EMPTY: '房間已關閉' } as any)[m.code] ?? '房間已關閉'; renderPanel(); } }
    if (m.type === 'error' && typeof m.for === 'string' && m.for.startsWith('room.')) { toast(ERR[m.code] ?? m.code); msg.textContent = ERR[m.code] ?? m.code; }
    if (m.type === 'wallet.updated') { coins = m.balance; if (tab === 'garage' && mode === 'menu') renderPanel(); }
    if (m.type === 'error' && typeof m.for === 'string' && m.for.startsWith('race.')) { mode = 'menu'; setMatch(false); msg.textContent = ERR[m.code] ?? m.code; toast(ERR[m.code] ?? m.code); renderPanel(); }
    else if (m.type === 'race.notice' && !m.home_id) { mode = 'menu'; setMatch(false); msg.textContent = ERR[m.code] ?? m.code; renderPanel(); }
    else if (m.type === 'race.started') onStarted(m);
    else if (m.type === 'race.snap' && race && m.race_id === race.id) {
      clock.onSnap(m.tick, performance.now()); race.snaps.push({ at: performance.now(), tick: m.tick, countdown: m.countdown, cars: new Map(m.cars.map((c: any[]) => [c[0], c])), pk: Array.isArray(m.pk) ? m.pk : [] }); if (race.snaps.length > 8) race.snaps.shift();
    }
    else if (m.type === 'race.ended' && race && m.race_id === race.id) {
      race.ended = m; mode = 'results'; setMatch(false); stopResume(); saveRace(null);
      if (m.aborted) { msg.textContent = '比賽中止，這場不算（伺服器重啟或關門）'; renderPanel(); return; }
      const r = m.me; msg.textContent = r ? `第 ${r.rank} 名！獎金 ${money(r.prize)}・${r.qualified ? '晉級' : '未晉級'}${r.champion ? '・國家冠軍！' : ''}` : '比賽結束';
      if (r) prof = { ...prof, unlocked: r.unlocked, cup: r.cup };
      showResults(m); void load();
    }
  });
  let knownNames = new Map<string, string>(); // 這場比賽裡其他真人的名字（積分榜 user:id → 名字）
  const stName = (k: string) => k === ME ? '你' : k.startsWith('user:') ? knownNames.get(k.slice(5)) ?? '其他玩家' : k;
  function standingsHtml(st: [string, number][]) { return `<ol class="results">${st.slice(0, 10).map(([k, p]) => `<li class="${k === ME ? 'me' : ''}"><span>${esc(stName(k))}</span><span>${p} 分</span></li>`).join('')}</ol>`; }
  function showResults(m: any) {
    for (const c of m.ranking ?? []) if (!c.ai) knownNames.set(c.id, c.name);
    const e = m.me;
    body.innerHTML = `<button id="rback" class="big race-top-btn">回選單</button><h3>${esc(trackById(m.track)!.name)} 結果</h3><ol class="results">${m.ranking.map((c: any) => `<li class="${c.id === me.user.id ? 'me' : ''}"><span>${c.rank}. ${esc(c.name)}${c.ai ? ' <span class="muted">電腦</span>' : ''}</span><span>${fmtMs(c.time_ms)}</span></li>`).join('')}</ol>
      ${e ? `<p>獎金 <b>${money(e.prize)}</b>　積分 +${e.points}　完美度 <b>${e.condition}%</b>（撞傷下一場前自動修好）</p>
      <p>${e.cup_counted ? (e.qualified ? (e.champion ? '🏆 國家冠軍！解鎖下一個國家' : e.country_done ? '本國四站結束，但不是冠軍，重新挑戰這個國家' : '晉級下一站') : '沒進前 10 名：這個國家要從第 1 站重來') : '<span class="muted">這場不是你目前的錦標賽站（不計國家積分）</span>'}</p>
      ${e.cup_counted ? `<h3>國家積分</h3>${standingsHtml(e.standings)}` : ''}` : ''}`;
    (body.querySelector('#rback') as HTMLElement).onclick = () => { mode = 'menu'; race = null; renderPanel(); };
  }
  // ---------- 操作：觸控按鈕＋鍵盤（不 stopPropagation，閒置偵測要收到 pointerdown） ----------
  const pad = root.querySelector('#rpad') as HTMLElement;
  pad.querySelectorAll('button').forEach((b) => {
    const k = (b as HTMLElement).dataset.k as keyof typeof keys;
    const set = (v: boolean) => (e: Event) => { if (e.cancelable) e.preventDefault(); keys[k] = v; b.classList.toggle('on', v); pushInput(); };
    b.addEventListener('pointerdown', set(true)); b.addEventListener('pointerup', set(false)); b.addEventListener('pointerleave', set(false)); b.addEventListener('pointercancel', set(false));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  const KEYMAP: Record<string, keyof typeof keys> = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'gas', z: 'gas', Z: 'gas', w: 'gas', W: 'gas', ArrowDown: 'brake', x: 'brake', X: 'brake', s: 'brake', S: 'brake', ' ': 'nitro', n: 'nitro', N: 'nitro' };
  const onKey = (v: boolean) => (e: KeyboardEvent) => { const k = KEYMAP[e.key]; if (!k || (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return; if (mode === 'race') e.preventDefault(); if (keys[k] !== v) { keys[k] = v; pushInput(); } };
  const SKEY: Record<string, string> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down', q: 'prev', e: 'next', PageUp: 'prev', PageDown: 'next', Enter: 'ok', z: 'ok', ' ': 'ok', Escape: 'back', x: 'back', Backspace: 'back' };
  const kdRace = onKey(true), ku = onKey(false);
  const kd = (e: KeyboardEvent) => {
    const tg = (e.target as HTMLElement)?.tagName; if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
    if (shopOn()) { const a = SKEY[e.key.length === 1 ? e.key.toLowerCase() : e.key]; if (a) { e.preventDefault(); shopAct(a); } return; }
    kdRace(e);
  };
  root.querySelectorAll('#spad button').forEach((b) => { b.addEventListener('pointerdown', (e) => { if (e.cancelable) e.preventDefault(); shopAct((b as HTMLElement).dataset.s!); }); b.addEventListener('contextmenu', (e) => e.preventDefault()); });
  cv.addEventListener('pointerdown', (e) => { if (!shopOn()) return; const r = cv.getBoundingClientRect(); const h = shopHit(shop.cat, (e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height);
    if (h === 'prev' || h === 'next') shopAct(h); else if (typeof h === 'number') { if (h === shop.cur) shopAct('ok'); else { shop.cur = h; shop.confirm = false; shop.note = ''; } } });
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  function pushInput(force = false) {
    if (mode !== 'race') return; const s = JSON.stringify(keys); if (!force && s === lastSent) return; lastSent = s;
    live?.send({ type: 'race.input', seq: ++seq, ...keys });
  }
  sendTimer = window.setInterval(() => pushInput(true), 250);
  // ---------- 繪圖迴圈 ----------
  const clock = new SnapClock(), T0 = performance.now();
  let lastHitT = -1; // 第一次看到就只記下，不補放舊的撞擊音
  let acc = 0, lastNow = T0, prevAttract: Map<string, [number, number]> | null = null;
  function view(): ViewCar[] | null {
    if (!race || race.snaps.length === 0) return null;
    const [a, b, f] = bracket(race.snaps, clock.renderTick(performance.now()));
    return race.cars.map((c) => { const p = a.cars.get(c.id), q = b.cars.get(c.id) ?? p; if (!p || !q) return null;
      return { id: c.id, name: c.name, ai: c.ai, car: c.car, color: c.color, pet: c.ai ? null : c.pet ?? null, z: p[1] + (q[1] - p[1]) * f, x: p[2] + (q[2] - p[2]) * f, speed: p[3] + (q[3] - p[3]) * f, damage: q[4], nitro: q[5], nitroT: q[6], fin: q[7], hit: q[8], evT: q[9] ?? 0, evK: q[10] ?? 0, evS: q[11] ?? 0, evSide: q[12] ?? 0, zd: [q[14] ?? 0, q[15] ?? 0, q[16] ?? 0], pkT: q[17] ?? 0, flip: (q[13] ?? 0) && (p[13] ?? 0) ? p[13] + (q[13] - p[13]) * f : q[13] ?? 0, brake: c.id === me.user.id ? keys.brake : q[3] < p[3] - 0.5 } as ViewCar; }).filter(Boolean) as ViewCar[];
  }
  // 每個 rAF 都重畫（60fps）；位置依時間內插。動畫用的 frame 仍是 20Hz 計數（閃爍等節奏不變）。
  function loop() {
    if (dead) return; raf = requestAnimationFrame(loop);
    const now = performance.now(); acc = Math.min(acc + (now - lastNow), 250); lastNow = now;
    frame = Math.floor((now - T0) / 50);
    const t = trackById(race?.track ?? sel)!;
    if (race && (mode === 'race' || mode === 'results')) {
      const cars = view(); if (!cars) { drawWait(); if (mode === 'results') drawResultsOverlay(); return; }
      const meCar = cars.find((c) => c.id === me.user.id) ?? null;
      const last = race.snaps[race.snaps.length - 1];
      const ranked = raceOrder(cars);
      if (import.meta.env.DEV && meCar) (window as any).__race = { x: meCar.x, z: meCar.z, curve: segAt(trackById(race.track)!.id, meCar.z + 40) };
      const flash = meCar?.fin != null ? 'FINISH!' : meCar && meCar.hit > 0 ? 'CRASH!' : meCar && Math.abs(meCar.x) > 1 ? 'OFF ROAD' : undefined;
      if (meCar && (meCar.evT ?? 0) > lastHitT) { if (lastHitT >= 0) hitSound(meCar.evK === 5 ? 12 : meCar.evS ?? 2); lastHitT = meCar.evT!; }
      const stt = prof ? carStats(prof.parts, prof.car) : null;
      const taken = new Set(last.pk ?? []);
      const share = meCar ? pickupShare(ranked.indexOf(meCar) + 1, cars.length) : 1; // v26：依自己名次只畫看得到的道具（伺服器同一套判定）
      const pickups = race.pickups.filter((p) => !taken.has(p[0]) && (p[3] ?? 0) < share && Math.abs(p[1] - (meCar?.z ?? 0)) < race!.len / 2).map((p) => ({ z: p[1], x: p[2] }));
      drawRace(x, { pickups, gears: [4, 5, 5, 6][prof?.parts?.gearbox ?? 0], top: stt?.topSpeed, track: t, me: meCar, cars, tick: last.tick, countdown: last.countdown, laps: race.laps, len: race.len, rank: meCar ? ranked.indexOf(meCar) + 1 : 0, frame, hud: true, flash });
      if (mode === 'results') drawResultsOverlay(); return;
    }
    if (mode === 'lobby') return drawWait();
    if (shopOn()) { drawShop(x, shop, prof, coins, frame); return; }
    // 選單：電腦自己跑的展示畫面
    if (!attract || attract.track !== sel) setAttract();
    while (acc >= 50) { acc -= 50; prevAttract = new Map(attract!.cars.map((c) => [c.id, [c.z, c.x]])); stepRace(attract!); if (attract!.over) { setAttract(); prevAttract = null; } }
    const af = acc / 50, ip = (c: { id: string; z: number; x: number }, i: 0 | 1) => { const p = prevAttract?.get(c.id); const v = i ? c.x : c.z; return p ? p[i] + (v - p[i]) * af : v; };
    const lead = raceRanking(attract!)[2];
    const cars = attract!.cars.map((c) => ({ id: c.id, name: c.name, ai: true, car: c.car, color: c.color, z: ip(c, 0), x: ip(c, 1), speed: c.speed, damage: c.damage, nitro: c.nitro, nitroT: c.nitroT, fin: c.finishedTick, hit: c.hit }));
    drawRace(x, { track: t, me: cars.find((c) => c.id === lead.id)!, cars, tick: attract!.tick, countdown: 0, laps: attract!.laps, len: attract!.len, rank: 0, frame, hud: false });
    // 選單標題（原生 240×200）
    panel(x, 0, 0, W, 24); text(x, 'GRAND PRIX', 6, 5, 0, 2); zh(x, `${t.country}・${t.name}`, W - 6 - zhW(x, `${t.country}・${t.name}`), 6, 1);
    panel(x, 4, H - 40, 120, 36); zh(x, `${t.country} 第 ${t.raceIdx + 1} 站 / ${RACES_PER_COUNTRY}`, 10, H - 36, 0); const rr = live?.room?.game === 'race' && live.room.track === t.id ? live.room : null; // v27：在賽車房裡顯示房間設定的圈數與房間獎金
    zh(x, rr ? `${WEATHER[t.weather]}・${rr.laps} 圈・冠軍 ${coinTxt(rr.members.length > 1 ? 150 : 50)}` : `${WEATHER[t.weather]}・${t.laps} 圈・冠軍 ${coinTxt(prizeFor(1))}`, 10, H - 21, 1);
    drawMinimap(x, { track: t, me: null, cars: [], tick: 0, countdown: 0, laps: t.laps, len: attract!.len, rank: 0, frame, hud: false }, W - 72, H - 64, 68, 60);
    if (frame % 20 < 13) { panel(x, W / 2 - 52, 84, 104, 22); text(x, 'PRESS GO', W / 2 - 46, 88, 0, 2); }
  }
  /** 賽前資訊卡（等待玩家時）：國家、賽道、長度、圈數、天氣、出發倒數、參賽者 */
  function drawWait() {
    const t = trackById(race?.track ?? sel)!; drawRace(x, { track: t, me: null, cars: [], tick: 0, countdown: 0, laps: t.laps, len: 1, rank: 0, frame, hud: false, camZ: (performance.now() - T0) / 12.5, camX: 0 });
    panel(x, 12, 14, W - 24, H - 28, 3, 1);
    text(x, 'RACE INFO', 22, 22, 0, 2);
    zh(x, `${t.country}　${t.name}`, 22, 44, 0, 12);
    const km = (trackSegs(t.id).length * SEG_LEN / 1000).toFixed(1);
    zh(x, `賽道長 ${km} km × ${race?.laps || t.laps} 圈`, 22, 62, 1); zh(x, `天氣：${WEATHER[t.weather]}　冠軍獎金 ${coinTxt(prizeFor(1))}`, 22, 78, 1);
    zh(x, `玩家 ${lobbyPlayers.length} 人＋電腦 ${RACE_SLOTS - lobbyPlayers.length} 台`, 22, 94, 1);
    lobbyPlayers.slice(0, 4).forEach((n, i) => zh(x, `・${n}`, 22 + (i % 2) * 90, 112 + Math.floor(i / 2) * 15, 0));
    drawMinimap(x, { track: t, me: null, cars: [], tick: 0, countdown: 0, laps: t.laps, len: 1, rank: 0, frame, hud: false }, W - 86, 22, 64, 56);
    const left = Math.max(0, Math.ceil((lobbyStarts - (live?.serverNow() ?? Date.now())) / 1000));
    panel(x, W / 2 - 60, H - 40, 120, 20, 2, 0); text(x, `START ${left}S`, W / 2 - textW(`START ${left}S`, 2) / 2, H - 37, 0, 2);
  }
  /** 結果畫面（原生解析度）：名次大字、獎金、時間、前六名 */
  function drawResultsOverlay() {
    const e = race?.ended?.me; if (!e) return;
    panel(x, 16, 8, W - 32, H - 16, 3, 1);
    text(x, 'RESULT', W / 2 - textW('RESULT', 2) / 2, 13, 0, 2);
    text(x, `P${e.rank}`, 26, 32, 0, 5);
    zh(x, `獎金 ${coinTxt(e.prize)}　+${e.points} 分`, 96, 32, 0); zh(x, `時間 ${fmtMs(e.time_ms)}`, 96, 46, 1);
    zh(x, `完美度 ${e.condition}%　${e.qualified ? '晉級' : '未晉級（前 10 名）'}`, 96, 60, e.qualified ? 0 : 1);
    (race!.ended.ranking as any[]).slice(0, 6).forEach((c, i) => { const y = 80 + i * 14, mine = c.id === me.user.id; if (mine) { x.fillStyle = G[2]; x.fillRect(24, y - 2, W - 48, 14); } text(x, String(c.rank), 30, y + 2, mine ? 0 : 1); zh(x, c.name, 44, y, mine ? 0 : 1); text(x, c.time_ms === null ? '--' : fmtMs(c.time_ms).replace(/[’'"]/g, (m: string) => m === '"' ? '.' : ':'), W - 30 - textW('0:00.00'), y + 2, mine ? 0 : 1); });
    const st = (e.standings ?? []) as [string, number][]; const myPos = st.findIndex((s) => s[0] === ME) + 1;
    zh(x, e.champion ? '國家冠軍！下一個國家解鎖' : e.country_done ? `本國結束：積分第 ${myPos} 名` : `國家積分第 ${myPos || '-'} 名（${st.find((s) => s[0] === ME)?.[1] ?? 0} 分）`, 26, H - 26, 0);
  }
  setAttract(); loop(); void load();
  const pend = (window as any).__pendingRace; if (pend) { (window as any).__pendingRace = null; onStarted(pend); } // 在家裡接受邀請後被帶過來
  else { const sv = savedRace(); if (sv) { resuming = sv; mode = 'lobby'; setMatch(true); msg.textContent = '接回剛才的比賽…'; tryResume(); renderPanel(); } } // 比賽中重新整理頁面
  return () => { clearInterval(roomTick); clearInterval(roomListT); ro.disconnect(); dead = true; cancelAnimationFrame(raf); clearInterval(sendTimer); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); off?.(); if (mode === 'lobby' || mode === 'race') live?.send(leaveMsg()); stopResume(); saveRace(null); setMatch(false); };
}
