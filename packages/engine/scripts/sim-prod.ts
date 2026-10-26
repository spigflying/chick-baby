/**
 * 正式賽道模擬：原廠車（簡單玩家機器人）對 19 台 AI，每條賽道 N 個種子。
 * 用法：npx tsx scripts/sim-prod.ts [N] [trackId]   ENGINE=<path to racing src index> 可改測別的版本
 */
const E: any = await import(process.env.ENGINE ?? '../src/index.ts');
const { TRACKS, createRace, stepRace, setRaceInput, fillField, raceRanking, trackSegs, segAt, SEG_LEN, SPEED_X, STOCK_PARTS, RACE_TICK_RATE, gripOf, trackById } = E;
const N = Number(process.argv[2] ?? 8), only = process.argv[3];
const X = SPEED_X;
const BOT = process.env.BOT ?? 'skilled';
function botInput(s: any, me: any) {
  // simple＝racing-ai-nitro 測試用的「原廠車全油門＋回中＋固定時點氮氣」玩家（v22 平衡時用的基準）
  if (BOT === 'simple') return { gas: true, left: me.x > 0.2, right: me.x < -0.2, nitro: s.tick % 200 === 50 };
  const t = trackById(s.track), grip = gripOf(me, t.weather);
  // 往前看：未來 25–(25+速度×2.2) m 內最大彎；安全速度＝把離心壓在收油轉向權限的 85%
  let worst = 0; for (let d = 10; d < 30 + me.speed * 2.4; d += SEG_LEN) { const c = Math.abs(segAt(s, me.z + d).curve); if (c > worst) worst = c; }
  const safe = worst < 0.3 ? Infinity : E.mapFirstPullRate ? (t.mapFirst
    ? 70 * X * Math.sqrt(E.STEER_RATE * E.STEER_AUTH_COAST * 0.8 / (E.segCurvature(worst) * E.MAPFIRST_PULL_K * E.slideFactor(grip)))
    : 70 * X * Math.sqrt(E.STEER_RATE * 0.75 / (Math.abs(E.segTurn(worst)) * E.cornerPullPerRad() * E.slideFactor(grip) * E.hairpinPullMul(worst)))) : Infinity;
  const cur = segAt(s, me.z).curve;
  // 超車：前方 40 m 內同車道有車 → 換到比較空的一側
  let tx = me.tx ?? 0; const blk = s.cars.find((o: any) => o !== me && o.finishedTick === null && o.z - me.z > 0 && o.z - me.z < 40 && Math.abs(o.x - tx) < 0.32);
  if (blk) { const cand = [-0.6, 0, 0.6].filter((x) => !s.cars.some((o: any) => o !== me && o.z - me.z > -3 && o.z - me.z < 40 && Math.abs(o.x - x) < 0.32));
    if (cand.length) tx = cand.reduce((b: number, x: number) => (Math.abs(x - me.x) < Math.abs(b - me.x) ? x : b)); }
  else if (!s.cars.some((o: any) => o !== me && Math.abs(o.z - me.z) < 30 && Math.abs(o.x) < 0.32)) tx = 0;
  me.tx = tx;
  let left = false, right = false;
  if (me.x > tx + 0.08) left = true; else if (me.x < tx - 0.08) right = true; else if (Math.abs(cur) > 0.3) { if (cur > 0) right = true; else left = true; }
  const straight = worst < 0.6;
  return { gas: me.speed < safe, brake: me.speed > safe + 6 * X, left, right, nitro: straight && me.nitroT === 0 && me.speed > 30 * X && s.tick % 40 === 0 };
}
const out: any[] = [];
for (const t of TRACKS) {
  if (only && t.id !== only) continue;
  const len = trackSegs(t.id).length * SEG_LEN; const ranks: number[] = [], times: number[] = [], aiT: number[] = []; let aiOff = 0, aiN = 0, stuck = 0, dnf = 0, meOff = 0, meN = 0;
  for (let k = 0; k < N; k++) {
    const s = createRace(100 + k, t.id, fillField([{ id: 'me', name: 'me', parts: STOCK_PARTS, car: 'falcon' }]));
    const me = s.cars.find((c: any) => c.id === 'me'); const lastZ = new Map<string, [number, number]>();
    while (!s.over) {
      setRaceInput(s, 'me', botInput(s, me)); stepRace(s);
      if (s.countdown > 0) continue;
      if (me.finishedTick === null) { meN++; if (Math.abs(me.x) > 1) meOff++; }
      for (const c of s.cars) if (c.ai && c.finishedTick === null) { aiN++; if (Math.abs(c.x) > 1) aiOff++;
        if (s.tick % 100 === 0) { const p = lastZ.get(c.id); if (p && c.z - p[0] < 5) stuck++; lastZ.set(c.id, [c.z, s.tick]); } }
    }
    ranks.push(raceRanking(s).indexOf(me) + 1); times.push(me.finishedTick === null ? NaN : (me.finishedTick - 60) / RACE_TICK_RATE);
    for (const c of s.cars) if (c.ai) { if (c.finishedTick === null) dnf++; else aiT.push((c.finishedTick - 60) / RACE_TICK_RATE); }
  }
  // 只有 AI 的比賽：全部跑完（不會因玩家完賽而提早結束）→ AI 完賽時間、出界、卡住
  aiT.length = 0; dnf = 0; aiOff = 0; aiN = 0; stuck = 0;
  for (let k = 0; k < 3; k++) {
    const s = createRace(500 + k, t.id, fillField([])); const lastZ = new Map<string, number>();
    while (!s.over) { stepRace(s); if (s.countdown > 0) continue;
      for (const c of s.cars) if (c.finishedTick === null) { aiN++; if (Math.abs(c.x) > 1) aiOff++;
        if (s.tick % 100 === 0) { const p = lastZ.get(c.id); if (p !== undefined && c.z - p < 5) stuck++; lastZ.set(c.id, c.z); } } }
    for (const c of s.cars) { if (c.finishedTick === null) dnf++; else aiT.push((c.finishedTick - 60) / RACE_TICK_RATE); }
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const r = { id: t.id, laps: t.laps, len, meRace: +avg(times).toFixed(1), meLap: +(avg(times) / t.laps).toFixed(1), aiWinner: +Math.min(...aiT).toFixed(1), aiLast: +Math.max(...aiT).toFixed(1), top3: ranks.filter((r) => r <= 3).length / N, ranks: ranks.join(','), meOff: +(meOff / meN * 100).toFixed(1), aiOff: +(aiOff / aiN * 100).toFixed(2), aiDnf: dnf, stuck };
  out.push(r); console.log(JSON.stringify(r));
}
if (process.env.OUT) (await import('node:fs')).writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
