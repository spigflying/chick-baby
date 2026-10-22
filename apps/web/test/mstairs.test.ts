import { describe, expect, it } from 'vitest';
import { inviteHtml, inviterHtml, lerpPos, multiResultHtml, multiStatus, rankText, stairsNotice } from '../src/mstairs';
import { boardHtml } from '../src/board';

describe('M2 一起下樓梯 (web helpers)', () => {
  it('invite shows who invited, accept/decline buttons and the countdown', () => {
    const h = inviteHtml({ id: 'i', from: 'u1', from_name: '小黃（<b>）', to: ['u2'], until: 15_000, answered: false, count: 1 }, 2_100);
    expect(h).toContain('小黃（&#60;b&#62;）'); expect(h).toContain('data-sacc="1"'); expect(h).toContain('data-sacc="0"'); expect(h).toContain('13 秒後自動不參加');
  });
  it('inviter sees how many joined, the countdown and a cancel button (stairs + race wording)', () => {
    const v = { id: 'i', from: 'u1', from_name: 'x', to: ['u2'], until: 15_000, answered: false, count: 2 };
    const h = inviterHtml(v, 2_100); expect(h).toContain('data-scancel="1"'); expect(h).toContain('13 秒後截止回覆'); expect(h).toContain('2 隻要一起下樓梯');
    expect(inviterHtml({ ...v, game: 'race' }, 0)).toContain('2 人要一起賽車');
  });
  it('result lists every pet with rank, floors, coins, how it went out; highlights me', () => {
    const players = [
      { user_id: 'a', name: 'A寶（阿）', num: 2, rank: 1, floor: 30, coins: 11, cause: null },
      { user_id: 'b', name: 'B寶（逼）', num: 1, rank: 2, floor: 12, coins: 8, cause: 'fell' },
      { user_id: 'c', name: 'C寶', num: 3, rank: 3, floor: 3, coins: 5, cause: 'left' },
    ];
    const h = multiResultHtml({ players, me: players[1] });
    expect(h).toContain('1. A寶（阿）'); expect(h).toContain('<div class="bwhy">掉下去</div>'); expect(h).not.toContain('推'); expect(h).not.toContain('<small'); expect(h).not.toContain('目前'); expect(h).toContain('離開'); expect(h).toContain('12 樓 +8');
    expect(h).toContain('brow mine'); expect(h).toContain(rankText(2));
    expect(multiResultHtml({ aborted: true, players: [], me: null })).toContain('遊戲中止');
  });
  it('other pets are interpolated between snapshots, but not across a teleport', () => {
    expect(lerpPos({ x: 0, y: 10 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 15 });
    expect(lerpPos({ x: 0, y: 10 }, { x: 10, y: 20 }, 3)).toEqual({ x: 10, y: 20 });
    expect(lerpPos(undefined, { x: 10, y: 20 }, 0.5)).toEqual({ x: 10, y: 20 });
    expect(lerpPos({ x: 0, y: 0 }, { x: 80, y: 0 }, 0.5)).toEqual({ x: 80, y: 0 });
  });
  it('status line and notices are in Chinese', () => {
    expect(multiStatus(3, true)).toContain('剩 3 隻'); expect(multiStatus(2, false)).toContain('出局');
    expect(stairsNotice('MATCH_FULL')).toContain('6 隻'); expect(stairsNotice('WHATEVER')).toBe('WHATEVER');
  });
  it('board: owner gets 開始 (+ 一起玩 when others are here); visitors only get 一起玩', () => {
    const b = { top: [], me: null };
    expect(boardHtml(b)).toContain('data-go'); expect(boardHtml(b)).not.toContain('data-multi');
    const both = boardHtml(b, false, { solo: true, multi: true }); expect(both).toContain('data-go'); expect(both).toContain('data-multi');
    const visitor = boardHtml(b, false, { solo: false, multi: true }); expect(visitor).not.toContain('data-go'); expect(visitor).toContain('mi on go" data-multi');
    expect(boardHtml(b, false, { solo: false, multi: false })).toContain('沒有可以一起玩');
  });
});
