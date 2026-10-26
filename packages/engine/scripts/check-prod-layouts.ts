// 草稿檢查：建出每條正式賽道的地圖先佈局 → 閉合誤差、自交、平行路段最小距離；輸出 JSON 給繪圖
import { buildMapFirst } from '../src/racing-mapfirst';
import { SEG_LEN, TRACKS } from '../src/racing';
import { PROD_LAYOUTS_DRAFT, cornerStats } from '../src/racing-prod-layouts.draft';
import { writeFileSync } from 'fs';
const res: any[] = []; let bad = 0;
for (const t of TRACKS) {
  const pieces = PROD_LAYOUTS_DRAFT[t.id]; let m;
  try { m = buildMapFirst({ id: t.id, name: t.name, scenery: t.scenery, weather: t.weather, laps: t.laps, pieces }); }
  catch (e: any) { console.log('ERR', t.id, e.message); bad++; continue; }
  const pts: [number, number][] = [[0, 0]]; let h = 0, x = 0, y = 0;
  for (const a of m.turns) { h += a; x += Math.sin(h) * SEG_LEN; y -= Math.cos(h) * SEG_LEN; pts.push([x, y]); }
  const N = m.turns.length;
  // 最小距離：路徑上相隔 > 700m 的兩點（循環）之間的直線距離
  const seg = (i: number) => pts[i]; let minD = 1e9, minAt = [0, 0];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const along = Math.min(j - i, N - (j - i)) * SEG_LEN; if (along <= 700) continue;
    const d = Math.hypot(seg(i)[0] - seg(j)[0], seg(i)[1] - seg(j)[1]); if (d < minD) { minD = d; minAt = [i, j]; }
  }
  // 自交：線段兩兩相交（非相鄰）
  const cross = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  let inter = 0;
  for (let i = 0; i < N; i++) for (let j = i + 2; j < N; j++) { if (i === 0 && j === N - 1) continue;
    const a = pts[i], b = pts[i + 1], c = pts[j], d = pts[j + 1];
    if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) inter++; }
  const cs = cornerStats(pieces);
  const ok = m.closeGapM < 15 && inter === 0 && minD >= 300;
  if (!ok) bad++;
  res.push({ pieces, id: t.id, name: t.name, country: t.country, countryId: t.countryId, laps: t.laps, ai: t.ai, scenery: t.scenery, weather: t.weather, len: N * SEG_LEN, gap: m.closeGapM, inter, minD, minAt: minAt.map((k) => k * SEG_LEN), autoLens: m.autoLens, ...cs, pts, pieceStart: m.pieceStart });
  console.log(ok ? 'ok ' : 'BAD', t.id, t.name, 'len', N * SEG_LEN, 'gap', m.closeGapM.toFixed(1), 'inter', inter, 'minD', minD.toFixed(0), '@', minAt.map((k) => k * SEG_LEN).join('/'), 'auto', m.autoLens.join(','), JSON.stringify(cs));
}
writeFileSync('/workspace/prod-layouts.json', JSON.stringify(res));
console.log(bad ? `${bad} BAD` : 'ALL OK');
