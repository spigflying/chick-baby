// v2 草稿：模板 → fin 補角 → 局部搜尋固定直線長度（閉合／無自交／相隔 >700m 路段距離 ≥300m）→ 指標＋難度分數 → JSON 給繪圖、寫出 racing-prod-layouts2.draft.ts
import { buildMapFirst, type LayoutPiece } from '../src/racing-mapfirst';
import { SEG_LEN, TRACKS, buildTrack } from '../src/racing';
import { TEMPLATES, resolve } from '../src/racing-prod-layouts2.templates';
import { writeFileSync } from 'fs';
const MIN_D = 310, R_LIFT = 400, R_BRAKE = 200;
const only = process.argv[2];
function geo(id: string, pieces: LayoutPiece[]) {
  const t = TRACKS.find((x) => x.id === id)!;
  const m = buildMapFirst({ id, name: t.name, scenery: t.scenery, weather: t.weather, laps: t.laps, pieces });
  const pts: number[][] = [[0, 0]]; let h = 0, x = 0, y = 0;
  for (const a of m.turns) { h += a; x += Math.sin(h) * SEG_LEN; y -= Math.cos(h) * SEG_LEN; pts.push([x, y]); }
  const N = m.turns.length; let minD = 1e9, minAt = [0, 0];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { if (Math.min(j - i, N - j + i) * SEG_LEN <= 700) continue; const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]); if (d < minD) { minD = d; minAt = [i, j]; } }
  return { m, pts, N, minD, minAt };
}
function evalP(id: string, pieces: LayoutPiece[], target: number) {
  let g; try { g = geo(id, pieces); } catch (e: any) { const n = (e.message.match(/-?\d+/g) ?? []).map(Number).filter((v: number) => v < 0); return { score: 1e6 + (n.length ? -Math.min(...n) * 50 : 1e6), ok: false, len: 0, minD: 0 }; }
  const len = g.N * SEG_LEN, ok = g.minD >= MIN_D && g.m.closeGapM < 15;
  const over = Math.max(0, len - target * 1.3) * 5;
  return { score: Math.abs(len - target) + over + (ok ? 0 : 1e5 + (MIN_D - g.minD) * 100), ok, len, minD: g.minD };
}
function fit(id: string, start: LayoutPiece[], target: number) {
  let cur = start.map((p) => ({ ...p })) as any[];
  const fixed = cur.map((p, i) => ('s' in p && p.s !== 'auto' && i !== 0 && i !== cur.length - 1 ? i : -1)).filter((i) => i >= 0);
  let best = evalP(id, cur, target);
  for (let it = 0; it < 400; it++) { let improved = false;
    for (const i of fixed) for (const d of [-300, -200, -100, -40, -20, 20, 40, 100, 200, 300]) { const ns = cur[i].s + d; if (ns < 40) continue;
      const cand = cur.map((q, k) => (k === i ? { ...q, s: ns } : q)); const e = evalP(id, cand, target);
      if (e.score < best.score - 1e-9) { best = e; cur = cand; improved = true; } }
    // 非關鍵弧可縮半徑：R≥400 掃彎最低 400、R250–400 最低 240；R<250 的關鍵彎不動
    for (let i = 0; i < cur.length; i++) { const p = cur[i]; if (!('a' in p)) continue; const t0 = (start[i] as any).r; if (t0 < 250) continue;
      const lo = t0 >= 400 ? 400 : 240;
      for (const d of [-40, -20, 20]) { const nr = p.r + d; if (nr < lo || nr > t0) continue;
        const cand = cur.map((q, k) => (k === i ? { ...q, r: nr } : q)); const e = evalP(id, cand, target);
        if (e.score < best.score - 1e-9) { best = e; cur = cand; improved = true; } } }
    if (!improved) break; }
  return { pieces: cur as LayoutPiece[], ...best };
}
function metrics(pieces: LayoutPiece[], len: number) {
  const arcs = pieces.map((p, i) => ({ p: p as any, i })).filter((x) => 'a' in x.p);
  const L = (p: any) => Math.abs(p.a) * Math.PI / 180 * p.r;
  const totalDeg = arcs.reduce((s, x) => s + Math.abs(x.p.a), 0);
  const liftM = arcs.filter((x) => x.p.r < R_LIFT).reduce((s, x) => s + L(x.p), 0);
  // 彎：連續同向圓弧（中間無直線）合併成一個彎；反向接續的算新彎
  const corners: { i0: number; i1: number; deg: number; rmin: number; load: number; combo: boolean }[] = [];
  for (let i = 0; i < pieces.length; i++) { const p: any = pieces[i]; if (!('a' in p)) continue; const last = corners[corners.length - 1];
    if (last && last.i1 === i - 1 && Math.sign((pieces[i - 1] as any).a) === Math.sign(p.a)) { last.i1 = i; last.deg += Math.abs(p.a); last.rmin = Math.min(last.rmin, p.r); }
    else corners.push({ i0: i, i1: i, deg: Math.abs(p.a), rmin: p.r, load: 0, combo: false }); }
  for (const c of corners) {
    c.load = 0; for (let i = c.i0; i <= c.i1; i++) { const p: any = pieces[i]; c.load += Math.abs(p.a) / 90 * Math.max(0, R_LIFT / p.r - 1); }
    // 連鎖：硬彎（R≤220）前 150m 內有別的彎，或本身是減半徑彎
    let dec = false; for (let i = c.i0 + 1; i <= c.i1; i++) if ((pieces[i] as any).r < (pieces[i - 1] as any).r) dec = true;
    let back = 0, k = c.i0 - 1, near = false; while (k >= 0 && back <= 150) { const q: any = pieces[k]; if ('a' in q) { near = true; break; } back += q.s === 'auto' ? 999 : q.s; k--; }
    c.combo = c.rmin <= 220 && (near || dec);
  }
  const hard = corners.filter((c) => c.rmin < R_LIFT);
  const hp = corners.filter((c) => c.deg >= 150).length;
  const combos = corners.filter((c) => c.combo).length;
  const rmin = Math.min(...arcs.map((x) => x.p.r));
  const load = corners.reduce((s, c) => s + c.load * (c.combo ? 1.5 : 1), 0);
  const hardest = [...corners].sort((a, b) => b.load * (b.combo ? 1.5 : 1) - a.load * (a.combo ? 1.5 : 1))[0];
  // 難度 0–10：raw = Σ彎 (角度/90)·max(0, 400/R−1)（連鎖彎 ×1.5）＋0.5·髮夾＋0.3·連鎖；score = 10·(1−e^(−raw/12))
  const raw = load + 0.5 * hp + 0.3 * combos; const score = 10 * (1 - Math.exp(-raw / 12));
  return { corners: corners.length, hardCorners: hard.length, hp, combos, totalDeg: Math.round(totalDeg), liftShare: liftM / len, rmin, load: +load.toFixed(2), score: +score.toFixed(1), raw: +raw.toFixed(2), hardest: { i0: hardest.i0, i1: hardest.i1, deg: hardest.deg, rmin: hardest.rmin } };
}
const SCORE_TARGET: Record<string, number> = { tw1: 1, tw2: 2.4, tw3: 3.2, tw4: 3.8, jp1: 5.0, jp2: 5.6, jp3: 5.8, jp4: 6.0, us1: 6.6, us2: 7.0, us3: 7.6, us4: 8.1, de1: 8.3, de2: 8.8, de3: 9.0, de4: 9.2 };
const res: any[] = []; const out: Record<string, LayoutPiece[]> = {}; let bad = 0;
for (const t of TRACKS) { if (only && t.id !== only) continue;
  const tpl = TEMPLATES[t.id]; const cur = buildTrack(t).length * SEG_LEN;
  const target = Math.round(cur * (1 + 0.06 * t.countryIdx + 0.03 * t.raceIdx) / 20) * 20;
  // 難度旋鈕：所有需收油的彎（模板 R<400）半徑 ×k（R120–399），挑分數最接近目標、長度 ≤ +30%、檢查通過的 k
  const want = SCORE_TARGET[t.id]; let f: any = null, fs = 1e9, kBest = 1;
  for (let k10 = 12; k10 <= 34; k10++) { const k = k10 / 20; {
    const base = resolve(tpl).map((p: any) => ('a' in p && p.r < 400 ? { ...p, r: Math.min(399, Math.max(120, Math.round(p.r * k / 10) * 10)) } : p));
    const c = fit(t.id, base, target); if (!c.ok) continue; const sc = metrics(c.pieces, c.len).score;
    const v = Math.abs(sc - want) + (c.len > cur * 1.3 ? 5 + (c.len - cur * 1.3) / 200 : 0); if (process.env.DBG) console.log('  k', k, 'len', c.len, 'score', sc);
    if (v < fs) { fs = v; f = c; kBest = k; } } }
  if (!f) f = fit(t.id, resolve(tpl), target);
  let g; try { g = geo(t.id, f.pieces); } catch (e: any) { console.log('ERR', t.id, e.message); bad++; continue; }
  const cross = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  let inter = 0; const P = g.pts, N = g.N;
  for (let i = 0; i < N; i++) for (let j = i + 2; j < N; j++) { if (i === 0 && j === N - 1) continue; if (cross(P[i], P[i + 1], P[j]) * cross(P[i], P[i + 1], P[j + 1]) < 0 && cross(P[j], P[j + 1], P[i]) * cross(P[j], P[j + 1], P[i + 1]) < 0) inter++; }
  const len = N * SEG_LEN, mt = metrics(f.pieces, len);
  const ok = g.m.closeGapM < 15 && inter === 0 && g.minD >= 300; if (!ok) bad++;
  out[t.id] = f.pieces;
  res.push({ id: t.id, name: t.name, country: t.country, countryId: t.countryId, laps: t.laps, ai: t.ai, scenery: t.scenery, weather: t.weather, insp: tpl.insp, note: tpl.note, cur, target, len, gap: g.m.closeGapM, inter, minD: g.minD, minAt: g.minAt.map((k) => k * SEG_LEN), autoLens: g.m.autoLens, ...mt, pieces: f.pieces, pts: g.pts, pieceStart: g.m.pieceStart });
  console.log(ok ? 'ok ' : 'BAD', t.id, 'k', kBest, 'want', want, 'cur', cur, 'tgt', target, 'len', len, 'minD', g.minD.toFixed(0), '@', g.minAt.map((k) => k * SEG_LEN).join('/'), 'inter', inter, 'auto', g.m.autoLens.join(','), JSON.stringify({ ...mt, liftShare: +mt.liftShare.toFixed(2) }));
}
if (!only) {
  writeFileSync('/workspace/prod-layouts2.json', JSON.stringify(res));
  const fmt = (p: any) => ('a' in p ? `A(${+p.a.toFixed(2)}, ${p.r}${p.hill ? ', ' + p.hill : ''})` : `S(${p.s === 'auto' ? "'auto'" : p.s}${p.hill ? ', ' + p.hill : ''})`);
  let src = `/** 草稿 v2（未接到 racing.ts）：由 racing-prod-layouts2.templates.ts 經 scripts/prod-layouts2.ts 補角＋調直線長度後的結果。 */\nimport type { LayoutPiece } from './racing-mapfirst';\nconst S = (s: number | 'auto', hill?: number): LayoutPiece => (hill ? { s, hill } : { s });\nconst A = (a: number, r: number, hill?: number): LayoutPiece => (hill ? { a, r, hill } : { a, r });\nexport const PROD_LAYOUTS2_DRAFT: Record<string, LayoutPiece[]> = {\n`;
  for (const r of res) src += `  // ${r.insp}\n  ${r.id}: [${r.pieces.map(fmt).join(', ')}],\n`;
  writeFileSync('src/racing-prod-layouts2.draft.ts', src + '};\n');
}
console.log(bad ? `${bad} BAD` : 'ALL OK');
