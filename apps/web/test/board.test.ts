import { describe, it, expect } from 'vitest';
import { boardHtml } from '../src/board';
describe('v1.6 stairs leaderboard', () => {
  it('lists the top floors, highlights mine, shows my rank and a 開始 button', () => {
    const h = boardHtml({ top: [{ rank: 1, pet_name: '鴨鴨', owner_name: '仲軍', species: 'duck', best_floor: 30, mine: false }, { rank: 2, pet_name: '<b>', owner_name: 'Benson', species: 'chicken', best_floor: 12, mine: true }], me: { pet_name: '<b>', best_floor: 12, rank: 2 } });
    expect(h).toContain('1. 鴨鴨'); expect(h).toContain('30 樓'); expect(h).toContain('brow mine'); expect(h).toContain('2. ');
    expect(h).toContain('data-go'); expect(h).toContain('開始'); expect(h).not.toContain('<b>');
  });
  it('loading, empty and error states still offer 開始', () => {
    expect(boardHtml(null)).toContain('載入中'); expect(boardHtml(null, true)).toContain('載入失敗');
    expect(boardHtml({ top: [], me: null })).toContain('還沒有人'); expect(boardHtml({ top: [], me: null })).toContain('開始');
  });
  it('long boards: only top 5, then … and my own row; 開始 sits in a pinned footer after the scrolling list', () => {
    const top = Array.from({ length: 30 }, (_, i) => ({ rank: i + 1, pet_name: 'p' + (i + 1), owner_name: 'o', species: 'chicken', best_floor: 100 - i, mine: i === 19 }));
    const h = boardHtml({ top, me: { pet_name: 'p20', best_floor: 81, rank: 20 } });
    expect((h.match(/class="wide brow/g) ?? []).length).toBe(6);
    expect(h).toContain('5. p5'); expect(h).not.toContain('6. p6'); expect(h).toContain('…'); expect(h).toContain('20. p20');
    expect(h.indexOf('class="blist"')).toBeLessThan(h.indexOf('class="bfoot"')); expect(h.indexOf('data-go')).toBeGreaterThan(h.indexOf('class="bfoot"'));
    // 自己就在前 5 名：不重複、沒有「…」
    const h2 = boardHtml({ top: top.map((r) => ({ ...r, mine: r.rank === 3 })), me: { pet_name: 'p3', best_floor: 98, rank: 3 } });
    expect((h2.match(/class="wide brow/g) ?? []).length).toBe(5); expect(h2).not.toContain('…');
    // 自己排第 6：緊接在後面，不需要「…」；自己不在 top 清單裡（伺服器只回前幾名）也照樣列出
    expect(boardHtml({ top: top.slice(0, 10).map((r) => ({ ...r, mine: false })), me: { pet_name: '我', best_floor: 1, rank: 6 } })).not.toContain('…');
    expect(boardHtml({ top: top.slice(0, 10).map((r) => ({ ...r, mine: false })), me: { pet_name: '我', best_floor: 1, rank: 42 } })).toContain('42. 我');
  });
});


import { stairsResultHtml } from '../src/board';
describe('stairs result screen', () => {
  it('says 時間到 when the 5-minute cap ended the run (pet did not die)', () => {
    const h = stairsResultHtml({ floors: 269, coins: 269, time_up: true }, 500);
    expect(h).toContain('時間到'); expect(h).toContain('269 樓'); expect(h).not.toContain('遊戲結束');
    expect(stairsResultHtml({ floors: 12, coins: 12 }, 50)).toContain('遊戲結束');
  });
});
