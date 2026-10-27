import { describe, expect, it } from 'vitest';
import { mergeRoomList, friendRoomsHtml, type RoomLists } from '../src/race-rooms-list';
const r = (room: string, inst: string, extra: any = {}) => ({ room, inst, game: 'race', host: 'h' + room, host_name: '房主' + room, track: 'tw1', laps: 4, members: 2, max: 8, ...extra });
describe('friends\u2019 rooms list (race menu)', () => {
  it('merges per-instance replies; a newer reply from the same instance replaces the old one', () => {
    const m: RoomLists = new Map();
    expect(mergeRoomList(m, 'i1', [r('a', 'i1')]).map((x) => x.room)).toEqual(['a']);
    expect(mergeRoomList(m, 'i2', [r('b', 'i2')]).map((x) => x.room)).toEqual(['a', 'b']);
    expect(mergeRoomList(m, 'i1', []).map((x) => x.room)).toEqual(['b']); // 那間房關了／滿了
    expect(mergeRoomList(m, 'i2', 'junk').length).toBe(0);
  });
  it('renders host, track, laps, member count and a join button; empty / loading text in Traditional Chinese', () => {
    const h = friendRoomsHtml([r('x', 'i9', { host_name: '<小華>' })], () => '台灣・台北');
    expect(h).toContain('好友的房間'); expect(h).toContain('<b>&lt;小華&gt;</b> 的房間'); expect(h).toContain('台灣・台北・4 圈・2/8 人');
    expect(h).toContain('data-rjoin="x" data-rinst="i9">加入</button>'); expect(h).toContain('id="rrefresh"');
    expect(friendRoomsHtml([], String)).toContain('目前沒有好友開著的房間');
    expect(friendRoomsHtml([], String, true)).toContain('查詢中…');
  });
});
