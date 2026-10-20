import { describe, expect, it } from 'vitest';
import { formatCountdown, savePetCache, loadPetCache, sleepSprite, closedLine, PET_CACHE_KEY } from '../src/sleep';
import { S } from '../src/sprites';

describe('formatCountdown', () => {
  it('formats hours, minutes, seconds and days', () => {
    expect(formatCountdown(0)).toBe('00:00:00');
    expect(formatCountdown(-5000)).toBe('00:00:00');
    expect(formatCountdown((3 * 3600 + 4 * 60 + 5) * 1000 + 999)).toBe('03:04:05');
    expect(formatCountdown((2 * 86400 + 13 * 3600) * 1000)).toBe('2 天 13:00:00');
  });
});

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
describe('closed-hours egg screen (v1.5)', () => {
  it('caches only species / stage / name and renders the own pet asleep', () => {
    const st = mem();
    savePetCache(st, { id: 'x', species: 'duck', status: 'alive', name: '鴨鴨', hunger: 50 });
    expect(JSON.parse(st.m.get(PET_CACHE_KEY)!)).toEqual({ species: 'duck', status: 'alive', name: '鴨鴨' });
    expect(sleepSprite(loadPetCache(st))).toEqual({ sprite: 'duck_s', egg: false, name: '鴨鴨' });
    savePetCache(st, { species: 'dino', status: 'egg', name: '蛋' }); expect(sleepSprite(loadPetCache(st)).sprite).toBe('egg');
  });
  it('falls back to a generic sleeping chick without (valid) cache', () => {
    const st = mem(); expect(sleepSprite(loadPetCache(st))).toEqual({ sprite: 'chicken_s', egg: false, name: '' });
    st.setItem(PET_CACHE_KEY, '{bad'); expect(loadPetCache(st)).toBeNull();
    savePetCache(st, null); expect(loadPetCache(st)).toBeNull();
    expect(sleepSprite({ species: 'duck', status: 'dead', name: 'x' }).sprite).toBe('chicken_s');
    for (const k of ['chicken_s', 'duck_s', 'penguin_s', 'dino_s', 'egg', 'z']) expect(S[k]).toBeTruthy();
  });
  it('shows 「休息中・09:00 開門」', () => {
    expect(closedLine(new Date(2026, 9, 15, 9, 0).getTime())).toBe('休息中・09:00 開門');
    expect(closedLine(null)).toBe('休息中');
  });
});
