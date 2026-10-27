/**
 * race-demo-obstacles 模擬：試玩頁設定（DEMO_HITBOX）有／無路障，AI 完賽時間、玩家機器人前 3 率、撞路障次數。
 * 用法：npx tsx scripts/sim-obstacles.ts [N]   OBST=0 關路障；AVOID=0 玩家機器人不閃路障
 */
const E: any = await import('../src/index.ts');
const { TRACKS, createRace, stepRace, setRaceInput, fillField, raceRanking, trackSegs, segAt, SEG_LEN, SPEED_X, STOCK_PARTS, RACE_TICK_RATE, gripOf, trackById, registerMapFirstTracks, DEMO_HITBOX, raceObstacles } = E;
const N = Number(process.argv[2] ?? 10), OBST = process.env.OBST !== '0', AVOID = process.env.AVOID !== '0';
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
  if (s.obstacles && AVOID) { const L = s.len, zl = ((me.z % L) + L) % L; // 看得到路障的玩家：前方 20+速度×1.5 m 內擋到就換線
    for (const o of s.obstacles) { const d = ((o.z - zl) % L + L) % L; if (d > 20 + me.speed * 1.5) continue;
      const hw = (E.DEMO_CAR_W + 0.14) / 2; if (Math.abs(tx - o.x) >= o.w / 2 + hw) continue;
      const c = [o.x - o.w / 2 - hw, o.x + o.w / 2 + hw].filter((v) => Math.abs(v) <= 0.85); if (c.length) tx = c.reduce((a, b) => Math.abs(b - me.x) < Math.abs(a - me.x) ? b : a); break; } }
  me.tx = tx;
  let left = false, right = false;
  if (me.x > tx + 0.08) left = true; else if (me.x < tx - 0.08) right = true; else if (Math.abs(cur) > 0.3) { if (cur > 0) right = true; else left = true; }
  const straight = worst < 0.6;
  return { gas: me.speed < safe, brake: me.speed > safe + 6 * X, left, right, nitro: straight && me.nitroT === 0 && me.speed > 30 * X && s.tick % 40 === 0 };
}

const tracks = [...registerMapFirstTracks(), ...[TRACKS[0], TRACKS[7], TRACKS[15]]];
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
for (const t of tracks) {
  const ranks: number[] = [], times: number[] = [], aiT: number[] = []; let meHits = 0, aiHits = 0, nOb = 0;
  for (let k = 0; k < N; k++) {
    const s = createRace(100 + k, t.id, fillField([{ id: 'me', name: 'me', parts: STOCK_PARTS, car: 'falcon' }]));
    s.hitbox = DEMO_HITBOX; if (OBST) s.obstacles = raceObstacles(s.seed, t.id); nOb += s.obstacles?.length ?? 0;
    const me = s.cars.find((c: any) => c.id === 'me');
    while (!s.over) { setRaceInput(s, 'me', botInput(s, me)); stepRace(s); }
    ranks.push(raceRanking(s).indexOf(me) + 1); times.push(me.finishedTick === null ? NaN : (me.finishedTick - 60) / RACE_TICK_RATE);
    meHits += me.obN ?? 0;
  }
  for (let k = 0; k < 3; k++) {
    const s = createRace(500 + k, t.id, fillField([])); s.hitbox = DEMO_HITBOX; if (OBST) s.obstacles = raceObstacles(s.seed, t.id);
    while (!s.over) stepRace(s);
    for (const c of s.cars) { aiHits += c.obN ?? 0; if (c.finishedTick !== null) aiT.push((c.finishedTick - 60) / RACE_TICK_RATE); }
  }
  console.log(JSON.stringify({ id: t.id, obsPerRace: nOb / N, meRace: +avg(times).toFixed(1), top3: ranks.filter((r) => r <= 3).length / N, ranks: ranks.join(','), meHitsPerRace: +(meHits / N).toFixed(2), aiWinner: +Math.min(...aiT).toFixed(1), aiMedian: +aiT.sort((a, b) => a - b)[aiT.length >> 1].toFixed(1), aiLast: +Math.max(...aiT).toFixed(1), aiFin: aiT.length + '/' + 3 * 19, aiHitsPerCarRace: +(aiHits / 57).toFixed(2) }));
}
