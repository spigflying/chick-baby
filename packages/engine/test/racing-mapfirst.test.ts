import { describe, it, expect } from 'vitest';
import {
  MAPFIRST_LAYOUTS, arcSegs, mapFirstTracks, registerMapFirstTracks, trackSegs, trackPathXY, segTurn, segCurvature,
  SEG_LEN, TRACKS, trackById, createRace, stepRace, setRaceInput, mapFirstPullRate, MAPFIRST_PULL_K,
} from '../src/index';

/** 佈局的「理想」連續幾何：真圓弧上等弧長取點（每 SEG_LEN），直線照長度——與引擎無關的獨立算法 */
function idealXY(id: string): [number, number][] {
  const m = mapFirstTracks().find((t) => t.track.id === id)!; const L = MAPFIRST_LAYOUTS.find((l) => l.id === id)!;
  const pts: [number, number][] = []; let x = 0, y = 0, th = 0, auto = 0;
  for (const p of L.pieces) {
    if ('a' in p) { const a = p.a * Math.PI / 180, n = arcSegs(p.a, p.r), R = (SEG_LEN / 2 / Math.sin(Math.abs(a) / n / 2)) * Math.sign(a); // 弦長 = SEG_LEN 的圓
      // 圓心在航向右側（右轉）；以圓心參數式取點
      const cx = x + R * Math.cos(th), cy = y + R * Math.sin(th);
      for (let i = 0; i < n; i++) { const t = th + a * i / n; pts.push([cx - R * Math.cos(t), cy - R * Math.sin(t)]); }
      th += a; x = cx - R * Math.cos(th); y = cy - R * Math.sin(th); }
    else { const len = p.s === 'auto' ? m.autoLens[auto++] : p.s, n = Math.round(len / SEG_LEN);
      for (let i = 0; i < n; i++) { pts.push([x, y]); x += Math.sin(th) * SEG_LEN; y -= Math.cos(th) * SEG_LEN; } }
  }
  return pts;
}

describe('race-demo-mapfirst', () => {
  registerMapFirstTracks();
  it('does not touch production tracks', () => {
    expect(TRACKS.every((t) => t.mapFirst)).toBe(true); // race-prod-port：正式賽道全面地圖先
    expect(trackById('mf1')?.mapFirst).toBe(true);
  });
  for (const m of mapFirstTracks()) describe(m.track.id, () => {
    const segs = trackSegs(m.track.id);
    it('total turn = 360° exactly, loop closes', () => {
      expect(segs.reduce((a, s) => a + segTurn(s.curve), 0)).toBeCloseTo(2 * Math.PI, 9);
      expect(m.closeGapM).toBeLessThan(SEG_LEN);
    });
    it('minimap polyline == integrated segment turns (open path, error ~0)', () => {
      const mm = trackPathXY(segs, false).map(([x, y]) => [x * SEG_LEN, y * SEG_LEN]);
      let th = 0, x = 0, y = 0, err = 0;
      m.turns.forEach((t, i) => { err = Math.max(err, Math.hypot(mm[i][0] - x, mm[i][1] - y)); th += t; x += Math.sin(th) * SEG_LEN; y -= Math.cos(th) * SEG_LEN; });
      expect(err).toBeLessThan(1e-6);
      // minimap edge heading changes == segTurn per segment
      for (let i = 1; i < mm.length - 1; i++) {
        const h0 = Math.atan2(mm[i][0] - mm[i - 1][0], -(mm[i][1] - mm[i - 1][1])), h1 = Math.atan2(mm[i + 1][0] - mm[i][0], -(mm[i + 1][1] - mm[i][1]));
        let d = h1 - h0; d = Math.atan2(Math.sin(d), Math.cos(d));
        expect(d).toBeCloseTo(segTurn(segs[i].curve), 9);
      }
    });
    it('closed minimap (softClose) integrated segments == designed layout (open ~0; closed only spreads <1-seg closure gap)', () => {
      const mm = trackPathXY(segs, true).map(([x, y]) => [x * SEG_LEN, y * SEG_LEN]), id = idealXY(m.track.id);
      expect(id.length).toBe(mm.length);
      const span = Math.max(...id.map((p) => p[0])) - Math.min(...id.map((p) => p[0]));
      const soft = Math.max(...mm.map((p, i) => Math.hypot(p[0] - trackPathXY(segs, false)[i][0] * SEG_LEN, p[1] - trackPathXY(segs, false)[i][1] * SEG_LEN)));
      expect(soft / span).toBeLessThan(0.01);
      const open = trackPathXY(segs, false).map(([x, y]) => [x * SEG_LEN, y * SEG_LEN]);
      const devOpen = Math.max(...open.map((p, i) => Math.hypot(p[0] - id[i][0], p[1] - id[i][1])));
      expect(devOpen).toBeLessThan(1e-6); // 路段積分 == 設計圖（真圓弧弦點），誤差 ~0
      const dev = Math.max(...mm.map((p, i) => Math.hypot(p[0] - id[i][0], p[1] - id[i][1])));
    });
    it('road visual heading over each layout arc == its designed angle', () => {
      // gfx 路面：lh += segCurvature(curve)·SEG_LEN（跟 trackPathXY 同一個 turn）
      const L = MAPFIRST_LAYOUTS.find((l) => l.id === m.track.id)!;
      const lhTo = (end: number) => { let lh = 0; for (let i = 0; i < end; i++) lh += segCurvature(segs[i].curve) * SEG_LEN; return lh; };
      let designed = 0;
      L.pieces.forEach((p, pi) => {
        if (!('a' in p)) return;
        const n = m.pieceSegs[pi], d = p.a * Math.PI / 180 / n, s0 = m.pieceStart[pi];
        // 弧中第 k 段的路面航向 = 進弧航向 + (k+½)·a/n（真弧弦方向）→ 90° 彎在畫面上就轉 90°
        for (let k = 0; k < n; k++) expect(lhTo(s0 + k + 1)).toBeCloseTo(designed + (k + 0.5) * d, 9);
        designed += p.a * Math.PI / 180;
      });
    });
  });
  it('pull = curvature × speed² × K (stock dry): 90° R450 < gas steer, hairpin R180 > gas steer', () => {
    const k90 = 1 / 450 / (segCurvature(1)), kHp = 1 / 180 / segCurvature(1);
    const top = 64 * 3 / 210, pullSp = top * top * 1.25;
    const gasAuth = 0.75 * 3 / 4 * 0.75, coastAuth = 0.75 * 3 / 4 * 1.2;
    expect(MAPFIRST_PULL_K).toBe(192);
    expect(mapFirstPullRate(k90, pullSp, 1)).toBeLessThan(gasAuth);
    expect(mapFirstPullRate(kHp, pullSp, 1)).toBeGreaterThan(gasAuth);
    expect(mapFirstPullRate(kHp, (0.8 ** 2), 1)).toBeLessThan(coastAuth);
  });
  it('sim: gas+steer clears mf2 (90°s); mf1 hairpin needs coasting', () => {
    const run = (id: string, coast: boolean) => {
      const s = createRace(1, id, [{ id: 'me', name: 'me' }]); s.laps = 1; const me = s.cars[0], segs = trackSegs(id); let off = 0;
      while (!s.over && s.tick < 3000) {
        const i = Math.floor((me.z % s.len + s.len) % s.len / SEG_LEN), hp = Math.abs(segs[i].curve) > 7 || Math.abs(segs[(i + 4) % segs.length].curve) > 7;
        setRaceInput(s, 'me', { gas: !(coast && hp), brake: false, left: me.x > 0.05, right: me.x < -0.05, nitro: false });
        stepRace(s); if (Math.abs(me.x) > 1) off++;
      }
      return { off, done: me.finishedTick !== null };
    };
    expect(run('mf2', false)).toEqual({ off: 0, done: true });
    expect(run('mf1', false).off).toBeGreaterThan(0);
    expect(run('mf1', true)).toEqual({ off: 0, done: true });
  });
});
