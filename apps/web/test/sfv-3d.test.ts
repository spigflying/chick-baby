import { describe, expect, it } from 'vitest';
import { SFV } from '@chick/engine';
import { __test } from '../src/sfv-3d';

const finitePose = (o: any) => Object.entries(o).every(([, v]) => typeof v !== 'number' || Number.isFinite(v));

describe('3D 格鬥姿勢', () => {
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
