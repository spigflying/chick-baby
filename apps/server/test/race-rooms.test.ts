import { describe, expect, it } from 'vitest';
import { newRoom, roomJoin, roomLeave, roomConfig, roomReady, roomDrop, roomTick, roomView, ROOM_COUNTDOWN_MS, ROOM_DROP_MS, ROOM_IDLE_MS, ROOM_AWAY_MS, roomRaceStart, roomRaceEnd, roomBack } from '../src/race-rooms';
const A = { user: 'a', name: '小雞（阿明）' }, B = { user: 'b', name: '鴨鴨（小華）' }, C = { user: 'c', name: 'c' };
const mk = () => newRoom('r1', 'i1', A, 'tw1', 3, 0);
describe('race rooms (state machine)', () => {
  it('all ready → 3 s countdown → start; any change cancels', () => {
    const r = mk(); expect(roomJoin(r, B, 10, 8)).toBeNull();
    roomReady(r, 'a', true, 20); expect(r.countdownAt).toBeNull();
    roomReady(r, 'b', true, 30); expect(r.countdownAt).toBe(30 + ROOM_COUNTDOWN_MS);
    expect(roomTick(r, 1000)).toBeNull();
    roomReady(r, 'b', false, 1000); expect(r.countdownAt).toBeNull();          // 取消準備
    roomReady(r, 'b', true, 1100); expect(r.countdownAt).toBe(1100 + ROOM_COUNTDOWN_MS);
    roomConfig(r, 'a', 'jp1', null, 1200);      // 改賽道：準備保留，倒數重新從 3 秒算
    expect(r.members.every((m) => m.ready)).toBe(true); expect(r.countdownAt).toBe(1200 + ROOM_COUNTDOWN_MS);
    roomConfig(r, 'a', 'jp1', 3, 1250); expect(r.countdownAt).toBe(1200 + ROOM_COUNTDOWN_MS); // 沒改到東西：倒數不動
    roomJoin(r, C, 1400, 8); expect(r.countdownAt).toBeNull(); // 新人進來
    roomReady(r, 'c', true, 1500); expect(roomTick(r, 1500 + ROOM_COUNTDOWN_MS)).toBe('start');
  });
  it('only host can change track/laps', () => { const r = mk(); roomJoin(r, B, 0, 8); expect(roomConfig(r, 'b', 'jp1', 5, 1)).toBe('NOT_HOST'); expect(roomConfig(r, 'a', null, 5, 1)).toBeNull(); expect(r.laps).toBe(5); });
  it('max humans; cannot join while about to start', () => {
    const r = mk(); expect(roomJoin(r, B, 0, 2)).toBeNull(); expect(roomJoin(r, C, 0, 2)).toBe('ROOM_FULL');
    const s = mk(); roomReady(s, 'a', true, 0); expect(roomJoin(s, B, ROOM_COUNTDOWN_MS - 100, 8)).toBe('ROOM_STARTING');
  });
  it('host leaving transfers host to earliest online member; last one leaving closes', () => {
    const r = mk(); roomJoin(r, B, 1, 8); roomJoin(r, C, 2, 8); roomDrop(r, 'b', 3);
    roomLeave(r, 'a', 4); expect(r.host).toBe('c'); expect(r.closed).toBeNull();
    roomLeave(r, 'c', 5); expect(r.host).toBe('b'); roomLeave(r, 'b', 6); expect(r.closed).toBe('EMPTY');
  });
  it('disconnect: keeps ready but cancels countdown; rejoin resumes countdown without pressing ready again; rejoin in time keeps seat; too late → removed', () => {
    const r = mk(); roomJoin(r, B, 0, 8); roomReady(r, 'a', true, 0); roomReady(r, 'b', true, 0); roomDrop(r, 'b', 100);
    expect(r.countdownAt).toBeNull(); expect(roomView(r, 100).members[1]).toMatchObject({ online: false, ready: true });
    roomJoin(r, B, 200, 8); expect(r.members.find((m) => m.user === 'b')!.online).toBe(true); expect(r.countdownAt).toBe(200 + ROOM_COUNTDOWN_MS);
    roomDrop(r, 'b', 300); roomTick(r, 300 + ROOM_DROP_MS + 1); expect(r.members.map((m) => m.user)).toEqual(['a']);
  });
  it('ready is pressed once: new member joining or someone leaving never clears existing ready', () => {
    const r = mk(); roomJoin(r, B, 0, 8); roomReady(r, 'a', true, 1); roomJoin(r, C, 2, 8);
    expect(r.members.find((m) => m.user === 'a')!.ready).toBe(true); roomLeave(r, 'c', 3);
    expect(r.members.find((m) => m.user === 'a')!.ready).toBe(true); roomReady(r, 'b', true, 4); expect(r.countdownAt).toBe(4 + ROOM_COUNTDOWN_MS);
  });
  it('after-race lifecycle: away until each presses back; ready cleared; no countdown while anyone is away; away dropped after ROOM_AWAY_MS; no idle expiry mid-race', () => {
    const r = mk(); roomJoin(r, B, 0, 8); roomJoin(r, C, 0, 8); roomReady(r, 'a', true, 1); roomReady(r, 'b', true, 1); roomReady(r, 'c', true, 1);
    roomRaceStart(r, 'race1', ['a', 'b', 'c'], 10);
    expect(r.members.every((m) => m.away && !m.ready)).toBe(true); expect(roomBack(r, 'a', 20)).toBe('ALREADY_IN_MATCH');
    expect(roomTick(r, 10 + ROOM_IDLE_MS + 5)).toBeNull(); expect(r.closed).toBeNull(); // 比賽中不算閒置
    roomRaceEnd(r, 'other', 100); expect(r.raceId).toBe('race1'); // 不是這場：不理
    const end = 10 + ROOM_IDLE_MS + 10; roomRaceEnd(r, 'race1', end);
    expect(roomBack(r, 'a', end + 1)).toBeNull(); roomReady(r, 'a', true, end + 2); expect(r.countdownAt).toBeNull();
    roomBack(r, 'b', end + 3); roomReady(r, 'b', true, end + 3); expect(r.countdownAt).toBeNull(); // c 還在看結果
    roomTick(r, end + ROOM_AWAY_MS + 1); expect(r.members.map((m) => m.user)).toEqual(['a', 'b']); expect(r.countdownAt).toBe(end + ROOM_AWAY_MS + 1 + ROOM_COUNTDOWN_MS);
    expect(roomView(r, end).members[0]).toMatchObject({ away: false });
  });
  it('pressing ready on the results screen counts as coming back', () => {
    const r = mk(); roomRaceStart(r, 'x', ['a'], 0); expect(roomReady(r, 'a', true, 1)).toBe('ALREADY_IN_MATCH');
    roomRaceEnd(r, 'x', 2); expect(roomReady(r, 'a', true, 3)).toBeNull(); expect(r.countdownAt).toBe(3 + ROOM_COUNTDOWN_MS);
  });
  it('expires after 10 min idle', () => { const r = mk(); expect(roomTick(r, ROOM_IDLE_MS - 1)).toBeNull(); expect(r.closed).toBeNull(); roomTick(r, ROOM_IDLE_MS + 1); expect(r.closed).toBe('EXPIRED'); });
  it('stairs room needs at least 2 ready members', () => {
    const r = newRoom('s1', 'i1', A, '', 0, 0, 'stairs', 2); roomReady(r, 'a', true, 0); expect(r.countdownAt).toBeNull();
    roomJoin(r, B, 1, 6); roomReady(r, 'b', true, 2); expect(r.countdownAt).toBe(2 + ROOM_COUNTDOWN_MS); expect(roomView(r, 2).game).toBe('stairs');
  });
});
