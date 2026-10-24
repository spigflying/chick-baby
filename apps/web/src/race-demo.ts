/**
 * 離線單人賽車試玩：純瀏覽器引擎＋本地 AI，不打 API、不寫庫、不存檔。
 * 入口：/race-demo.html（獨立於 main.ts，關門時段也可開）。
 */
import './style.css';
import {
  createRace, stepRace, DEMO_HITBOX, setRaceInput, fillField, raceRanking, raceTimeMs, condition,
  trackById, TRACKS, STOCK_PARTS, carStats, pickupShare, rankOf,
  RACE_TICK_RATE, RACE_SLOTS, NITRO_PER_RACE, registerMapFirstTracks, type RaceState,
} from '@chick/engine';

// race-demo-mapfirst：試玩頁只用「地圖先」賽道（佈局→路段；小地圖／路面／外甩同一份轉角）。正式 /race 不註冊。
const DEMO_TRACKS = registerMapFirstTracks();
import { drawRace, raceOrder, text, textW, zh, zhW, panel, W, H, G, type ViewCar } from './race-gfx';
import { fitScale } from './race-fit';

const WEATHER: Record<string, string> = { clear: '晴', rain: '雨', night: '夜', snow: '雪', fog: '霧' };
const fmtMs = (ms: number | null) => ms === null ? '—' : `${Math.floor(ms / 60000)}'${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}"${String(Math.floor(ms / 10) % 100).padStart(2, '0')}`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const q = new URLSearchParams(location.search);
const camH = Number(q.get('cam')) > 0 ? Number(q.get('cam')) : undefined; // ?cam=7.5／16：比較攝影機高度
let showHitbox = q.get('hitbox') === '1'; // race-demo-hitbox：?hitbox=1 或按 H 切換
const ME_ID = 'me';
const ME_NAME = '試玩';
const STOCK_CAR = 'falcon';
const STOCK_COLOR = 0;

function boot() {
  const root = document.getElementById('app')!;
  document.body.style.background = '#1a1030';
  root.innerHTML = `<main class="page race-page">
    <div class="race-dev">
      <p class="muted" style="margin:0;padding:4px 8px;background:#2a1848;border:2px solid #000;font-family:var(--ui,#Cubic 11,monospace)">DEMO · 離線試玩 · 不登入 · 不存檔 · 重新整理＝沒了</p>
      <div class="lcd race-lcd"><canvas id="rc" width="${W}" height="${H}"></canvas><p class="msg" id="rmsg">選賽道後按「開始試玩」</p></div>
      <div class="race-pad" id="rpad">
        <button data-k="left" aria-label="左">◀</button><button data-k="right" aria-label="右">▶</button>
        <span class="sp"></span>
        <button data-k="nitro" class="n2o">N2O</button><button data-k="brake">煞車</button><button data-k="gas" class="gas">油門</button>
      </div>
      <p class="muted race-keys">鍵盤：←→ 轉向、↑/Z/W 油門、↓/X/S 煞車、空白鍵／N 氮氣</p>
    </div>
    <div class="panel race-panel">
      <h2>賽車試玩（離線）</h2>
      <p class="muted">原廠零件・隼 GT・${RACE_SLOTS} 台（你＋電腦）。無錦標賽進度、金幣、房間。</p>
      <div id="rbody"></div>
    </div>
  </main>`;

  const cv = root.querySelector('#rc') as HTMLCanvasElement;
  const x = cv.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  const fit = () => {
    const box = cv.parentElement!, f = fitScale(box.clientWidth, window.devicePixelRatio || 1);
    cv.style.width = f.k ? `${f.cssW}px` : '';
    cv.style.margin = f.k ? '0 auto' : '';
  };
  const ro = new ResizeObserver(fit); ro.observe(cv.parentElement!); fit();
  const body = root.querySelector('#rbody') as HTMLElement;
  const msg = root.querySelector('#rmsg') as HTMLElement;

  let sel = DEMO_TRACKS.find((t) => t.id === q.get('t'))?.id ?? DEMO_TRACKS[0].id;
  let mode: 'menu' | 'race' | 'results' = 'menu';
  let sim: RaceState | null = null;
  let frame = 0, raf = 0, dead = false;
  const keys = { gas: false, brake: false, left: false, right: false, nitro: false };
  let acc = 0, lastNow = performance.now();
  const T0 = lastNow;
  const stats = carStats(STOCK_PARTS, STOCK_CAR);

  function renderPanel() {
    if (mode === 'race') {
      body.innerHTML = `<button id="rabort" class="race-top-btn">放棄這場</button>
        <p>比賽進行中…（本地模擬，${NITRO_PER_RACE} 次氮氣）</p>`;
      (body.querySelector('#rabort') as HTMLElement).onclick = () => { endRace(true); };
      return;
    }
    if (mode === 'results' && sim) {
      const rk = raceRanking(sim);
      const meC = sim.cars.find((c) => c.id === ME_ID)!;
      const pos = rk.indexOf(meC) + 1;
      body.innerHTML = `<button id="ragain" class="big race-top-btn">再來一場</button>
        <button id="rmenu" class="race-top-btn">回選單</button>
        <h3>${esc(trackById(sim.track)!.name)} 結果（試玩・不計分）</h3>
        <p>你：第 <b>${pos}</b> 名　時間 ${fmtMs(raceTimeMs(sim, meC))}　完美度 ${condition(meC)}%</p>
        <ol class="results">${rk.slice(0, 10).map((c, i) =>
          `<li class="${c.id === ME_ID ? 'me' : ''}"><span>${i + 1}. ${esc(c.name)}${c.ai ? ' <span class="muted">電腦</span>' : ''}</span><span>${fmtMs(raceTimeMs(sim!, c))}</span></li>`
        ).join('')}</ol>
        <p class="muted">沒有金幣、積分、錦標賽進度。重新整理頁面就全部清掉。</p>`;
      (body.querySelector('#ragain') as HTMLElement).onclick = () => startRace();
      (body.querySelector('#rmenu') as HTMLElement).onclick = () => { mode = 'menu'; sim = null; msg.textContent = '選賽道後按「開始試玩」'; renderPanel(); };
      return;
    }
    body.innerHTML = `<button id="rgo" class="big race-top-btn">開始試玩：${esc(trackById(sel)!.name)}</button>
      <h3>地圖先設計的試玩賽道</h3><ul class="tracks">${DEMO_TRACKS.map((t) =>
        `<li class="${t.id === sel ? 'sel' : ''}" data-tr="${t.id}"><span>${t.raceIdx + 1}. <b>${esc(t.name)}</b> <span class="muted">${WEATHER[t.weather]}・${t.laps} 圈</span></span></li>`).join('')}</ul>
      <p class="muted">賽道先畫成封閉平面圖（直線＋90° 彎、髮夾、S 彎），再切成路段；小地圖、路面彎、外甩全用同一份轉角。正式 ${TRACKS.length} 條賽道請走平常的賽車頁。</p>`;
    body.querySelectorAll('li[data-tr]').forEach((li) => {
      (li as HTMLElement).onclick = () => { sel = (li as HTMLElement).dataset.tr!; renderPanel(); };
    });
    (body.querySelector('#rgo') as HTMLElement).onclick = () => startRace();
  }

  function startRace() {
    const seed = (Math.random() * 1e9) | 0;
    sim = createRace(seed, sel, fillField([{
      id: ME_ID, name: ME_NAME, car: STOCK_CAR, color: STOCK_COLOR, parts: STOCK_PARTS,
    }]));
    sim.hitbox = DEMO_HITBOX; // 試玩頁專用：照精靈量的碰撞盒
    mode = 'race';
    prevSnap = snapCars(sim);
    acc = 0; lastNow = performance.now();
    msg.textContent = `${trackById(sel)!.country}・${trackById(sel)!.name}　發車！`;
    Object.keys(keys).forEach((k) => { (keys as any)[k] = false; });
    renderPanel();
  }

  function endRace(aborted: boolean) {
    if (!sim) return;
    if (aborted) { mode = 'menu'; sim = null; msg.textContent = '已放棄。選賽道再試一次。'; renderPanel(); return; }
    mode = 'results';
    msg.textContent = '完賽！（試玩結果不存檔）';
    renderPanel();
  }

  function snapCars(s: RaceState) {
    return new Map(s.cars.map((c) => [c.id, {
      z: c.z, x: c.x, speed: c.speed, damage: c.damage, nitro: c.nitro, nitroT: c.nitroT,
      fin: c.finishedTick, hit: c.hit, evT: c.evT ?? 0, evK: c.evK ?? 0, evS: c.evS ?? 0,
      evSide: c.evSide ?? 0, flip: c.flip ?? 0, zd: c.zd ?? [0, 0, 0], pkT: c.pkT ?? 0,
    }]));
  }
  let prevSnap = new Map<string, ReturnType<typeof snapCars> extends Map<string, infer V> ? V : never>();

  // ---------- 操作：觸控按鈕＋鍵盤（不 stopPropagation） ----------
  const pad = root.querySelector('#rpad') as HTMLElement;
  pad.querySelectorAll('button').forEach((b) => {
    const k = (b as HTMLElement).dataset.k as keyof typeof keys;
    const set = (v: boolean) => (e: Event) => {
      if (e.cancelable) e.preventDefault();
      keys[k] = v;
      b.classList.toggle('on', v);
    };
    b.addEventListener('pointerdown', set(true));
    b.addEventListener('pointerup', set(false));
    b.addEventListener('pointerleave', set(false));
    b.addEventListener('pointercancel', set(false));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  const KEYMAP: Record<string, keyof typeof keys> = {
    ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'gas', z: 'gas', Z: 'gas', w: 'gas', W: 'gas',
    ArrowDown: 'brake', x: 'brake', X: 'brake', s: 'brake', S: 'brake',
    ' ': 'nitro', n: 'nitro', N: 'nitro',
  };
  const onKey = (v: boolean) => (e: KeyboardEvent) => {
    const k = KEYMAP[e.key];
    if (!k || (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    if (mode === 'race') e.preventDefault();
    keys[k] = v;
  };
  const kd = onKey(true), ku = onKey(false);
  window.addEventListener('keydown', kd);
  window.addEventListener('keydown', (e) => { if (e.key === 'h' || e.key === 'H') showHitbox = !showHitbox; }); // 碰撞盒除錯
  window.addEventListener('keyup', ku);

  function viewCars(f: number): ViewCar[] {
    if (!sim) return [];
    return sim.cars.map((c) => {
      const p = prevSnap.get(c.id);
      const z = p ? p.z + (c.z - p.z) * f : c.z;
      const xx = p ? p.x + (c.x - p.x) * f : c.x;
      const speed = p ? p.speed + (c.speed - p.speed) * f : c.speed;
      const flip = c.flip && p?.flip ? p.flip + (c.flip - p.flip) * f : (c.flip ?? 0);
      return {
        id: c.id, name: c.name, ai: c.ai, car: c.car, color: c.color,
        pet: c.ai ? null : 'chicken',
        z, x: xx, speed, damage: c.damage, nitro: c.nitro, nitroT: c.nitroT,
        fin: c.finishedTick, hit: c.hit, evT: c.evT, evK: c.evK, evS: c.evS, evSide: c.evSide,
        zd: c.zd, pkT: c.pkT ?? 0, flip, brake: c.id === ME_ID ? keys.brake : false,
      } as ViewCar;
    });
  }

  function loop() {
    if (dead) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    acc = Math.min(acc + (now - lastNow), 250);
    lastNow = now;
    frame = Math.floor((now - T0) / 50);
    const t = trackById(sim?.track ?? sel)!;

    if (mode === 'race' && sim) {
      const tickMs = 1000 / RACE_TICK_RATE;
      while (acc >= tickMs) {
        acc -= tickMs;
        prevSnap = snapCars(sim);
        setRaceInput(sim, ME_ID, keys);
        stepRace(sim);
        if (sim.over) { endRace(false); break; }
      }
      if (mode !== 'race' || !sim) return;
      const f = acc / tickMs;
      const cars = viewCars(f);
      const meCar = cars.find((c) => c.id === ME_ID) ?? null;
      const ranked = raceOrder(cars);
      const flash = meCar?.fin != null ? 'FINISH!' : meCar && meCar.hit > 0 ? 'CRASH!' : meCar && Math.abs(meCar.x) > 1 ? 'OFF ROAD' : undefined;
      const meReal = sim.cars.find((c) => c.id === ME_ID)!;
      const share = pickupShare(rankOf(sim.cars, meReal), sim.cars.length);
      const pickups = sim.pickups
        .filter((p) => p.taken === null && p.q < share && Math.abs(p.z - (meCar?.z ?? 0)) < sim!.len / 2)
        .map((p) => ({ z: p.z, x: p.x }));
      drawRace(x, {
        pickups, gears: 4, top: stats.topSpeed, track: t, me: meCar, cars,
        tick: sim.tick, countdown: sim.countdown, laps: sim.laps, len: sim.len,
        rank: meCar ? ranked.indexOf(meCar) + 1 : 0, frame, hud: true, flash, now, exact: true, camH, hitbox: showHitbox ? DEMO_HITBOX : undefined, carW: DEMO_HITBOX.dx,
      });
      return;
    }

    if (mode === 'results' && sim) {
      const cars = viewCars(1);
      const meCar = cars.find((c) => c.id === ME_ID) ?? null;
      const ranked = raceOrder(cars);
      drawRace(x, {
        gears: 4, top: stats.topSpeed, track: t, me: meCar, cars,
        tick: sim.tick, countdown: 0, laps: sim.laps, len: sim.len,
        rank: meCar ? ranked.indexOf(meCar) + 1 : 0, frame, hud: true, flash: 'FINISH!',  exact: true, carW: DEMO_HITBOX.dx, camH,
      });
      const meC = sim.cars.find((c) => c.id === ME_ID)!;
      const pos = raceRanking(sim).indexOf(meC) + 1;
      panel(x, 16, 8, W - 32, 56, 3, 1);
      text(x, 'DEMO RESULT', W / 2 - textW('DEMO RESULT', 2) / 2, 14, 0, 2);
      text(x, `P${pos}`, 26, 34, 0, 4);
      zh(x, `時間 ${fmtMs(raceTimeMs(sim, meC))}　試玩不存檔`, 90, 36, 0);
      return;
    }

    // 選單：靜態預覽（玩家車在起跑格附近）
    const me: ViewCar = {
      id: ME_ID, name: ME_NAME, ai: false, car: STOCK_CAR, color: STOCK_COLOR,
      z: -40, x: 0.2, speed: 0, damage: 0, nitro: NITRO_PER_RACE, nitroT: 0, fin: null, hit: 0, pet: 'chicken',
    };
    const ghosts: ViewCar[] = Array.from({ length: 6 }, (_, i) => ({
      id: 'ai' + i, name: 'ai', ai: true, car: 'ai', color: 0,
      z: -50 - Math.floor(i / 2) * 12, x: i % 2 ? -0.45 : 0.45,
      speed: 0, damage: 0, nitro: 3, nitroT: 0, fin: null, hit: 0,
    }));
    drawRace(x, {
      track: t, me, cars: [...ghosts, me], tick: 0, countdown: 60, laps: t.laps,
      len: 2000, rank: RACE_SLOTS, frame, hud: true, carW: DEMO_HITBOX.dx, gears: 4, top: stats.topSpeed,
    });
    panel(x, 0, 0, W, 22);
    text(x, 'SOLO DEMO', 6, 4, 0, 2);
    zh(x, `${t.country}・${t.name}`, W - 6 - zhW(x, `${t.country}・${t.name}`), 5, 1);
    if (frame % 20 < 13) {
      panel(x, W / 2 - 56, 88, 112, 22);
      text(x, 'PRESS START', W / 2 - textW('PRESS START', 2) / 2, 92, 0, 2);
    }
  }

  renderPanel();
  loop();

  (window as any).__raceDemo = {
    start: startRace,
    abort: () => endRace(true),
    finish: () => endRace(false),
    mode: () => mode,
    sim: () => sim,
    keys,
    /** 開發／截圖用：本地快轉到完賽（不打 API） */
    fastForward: (max = 30000) => {
      if (!sim || mode !== 'race') return { ok: false };
      let n = 0;
      while (!sim.over && n < max) {
        const me = sim.cars.find((c) => c.id === ME_ID)!;
        setRaceInput(sim, ME_ID, { gas: true, brake: false, left: me.x > 0.25, right: me.x < -0.25, nitro: n % 280 === 40 });
        stepRace(sim);
        n++;
      }
      if (sim.over) endRace(false);
      return { ok: !!sim?.over, n, tick: sim?.tick };
    },
  };
}

boot();
