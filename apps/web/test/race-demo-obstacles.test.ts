// race-demo-obstacles：路障跟路面同一套 exact 投影 —— 越近越大（單調、連續），寬度＝那一列路寬 × 引擎寬
import { describe, it, expect } from 'vitest';
import { registerMapFirstTracks, raceObstacles, trackSegs, OBSTACLE_SPECS } from '@chick/engine';
import { exactRoadPts, exactPlace, rowAtPts, CAM_H_EXACT, GROUND_Y, PLAYER_DZ } from '../src/race-gfx';
import { obstacleDims, obstacleSlide, OBST_ART } from '../src/race-obstacles';

const MF = registerMapFirstTracks();

describe('obstacle projection', () => {
  it('art: 4 greens, rectangular grids, 1-cell dark outline on the edges', () => {
    for (const a of Object.values(OBST_ART)) {
      expect(new Set(a.map((r) => r.length)).size).toBe(1);
      for (const r of a) expect(/^[.0123]+$/.test(r)).toBe(true);
      expect(a[a.length - 1].replace(/\./g, '')).toMatch(/^3+$/);
    }
  });
  it('grows monotonically from far to near and matches the road width at that row', () => {
    for (const t of MF) for (const o of raceObstacles(3, t.id)) {
      const segs = trackSegs(t.id), camZ = o.z - 160; let prevW = 0, prevY = -1e9; const w0 = obstacleDims(o.kind, o.w, exactPlace(exactRoadPts(segs, camZ, 0, () => 0, CAM_H_EXACT), 160, 0, 0, CAM_H_EXACT)!.pw).w;
      for (let dz = 160; dz >= 12; dz -= 0.5) {
        const pts = exactRoadPts(segs, camZ + (160 - dz), 0, () => 0, CAM_H_EXACT);
        const e = exactPlace(pts, dz, 0, 0, CAM_H_EXACT)!; expect(e).not.toBeNull();
        const w = obstacleDims(o.kind, o.w, e.pw).w;
        expect(w).toBeGreaterThan(prevW * (1 - 1e-3)); // 出彎時攝影機航向回正，1/cos 項有 <0.1% 的微小回落（真實透視），不是跳動 expect(e.py).toBeGreaterThan(prevY);
        prevW = w; prevY = e.py;
        if (e.py < GROUND_Y) { const row = rowAtPts(pts, e.py)!; expect(Math.abs(row.w - e.pw) / e.pw).toBeLessThan(0.03); }
      }
      expect(prevW).toBeGreaterThan(w0 * 5); // 160 m → 12 m：至少放大 5 倍
      // 150 m 外就看得到（≥ 2px 寬）
      const far = exactPlace(exactRoadPts(segs, o.z - 150 - 0, 0, () => 0, CAM_H_EXACT), 150, 0, 0, CAM_H_EXACT)!;
      expect(obstacleDims(o.kind, o.w, far.pw).w).toBeGreaterThanOrEqual(2);
    }
  });
  it('drawn width = engine hitbox width × road half-width px; height follows the art', () => {
    for (const k of ['boxes', 'tyres', 'cones'] as const) {
      const d = obstacleDims(k, OBSTACLE_SPECS[k].w, 100);
      expect(d.w).toBeCloseTo(OBSTACLE_SPECS[k].w * 100);
      expect(d.h / d.w).toBeCloseTo(OBST_ART[k].length / OBST_ART[k][0].length);
    }
  });
  it('after passing the car nose it slides off screen continuously', () => {
    let prev = -1; for (let dz = 6; dz >= 0.5; dz -= 0.05) { const s = obstacleSlide(dz, PLAYER_DZ); expect(s).toBeGreaterThanOrEqual(prev); expect(s - prev < 0.05 || prev < 0).toBe(true); prev = s; }
    expect(obstacleSlide(PLAYER_DZ + 1, PLAYER_DZ)).toBe(0); expect(obstacleSlide(0.5, PLAYER_DZ)).toBe(1);
  });
});
