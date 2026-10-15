import { describe, it, expect } from 'vitest';
import { boardHtml } from '../src/board';
describe('v1.6 stairs leaderboard', () => {
  it('lists the top floors, highlights mine, shows my rank and a 開始 button', () => {
    const h = boardHtml({ top: [{ rank: 1, pet_name: '鴨鴨', owner_name: '仲軍', species: 'duck', best_floor: 30, mine: false }, { rank: 2, pet_name: '<b>', owner_name: 'Benson', species: 'chicken', best_floor: 12, mine: true }], me: { pet_name: '<b>', best_floor: 12, rank: 2 } });
    expect(h).toContain('1. 鴨鴨'); expect(h).toContain('30 樓'); expect(h).toContain('brow mine'); expect(h).toContain('第 2 名');
    expect(h).toContain('data-go'); expect(h).toContain('開始'); expect(h).not.toContain('<b>');
  });
  it('loading, empty and error states still offer 開始', () => {
    expect(boardHtml(null)).toContain('載入中'); expect(boardHtml(null, true)).toContain('載入失敗');
    expect(boardHtml({ top: [], me: null })).toContain('還沒有人'); expect(boardHtml({ top: [], me: null })).toContain('開始');
  });
});
