// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { SFV, SFV_FIT } from '../src/index';

const { UP, DOWN, LEFT, RIGHT, LP, HP, LK, HK, ST, EASY_HADO, M, PROJ } = SFV;

function fight(x1 = 400, x2 = 600, modes: number[] = [0, 0]) {
  const s = SFV.createState(modes);
  s.rs = SFV.RS.FIGHT;
  s.p[0].x = x1; s.p[1].x = x2;
  return s;
}
function tick(s: any, m1 = 0, m2 = 0) { SFV.simulateSFVTick(s, m1, m2); return s; }

describe('jump A+B', () => {
  it('exports new constants', () => {
    expect(SFV.PREJUMP_T).toBe(4);
    expect(SFV.JUMP_VY).toBe(-18);
    expect(SFV.JUMP_LAND).toBe(4);
    expect(SFV.GRAVITY).toBe(1);
    expect(SFV.JUMP_VX).toBe(4);
  });

  it('neutral jump apex ~-153, longer airtime, land 4', () => {
    const s = fight(450, 750);
    tick(s, UP);
    const rows: any[] = [];
    for (let i = 0; i < 90; i++) {
      const p = s.p[0];
      rows.push({ i, st: SFV.ST_NAME[p.st], y: p.y, x: p.x });
      tick(s, 0);
      if (p.st === ST.IDLE && i > 5) break;
    }
    const apex = Math.min(...rows.map((r) => r.y));
    const landRows = rows.filter((r) => r.st === 'LAND');
    expect(apex).toBeLessThanOrEqual(-150);
    expect(apex).toBeGreaterThanOrEqual(-160);
    expect(landRows[0].i).toBeGreaterThan(30);
    expect(landRows.length).toBe(4);
  });

  it('air hurt bottom never below -40 (engine + fit)', () => {
    const p: any = { x: 400, y: -100, f: 1, st: ST.JUMP, mv: -1, mt: 0, vy: 0, vx: 0, cr: 0, hs: 0, air: 0, jg: 0, t: 0 };
    const boxes = SFV.hurtboxes(p);
    for (const b of boxes) expect(b[1] + b[3]).toBeLessThanOrEqual(p.y - 40 + 1e-9);
    // fit pose hurt slim
    const rel = SFV_FIT.hurt(p)!;
    for (const b of rel) expect(b[1] + b[3]).toBeLessThanOrEqual(-40);
  });

  it('8HP/8HK live + fit hitboxes match art port', () => {
    expect(SFV.MOVE_LIST[M['8HP']].hitbox).toEqual([10, -44, 44, 26]);
    expect(SFV.MOVE_LIST[M['8HK']].hitbox).toEqual([6, -60, 60, 20]);
    const p = (id: string) => ({ x: 400, y: -60, f: 1, st: ST.MOVE, mv: M[id], mt: SFV.MOVE_LIST[M[id]].S, vy: 0, vx: 0, cr: 0, hs: 0, air: 1, hm: 0, cn: 0, t: 0 });
    expect(SFV_FIT.hit(p('8HP'))).toEqual([10, -44, 44, 26]);
    expect(SFV_FIT.hit(p('8HK'))).toEqual([6, -60, 60, 20]);
  });
});

describe('SF5 proximity guard', () => {
  it('holding back stops walk and shows stand guard when opponent attacks in range', () => {
    const s = fight(450, 520); // close
    // P1 starts 5HP (startup 9)
    tick(s, 0, 0);
    const x0 = s.p[0].x;
    tick(s, LEFT, HP); // P0 hold back, P1 5HP — same tick freezeProx zeros back-walk
    expect(s.p[1].st).toBe(ST.MOVE);
    expect(SFV.proxGuard(s, 0)).toBe(4);
    expect(s.p[0].vx).toBe(0);
    const x1 = s.p[0].x;
    for (let i = 0; i < 5; i++) tick(s, LEFT, 0);
    expect(s.p[0].x).toBe(x1);
    expect(SFV_FIT.pose(s.p[0], s).img).toBe('n_sblock');
  });

  it('down-back shows crouch guard pose', () => {
    const s = fight(450, 520);
    tick(s, DOWN | LEFT, HP);
    expect(SFV.proxGuard(s, 0)).toBe(1);
    expect(s.p[0].st).toBe(ST.CROUCH);
    expect(SFV_FIT.pose(s.p[0], s).img).toBe('n_cblock');
  });

  it('releases when opponent recovers / out of range', () => {
    const s = fight(450, 520);
    tick(s, LEFT, HP);
    expect(SFV.proxGuard(s, 0)).toBe(4);
    for (let i = 0; i < 60; i++) tick(s, LEFT, 0);
    expect(s.p[1].st).toBe(ST.IDLE);
    expect(SFV.proxGuard(s, 0)).toBe(0);
    // now walk back works
    const x = s.p[0].x;
    tick(s, LEFT, 0);
    expect(s.p[0].vx).toBeLessThan(0);
    tick(s, LEFT, 0);
    expect(s.p[0].x).toBeLessThan(x);
  });

  it('whiff still triggers; throw does not', () => {
    const s = fight(300, 700); // far — 5HP will whiff
    tick(s, LEFT, HP);
    // may or may not be in prox range at dist 400; use closer whiff: hitbox won't reach but prox margin might
    const s2 = fight(450, 560);
    tick(s2, LEFT, HP);
    expect(SFV.proxGuard(s2, 0)).toBe(4); // prox > hit
    // throw
    const s3 = fight(450, 500);
    tick(s3, LEFT, LP | LK);
    expect(s3.p[1].st === ST.MOVE || s3.p[1].st === ST.THROWING || s3.p[1].st === ST.IDLE).toBe(true);
    // if THROW move startup
    if (s3.p[1].st === ST.MOVE && SFV.MOVE_LIST[s3.p[1].mv].id === 'THROW') {
      expect(SFV.proxGuard(s3, 0)).toBe(0);
    }
    // force throw move state
    const s4 = fight(450, 500);
    s4.p[1].st = ST.MOVE; s4.p[1].mv = M.THROW; s4.p[1].mt = 2;
    s4.p[0].st = ST.IDLE;
    // need hist for back input
    for (let k = 0; k < 3; k++) tick(s4, LEFT, 0);
    s4.p[1].st = ST.MOVE; s4.p[1].mv = M.THROW; s4.p[1].mt = 2;
    expect(SFV.proxGuard(s4, 0)).toBe(0);
  });

  it('projectile triggers proximity guard', () => {
    const s = fight(400, 700, [0, 1]);
    for (let i = 0; i < 3; i++) tick(s, 0, 0);
    tick(s, LEFT, EASY_HADO);
    // wait until projectile exists
    for (let i = 0; i < 20 && !s.pr.length; i++) tick(s, LEFT, 0);
    expect(s.pr.length).toBeGreaterThan(0);
    // while fireball approaching, holding back → prox
    let saw = false;
    for (let i = 0; i < 80; i++) {
      tick(s, LEFT, 0);
      if (SFV.proxGuard(s, 0) === 4) { saw = true; break; }
      if (s.p[0].st === ST.BLOCK || s.p[0].st === ST.HIT) break;
    }
    expect(saw).toBe(true);
  });

  it('can cancel prox into attack or jump', () => {
    const s = fight(450, 520);
    tick(s, LEFT, HP);
    expect(SFV.proxGuard(s, 0)).toBe(4);
    tick(s, LP, 0); // jab out
    expect(s.p[0].st).toBe(ST.MOVE);
    expect(SFV.MOVE_LIST[s.p[0].mv].id).toBe('5LP');

    const s2 = fight(450, 520);
    tick(s2, LEFT, HP);
    tick(s2, UP, 0);
    expect(s2.p[0].st).toBe(ST.PREJUMP);
  });

  it('deterministic across two runs', () => {
    const run = () => {
      const s = fight(450, 530);
      const imgs: string[] = [];
      for (let i = 0; i < 30; i++) {
        tick(s, LEFT, i === 0 ? HP : 0);
        imgs.push(SFV_FIT.pose(s.p[0], s).img + '/' + SFV.proxGuard(s, 0) + '/' + s.p[0].x);
      }
      return { h: SFV.hashState(s), imgs };
    };
    const a = run(), b = run();
    expect(a.h).toBe(b.h);
    expect(a.imgs).toEqual(b.imgs);
  });
});

describe('hado jump clearance after A+B', () => {
  it('prints clear table', () => {
    const lines: string[] = [];
    for (const dist of [180, 220, 260, 300, 340, 380, 420]) {
      for (const jdir of ['N', 'F'] as const) {
        const clears: number[] = [];
        for (const react of [0, 6, 10, 14, 18, 22, 26, 30]) {
          const s = fight(400, 400 + dist, [0, 1]);
          for (let k = 0; k < 3; k++) tick(s, 0, 0);
          let appeared = -1, hit = false;
          const jmask = jdir === 'N' ? UP : UP | RIGHT;
          for (let i = 0; i < 220; i++) {
            let m1 = 0, m2 = 0;
            if (appeared < 0 && !s.pr.length) m2 = EASY_HADO;
            if (s.pr.length && appeared < 0) appeared = i;
            if (appeared >= 0 && i === appeared + react) m1 = jmask;
            const hp = s.p[0].hp;
            tick(s, m1, m2);
            if (s.p[0].hp < hp || s.p[0].st === ST.HIT || s.p[0].st === ST.AIRHIT || s.p[0].st === ST.BLOCK) hit = true;
          }
          if (!hit) clears.push(react);
        }
        lines.push(`L dist=${dist} ${jdir}: ${clears.join(',') || 'NONE'}`);
      }
    }
    console.log(lines.join('\n'));
    // mid-range neutral jump should now clear at some react
    expect(lines.some((l) => l.includes('dist=300 N:') && !l.endsWith('NONE'))).toBe(true);
  });
});
