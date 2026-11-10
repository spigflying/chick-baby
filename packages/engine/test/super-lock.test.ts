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
  it('(a) 地面 CA：10 段全中，總傷害 400（每段相加）', () => {
    const s = fight(450, 500);
    const r = run(s, [...QCF2, RIGHT | HK]);
    expect(r.locked).toBe(true);
    expect(r.hits).toBe(10);
    expect(CA_DMG).toBe(400);
    expect(r.dmg).toBe(CA_DMG);
    expect(s.p[0].sl).toBe(0); // 招式結束後清掉
  });
  it('(b) 重衝天啄 → CA 取消：對手浮空、浮空連段數已接近上限，CA 還是全中', () => {
    const s = fight(450, 490); s.p[1].jg = JUGGLE_MAX - 2;
    let maxJg = 0, airborneHits = 0;
    const p1 = [RIGHT, DOWN, DOWN | RIGHT | HP, 0, 0, ...QCF2, RIGHT | HK];
    let hits = 0, hp0 = -1;
    for (let k = 0; k < 320; k++) {
      const before = s.p[1].hp, wasCA = MOVE_LIST[s.p[0].mv]?.id === 'CA';
      SFV.simulateSFVTick(s, p1[k] ?? 0, 0);
      if (!wasCA && MOVE_LIST[s.p[0].mv]?.id === 'CA') hp0 = before;
      if (MOVE_LIST[s.p[0].mv]?.id === 'CA' && s.p[1].hp < before) { hits++; if (s.p[1].st === ST.AIRHIT) airborneHits++; }
      maxJg = Math.max(maxJg, s.p[1].jg);
    }
    expect(hp0).toBeGreaterThan(0); // 真的取消出了 CA
    expect(hits).toBe(10);
    expect(airborneHits).toBe(10);
    expect(hp0 - s.p[1].hp).toBe(CA_DMG);
    expect(1000 - s.p[1].hp).toBe(MOVE_LIST[M.DP_H].dmg[0] + 400); // 整套：重衝天啄 + CA 400
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
    expect(s.p[0].sl).toBe(2); // CA = 演出鎖定（攻擊方無敵）
    const u = SFV.unpackState(SFV.packState(s));
    expect(u.p[0].sl).toBe(2);
    expect(SFV.cloneState(s).p[0].sl).toBe(2);
    const w = SFV.cloneState(s); w.p[0].sl = 1;
    expect(SFV.unpackState(SFV.packState(w)).p[0].sl).toBe(1);
    expect(SFV.hashState(w)).not.toBe(SFV.hashState(s));
    expect(SFV.hashState(u)).toBe(SFV.hashState(s));
    const v = SFV.cloneState(s); v.p[0].sl = 0;
    expect(SFV.hashState(v)).not.toBe(SFV.hashState(s));
    // 從快照接著跑，跟原本一模一樣
    for (let k = 0; k < 120; k++) { SFV.simulateSFVTick(s, 0, 0); SFV.simulateSFVTick(u, 0, 0); }
    expect(SFV.hashState(u)).toBe(SFV.hashState(s));
  });
  it('真空蛋波全畫面：從左邊角落打到右邊角落的對手，5 段全中', () => {
    const s = fight(WALL + 20, STAGE_W - WALL - 20);
    const r = run(s, [...QCF2, RIGHT | HP], [], 240, 'SHINKU');
    expect(r.hits).toBe(5);
    expect(r.dmg).toBe(SK_DMG);
    const t = fight(STAGE_W - WALL - 20, WALL + 20); t.p[0].f = -1; t.p[1].f = 1;
    const L = [DOWN, DOWN | LEFT, LEFT, DOWN, DOWN | LEFT, LEFT | HP];
    expect(run(t, L, [], 240, 'SHINKU').hits).toBe(5);
  });
});

/**
 * 跑大招，鎖定成立、招式走到 mt ≥ atMt（過了 1～10 幀無敵）時，在 P1 身上放一顆 P2 先前放出、正飛向 P1 的波。
 * 回傳 P1 這招打中幾段、P2 扣多少、波打中 P1 沒、鎖定值、波最後還在不在
 */
function runWithFireball(s: any, p1: number[], id: string, atMt = 12, n = 260) {
  let hits = 0, hp0 = -1, injected = false, p1Hit = false, slAt = 0;
  for (let k = 0; k < n; k++) {
    const before = s.p[1].hp, wasMove = MOVE_LIST[s.p[0].mv]?.id === id, p1hp = s.p[0].hp;
    SFV.simulateSFVTick(s, p1[k] ?? 0, 0);
    if (!wasMove && MOVE_LIST[s.p[0].mv]?.id === id && hp0 < 0) hp0 = before;
    if (MOVE_LIST[s.p[0].mv]?.id === id && s.p[1].hp < before && s.p[1].st !== ST.BLOCK) hits++;
    if (s.p[0].hp < p1hp) p1Hit = true;
    if (!injected && s.p[0].sl && s.p[0].mt >= atMt) {
      injected = true; slAt = s.p[0].sl;
      s.pr.push({ o: 1, x: s.p[0].x, y: -66, vx: -5 * s.p[0].f, n: 1, lv: 0, cd: 0 });
    }
  }
  return { hits, dmg: hp0 < 0 ? 0 : hp0 - s.p[1].hp, injected, p1Hit, slAt };
}

describe('大招無敵（SF5）：演出中攻擊方全身無敵，遠距離光束打得到', () => {
  it('SUPER_CLOSE = 120', () => { expect(SFV.SUPER_CLOSE).toBe(120); });
  it('CA：鎖定後被先前放出的波碰到也不會中斷，10 段打完，波繼續飛', () => {
    const s = fight(450, 500);
    const r = runWithFireball(s, [...QCF2, RIGHT | HK], 'CA', 14);
    expect(r.injected).toBe(true);
    expect(r.slAt).toBe(2);
    expect(r.p1Hit).toBe(false);
    expect(r.hits).toBe(10);
    expect(r.dmg).toBe(CA_DMG);
  });
  it('CA 演出中：受擊框是空的、幀數條標無敵', () => {
    const s = fight(450, 500);
    const p1 = [...QCF2, RIGHT | HK];
    let checked = false;
    for (let k = 0; k < 200; k++) {
      SFV.simulateSFVTick(s, p1[k] ?? 0, 0);
      if (s.p[0].sl === 2 && s.p[0].mt > 12) {
        expect(SFV.hurtboxes(s.p[0]).length).toBe(0);
        expect(SFV.frameKind(s, 0).inv).toBe(true);
        checked = true;
      }
    }
    expect(checked).toBe(true);
  });
  it('近距離真空蛋波（≤ 120）：同樣演出鎖定、無敵，5 段打完', () => {
    const s = fight(450, 520);
    const r = runWithFireball(s, [...QCF2, RIGHT | HP], 'SHINKU', 12);
    expect(r.slAt).toBe(2);
    expect(r.p1Hit).toBe(false);
    expect(r.hits).toBe(5);
    expect(r.dmg).toBe(SK_DMG);
  });
  it('遠距離真空蛋波：對手被鎖，但放的人被先前放出的波打中 → 鎖定斷掉，剩下的段不會打中', () => {
    const s = fight(200, 700);
    const r = runWithFireball(s, [...QCF2, RIGHT | HP], 'SHINKU', 12);
    expect(r.slAt).toBe(1);
    expect(r.p1Hit).toBe(true);
    expect(s.p[0].sl).toBe(0);
    expect(r.hits).toBeGreaterThan(0);
    expect(r.hits).toBeLessThan(5);
    expect(r.dmg).toBeLessThan(SK_DMG);
  });
  it('遠距離真空蛋波沒人打擾：照樣 5 段打完', () => {
    const s = fight(200, 700);
    const r = run(s, [...QCF2, RIGHT | HP], [], 240, 'SHINKU');
    expect(r.hits).toBe(5);
    expect(r.dmg).toBe(SK_DMG);
  });
  it('鎖定結束後的收招打得到（確反）', () => {
    const s = fight(450, 500);
    const p1 = [...QCF2, RIGHT | HK];
    let wasLocked = false, recoveryVulnerable = false, p1Hit = false;
    for (let k = 0; k < 220; k++) {
      const hp = s.p[0].hp;
      SFV.simulateSFVTick(s, p1[k] ?? 0, 0);
      if (s.p[0].sl) wasLocked = true;
      if (s.p[0].hp < hp) p1Hit = true;
      if (wasLocked && !s.p[0].sl && MOVE_LIST[s.p[0].mv]?.id === 'CA' && !recoveryVulnerable) {
        const mv = MOVE_LIST[M.CA];
        expect(s.p[0].mt).toBeGreaterThanOrEqual(mv.startup + mv.active);
        expect(SFV.hurtboxes(s.p[0]).length).toBeGreaterThan(0);
        recoveryVulnerable = true;
        s.pr.push({ o: 1, x: s.p[0].x, y: -66, vx: -5 * s.p[0].f, n: 1, lv: 0, cd: 0 });
      }
    }
    expect(recoveryVulnerable).toBe(true);
    expect(p1Hit).toBe(true);
  });
});
