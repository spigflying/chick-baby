// 試玩頁（地圖先）exact 投影：前方路面 = 各段自己的轉角積分；不轉向時車身穩定（只有離心的平滑外飄）
import { describe, it, expect } from 'vitest';
import { registerMapFirstTracks, mapFirstTracks, segCurvature, SEG_LEN, createRace, setRaceInput, stepRace, fillField, STOCK_PARTS, RACE_TICK_RATE } from '@chick/engine';
import { exactRoadPts, exactMeCenter, rowAtPts, GROUND_Y, RACE_ROAD_W, RACE_DEPTH, RACE_HORIZON, RACE_CAM_H, RACE_DRAW, CAM_H_EXACT, raceCamFollow, W, type RoadPt } from '../src/race-gfx';

registerMapFirstTracks();
const mf = (id: string) => mapFirstTracks().find((m) => m.track.id === id)!;

/** 參考：獨立細步長（0.05m）積分每段自己的曲率，真實前向深度投影 */
function refScreenX(segs: { curve: number }[], camZ: number, s: number, camXw: number) {
  const n = segs.length, step = 0.05; let lat = 0, fw = 0, h = 0, z = camZ;
  for (let u = 0; u < s - 1e-9; u += step) {
    const l = Math.min(step, s - u), c = segCurvature(segs[Math.floor(z / SEG_LEN) % n].curve);
    lat += Math.sin(h + c * l / 2) * l; fw += Math.cos(h + c * l / 2) * l; h += c * l; z += l;
  }
  const scale = RACE_DEPTH * 6 / (fw + 4); return W / 2 + (lat - camXw) * scale * (W / 2);
}
/** 修正前（正式 /race 的公式）：弧長當深度、二次橫移，第一段長度隨 frac 變 */
function legacyPts(segs: { curve: number }[], camZ: number, camXw: number, camY: number): RoadPt[] {
  const n = segs.length, base = Math.floor(camZ / SEG_LEN), frac = (camZ % SEG_LEN) / SEG_LEN, pts: RoadPt[] = [];
  let lx = 0, lh = 0;
  for (let k = 0; k < RACE_DRAW; k++) {
    const d = k === 0 ? 0 : (k - frac) * SEG_LEN, c = segCurvature(segs[(base + k) % n].curve), zRel = d + 4, scale = RACE_DEPTH * 6 / zRel;
    pts.push({ y: RACE_HORIZON + camY * scale * (W / 2) / 6, x: W / 2 + (lx - camXw) * scale * (W / 2), w: RACE_ROAD_W * scale * (W / 2), scale, i: 0, clip: 0, wx: lx, wy: 0, z: zRel, d, h: lh, c, fw: d });
    const L = k === 0 ? (1 - frac) * SEG_LEN : SEG_LEN; lx += lh * L + c * L * L / 2; lh += c * L;
  }
  return pts;
}

describe('exact 前方路面', () => {
  it('每個取樣點的螢幕 x = 該處以各段自己轉角積分的真實投影（< 0.01px）', () => {
    for (const id of ['mf1', 'mf2', 'mf3']) {
      const segs = mf(id).segs;
      for (const camZ of [0, 133.7, 2000, 4567.8, 6001]) {
        const pts = exactRoadPts(segs, camZ, 0.7, () => 0, CAM_H_EXACT);
        let worst = 0;
        for (const p of pts) worst = Math.max(worst, Math.abs(p.x - refScreenX(segs, camZ, p.d, 0.7)));
        expect(worst).toBeLessThan(0.01);
      }
    }
  });
  it('90° 彎與髮夾彎：同距離預覽時形狀明顯不同，彎的起點與地圖一致', () => {
    const m = mf('mf1'), t1 = m.pieceStart[1] * SEG_LEN, hp = m.pieceStart[8] * SEG_LEN;
    const off = (start: number, ahead: number) => { const pts = exactRoadPts(m.segs, start - 100, 0, () => 0, CAM_H_EXACT); const p = pts.find((q) => q.d >= ahead - 1e-6)!; return { dx: p.x - W / 2, h: p.h }; };
    // 彎起點之前（d < 100m）完全直：螢幕 x 不偏
    expect(Math.abs(off(t1, 99).dx)).toBeLessThan(1e-6); expect(Math.abs(off(hp, 99).dx)).toBeLessThan(1e-6);
    // 進彎 60m 後：航向分別 = 60/R（R450 vs R180）
    const a = off(t1, 160), b = off(hp, 160);
    // 進彎第一段只轉半段（半步相位，見 racing-mapfirst）→ 航向 = (60-10)/R
    expect(a.h).toBeCloseTo(50 / 450, 2); expect(b.h).toBeCloseTo(50 / 180, 2);
    expect(b.dx / a.dx).toBeGreaterThan(2);
  });
});

describe('不轉向時車身穩定', () => {
  function run(exact: boolean) {
    const m = mf('mf1'), seg0 = m.pieceStart[1] - 8, s = createRace(1, 'mf1', fillField([{ id: 'me', name: 'me', car: 'gt', parts: STOCK_PARTS } as any], 1) as any);
    s.countdown = 0; const me = s.cars.find((c: any) => c.id === 'me')!;
    for (const c of s.cars) if (c !== me) c.z = -5000;
    me.z = seg0 * SEG_LEN; me.speed = 120 * 3 * 0.6; me.x = 0;
    const xs: number[] = [], cxs: number[] = [];
    for (let i = 0; i < RACE_TICK_RATE * 3; i++) {
      setRaceInput(s, 'me', { gas: true, brake: false, left: false, right: false, nitro: false }); stepRace(s);
      for (const c of s.cars) if (c !== me) c.z = -5000;
      const camZ = me.z - 2.75, camXw = me.x * RACE_ROAD_W * raceCamFollow(me.x);
      const pts = exact ? exactRoadPts(m.segs, camZ, camXw, () => 0, CAM_H_EXACT) : legacyPts(m.segs, camZ, camXw, RACE_CAM_H);
      const row = rowAtPts(pts, GROUND_Y)!; cxs.push((exact ? exactMeCenter(pts, row.w, camXw) : row.x) + me.x * row.w); xs.push(me.x);
    }
    return { xs, cxs };
  }
  /** 左右擺＝二階差（>0.05px）正負交替的次數；平滑外飄只會同號 */
  const flips = (a: number[]) => { let f = 0, prev = 0; for (let i = 2; i < a.length; i++) { const w = a[i] - 2 * a[i - 1] + a[i - 2]; if (Math.abs(w) < 0.05) continue; const sg = Math.sign(w); if (prev && sg !== prev) f++; prev = sg; } return f; };
  const mono = (a: number[]) => { const d = a.slice(1).map((v, i) => v - a[i]); return d.every((x) => x >= -1e-6) || d.every((x) => x <= 1e-6); };
  it('引擎：不按方向 → x 只單調往外（離心），沒有左右擺', () => {
    const { xs } = run(true);
    const dx = xs.slice(1).map((v, i) => v - xs[i]);
    expect(dx.every((d) => d >= -1e-9) || dx.every((d) => d <= 1e-9)).toBe(true);
  });
  it('畫面：exact 模式車身螢幕 x 單向平滑（不左右擺），舊投影每 tick 左右跳', () => {
    const after = run(true), before = run(false);
    const fa = flips(after.cxs), fb = flips(before.cxs);
    if (process.env.SWAY_DUMP) require('fs').writeFileSync(process.env.SWAY_DUMP, JSON.stringify({ before: before.cxs, after: after.cxs }));
    expect(fa).toBe(0); // 修正後：不擺
    expect(mono(after.cxs)).toBe(true); // 只單向（往外）平滑移動
    expect(fb).toBeGreaterThan(10); // 修正前：每 tick 左右跳
  });
});
