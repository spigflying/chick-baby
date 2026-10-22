import { describe, expect, it } from 'vitest';
import { cupSel, tabNav } from '../src/race-nav';
describe('race tabs after a race ends', () => {
  it('each tab leaves the results screen and navigates', () => {
    for (const t of ['cup', 'garage', 'board']) expect(tabNav('results', t)).toEqual({ mode: 'menu', tab: t, clearRace: true });
  });
  it('menu tabs switch; racing keeps the race', () => {
    expect(tabNav('menu', 'garage')).toEqual({ mode: 'menu', tab: 'garage', clearRace: false });
    expect(tabNav('race', 'board').mode).toBe('race');
  });
});
describe('solo start track follows the cup station', () => {
  const country = (id: string) => (id.startsWith('tw') ? 0 : id.startsWith('jp') ? 1 : null);
  it('following the cup → current station (not always tw1)', () => {
    expect(cupSel('tw1', true, 'tw3', 1, country)).toBe('tw3');
    expect(cupSel('tw4', true, 'jp1', 2, country)).toBe('jp1');
  });
  it('manual pick is kept; locked or missing cup track keeps the selection', () => {
    expect(cupSel('tw2', false, 'tw3', 1, country)).toBe('tw2');
    expect(cupSel('tw1', true, 'jp1', 1, country)).toBe('tw1');
    expect(cupSel('tw1', true, null, 1, country)).toBe('tw1');
  });
});
