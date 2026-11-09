import { describe, expect, it } from 'vitest';
import { SFV } from '@chick/engine';
import { SFVClient } from '../src/sfv-net';

const { HK, HP, LP, RIGHT, DOWN } = SFV;
const L: Record<string, string> = { startup: 'S', active: 'A', recovery: 'R', stun: 'B', free: '.', jump: 'J', move: 'M' };
const str = (row: any[]) => row.map((c) => (c.hs ? 'h' : L[c.k])).join('');
function record(x2: number, p1: (k: number) => number, p2: (k: number) => number, ticks = 120) {
  const s = SFV.createState(); s.rs = SFV.RS.FIGHT; s.p[0].x = 450; s.p[1].x = x2;
  const m = SFVClient.createFrameMeter();
  for (let k = 1; k < ticks; k++) { SFV.simulateSFVTick(s, p1(k), p2(k)); m.push(s); }
  return m;
}

describe('frame meter', () => {
  it('5HK blocked: 10F startup, the two rows end 7 frames apart, advantage -7 / +7', () => {
    const m = record(500, (k) => (k <= 2 ? HK : 0), () => RIGHT);
    const [a, b] = m.rows.map(str);
    expect(a).toBe('S'.repeat(9) + 'h'.repeat(13) + 'AAA' + 'R'.repeat(21) + '......');
    expect(b).toBe('.'.repeat(9) + 'h'.repeat(13) + 'B'.repeat(17) + '.'.repeat(13));
    expect(a.lastIndexOf('R') - b.lastIndexOf('B')).toBe(7);
    expect(SFVClient.startupOf(m.rows[0])).toBe(SFV.MOVE_LIST[SFV.M['5HK']].S);
    expect(m.adv).toEqual([-7, 7]);
  });
  it('heavy 衝天啄 marks its invincible frames', () => {
    const m = record(800, (k) => [RIGHT, DOWN, DOWN | RIGHT | HP][k - 1] ?? 0, () => 0);
    const inv = m.rows[0].map((c: any) => (c.inv ? 1 : 0)).join('');
    expect(inv.startsWith('1111' + '0')).toBe(true); // 1～4 幀全身無敵（判定第 5 幀出來前結束）
    expect(SFVClient.startupOf(m.rows[0])).toBe(5);
  });
  it('starts on the first action, stops after both sides are free, restarts on the next action', () => {
    const m = record(800, (k) => (k === 1 || k === 61 ? LP : 0), () => 0, 70);
    expect(m.rows[0].length).toBeLessThan(20); // 第二下輕拳開始時清掉重記
    expect(str(m.rows[0]).startsWith('SSS')).toBe(true);
  });
  it('nothing is recorded while both sides just stand there', () => {
    const m = record(800, () => 0, () => 0, 60);
    expect(m.rows).toEqual([[], []]);
  });
});
