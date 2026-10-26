import { describe, it, expect } from 'vitest';
import { TRACKS, createRace, stepRace, fillField, DEMO_HITBOX, DEMO_CAR_W, COLLIDE_DX, ROAD_WIDEN, type RaceState } from '../src';

// 畫面上：車精靈寬 48–52px、底線半路寬 ≈194.8px → 0.246–0.267 路寬單位；兩台 50px 的車中心相距 < 0.257 才會疊到
const SPRITE_W = DEMO_CAR_W; // race-demo-onecar：所有車畫成同寬 = 盒寬
function duo(dx: number, dz: number, demo = true, rel = 0, pick: 'mix' | 'ai' = 'mix') {
  const s: RaceState = createRace(1, TRACKS[0].id, fillField([{ id: 'me', name: 'me' }]));
  if (demo) s.hitbox = DEMO_HITBOX;
  s.countdown = 0; s.pickups = [];
  const ord = pick === 'ai' ? s.cars.filter((c) => c.id !== 'me').concat(s.cars.filter((c) => c.id === 'me')) : [s.cars.find((c) => c.id === 'me')!, ...s.cars.filter((c) => c.id !== 'me')];
  const [a, b, ...rest] = ord; for (const c of rest) { c.z = -500 - Math.random(); c.finishedTick = 0; }
  for (const c of [a, b]) { c.ai = false; c.stats.accel = 0; }
  a.z = 100; b.z = 100 + dz; a.x = 0; b.x = dx; a.speed = 20 + rel; b.speed = 20; a.aiLane = 0; b.aiLane = dx;
  stepRace(s); return a.hits + b.hits > 0 || a.hit > 0 || b.hit > 0;
}
describe('race-demo hitbox matches sprite', () => {
  it('one box = one drawn car width; old box wider', () => {
    expect(DEMO_HITBOX.dx).toBe(DEMO_CAR_W);
    expect(DEMO_CAR_W).toBeCloseTo(52 / 194.8, 2);
    expect(COLLIDE_DX).toBeGreaterThan(SPRITE_W); // 舊盒子：精靈之間還有空隙就算碰
    expect(0.38 / ROAD_WIDEN).toBeCloseTo(COLLIDE_DX);
  });
  it('side-by-side with visible gap: no hit (demo), but old box hits', () => {
    const gap = SPRITE_W + 0.02; // 約 4px 的縫
    expect(duo(gap, 0.3)).toBe(false);
  });
  it('side-by-side overlapping sprites: hit', () => { expect(duo(SPRITE_W - 0.05, 0.3)).toBe(true); });
  it('nose-to-tail with a gap (dz 3 m): no hit in demo, hit in old', () => {
    expect(duo(0, 3, true, 30)).toBe(false);
  });
  it('rear-end when bumpers overlap (dz 1.2 m, faster behind): hit', () => { expect(duo(0, 1.2, true, 30)).toBe(true); });
  it('hits only when sprites overlap: touching = no hit, 1% overlap = hit; same for player–AI and AI–AI', () => {
    for (const pick of ['mix', 'ai'] as const) {
      expect(duo(SPRITE_W, 0.3, true, 0, pick)).toBe(false);
      expect(duo(SPRITE_W + 0.03, 0.3, true, 0, pick)).toBe(false);
      expect(duo(SPRITE_W * 0.99, 0.3, true, 0, pick)).toBe(true);
    }
  });
});
