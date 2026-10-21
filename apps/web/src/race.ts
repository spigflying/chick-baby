/** 賽車模式頁面：錦標賽選單、車庫、比賽（WS 即時多人，伺服器權威）、結果。 */
import { api, errText } from './api';
import type { Live } from './ws';
import { createRace, stepRace, trackSegs, SEG_LEN, raceRanking, trackById, CARS, PARTS, PART_KINDS, TRACKS, carStats, NITRO_PER_RACE, type RaceState, type PartKind } from '@chick/engine';
import { drawRace, carCanvas, text, W, H, G, type ViewCar } from './race-gfx';

const segAt = (id: string, z: number) => { const s = trackSegs(id); return s[((Math.floor(z / SEG_LEN) % s.length) + s.length) % s.length].curve; };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const fmtMs = (ms: number | null) => ms === null ? '—' : `${Math.floor(ms / 60000)}'${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}"${String(Math.floor(ms / 10) % 100).padStart(2, '0')}`;
const WEATHER: Record<string, string> = { clear: '晴', rain: '雨', night: '夜', snow: '雪' };
const ERR: Record<string, string> = { TRACK_LOCKED: '這條賽道還沒解鎖（前一站拿到前三名）', CAR_WRECKED: '車子全毀了，先到車庫修理', INSUFFICIENT_RACE_CASH: '賽車獎金不夠', TIER_LOCKED: '要先買前一級', ALREADY_OWNED: '已經有了', NOTHING_TO_REPAIR: '車子沒有損傷', ALREADY_IN_MATCH: '你正在另一場比賽中' };

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
  let prof: any = null, cat: any = null, tab = 'cup', sel = 'tpe';
  let mode: 'menu' | 'lobby' | 'race' | 'results' = 'menu';
  let attract: RaceState | null = null, frame = 0, raf = 0, dead = false;
  let race: { id: string; track: string; laps: number; len: number; cars: any[]; snaps: Snap[]; ended: any | null } | null = null;
  const keys = { gas: false, brake: false, left: false, right: false, nitro: false };
  let seq = 0, lastSent = '', sendTimer = 0;

  const setMatch = (on: boolean) => { if (live) live.inMatch = on; };
  async function load() {
    try { const r = await api('GET', '/race/profile'); prof = r.profile; cat = r.catalog; } catch (e) { toast(errText(e)); }
    renderPanel();
  }
  function setAttract() { attract = createRace(7, sel, CARS.map((c, i) => ({ id: 'a' + i, name: c.name, ai: true, car: c.id })).concat([{ id: 'a4', name: 'x', ai: true, car: 'falcon' }, { id: 'a5', name: 'y', ai: true, car: 'arrow' }])); attract.countdown = 0; }
  // ---------- 面板 ----------
  function renderPanel() {
    root.querySelectorAll('#rtabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === tab));
    if (!prof) { body.innerHTML = '<p class="muted">載入中…</p>'; return; }
    if (mode === 'results' && race?.ended && !race.ended.aborted) return showResults(race.ended);
    const head = `<p class="race-cash">賽車獎金 <b>${money(prof.cash)}</b>　積分 <b>${prof.points}</b>　勝場 ${prof.wins}/${prof.races}</p>`;
    if (mode === 'lobby' || mode === 'race') { body.innerHTML = head + `<p>比賽進行中…</p><button id="rleave">離開比賽</button>`; (body.querySelector('#rleave') as HTMLElement).onclick = leave; return; }
    if (tab === 'cup') {
      body.innerHTML = head + `<ul class="tracks">${TRACKS.map((t, i) => { const lock = i >= prof.unlocked; return `<li class="${t.id === sel ? 'sel' : ''} ${lock ? 'lock' : ''}" data-tr="${t.id}"><span>${i + 1}. ${lock ? '🔒' : ''}<b>${esc(t.name)}</b> <span class="muted">${esc(t.country)}・${WEATHER[t.weather]}・${t.laps} 圈</span></span><span>${money(t.prize)}</span></li>`; }).join('')}</ul>
        <p class="muted">前三名解鎖下一站。名次獎金：1 名全額、2 名 60%、3 名 40%…；積分 10/6/4/3/2/1。</p>
        ${prof.damage > 0 ? `<p>車子損傷 <b>${Math.round(prof.damage)}%</b>（越壞越慢）</p>` : ''}
        <button id="rgo" class="big">出發：${esc(trackById(sel)!.name)}</button>`;
      body.querySelectorAll('li[data-tr]').forEach((li) => (li as HTMLElement).onclick = () => { const id = (li as HTMLElement).dataset.tr!; if (TRACKS.findIndex((t) => t.id === id) >= prof.unlocked) return toast(ERR.TRACK_LOCKED); sel = id; setAttract(); renderPanel(); });
      (body.querySelector('#rgo') as HTMLElement).onclick = join;
    } else if (tab === 'garage') {
      const st = carStats(prof.parts, prof.car);
      const partRow = (k: PartKind) => { const p = PARTS[k], lv = prof.parts[k], next = p.tiers[lv + 1];
        return `<li><span><b>${esc(p.label)}</b><br><span class="muted">${esc(p.tiers[lv].name)}　${'■'.repeat(lv)}${'□'.repeat(p.tiers.length - 1 - lv)}</span></span>${next ? `<button data-buy="${k}" data-tier="${lv + 1}" ${prof.cash < next.price ? 'disabled' : ''}>${esc(next.name)}<br>${money(next.price)}</button>` : '<span class="muted">滿級</span>'}</li>`; };
      body.innerHTML = head + `<div class="garage-car"><canvas id="gcar" width="40" height="22"></canvas><div><b>${esc(CARS.find((c) => c.id === prof.car)?.name)}</b><br><span class="muted">極速 ${Math.round(st.topSpeed * 3.6)} km/h・加速 ${st.accel.toFixed(0)}・抓地 ${st.grip.toFixed(2)}/${st.wetGrip.toFixed(2)}（雨）・裝甲 ${Math.round(st.armor * 100)}%</span></div></div>
        <h3>維修</h3><p>損傷 <b>${Math.round(prof.damage)}%</b> ${prof.damage > 0 ? `<button id="rfix">修好 ${money(prof.repair_cost)}</button>` : '<span class="muted">車況良好</span>'}</p>
        <h3>零件</h3><ul>${PART_KINDS.map(partRow).join('')}</ul>
        <h3>車款</h3><ul>${CARS.map((c) => `<li><span><canvas class="mini" data-car="${c.id}" width="20" height="11"></canvas> <b>${esc(c.name)}</b> <span class="muted">${esc(c.desc ?? '')}</span></span>${prof.car === c.id ? '<span>使用中</span>' : prof.cars.includes(c.id) ? `<button data-car-buy="${c.id}">換這台</button>` : `<button data-car-buy="${c.id}" ${prof.cash < c.price ? 'disabled' : ''}>${money(c.price)}</button>`}</li>`).join('')}</ul>`;
      const g = (body.querySelector('#gcar') as HTMLCanvasElement).getContext('2d')!; g.imageSmoothingEnabled = false; g.fillStyle = G[0]; g.fillRect(0, 0, 40, 22); g.drawImage(carCanvas(prof.car, 0), 8, 4);
      body.querySelectorAll('canvas.mini').forEach((c) => { const cx = (c as HTMLCanvasElement).getContext('2d')!; cx.fillStyle = G[0]; cx.fillRect(0, 0, 20, 11); cx.drawImage(carCanvas((c as HTMLElement).dataset.car!, 0, {}, 1), 2, 1); });
      body.querySelectorAll('[data-buy]').forEach((b) => (b as HTMLElement).onclick = () => buy({ kind: (b as HTMLElement).dataset.buy, tier: +(b as HTMLElement).dataset.tier! }));
      body.querySelectorAll('[data-car-buy]').forEach((b) => (b as HTMLElement).onclick = () => buy({ car: (b as HTMLElement).dataset.carBuy }));
      const fix = body.querySelector('#rfix') as HTMLElement | null; if (fix) fix.onclick = async () => { try { prof = await api('POST', '/race/repair'); toast('修好了！'); renderPanel(); } catch (e) { toast(errText(e)); } };
    } else {
      body.innerHTML = head + `<select id="rlbt">${TRACKS.map((t) => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select><div id="rlb" class="muted">載入中…</div>`;
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
  function join() {
    if (!live?.send({ type: 'race.join', track: sel })) return toast('連線中，請稍候');
    mode = 'lobby'; setMatch(true); msg.textContent = '尋找對手中…'; renderPanel();
  }
  function leave() { live?.send({ type: 'race.leave' }); race = null; mode = 'menu'; setMatch(false); msg.textContent = '已離開比賽'; renderPanel(); }
  const off = live?.on((m) => {
    if (m.type === 'error' && m.for === 'race.join') { mode = 'menu'; setMatch(false); msg.textContent = ERR[m.code] ?? m.code; renderPanel(); }
    else if (m.type === 'race.lobby') { mode = 'lobby'; const s = Math.max(0, Math.ceil((m.starts_at - (live?.serverNow() ?? Date.now())) / 1000)); msg.textContent = `等待玩家 ${m.players.length} 人（${s} 秒後發車，空位由電腦補上）`; }
    else if (m.type === 'race.started') { race = { id: m.race_id, track: m.track, laps: m.laps, len: m.len, cars: m.cars, snaps: [], ended: null }; mode = 'race'; setMatch(true); msg.textContent = `${trackById(m.track)!.name}・${m.laps} 圈・氮氣 ${NITRO_PER_RACE} 次`; renderPanel(); }
    else if (m.type === 'race.snap' && race && m.race_id === race.id) {
      race.snaps.push({ at: performance.now(), tick: m.tick, countdown: m.countdown, cars: new Map(m.cars.map((c: any[]) => [c[0], c])) }); if (race.snaps.length > 6) race.snaps.shift();
    }
    else if (m.type === 'race.ended' && race && m.race_id === race.id) {
      race.ended = m; mode = 'results'; setMatch(false);
      if (m.aborted) { msg.textContent = '比賽中止（伺服器重啟）'; return; }
      const r = m.me; msg.textContent = r ? `第 ${r.rank} 名！獎金 ${money(r.prize)}${r.new_unlock ? `，解鎖 ${trackById(r.new_unlock)!.name}` : ''}` : '比賽結束';
      if (r) { prof = { ...prof, cash: r.cash, damage: r.damage, unlocked: r.unlocked }; }
      showResults(m); void load();
    }
  });
  function showResults(m: any) {
    body.innerHTML = `<h3>${esc(trackById(m.track)!.name)} 結果</h3><ol class="results">${m.ranking.map((c: any) => `<li class="${c.id === me.user.id ? 'me' : ''}"><span>${c.rank}. ${esc(c.name)}${c.ai ? ' <span class="muted">電腦</span>' : ''}</span><span>${fmtMs(c.time_ms)}</span></li>`).join('')}</ol>
      ${m.me ? `<p>獎金 <b>${money(m.me.prize)}</b>　車損 <b>${Math.round(m.me.damage)}%</b>${m.me.damage > 0 ? '（到車庫修理）' : ''}</p>` : ''}<button id="rback" class="big">回選單</button>`;
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
      const ranked = [...cars].sort((p, q) => (p.fin ?? Infinity) - (q.fin ?? Infinity) || q.z - p.z);
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
    x.fillStyle = G[3]; x.fillRect(0, 0, W, 13); text(x, 'GRAND PRIX', 2, 2, 0, 1); text(x, t.id.toUpperCase(), W - 14, 2, 1);
    if (frame % 20 < 12) { x.fillStyle = G[3]; x.fillRect(W / 2 - 23, 52, 46, 9); text(x, 'PRESS GO', W / 2 - 15, 54, 0); }
  }
  function drawWait() { const t = trackById(race?.track ?? sel)!; drawRace(x, { track: t, me: null, cars: [], tick: 0, countdown: 0, laps: t.laps, len: 1, rank: 0, frame, hud: false, camZ: 0, camX: 0 }); x.fillStyle = G[3]; x.fillRect(W / 2 - 30, 44, 60, 11); text(x, 'WAITING' + '.'.repeat(frame / 6 % 4), W / 2 - 26, 47, 0); }
  function drawResultsOverlay() { const e = race?.ended?.me; if (!e) return; x.fillStyle = G[3]; x.fillRect(20, 20, 80, 42); x.fillStyle = G[0]; x.fillRect(21, 21, 78, 40); text(x, 'RESULT', 48, 24, 3); text(x, `POS ${e.rank}`, 26, 33, 3, 2); text(x, `$${e.prize}`, 26, 47, 2); text(x, `DMG ${Math.round(e.damage)}`, 64, 47, 2); }
  setAttract(); loop(); void load();
  return () => { dead = true; cancelAnimationFrame(raf); clearInterval(sendTimer); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); off?.(); if (mode === 'lobby' || mode === 'race') live?.send({ type: 'race.leave' }); setMatch(false); };
}
