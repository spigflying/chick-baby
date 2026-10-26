// 只調整「固定長度直線」（每條 ≥40m、20m 一格），用局部搜尋讓總長貼近現在的正式賽道長度，同時滿足：閉合、無自交、相隔 >700m 的路段距離 ≥300m
import { buildMapFirst, type LayoutPiece } from '../src/racing-mapfirst';
import { SEG_LEN, TRACKS, buildTrack } from '../src/racing';
import { PROD_LAYOUTS_DRAFT } from '../src/racing-prod-layouts.draft';
import { readFileSync, writeFileSync } from 'fs';
const MIN_D = 310; // 留一點餘裕
function evalP(id: string, pieces: LayoutPiece[], target: number) {
  const t = TRACKS.find((x) => x.id === id)!; let m;
  try { m = buildMapFirst({ id, name: t.name, scenery: t.scenery, weather: t.weather, laps: t.laps, pieces }); }
  catch (e: any) { const n = (e.message.match(/-?\d+/g) ?? []).map(Number).filter((v: number) => v < 0); return { score: 1e6 + (n.length ? -Math.min(...n) * 50 : 1e6), ok: false, len: 0, minD: 0 }; }
  const pts: number[][] = [[0, 0]]; let h = 0, x = 0, y = 0;
  for (const a of m.turns) { h += a; x += Math.sin(h) * SEG_LEN; y -= Math.cos(h) * SEG_LEN; pts.push([x, y]); }
  const N = m.turns.length; let minD = 1e9;
  for (let i = 0; i < N; i += 1) for (let j = i + 1; j < N; j++) { if (Math.min(j - i, N - j + i) * SEG_LEN <= 700) continue; minD = Math.min(minD, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])); }
  const len = N * SEG_LEN, ok = minD >= MIN_D && m.closeGapM < 15;
  return { score: Math.abs(len - target) + (ok ? 0 : 1e5 + (MIN_D - minD) * 100), ok, len, minD };
}
const out: Record<string, LayoutPiece[]> = {};
for (const t of TRACKS) {
  const target = buildTrack(t).length * SEG_LEN; let cur = PROD_LAYOUTS_DRAFT[t.id].map((p) => ({ ...p }));
  const fixed = cur.map((p, i) => ('s' in p && p.s !== 'auto' && i !== 0 && i !== cur.length - 1 ? i : -1)).filter((i) => i >= 0);
  let best = evalP(t.id, cur, target);
  for (let it = 0; it < 400; it++) { let improved = false;
    for (const i of fixed) for (const d of [-200, -100, -40, -20, 20, 40, 100, 200]) {
      const p = cur[i] as any; const ns = p.s + d; if (ns < 40) continue;
      const cand = cur.map((q, k) => (k === i ? { ...q, s: ns } : q)); const e = evalP(t.id, cand, target);
      if (e.score < best.score - 1e-9) { best = e; cur = cand; improved = true; }
    }
    // 弧半徑：90° 彎 260–原值、S／掃彎 200–原值；髮夾不動
    for (let i = 0; i < cur.length; i++) { const p = cur[i] as any; if (!('a' in p) || Math.abs(p.a) >= 150) continue;
      const tpl = (PROD_LAYOUTS_DRAFT[t.id][i] as any).r, lo = Math.abs(p.a) >= 70 ? 260 : 200;
      for (const d of [-40, -20, 20]) { const nr = p.r + d; if (nr < lo || nr > tpl) continue;
        const cand = cur.map((q, k) => (k === i ? { ...q, r: nr } : q)); const e = evalP(t.id, cand, target);
        if (e.score < best.score - 1e-9) { best = e; cur = cand; improved = true; } } }
    if (!improved) break; }
  console.log(t.id, 'target', target, 'len', best.len, best.ok ? 'OK' : 'FAIL', 'minD', best.minD.toFixed(0)); out[t.id] = cur;
}
const fmt = (p: any) => ('a' in p ? `A(${p.a}, ${p.r === 180 ? 'HP' : p.r}${p.hill ? ', ' + p.hill : ''})` : `S(${p.s === 'auto' ? "'auto'" : p.s}${p.hill ? ', ' + p.hill : ''})`);
let src = readFileSync('src/racing-prod-layouts.draft.ts', 'utf8');
for (const [id, pcs] of Object.entries(out)) src = src.replace(new RegExp(`  ${id}: \\[.*\\],\\n`), `  ${id}: [${pcs.map(fmt).join(', ')}],\n`);
writeFileSync(process.argv[2] ?? 'src/racing-prod-layouts.draft.ts', src);
