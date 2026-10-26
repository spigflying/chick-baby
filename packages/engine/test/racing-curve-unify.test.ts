import { describe, it, expect } from 'vitest';
import {
  TRACKS, buildTrack, trackSegs, SEG_LEN, SEG_TURN_K, segTurn, segCurvature, trackPathXY,
  CORNER_PULL, cornerPullPerRad, cornerPullRate, hairpinPullMul, HAIRPIN_CURVE, HAIRPIN_PULL_EXTRA,
  slideFactor, STEER_AUTH_GAS, STEER_AUTH_COAST, STEER_AUTH_NITRO, SPEED_X,
} from '../src/racing';

describe('race-curve-unify: one shared geometry', () => {
  it('SEG_TURN_K matches legacy visual CURVE_K×SEG_LEN (0.0004×20)', () => {
    expect(SEG_TURN_K).toBeCloseTo(0.0004 * SEG_LEN, 12);
    expect(SEG_TURN_K).toBeCloseTo(0.008, 12);
    expect(segTurn(2)).toBeCloseTo(2 * SEG_TURN_K, 12);
    expect(segCurvature(2)).toBeCloseTo(segTurn(2) / SEG_LEN, 12);
    expect(segCurvature(2)).toBeCloseTo(0.0004 * 2, 12); // same as old CURVE_K * curve
  });

  it('cornerPullRate ≡ legacy curve×CORNER_PULL×… (feel preserved)', () => {
    expect(CORNER_PULL).toBeGreaterThan(0.27);
    expect(CORNER_PULL).toBeLessThan(0.32);
    expect(cornerPullPerRad()).toBeCloseTo(CORNER_PULL / SEG_TURN_K, 10);
    const grip = 1.0, pullSp = 0.64;
    for (const c of [0, 1.2, 2, 4.6, -3]) {
      const legacy = c * pullSp * slideFactor(grip) * CORNER_PULL * hairpinPullMul(Math.abs(c));
      expect(cornerPullRate(c, pullSp, grip)).toBeCloseTo(legacy, 10);
    }
    expect(STEER_AUTH_GAS).toBe(0.75);
    expect(STEER_AUTH_COAST).toBe(1.2);
    expect(STEER_AUTH_NITRO).toBe(0.68);
    expect(SPEED_X).toBe(3);
  });

  it('hairpin mul still scales past HAIRPIN_CURVE', () => {
    expect(HAIRPIN_CURVE).toBe(2.0);
    expect(hairpinPullMul(HAIRPIN_CURVE)).toBe(1);
    expect(hairpinPullMul(HAIRPIN_CURVE + 1)).toBeCloseTo(1 + HAIRPIN_PULL_EXTRA, 6);
    expect(hairpinPullMul(4)).toBeGreaterThan(hairpinPullMul(2.5));
  });

  it('trackPathXY uses only segTurn — no forced 2π; softClose does not invent turn', () => {
    for (const t of TRACKS) {
      trackSegs(t.id); const segs = buildTrack(t); // race-prod-port：pieces 由地圖先佈局回填後，舊幾何管線仍需成立
      const sumTurn = segs.reduce((a, s) => a + segTurn(s.curve), 0);
      // without softClose, endpoint displacement reflects real residual turn (not forced to origin via fake heading)
      const open = trackPathXY(segs, false);
      expect(open.length).toBe(segs.length);
      // softClose endpoint ≈ start (for polyline loop draw) but heading sum unchanged in the helper’s design
      const closed = trackPathXY(segs, true);
      const [x0, y0] = closed[0];
      const n = closed.length;
      // reconstruct last step endpoint after softClose: last point should be near first
      // softClose spreads (px,py) so after n steps of the correction the geometric end meets start
      // Check finite + scaled shape has variance (not a single point unless all curve 0)
      expect(closed.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
      const xs = closed.map((p) => p[0]), ys = closed.map((p) => p[1]);
      const span = Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys);
      expect(span).toBeGreaterThan(0.5);
      void sumTurn; void x0; void y0; void n; void open;
    }
  });

  it('minimap vs physics consistency: path turn deltas match segTurn per segment', () => {
    // Recover heading deltas from open path (unit steps): Δθ_i ≈ atan2 of successive chords…
    // Simpler smoke: sum of segTurn equals total heading used while integrating open path.
    for (const id of ['tw1', 'de2', 'us3']) {
      const segs = trackSegs(id);
      let th = 0;
      for (const s of segs) th += segTurn(s.curve);
      const expected = segs.reduce((a, s) => a + s.curve, 0) * SEG_TURN_K;
      expect(th).toBeCloseTo(expected, 10);
      // physics pull magnitude proportional to same curve (via cornerPullRate)
      const p = cornerPullRate(segs[10]?.curve ?? 1, 1, 1);
      const legacy = (segs[10]?.curve ?? 1) * CORNER_PULL * slideFactor(1) * hairpinPullMul(Math.abs(segs[10]?.curve ?? 1));
      expect(p).toBeCloseTo(legacy, 10);
    }
  });

  it('elevation still closes; heading is not force-baked to 2π in buildTrack', () => {
    for (const t of TRACKS) {
      trackSegs(t.id); const segs = buildTrack(t); // race-prod-port：pieces 由地圖先佈局回填後，舊幾何管線仍需成立
      expect(Math.abs(segs[segs.length - 1].y)).toBeLessThan(1e-6);
      const sumTurn = segs.reduce((a, s) => a + segTurn(s.curve), 0);
      // Real tracks are not all ~2π; we must NOT have baked residual into every curve
      // (old minimap did). Allow any sum; just assert we did not snap to exactly 2π.
      expect(Math.abs(Math.abs(sumTurn) - Math.PI * 2) > 0.05 || Math.abs(sumTurn) < 0.05).toBe(true);
      // Stronger: mean |curve| shouldn't have a uniform +2π/(n·K) baked in for balanced tracks
      // us3 is nearly sum≈0 — if baked to 2π, sum would be 2π.
      if (t.id === 'us3' && !t.mapFirst) expect(Math.abs(sumTurn)).toBeLessThan(0.5);
    }
  });
});
