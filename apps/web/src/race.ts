/** 賽車模式頁面：錦標賽選單、車庫、比賽（WS 即時多人，伺服器權威）、結果。 */
import { api, errText } from './api';
import type { Live } from './ws';
import { createRace, stepRace, trackSegs, SEG_LEN, raceRanking, trackById, CARS, PARTS, PART_KINDS, TRACKS, COUNTRIES, carStats, fillField, cupTrack, prizeFor, PRIZES, POINTS, ME, EXCHANGE, PAINTS, QUALIFY_RANK, RACES_PER_COUNTRY, RACE_SLOTS, NITRO_PER_RACE, type RaceState, type PartKind } from '@chick/engine';
import { drawRace, carCanvas, text, textW, zh, zhW, panel, drawMinimap, W, H, G, type ViewCar } from './race-gfx';

const segAt = (id: string, z: number) => { const s = trackSegs(id); return s[((Math.floor(z / SEG_LEN) % s.length) + s.length) % s.length].curve; };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const fmtMs = (ms: number | null) => ms === null ? '—' : `${Math.floor(ms / 60000)}'${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}"${String(Math.floor(ms / 10) % 100).padStart(2, '0')}`;
const WEATHER: Record<string, string> = { clear: '晴', rain: '雨', night: '夜', snow: '雪', fog: '霧' };
const ERR: Record<string, string> = { TRACK_LOCKED: '這個國家還沒解鎖（拿下前一國的國家冠軍）', INSUFFICIENT_RACE_CASH: '賽車獎金不夠', INSUFFICIENT_COINS: '金幣不夠', EXCHANGE_CAP: '今天的換匯額度用完了（50 枚）', TIER_LOCKED: '要先買前一級', ALREADY_OWNED: '已經有了', ALREADY_IN_MATCH: '你正在另一場比賽中', RACE_CLOSING: '快關門了，關門前 8 分鐘不開新比賽', GAME_CLOSING: '快關門了', ROOM_NOT_FOUND: '找不到這個房間', ROOM_FULL: '房間滿了', FORBIDDEN: '只有房主可以開始', NOT_FOUND: '找不到這個分享碼' };

interface Snap { at: number; tick: number; countdown: number; cars: Map<string, any[]> }
export function racePage(root: HTMLElement, live: Live | null, me: any, toast: (s: string) => void): () => void {
  root.innerHTML = `<main class="page race-page">
    <div class="race-dev"><div class="lcd race-lcd"><canvas id="rc" width="${W}" height="${H}"></canvas><p class="msg" id="rmsg">選一條賽道開始比賽！</p></div>
      <div class="race-pad" id="rpad">
        <button data-k="left" aria-label="左">◀</button><button data-k="right" aria-label="右">▶</button>
        <span class="sp"></span>
        <button data-k="nitro" class="n2o">N2O</button><button data-k="brake">煞車</button><button data-k="gas" class="gas">油門</button>
      </div>
      <p class="muted race-keys">鍵盤：←→ 轉向、↑/Z 油門、↓/X 煞車、空白鍵 氮氣</p>
    </div>
    <div class="panel race-panel"><h2>賽車錦標賽</h2>
      <div class="tabs" id="rtabs"><button data-t="cup" class="on">錦標賽</button><button data-t="garage">車庫</button><button data-t="board">排行榜</button></div>
      <div id="rbody"></div></div></main>`;
  const cv = root.querySelector('#rc') as HTMLCanvasElement, x = cv.getContext('2d')!; x.imageSmoothingEnabled = false;
  const body = root.querySelector('#rbody') as HTMLElement, msg = root.querySelector('#rmsg') as HTMLElement;
  let prof: any = null, cat: any = null, tab = 'cup', sel = 'tw1';
  let mode: 'menu' | 'lobby' | 'race' | 'results' = 'menu';
  let attract: RaceState | null = null, frame = 0, raf = 0, dead = false;
  let race: { id: string; track: string; laps: number; len: number; cars: any[]; snaps: Snap[]; ended: any | null } | null = null;
  const keys = { gas: false, brake: false, left: false, right: false, nitro: false };
  let seq = 0, lastSent = '', sendTimer = 0; let lobbyPlayers: string[] = [], lobbyStarts = 0, lobbyCode: string | null = null, lobbyHost: string | null = null, invite: any = null;

  const setMatch = (on: boolean) => { if (live) live.inMatch = on; };
  async function load() {
    try { const r = await api('GET', '/race/profile'); prof = r.profile; cat = r.catalog; } catch (e) { toast(errText(e)); }
    renderPanel();
  }
  function setAttract() { attract = createRace(7, sel, fillField([])); attract.countdown = 0; }
  // ---------- 面板 ----------
  function renderPanel() {
    root.querySelectorAll('#rtabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === tab));
    if (!prof) { body.innerHTML = '<p class="muted">載入中…</p>'; return; }
    if (mode === 'results' && race?.ended && !race.ended.aborted) return showResults(race.ended);
    const head = `<p class="race-cash">賽車獎金 <b>${money(prof.cash)}</b>　積分 <b>${prof.points}</b>　勝場 ${prof.wins}/${prof.races}<br><span class="muted">賽季 ${esc(prof.season)}（每月重置積分與解鎖，獎金和零件保留）</span></p>`;
    if (mode === 'lobby' || mode === 'race') {
      const priv = mode === 'lobby' && lobbyCode;
      body.innerHTML = head + (priv ? `<h3>私人房間 <b class="code">${esc(lobbyCode)}</b></h3><p>玩家：${lobbyPlayers.map(esc).join('、')}</p>
        <p><input id="rinv" placeholder="朋友的分享碼" maxlength="16"> <button id="rinvb">邀請</button></p>${lobbyHost === me.user.id ? '<button id="rstart" class="big">開始比賽</button>' : '<p class="muted">等房主開始…</p>'}` : `<p>${mode === 'lobby' ? '等待發車…' : '比賽進行中…'}</p>`) + `<button id="rleave">離開比賽</button>`;
      (body.querySelector('#rleave') as HTMLElement).onclick = leave;
      const ib = body.querySelector('#rinvb') as HTMLElement | null; if (ib) ib.onclick = () => live?.send({ type: 'race.invite', share_code: (body.querySelector('#rinv') as HTMLInputElement).value.trim() });
      const sb = body.querySelector('#rstart') as HTMLElement | null; if (sb) sb.onclick = () => live?.send({ type: 'race.start' });
      return;
    }
    if (tab === 'cup') {
      const ct = cupTrack(prof.cup); const st = Object.entries(prof.cup.points ?? {}).sort((a: any, b: any) => b[1] - a[1]) as [string, number][];
      body.innerHTML = head + (invite ? `<p class="invite">${esc(invite.from)} 邀你到私人房間（${esc(trackById(invite.track)?.name)}） <button id="rinvok">加入</button></p>` : '') +
        COUNTRIES.map((c, ci) => { const lock = ci >= prof.unlocked; return `<h3>${lock ? '🔒 ' : ''}${esc(c.name)}${ci === prof.cup.country ? ' <span class="muted">← 目前</span>' : ''}</h3><ul class="tracks">${c.tracks.map((id) => { const t = trackById(id)!, cur = ct?.id === id; return `<li class="${t.id === sel ? 'sel' : ''} ${lock ? 'lock' : ''}" data-tr="${t.id}"><span>${t.raceIdx + 1}. <b>${esc(t.name)}</b> <span class="muted">${WEATHER[t.weather]}・${t.laps} 圈</span></span><span>${cur ? '錦標賽站' : ''}</span></li>`; }).join('')}</ul>`; }).join('') +
        `<p class="muted">從最後一名起跑，共 ${RACE_SLOTS} 台。前 ${QUALIFY_RANK} 名晉級下一站；前 6 名有獎金 ${PRIZES.map(money).join('/')} 和積分 ${POINTS.join('/')}。每個國家 ${RACES_PER_COUNTRY} 站，國家積分第一解鎖下一國。</p>
        ${st.length ? `<h3>${esc(COUNTRIES[prof.cup.country]?.name)} 國家積分（第 ${prof.cup.race + 1} 站）</h3>${standingsHtml(st)}` : ''}
        <button id="rgo" class="big">出發：${esc(trackById(sel)!.name)}</button> <button id="rpriv">開私人房間</button>
        <p><input id="rcode" placeholder="房號" maxlength="6" size="8"> <button id="rjoin">用房號加入</button></p>`;
      body.querySelectorAll('li[data-tr]').forEach((li) => (li as HTMLElement).onclick = () => { const id = (li as HTMLElement).dataset.tr!; if (trackById(id)!.countryIdx >= prof.unlocked) return toast(ERR.TRACK_LOCKED); sel = id; setAttract(); renderPanel(); });
      (body.querySelector('#rgo') as HTMLElement).onclick = () => join();
      (body.querySelector('#rpriv') as HTMLElement).onclick = () => join({ type: 'race.create', track: sel });
      (body.querySelector('#rjoin') as HTMLElement).onclick = () => join({ type: 'race.join', code: (body.querySelector('#rcode') as HTMLInputElement).value.trim().toUpperCase() });
      const ok = body.querySelector('#rinvok') as HTMLElement | null; if (ok) ok.onclick = () => { const c = invite.code; invite = null; join({ type: 'race.join', code: c }); };
    } else if (tab === 'garage') {
      const st = carStats(prof.parts, prof.car);
      const partRow = (k: PartKind) => { const p = PARTS[k], lv = prof.parts[k], next = p.tiers[lv + 1];
        return `<li><span><b>${esc(p.label)}</b><br><span class="muted">${esc(p.tiers[lv].name)}　${'■'.repeat(lv)}${'□'.repeat(p.tiers.length - 1 - lv)}</span></span>${next ? `<button data-buy="${k}" data-tier="${lv + 1}" ${prof.cash < next.price ? 'disabled' : ''}>${esc(next.name)}<br>${money(next.price)}</button>` : '<span class="muted">滿級</span>'}</li>`; };
      body.innerHTML = head + `<div class="garage-car"><canvas id="gcar" width="52" height="34"></canvas><div><b>${esc(CARS.find((c) => c.id === prof.car)?.name)}</b><br><span class="muted">極速 ${Math.round(st.topSpeed * 3.6)} km/h・加速 ${st.accel.toFixed(0)}・抓地 ${st.grip.toFixed(2)}/${st.wetGrip.toFixed(2)}（雨）・裝甲 前${Math.round(st.armor.F * 100)}/側${Math.round(st.armor.S * 100)}/後${Math.round(st.armor.R * 100)}%</span></div></div>
        <p class="muted">每次碰撞（車、路邊、任何東西）都會降低完美度，完美度越低極速越慢；下一場前自動修好。</p>
        <h3>塗裝</h3><p>${Array.from({ length: PAINTS }, (_, i) => `<button data-paint="${i}" class="${prof.paint === i ? 'on' : ''}">${i + 1}</button>`).join(' ')}</p>
        <h3>零件</h3><ul>${PART_KINDS.map(partRow).join('')}</ul>
        <h3>車款</h3><ul>${CARS.map((c) => `<li><span><canvas class="mini" data-car="${c.id}" width="34" height="22"></canvas> <b>${esc(c.name)}</b> <span class="muted">${esc(c.desc ?? '')}</span></span>${prof.car === c.id ? '<span>使用中</span>' : prof.cars.includes(c.id) ? `<button data-car-buy="${c.id}">換這台</button>` : `<button data-car-buy="${c.id}" ${prof.cash < c.price ? 'disabled' : ''}>${money(c.price)}</button>`}</li>`).join('')}</ul>
        <h3>換匯</h3><p class="muted">1 金幣 → ${money(EXCHANGE.coinToCash)}；${money(EXCHANGE.cashPerCoin)} → 1 金幣；每天每個方向最多 ${EXCHANGE.dailyCapCoins} 枚。</p>
        <p><input id="rxn" type="number" min="1" max="${EXCHANGE.dailyCapCoins}" value="10" size="4"> 枚 <button id="rxin">金幣換獎金</button> <button id="rxout">獎金換金幣</button></p>`;
      const g = (body.querySelector('#gcar') as HTMLCanvasElement).getContext('2d')!; g.imageSmoothingEnabled = false; g.fillStyle = G[0]; g.fillRect(0, 0, 52, 34); g.drawImage(carCanvas(prof.car, prof.paint), 2, 2);
      body.querySelectorAll('canvas.mini').forEach((c) => { const cx = (c as HTMLCanvasElement).getContext('2d')!; cx.fillStyle = G[0]; cx.fillRect(0, 0, 34, 22); cx.drawImage(carCanvas((c as HTMLElement).dataset.car!, 0, {}, 1), 1, 1); });
      body.querySelectorAll('[data-buy]').forEach((b) => (b as HTMLElement).onclick = () => buy({ kind: (b as HTMLElement).dataset.buy, tier: +(b as HTMLElement).dataset.tier! }));
      body.querySelectorAll('[data-car-buy]').forEach((b) => (b as HTMLElement).onclick = () => buy({ car: (b as HTMLElement).dataset.carBuy }));
      body.querySelectorAll('[data-paint]').forEach((b) => (b as HTMLElement).onclick = () => buy({ car: prof.car, paint: +(b as HTMLElement).dataset.paint! }));
      const ex = (dir: string) => async () => { try { const r = await api('POST', '/race/exchange', { dir, coins: +(body.querySelector('#rxn') as HTMLInputElement).value }); prof = r.profile; toast(`換好了（今天已換 ${r.used_today} 枚）`); renderPanel(); } catch (e) { toast(ERR[(e as any).code] ?? errText(e)); } };
      (body.querySelector('#rxin') as HTMLElement).onclick = ex('in'); (body.querySelector('#rxout') as HTMLElement).onclick = ex('out');
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
  async function buy(b: any) { try { prof = await api('POST', '/race/buy', b); toast('買好了！'); renderPanel(); } catch (e) { toast(ERR[(e as any).code] ?? errText(e)); } }
  root.querySelectorAll('#rtabs button').forEach((b) => (b as HTMLElement).onclick = () => { tab = (b as HTMLElement).dataset.t!; renderPanel(); });

  // ---------- 連線 ----------
  function join(extra: any = { type: 'race.join', track: sel }) {
    if (!live?.send(extra)) return toast('連線中，請稍候');
    mode = 'lobby'; setMatch(true); msg.textContent = extra.type === 'race.create' ? '建立私人房間…' : '尋找對手中…'; renderPanel();
  }
  function leave() { live?.send({ type: 'race.leave' }); race = null; mode = 'menu'; lobbyCode = null; setMatch(false); msg.textContent = '已離開比賽'; renderPanel(); }
  const off = live?.on((m) => {
    if (m.type === 'error' && ['race.join', 'race.create', 'race.start', 'race.invite'].includes(m.for)) { if (m.for !== 'race.invite' && m.for !== 'race.start') { mode = 'menu'; setMatch(false); } msg.textContent = ERR[m.code] ?? m.code; toast(ERR[m.code] ?? m.code); renderPanel(); }
    else if (m.type === 'race.room') { lobbyCode = m.code; renderPanel(); }
    else if (m.type === 'race.invited') { invite = m; toast(`${m.from} 邀你賽車（房號 ${m.code}）`); if (mode === 'menu') renderPanel(); }
    else if (m.type === 'race.invite_sent') toast(m.online ? '邀請已送出' : '對方目前不在線上');
    else if (m.type === 'race.lobby') { const first = mode !== 'lobby'; mode = 'lobby'; lobbyPlayers = m.players.map((p: any) => p.name); lobbyStarts = m.starts_at; lobbyCode = m.code; lobbyHost = m.host; const s = Math.max(0, Math.ceil((m.starts_at - (live?.serverNow() ?? Date.now())) / 1000)); msg.textContent = `等待玩家 ${m.players.length} 人（${s} 秒後發車，空位由電腦補上）`; if (first || m.code) renderPanel(); }
    else if (m.type === 'race.started') { race = { id: m.race_id, track: m.track, laps: m.laps, len: m.len, cars: m.cars, snaps: [], ended: null }; mode = 'race'; lobbyCode = null; setMatch(true); msg.textContent = `${trackById(m.track)!.name}・${m.cars.length} 台・${m.laps} 圈・氮氣 ${NITRO_PER_RACE} 次`; renderPanel(); }
    else if (m.type === 'race.snap' && race && m.race_id === race.id) {
      race.snaps.push({ at: performance.now(), tick: m.tick, countdown: m.countdown, cars: new Map(m.cars.map((c: any[]) => [c[0], c])) }); if (race.snaps.length > 6) race.snaps.shift();
    }
    else if (m.type === 'race.ended' && race && m.race_id === race.id) {
      race.ended = m; mode = 'results'; setMatch(false);
      if (m.aborted) { msg.textContent = '比賽中止（伺服器重啟）'; return; }
      const r = m.me; msg.textContent = r ? `第 ${r.rank} 名！獎金 ${money(r.prize)}・${r.qualified ? '晉級' : '未晉級'}${r.champion ? '・國家冠軍！' : ''}` : '比賽結束';
      if (r) prof = { ...prof, cash: r.cash, unlocked: r.unlocked, cup: r.cup };
      showResults(m); void load();
    }
  });
  const stName = (k: string) => k === ME ? '你' : k.startsWith('user:') ? '其他玩家' : k;
  function standingsHtml(st: [string, number][]) { return `<ol class="results">${st.slice(0, 10).map(([k, p]) => `<li class="${k === ME ? 'me' : ''}"><span>${esc(stName(k))}</span><span>${p} 分</span></li>`).join('')}</ol>`; }
  function showResults(m: any) {
    const e = m.me;
    body.innerHTML = `<h3>${esc(trackById(m.track)!.name)} 結果</h3><ol class="results">${m.ranking.map((c: any) => `<li class="${c.id === me.user.id ? 'me' : ''}"><span>${c.rank}. ${esc(c.name)}${c.ai ? ' <span class="muted">電腦</span>' : ''}</span><span>${fmtMs(c.time_ms)}</span></li>`).join('')}</ol>
      ${e ? `<p>獎金 <b>${money(e.prize)}</b>　積分 +${e.points}　完美度 <b>${e.condition}%</b>（撞傷下一場前自動修好）</p>
      <p>${e.cup_counted ? (e.qualified ? (e.champion ? '🏆 國家冠軍！解鎖下一個國家' : e.country_done ? '本國四站結束，但不是冠軍，重新挑戰這個國家' : '晉級下一站') : '沒進前 10 名：這個國家要從第 1 站重來') : '<span class="muted">這場不是你目前的錦標賽站（不計國家積分）</span>'}</p>
      ${e.cup_counted ? `<h3>國家積分</h3>${standingsHtml(e.standings)}` : ''}` : ''}<button id="rback" class="big">回選單</button>`;
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
  const kd = onKey(true), ku = onKey(false);
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  function pushInput(force = false) {
    if (mode !== 'race') return; const s = JSON.stringify(keys); if (!force && s === lastSent) return; lastSent = s;
    live?.send({ type: 'race.input', seq: ++seq, ...keys });
  }
  sendTimer = window.setInterval(() => pushInput(true), 250);
  // ---------- 繪圖迴圈 ----------
  let lastStep = performance.now();
  function view(): ViewCar[] | null {
    if (!race || race.snaps.length === 0) return null;
    const now = performance.now() - 100; const sn = race.snaps; let a = sn[0], b = sn[sn.length - 1];
    for (let i = 0; i < sn.length - 1; i++) if (sn[i].at <= now && sn[i + 1].at >= now) { a = sn[i]; b = sn[i + 1]; }
    const f = b.at === a.at ? 1 : Math.max(0, Math.min(1, (now - a.at) / (b.at - a.at)));
    return race.cars.map((c) => { const p = a.cars.get(c.id), q = b.cars.get(c.id) ?? p; if (!p || !q) return null;
      return { id: c.id, name: c.name, ai: c.ai, car: c.car, color: c.color, z: p[1] + (q[1] - p[1]) * f, x: p[2] + (q[2] - p[2]) * f, speed: q[3], damage: q[4], nitro: q[5], nitroT: q[6], fin: q[7], hit: q[8], brake: c.id === me.user.id ? keys.brake : q[3] < p[3] - 0.5 } as ViewCar; }).filter(Boolean) as ViewCar[];
  }
  function loop() {
    if (dead) return; raf = requestAnimationFrame(loop);
    const now = performance.now(); if (now - lastStep < 1000 / 20) return; lastStep = now; frame++;
    const t = trackById(race?.track ?? sel)!;
    if (race && (mode === 'race' || mode === 'results')) {
      const cars = view(); if (!cars) return drawWait();
      const meCar = cars.find((c) => c.id === me.user.id) ?? null;
      const last = race.snaps[race.snaps.length - 1];
      const fk = (c: ViewCar) => c.fin ?? 1e12; const ranked = [...cars].sort((p, q) => fk(p) - fk(q) || q.z - p.z);
      if (import.meta.env.DEV && meCar) (window as any).__race = { x: meCar.x, z: meCar.z, curve: segAt(trackById(race.track)!.id, meCar.z + 40) };
      const flash = meCar?.fin != null ? 'FINISH!' : meCar && meCar.hit > 0 ? 'CRASH!' : meCar && meCar.nitroT > 0 ? 'NITRO!' : meCar && Math.abs(meCar.x) > 1 ? 'OFF ROAD' : undefined;
      drawRace(x, { track: t, me: meCar, cars, tick: last.tick, countdown: last.countdown, laps: race.laps, len: race.len, rank: meCar ? ranked.indexOf(meCar) + 1 : 0, frame, hud: true, flash });
      if (mode === 'results') drawResultsOverlay(); return;
    }
    if (mode === 'lobby') return drawWait();
    // 選單：電腦自己跑的展示畫面
    if (!attract || attract.track !== sel) setAttract();
    stepRace(attract!); if (attract!.over) setAttract();
    const lead = raceRanking(attract!)[2];
    const cars = attract!.cars.map((c) => ({ id: c.id, name: c.name, ai: true, car: c.car, color: c.color, z: c.z, x: c.x, speed: c.speed, damage: c.damage, nitro: c.nitro, nitroT: c.nitroT, fin: c.finishedTick, hit: c.hit }));
    drawRace(x, { track: t, me: cars.find((c) => c.id === lead.id)!, cars, tick: attract!.tick, countdown: 0, laps: attract!.laps, len: attract!.len, rank: 0, frame, hud: false });
    // 選單標題（原生 240×200）
    panel(x, 0, 0, W, 24); text(x, 'GRAND PRIX', 6, 5, 0, 2); zh(x, `${t.country}・${t.name}`, W - 6 - zhW(x, `${t.country}・${t.name}`), 6, 1);
    panel(x, 4, H - 40, 120, 36); zh(x, `${t.country} 第 ${t.raceIdx + 1} 站 / ${RACES_PER_COUNTRY}`, 10, H - 36, 0); zh(x, `${WEATHER[t.weather]}・${t.laps} 圈・冠軍 ${money(prizeFor(1))}`, 10, H - 21, 1);
    drawMinimap(x, { track: t, me: null, cars: [], tick: 0, countdown: 0, laps: t.laps, len: attract!.len, rank: 0, frame, hud: false }, W - 72, H - 64, 68, 60);
    if (frame % 20 < 13) { panel(x, W / 2 - 52, 84, 104, 22); text(x, 'PRESS GO', W / 2 - 46, 88, 0, 2); }
  }
  /** 賽前資訊卡（等待玩家時）：國家、賽道、長度、圈數、天氣、出發倒數、參賽者 */
  function drawWait() {
    const t = trackById(race?.track ?? sel)!; drawRace(x, { track: t, me: null, cars: [], tick: 0, countdown: 0, laps: t.laps, len: 1, rank: 0, frame, hud: false, camZ: frame * 4, camX: 0 });
    panel(x, 12, 14, W - 24, H - 28, 3, 1);
    text(x, 'RACE INFO', 22, 22, 0, 2);
    zh(x, `${t.country}　${t.name}`, 22, 44, 0, 12);
    const km = (trackSegs(t.id).length * SEG_LEN / 1000).toFixed(1);
    zh(x, `賽道長 ${km} km × ${t.laps} 圈`, 22, 62, 1); zh(x, `天氣：${WEATHER[t.weather]}　冠軍獎金 ${money(prizeFor(1))}`, 22, 78, 1);
    zh(x, `玩家 ${lobbyPlayers.length} 人＋電腦 ${RACE_SLOTS - lobbyPlayers.length} 台${lobbyCode ? `　房號 ${lobbyCode}` : ''}`, 22, 94, 1);
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
    zh(x, `獎金 ${money(e.prize)}　+${e.points} 分`, 96, 32, 0); zh(x, `時間 ${fmtMs(e.time_ms)}`, 96, 46, 1);
    zh(x, `完美度 ${e.condition}%　${e.qualified ? '晉級' : '未晉級（前 10 名）'}`, 96, 60, e.qualified ? 0 : 1);
    (race!.ended.ranking as any[]).slice(0, 6).forEach((c, i) => { const y = 80 + i * 14, mine = c.id === me.user.id; if (mine) { x.fillStyle = G[2]; x.fillRect(24, y - 2, W - 48, 14); } text(x, String(c.rank), 30, y + 2, mine ? 0 : 1); zh(x, c.name, 44, y, mine ? 0 : 1); text(x, c.time_ms === null ? '--' : fmtMs(c.time_ms).replace(/[’'"]/g, (m: string) => m === '"' ? '.' : ':'), W - 30 - textW('0:00.00'), y + 2, mine ? 0 : 1); });
    const st = (e.standings ?? []) as [string, number][]; const myPos = st.findIndex((s) => s[0] === ME) + 1;
    zh(x, e.champion ? '國家冠軍！下一個國家解鎖' : e.country_done ? `本國結束：積分第 ${myPos} 名` : `國家積分第 ${myPos || '-'} 名（${st.find((s) => s[0] === ME)?.[1] ?? 0} 分）`, 26, H - 26, 0);
  }
  setAttract(); loop(); void load();
  return () => { dead = true; cancelAnimationFrame(raf); clearInterval(sendTimer); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); off?.(); if (mode === 'lobby' || mode === 'race') live?.send({ type: 'race.leave' }); setMatch(false); };
}
