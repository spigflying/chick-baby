import { describe, expect, it } from 'vitest';
import { SFV } from '@chick/engine';
import { FIGHT_FACES } from '@chick/engine';
import { __test, FACES } from '../src/sfv-3d';

const finitePose = (o: any) => Object.entries(o).every(([, v]) => typeof v !== 'number' || Number.isFinite(v));

describe('3D 格鬥姿勢', () => {
  it('前端的臉清單跟伺服器（引擎）一致，照片臉都有五官座標', () => {
    expect(Object.keys(FACES)).toEqual([...FIGHT_FACES]);
    for (const id of FIGHT_FACES) if (id !== 'chick') expect(FACES[id]).toMatchObject({ src: expect.stringContaining(`face_${id}`), eyes: expect.any(Array), nose: expect.any(Array), cheek: expect.any(Array) });
  });
  it('每種狀態都算得出有限的姿勢', () => {
    const s = SFV.createState([0, 0]);
    for (const st of SFV.ST_NAME) {
      for (const t of [0, 5, 16, 30]) {
        const p = { ...s.p[0], st: SFV.ST[st], t, mv: st === 'MOVE' ? 0 : -1, mt: 1, vx: st === 'IDLE' ? 3 : 0, vy: -5 };
        expect(finitePose(__test.poseFor(p, s)), `${st} t=${t}`).toBe(true);
      }
    }
  });
  it('每一招從第 1 幀到收招結束都算得出有限的姿勢', () => {
    const s = SFV.createState([0, 0]);
    SFV.MOVE_LIST.forEach((mv: any, k: number) => {
      const total = mv.S + (mv.A || 1) + (mv.R || 30) + 5;
      for (let mt = 1; mt <= total; mt++) {
        const p = { ...s.p[0], st: SFV.ST.MOVE, mv: k, mt, vy: 0 };
        expect(finitePose(__test.poseFor(p, s)), `${mv.id} mt=${mt}`).toBe(true);
      }
    });
  });
  it('打擊幀時手／腳會伸到判定框（ik = 1），收招結束回到架式', () => {
    const s = SFV.createState([0, 0]);
    const k = SFV.MOVE_LIST.findIndex((m: any) => m.id === '5HP'), mv = SFV.MOVE_LIST[k];
    const at = (mt: number) => __test.poseFor({ ...s.p[0], st: SFV.ST.MOVE, mv: k, mt }, s);
    expect(at(mv.S)).toMatchObject({ ik: 1, ikLimb: 'aF' });
    expect(at(mv.S + mv.A + mv.R).ik).toBe(0);
  });
});

  it('近身防禦：IDLE 按後用 BLOCK_ST，CROUCH 後下用 BLOCK_CR', () => {
    const { LEFT, DOWN, HP, ST } = SFV;
    const fight = (x1: number, x2: number) => {
      const s = SFV.createState([0, 0]); s.rs = SFV.RS.FIGHT; s.p[0].x = x1; s.p[1].x = x2; return s;
    };
    const tick = (s: any, a = 0, b = 0) => SFV.simulateSFVTick(s, a, b);
    const s = fight(450, 520);
    tick(s, LEFT, HP);
    expect(SFV.proxGuard(s, 0)).toBe(4);
    expect(s.p[0].st).toBe(ST.IDLE);
    const st = __test.poseFor(s.p[0], s);
    expect(st.lean).toBeCloseTo(-0.12, 5);
    expect(st.eF).toBeCloseTo(2.6, 5);
    expect(st.head).toBeCloseTo(-0.15, 5);

    const s2 = fight(450, 520);
    tick(s2, DOWN | LEFT, HP);
    expect(SFV.proxGuard(s2, 0)).toBe(1);
    expect(s2.p[0].st).toBe(ST.CROUCH);
    const cr = __test.poseFor(s2.p[0], s2);
    expect(cr.eF).toBeCloseTo(2.6, 5);
    expect(cr.head).toBeCloseTo(-0.2, 5);
    expect(cr.aF).toBeCloseTo(0.3, 5);
    // 無近身範圍時（對手 IDLE）蹲下是普通 CROUCH，不是 BLOCK_CR
    const s3 = fight(200, 800);
    tick(s3, DOWN | LEFT, 0);
    expect(SFV.proxGuard(s3, 0)).toBe(0);
    expect(__test.poseFor(s3.p[0], s3).eF).toBeCloseTo(1.9, 5);
  });

  it('blockstun 仍用 BLOCK 姿勢；預跳／落地依 PREJUMP_T／JUMP_LAND', () => {
    const s = SFV.createState([0, 0]);
    expect(SFV.PREJUMP_T).toBe(4);
    expect(SFV.JUMP_LAND).toBe(4);
    const blk = __test.poseFor({ ...s.p[0], st: SFV.ST.BLOCK, cr: 0, t: 8 }, s);
    expect(blk.lean).toBeCloseTo(-0.12, 5);
    const blkCr = __test.poseFor({ ...s.p[0], st: SFV.ST.BLOCK, cr: 1, t: 8 }, s);
    expect(blkCr.eF).toBeCloseTo(2.6, 5);

    const pj4 = __test.poseFor({ ...s.p[0], st: SFV.ST.PREJUMP, t: 4 }, s);
    const pj1 = __test.poseFor({ ...s.p[0], st: SFV.ST.PREJUMP, t: 1 }, s);
    expect(pj4.drop).toBeGreaterThan(pj1.drop);

    const land4 = __test.poseFor({ ...s.p[0], st: SFV.ST.LAND, t: 4, mv: -1 }, s);
    const land1 = __test.poseFor({ ...s.p[0], st: SFV.ST.LAND, t: 1, mv: -1 }, s);
    expect(land4.drop).toBeGreaterThan(land1.drop);
    expect(land4.sy).toBeLessThan(land1.sy);
  });
