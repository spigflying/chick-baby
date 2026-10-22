import { describe, expect, it } from 'vitest';
import { tabNav } from '../src/race-nav';
describe('race tabs after a race ends', () => {
  it('each tab leaves the results screen and navigates', () => {
    for (const t of ['cup', 'garage', 'board']) expect(tabNav('results', t)).toEqual({ mode: 'menu', tab: t, clearRace: true });
  });
  it('menu tabs switch; racing keeps the race', () => {
    expect(tabNav('menu', 'garage')).toEqual({ mode: 'menu', tab: 'garage', clearRace: false });
    expect(tabNav('race', 'board').mode).toBe('race');
  });
});
