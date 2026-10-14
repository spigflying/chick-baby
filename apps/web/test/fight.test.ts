import { describe, expect, it } from 'vitest';
import { controlMode, petKey, PadState, lerpFighters, resultText, HINT } from '../src/fight';

const base = { isOwner: false, submenuOpen: false, navOpen: false, inArena: true, inFight: false };
describe('fight input mode (v1.4)', () => {
  it('visiting: arrows control the pet by default; Enter opens the action bar', () => {
    expect(controlMode(base)).toBe('pet');
    expect(controlMode({ ...base, navOpen: true })).toBe('nav');
    expect(controlMode({ ...base, submenuOpen: true })).toBe('menu');
    expect(controlMode({ ...base, inArena: false })).toBe('menu'); // 沒有能打的寵物
  });
  it('own home: menu navigation unless in an active fight', () => {
    expect(controlMode({ ...base, isOwner: true })).toBe('menu');
    expect(controlMode({ ...base, isOwner: true, inFight: true })).toBe('pet');
    expect(controlMode({ ...base, isOwner: true, inFight: true, navOpen: true })).toBe('nav');
  });
  it('key mapping and pad edge detection', () => {
    expect(petKey('ArrowLeft')).toBe('left'); expect(petKey('ArrowUp')).toBe('jump'); expect(petKey(' ')).toBe('attack'); expect(petKey('Enter')).toBe('nav'); expect(petKey('x')).toBeNull();
    const p = new PadState();
    expect(p.set('left', true)).toBe(true); expect(p.set('left', true)).toBe(false);
    expect(p.clear()).toBe(true); expect(p.clear()).toBe(false);
  });
  it('interpolates between snapshots', () => {
    const f = (x: number) => ({ u: 'a', pet: 'p', sp: 'duck', name: 'A', x, y: 70, dir: 1 as const, atk: 0, inv: 0, hp: 100, fight: null });
    const prev = { tick: 1, server_time: 0, fighters: [f(10)], fights: [], hp_max: 100 }, cur = { ...prev, tick: 4, fighters: [f(20)] };
    expect(lerpFighters(prev, cur, 0.5)[0].x).toBe(15);
    expect(lerpFighters(null, cur, 0.5)[0].x).toBe(20);
  });
  it('result texts and hints', () => {
    const n = (id: string) => ({ a: 'Benson', b: '仲軍' } as any)[id];
    expect(resultText({ winner: 'a', amount: 20, reason: 'ko' }, n)).toBe('Benson 贏了！拿走 ◎20');
    expect(resultText({ winner: null, amount: 0, reason: 'timeout' }, n)).toBe('平手！不轉帳');
    expect(resultText({ winner: null, amount: 0, reason: 'cancel' }, n)).toContain('取消');
    expect(HINT.pet).toContain('Enter');
  });
});
