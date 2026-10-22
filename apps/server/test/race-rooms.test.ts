import { describe, expect, it } from 'vitest';
import { newRoom, roomJoin, roomLeave, roomConfig, roomReady, roomDrop, roomTick, roomView, ROOM_COUNTDOWN_MS, ROOM_DROP_MS, ROOM_IDLE_MS } from '../src/race-rooms';
const A = { user: 'a', name: '小雞（阿明）' }, B = { user: 'b', name: '鴨鴨（小華）' }, C = { user: 'c', name: 'c' };
const mk = () => newRoom('r1', 'i1', A, 'tw1', 3, 0);
describe('race rooms (state machine)', () => {
  it('all ready → 3 s countdown → start; any change cancels', () => {
    const r = mk(); expect(roomJoin(r, B, 10, 8)).toBeNull();
    roomReady(r, 'a', true, 20); expect(r.countdownAt).toBeNull();
    roomReady(r, 'b', true, 30); expect(r.countdownAt).toBe(30 + ROOM_COUNTDOWN_MS);
    expect(roomTick(r, 1000)).toBeNull();
    roomReady(r, 'b', false, 1000); expect(r.countdownAt).toBeNull();          // 取消準備
    roomReady(r, 'b', true, 1100); roomConfig(r, 'a', 'jp1', null, 1200);      // 改賽道：全員取消準備
    expect(r.countdownAt).toBeNull(); expect(r.members.every((m) => !m.ready)).toBe(true);
    roomReady(r, 'a', true, 1300); roomReady(r, 'b', true, 1300); roomJoin(r, C, 1400, 8); expect(r.countdownAt).toBeNull(); // 新人進來
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
  it('disconnect: unready + cancels countdown; rejoin in time keeps seat; too late → removed', () => {
    const r = mk(); roomJoin(r, B, 0, 8); roomReady(r, 'a', true, 0); roomReady(r, 'b', true, 0); roomDrop(r, 'b', 100);
    expect(r.countdownAt).toBeNull(); expect(roomView(r, 100).members[1]).toMatchObject({ online: false, ready: false });
    roomJoin(r, B, 200, 8); expect(r.members.find((m) => m.user === 'b')!.online).toBe(true);
    roomDrop(r, 'b', 300); roomTick(r, 300 + ROOM_DROP_MS + 1); expect(r.members.map((m) => m.user)).toEqual(['a']);
  });
  it('expires after 10 min idle', () => { const r = mk(); expect(roomTick(r, ROOM_IDLE_MS - 1)).toBeNull(); expect(r.closed).toBeNull(); roomTick(r, ROOM_IDLE_MS + 1); expect(r.closed).toBe('EXPIRED'); });
});
