// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { SFV } from '../src/index';

const { DOWN, LEFT, RIGHT, HP, HK, ST, M, MOVE_LIST, STAGE_W, WALL } = SFV;
const JUGGLE_MAX = 3; // 引擎的浮空連段上限（sfv.ts JUGGLE_MAX）
const CA_DMG = MOVE_LIST[M.CA].dmg.reduce((a, b) => a + b, 0), SK_DMG = MOVE_LIST[M.SHINKU].dmg.reduce((a, b) => a + b, 0);
const QCF2 = [DOWN, DOWN | RIGHT, RIGHT, DOWN, DOWN | RIGHT];
function fight(x1: number, x2: number) {
  const s = SFV.createState(); s.rs = SFV.RS.FIGHT; s.p[0].x = x1; s.p[1].x = x2; s.p[0].ex = SFV.EX_MAX; return s;
}
/** 跑輸入；回傳 P1 這招打中幾段、P2 扣多少、是否進過鎖定 */
function run(s: any, p1: number[], p2: number[] = [], n = 220, id = 'CA') {
  let hits = 0, locked = false, hp0 = -1;
  for (let k = 0; k < n; k++) {
    const before = s.p[1].hp, wasMove = MOVE_LIST[s.p[0].mv]?.id === id;
    SFV.simulateSFVTick(s, p1[k] ?? 0, p2[k] ?? 0);
    if (!wasMove && MOVE_LIST[s.p[0].mv]?.id === id && hp0 < 0) hp0 = before;
    if (MOVE_LIST[s.p[0].mv]?.id === id && s.p[1].hp < before && s.p[1].st !== ST.BLOCK) hits++;
    if (s.p[0].sl) locked = true;
  }
  return { hits, locked, dmg: hp0 < 0 ? 0 : hp0 - s.p[1].hp };
}

describe('超必殺鎖定（SF5 Critical Art）：第一段打中就一定打完', () => {
  it('(a) 地面 CA：6 段全中，總傷害 = 每段相加', () => {
    const s = fight(450, 500);
    const r = run(s, [...QCF2, RIGHT | HK]);
    expect(r.locked).toBe(true);
    expect(r.hits).toBe(6);
    expect(r.dmg).toBe(CA_DMG);
    expect(s.p[0].sl).toBe(0); // 招式結束後清掉
  });
  it('(b) 重衝天啄 → CA 取消：對手浮空、浮空連段數已接近上限，CA 還是全中', () => {
    const s = fight(450, 490); s.p[1].jg = JUGGLE_MAX - 2;
    let maxJg = 0, airborneHits = 0;
    const p1 = [RIGHT, DOWN, DOWN | RIGHT | HP, 0, 0, ...QCF2, RIGHT | HK];
    let hits = 0, hp0 = -1;
    for (let k = 0; k < 260; k++) {
      const before = s.p[1].hp, wasCA = MOVE_LIST[s.p[0].mv]?.id === 'CA';
      SFV.simulateSFVTick(s, p1[k] ?? 0, 0);
      if (!wasCA && MOVE_LIST[s.p[0].mv]?.id === 'CA') hp0 = before;
      if (MOVE_LIST[s.p[0].mv]?.id === 'CA' && s.p[1].hp < before) { hits++; if (s.p[1].st === ST.AIRHIT) airborneHits++; }
      maxJg = Math.max(maxJg, s.p[1].jg);
    }
    expect(hp0).toBeGreaterThan(0); // 真的取消出了 CA
    expect(hits).toBe(6);
    expect(airborneHits).toBe(6);
    expect(hp0 - s.p[1].hp).toBe(CA_DMG);
    expect(maxJg).toBeGreaterThan(JUGGLE_MAX); // 超過上限照樣打中
  });
  it('(c) 真空蛋波打浮空的對手：5 段全中', () => {
    const s = fight(300, 520);
    s.p[1].st = ST.AIRHIT; s.p[1].y = -120; s.p[1].vy = -2; s.p[1].vx = 3; s.p[1].jg = 1;
    const r = run(s, [...QCF2, RIGHT | HP], [], 240, 'SHINKU');
    expect(r.locked).toBe(true);
    expect(r.hits).toBe(5);
    expect(r.dmg).toBe(SK_DMG);
  });
  it('(d) 第一段被擋：不鎖定，照常防禦（削血）', () => {
    const s = fight(450, 500);
    const r = run(s, [...QCF2, RIGHT | HK], new Array(220).fill(RIGHT));
    expect(r.locked).toBe(false);
    expect(r.hits).toBe(0);
    expect(s.p[1].hp).toBeLessThan(1000); // 白血削
    expect(s.p[1].hp).toBeGreaterThan(1000 - CA_DMG / 2);
  });
  it('(e) 揮空：不鎖定、沒有傷害', () => {
    const s = fight(100, 860);
    const r = run(s, [...QCF2, RIGHT | HK], [], 160);
    expect(r.locked).toBe(false);
    expect(s.p[1].hp).toBe(1000);
  });
  it('(f) 鎖定欄位在 P_FIELDS：pack／unpack／clone／hash 都帶著', () => {
    expect(SFV.P_FIELDS).toContain('sl');
    const s = fight(450, 500);
    for (const m of [...QCF2, RIGHT | HK]) SFV.simulateSFVTick(s, m, 0);
    for (let k = 0; k < 60 && !s.p[0].sl; k++) SFV.simulateSFVTick(s, 0, 0);
    expect(s.p[0].sl).toBe(1);
    const u = SFV.unpackState(SFV.packState(s));
    expect(u.p[0].sl).toBe(1);
    expect(SFV.cloneState(s).p[0].sl).toBe(1);
    expect(SFV.hashState(u)).toBe(SFV.hashState(s));
    const v = SFV.cloneState(s); v.p[0].sl = 0;
    expect(SFV.hashState(v)).not.toBe(SFV.hashState(s));
    // 從快照接著跑，跟原本一模一樣
    for (let k = 0; k < 120; k++) { SFV.simulateSFVTick(s, 0, 0); SFV.simulateSFVTick(u, 0, 0); }
    expect(SFV.hashState(u)).toBe(SFV.hashState(s));
  });
});
