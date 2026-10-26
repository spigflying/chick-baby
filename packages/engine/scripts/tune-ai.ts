/** 掃 track.ai：原廠車（simple 玩家）前三名比率 vs AI 強度。用法：npx tsx scripts/tune-ai.ts [N] [ids...] */
const E: any = await import('../src/index.ts');
const N = Number(process.argv[2] ?? 8), ids = process.argv.slice(3);
const res: Record<string, [number, number, number][]> = {};
for (const t of E.TRACKS) {
  if (ids.length && !ids.includes(t.id)) continue; const row: [number, number, number][] = [];
  for (let ai = 0.8; ai <= 1.951; ai += 0.05) {
    t.ai = ai; let top3 = 0, rs = 0;
    for (let k = 0; k < N; k++) {
      const s = E.createRace(100 + k, t.id, E.fillField([{ id: 'me', name: 'me', parts: E.STOCK_PARTS, car: 'falcon' }]));
      const me = s.cars.find((c: any) => c.id === 'me');
      while (!s.over) { E.setRaceInput(s, 'me', { gas: true, left: me.x > 0.2, right: me.x < -0.2, nitro: s.tick % 200 === 50 }); E.stepRace(s); }
      const r = E.raceRanking(s).indexOf(me) + 1; rs += r; if (r <= 3) top3++;
    }
    row.push([+ai.toFixed(2), top3 / N, rs / N]);
  }
  res[t.id] = row; console.log(t.id, row.map((r) => `${r[0]}:${r[1].toFixed(2)}/${r[2].toFixed(1)}`).join(' '));
}
