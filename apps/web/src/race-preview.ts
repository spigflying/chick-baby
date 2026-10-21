// 開發用：賽車美術設計稿與畫面模擬（不進正式頁面）。/race-preview.html?v=sheet|grid|pack|nitro|rain|night（v3：240×200）
import { drawRace, carCanvas, G, W, H, text, type ViewCar } from './race-gfx';
import { CAR_MODELS, LODS, LIVERIES, LIVERY_NAMES } from './race-cars';
import { trackById, trackSegs, SEG_LEN, CARS } from '@chick/engine';

const root = document.getElementById('root')!;
const v = new URLSearchParams(location.search).get('v') ?? 'sheet';
import { CAR_SPECS } from './race-cars';
const NAMES: Record<string, string> = Object.fromEntries(Object.entries(CAR_SPECS).map(([k, v]) => [k, v.name]));

function sheet() {
  // 一張大圖：每車款一列 × (5 個 LOD) + 6 種塗裝（L 尺寸）+ 煞車/氮氣/受損
  const S = 3, cellW = 56, rowH = 44, cols = LODS.length + LIVERIES.length + 3;
  const cw = 96 + cols * cellW, ch = 34 + CAR_MODELS.length * rowH + 18;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; c.style.width = cw * S + 'px'; c.style.height = ch * S + 'px';
  const x = c.getContext('2d')!; x.imageSmoothingEnabled = false;
  x.fillStyle = G[0]; x.fillRect(0, 0, cw, ch);
  text(x, 'CAR DESIGN SHEET V5', 2, 2, 3, 2);
  const heads = [...LODS.map((w) => `${w}PX`), ...LIVERIES.map((_, i) => `C${i + 1}`), 'BRAKE', 'NITRO', 'HIT'];
  heads.forEach((hd, i) => text(x, hd.slice(0, 8), 96 + i * cellW + 2, 22, 2));
  CAR_MODELS.forEach((m, r) => {
    const y0 = 34 + r * rowH;
    text(x, m.toUpperCase(), 4, y0 + 10, 3, 2); text(x, (CARS.find((c) => c.id === m)?.price ?? 0) ? '$' + (CARS.find((c) => c.id === m)!.price / 1000) + 'K' : 'FREE', 4, y0 + 28, 2);
    for (let i = 0; i < cols; i++) { x.fillStyle = (i + r) % 2 ? G[2] : G[1]; x.fillRect(96 + i * cellW, y0, cellW - 2, rowH - 2); } // 路面底色（近似實際背景）
    const put = (img: HTMLCanvasElement, i: number) => x.drawImage(img, 96 + i * cellW + Math.floor((cellW - 2 - img.width) / 2), y0 + rowH - 3 - img.height);
    LODS.forEach((_, l) => put(carCanvas(m, 0, {}, l), l));
    LIVERIES.forEach((_, k) => put(carCanvas(m, k, {}, 0), LODS.length + k));
    put(carCanvas(m, 1, { brake: true }, 0), LODS.length + LIVERIES.length);
    put(carCanvas(m, 1, { nitro: true, frame: 1 }, 0), LODS.length + LIVERIES.length + 1);
    put(carCanvas(m, 1, { hit: true, frame: 1 }, 0), LODS.length + LIVERIES.length + 2);
  });
  text(x, 'PALETTE', 2, ch - 10, 3); G.forEach((g, i) => { x.fillStyle = g; x.fillRect(34 + i * 10, ch - 11, 9, 8); x.strokeStyle = G[3]; x.strokeRect(34.5 + i * 10, ch - 10.5, 8, 7); });
  const d = document.createElement('div'); d.id = 'sheet'; d.innerHTML = `<h1>賽車設計稿 v4（9 種車型，2 倍解析度）：${CAR_MODELS.map((m) => NAMES[m]).join('・')}</h1><p>每列：5 個尺寸（48/32/20/12/8 px，在各尺寸重新點陣化，遠處直接換小圖，不縮放）＋ 6 種塗裝（${LIVERY_NAMES.join('、')}）＋ 煞車燈／氮氣火焰／受損閃爍。只用四階綠，1px 最暗色外框。</p>`;
  d.append(c); root.append(d);
}
function scene(kind: string) {
  const track = trackById(kind === 'rain' ? 'tw4' : kind === 'night' ? 'tw3' : kind === 'fog' ? 'tw2' : kind === 'pack' ? 'us1' : 'tw1')!;
  const len = trackSegs(track.id).length * SEG_LEN;
  const mk = (i: number, z: number, xx: number, extra: Partial<ViewCar> = {}): ViewCar => ({ id: 'c' + i, name: 'c' + i, ai: true, car: 'ai', color: 0, z, x: xx, speed: 50, damage: 0, nitro: 3, nitroT: 0, fin: null, hit: 0, ...extra });
  const cars: ViewCar[] = []; let me: ViewCar;
  if (kind === 'grid') { for (let i = 0; i < 19; i++) cars.push(mk(i + 1, 300 - Math.floor(i / 2) * 10, i % 2 ? 0.5 : -0.5, { speed: 0, ...(i === 18 ? { ai: false, car: 'muscle', color: 1 } : {}) })); me = mk(0, 300 - 9 * 10, 0.5, { id: 'me', speed: 0, car: 'falcon', color: 0 }); }
  else { const base = 1400; me = mk(0, base, 0.1, { id: 'me', car: 'falcon', color: 0, damage: kind === 'pack' ? 23 : 0, speed: kind === 'nitro' ? 78 : 60, nitroT: kind === 'nitro' ? 30 : 0, nitro: kind === 'nitro' ? 2 : 3 });
    const ahead = [[7, -0.4], [9, 0.45], [16, -0.1], [26, 0.5], [40, -0.5], [60, 0.2], [85, -0.3], [120, 0.4], [170, -0.2], [240, 0.3], [330, 0]];
    ahead.forEach(([dz, xx], i) => cars.push(mk(i + 1, base + dz, xx, { brake: i === 1, hit: kind === 'pack' && i === 0 ? 5 : 0, ...(i === 2 ? { ai: false, car: 'rally', color: 2 } : i === 5 ? { ai: false, car: 'f1', color: 4 } : {}) }))); }
  cars.push(me);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.style.width = W * 3 + 'px'; cv.style.height = H * 3 + 'px';
  const x = cv.getContext('2d')!; x.imageSmoothingEnabled = false;
  let frame = 0;
  const draw = () => { frame++; drawRace(x, { track, me, cars, tick: kind === 'grid' ? 30 : 400, countdown: kind === 'grid' ? 40 : 0, laps: track.laps, len, rank: kind === 'grid' ? 20 : kind === 'nitro' ? 9 : 12, frame, hud: true, flash: kind === 'nitro' ? 'NITRO!' : undefined }); };
  draw(); draw();
  const d = document.createElement('div'); d.id = 'shots'; d.append(cv); root.append(d);
}
// ---- 'page'：用假的 API／WS 跑真正的賽車頁面（選單、車庫、等待、比賽、結果） ----
async function page() {
  await import('./style.css');
  const { racePage } = await import('./race');
  const { createRace, stepRace, setRaceInput, raceRanking, raceTimeMs, TRACKS, PARTS, NITRO_PER_RACE, RACE_SLOTS, fillField, settleCup, prizeFor, pointsFor, condition, ME, newCup } = await import('@chick/engine');
  const prof: any = { cash: 64000, points: 16, wins: 1, races: 3, season: '2026-10', paint: 0, parts: { engine: 1, gearbox: 2, dry: 2, wet: 1, nitro: 1, armorF: 1, armorS: 0, armorR: 0 }, car: 'falcon', cars: ['falcon', 'arrow'], unlocked: 1, cup: { ...newCup(0), race: 2, points: { [ME]: 16, '阿飛': 14, '雷霆': 10, '閃電': 7 } } };
  const realFetch = window.fetch.bind(window);
  window.fetch = (async (u: any, o?: any) => {
    const url = String(u);
    const ok = (j: any) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('/api/race/profile')) return ok({ profile: prof, catalog: { parts: PARTS, cars: CARS, tracks: TRACKS, nitro: NITRO_PER_RACE, slots: RACE_SLOTS } });
    if (url.startsWith('/api/race/leaderboard')) return ok({ best: [{ name: 'racer', time_ms: 128400 }, { name: 'benson', time_ms: 131020 }], championship: [{ name: 'benson', points: 40 }, { name: 'racer', points: 26 }] });
    return realFetch(u, o);
  }) as any;
  const handlers = new Set<(m: any) => void>();
  const emit = (m: any) => handlers.forEach((h) => h(m));
  let sim: any = null, timer = 0;
  const live: any = { inMatch: false, inFight: false, inLobby: false, serverNow: () => Date.now(), on: (h: any) => { handlers.add(h); return () => handlers.delete(h); },
    send: (m: any) => { if (m.type === 'race.input' && sim) setRaceInput(sim, 'me', m); if (m.type === 'race.join' || m.type === 'race.create') emit({ type: 'race.lobby', race_id: 'r1', track: m.track, starts_at: Date.now() + 6000, code: m.type === 'race.create' ? 'K7Q2PX' : null, host: 'me', players: [{ user_id: 'me', name: 'racer' }, { user_id: 'b', name: 'benson' }] }); return true; } };
  const w = window as any;
  w.__start = (track: string) => {
    sim = createRace(5, track, fillField([{ id: 'b', name: 'benson', car: 'muscle', color: 1, parts: prof.parts }, { id: 'me', name: 'racer', car: 'falcon', color: 0, parts: prof.parts as any }]));
    emit({ type: 'race.started', race_id: 'r1', track, seed: 5, cars: sim.cars.map((c: any) => ({ id: c.id, name: c.name, ai: c.ai, car: c.car, color: c.color })), laps: sim.laps, len: sim.len, tick_rate: 20 });
    const snap = () => emit({ type: 'race.snap', race_id: 'r1', tick: sim.tick, countdown: sim.countdown, cars: sim.cars.map((c: any) => [c.id, c.z, c.x, c.speed, c.damage, c.nitro, c.nitroT, c.finishedTick, c.hit]) });
    timer = window.setInterval(() => { stepRace(sim); stepRace(sim); snap(); }, 100);
  };
  w.__sim = () => sim;
  w.__skip = (secs: number) => { for (let i = 0; i < secs * 20; i++) { const me = sim.cars.find((c: any) => c.id === 'me'); setRaceInput(sim, 'me', { gas: true, left: me.x > 0.2, right: me.x < -0.2 }); stepRace(sim); } };
  w.__finish = () => {
    clearInterval(timer); while (!sim.over) { const me = sim.cars.find((c: any) => c.id === 'me'); setRaceInput(sim, 'me', { gas: true, left: me.x > 0.2, right: me.x < -0.2 }); stepRace(sim); }
    const rk = raceRanking(sim); const meC = sim.cars.find((c: any) => c.id === 'me'); const pos = rk.indexOf(meC) + 1;
    emit({ type: 'race.snap', race_id: 'r1', tick: sim.tick, countdown: 0, cars: sim.cars.map((c: any) => [c.id, c.z, c.x, c.speed, c.damage, c.nitro, c.nitroT, c.finishedTick, c.hit]) });
    emit({ type: 'race.ended', race_id: 'r1', track: sim.track, ranking: rk.map((c: any, i: number) => ({ id: c.id, name: c.name, ai: c.ai, rank: i + 1, time_ms: raceTimeMs(sim, c), condition: condition(c) })), me: (() => { const r = settleCup(prof.cup, 1, 'tw3', rk.map((c: any, i: number) => ({ key: c.id === 'me' ? ME : c.ai ? c.name : 'user:' + c.id, rank: i + 1 }))); return { user_id: 'me', rank: pos, prize: prizeFor(pos), points: pointsFor(pos), time_ms: raceTimeMs(sim, meC), condition: condition(meC), hits: meC.hits, unlocked: r.unlocked, cash: prof.cash + prizeFor(pos), qualified: r.qualified, cup_counted: r.counted, country_done: r.countryDone, champion: r.champion, cup: r.cup, standings: r.standings.slice(0, 10) }; })() });
  };
  document.body.style.background = '#1a1030';
  racePage(root, live, { user: { id: 'me', display_name: 'racer' } }, (t) => console.log('toast', t));
}
if (v === 'sheet') sheet(); else if (v === 'page') void page(); else scene(v);
(window as any).__ready = v !== 'page' || true;
