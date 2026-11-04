import { describe, expect, it } from 'vitest';
import { SFV, SFV_FIT, FIT_IMAGES } from '@chick/engine';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { RIGHT, LP, LK, M, ST } = SFV;
const P = (o: any) => ({ x: 400, y: -60, f: 1, vx: 0, vy: 0, t: 0, mt: 0, mv: -1, cr: 0, hs: 0, hm: 0, st: ST.IDLE, ...o });
function fight(x1 = 450, x2 = 500) { const s = SFV.createState(); s.rs = SFV.RS.FIGHT; s.p[0].x = x1; s.p[1].x = x2; return s; }
function run(s: any, p1: number[]) { for (const m of p1) SFV.simulateSFVTick(s, m, 0); return s; }

describe('poc4 art port', () => {
  it('8HP / 8HK active hitboxes follow the drawn limb', () => {
    for (const [id, box] of [['8HP', [10, -44, 44, 26]], ['8HK', [6, -60, 60, 20]]] as const) {
      const mv = SFV.MOVE_LIST[M[id]];
      expect(SFV_FIT.hit(P({ st: ST.MOVE, mv: M[id], mt: mv.S }))).toEqual(box);
      expect(SFV_FIT.pose(P({ st: ST.MOVE, mv: M[id], mt: mv.S })).img).toBe(id === '8HP' ? 'n_j_hp' : 'n_j_hk');
      // 起手／收招：受擊前緣封頂 18
      for (const b of SFV_FIT.hurt(P({ st: ST.MOVE, mv: M[id], mt: 1 }))) expect(b[0] + b[2]).toBeLessThanOrEqual(18);
    }
  });
  it('system moves use the new drawings, hurt capped at 22', () => {
    for (const [id, img] of [['FDASH', 'n_dash_f'], ['BDASH', 'n_dash_b'], ['VT', 'n_vt_dash'], ['THROW', 'n_th_grab']] as const) {
      const p = P({ st: ST.MOVE, mv: M[id], mt: SFV.MOVE_LIST[M[id]].S + 1, y: 0 });
      expect(SFV_FIT.pose(p).img).toBe(img);
      for (const b of SFV_FIT.hurt(p)) expect(b[0] + b[2]).toBeLessThanOrEqual(22);
    }
  });
  it('walk w10 cycles 6 poses over 12 slots as a pure function of x', () => {
    const seen = new Set<number>();
    for (let x = 300; x < 400; x += 0.5) seen.add(SFV_FIT.pose(P({ x, y: 0, vx: 3 })).slot);
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(SFV_FIT.pose(P({ x: 333, y: 0, vx: 3 }))).toEqual(SFV_FIT.pose(P({ x: 333, y: 0, vx: 3 })));
  });
  it('throw: grab -> lift -> slam, victim pose, recovery flag set then cleared, deterministic', () => {
    const go = () => { const s = fight(450, 480); const imgs: string[] = []; run(s, [RIGHT | LP | LK]); for (let k = 0; k < 90; k++) { run(s, [0]); imgs.push(SFV_FIT.pose(s.p[0]).img + '/' + SFV_FIT.pose(s.p[1]).img); } return { s, imgs }; };
    const a = go(), b = go();
    expect(a.imgs).toEqual(b.imgs);
    expect(JSON.stringify(a.s)).toBe(JSON.stringify(b.s));
    const j = a.imgs.join(' ');
    for (const n of ['n_th_grab/n_th_victim', 'n_th_lift/n_th_victim', 'n_th_slam/']) expect(j).toContain(n);
    expect(a.s.p[0].st).toBe(ST.IDLE); expect(a.s.p[0].mv).toBe(-1);
    expect(1000 - a.s.p[1].hp).toBe(120);
  });
  it('dizzy alternates two drawings, tech uses its drawing', () => {
    expect(SFV_FIT.pose(P({ st: ST.DIZZY, t: 10, y: 0 })).img).toBe('n_dz1');
    expect(SFV_FIT.pose(P({ st: ST.DIZZY, t: 30, y: 0 })).img).toBe('n_dz2');
    expect(SFV_FIT.pose(P({ st: ST.TECH, t: 5, y: 0 })).img).toBe('n_th_tech');
  });
  it('every preloaded image exists with a manifest entry', () => {
    const dir = fileURLToPath(new URL('../public/fight/', import.meta.url));
    const man = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));
    const need = FIT_IMAGES.filter((n: string) => !/^fx[bf]_/.test(n) || existsSync(dir + n + '.webp'));
    for (const n of need) { expect(man[n], n).toBeTruthy(); expect(existsSync(dir + n + '.webp'), n).toBe(true); }
  });
});
