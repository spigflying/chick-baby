import { describe, expect, it } from 'vitest';
import { ALWAYS_OPEN, makeClock, parseOpenHours, phaseAt } from '../src';

const tpe = (s: string) => Date.parse(`${s}+08:00`); // 台北時間字串 → epoch ms
const H = 3600_000, M = 60_000;
const clock = makeClock(parseOpenHours('mon-fri 09:00-20:00 Asia/Taipei'));
// 2026-10-12 是星期一、10-16 星期五、10-17 星期六、10-19 星期一

describe('parseOpenHours', () => {
  it('parses weekdays, minutes and offset', () => {
    expect(parseOpenHours('mon-fri 09:00-20:00 Asia/Taipei')).toEqual({ days: [1, 2, 3, 4, 5], openMin: 540, closeMin: 1200, offsetMin: 480 });
  });
  it('rejects bad input', () => {
    expect(() => parseOpenHours('weekdays 9-20')).toThrow();
    expect(() => parseOpenHours('mon-fri 20:00-09:00 Asia/Taipei')).toThrow();
    expect(() => parseOpenHours('mon-fri 09:00-20:00 Europe/London')).toThrow(); // 有夏令時間，不支援
  });
});

describe('makeClock', () => {
  it('isOpen: open at 09:00 inclusive, closed at 20:00 exclusive, closed on weekends', () => {
    expect(clock.isOpen(tpe('2026-10-12T08:59:59'))).toBe(false);
    expect(clock.isOpen(tpe('2026-10-12T09:00:00'))).toBe(true);
    expect(clock.isOpen(tpe('2026-10-12T19:59:59'))).toBe(true);
    expect(clock.isOpen(tpe('2026-10-12T20:00:00'))).toBe(false);
    expect(clock.isOpen(tpe('2026-10-17T12:00:00'))).toBe(false);
  });
  it('elapsed counts only open time: overnight and over a weekend', () => {
    expect(clock.elapsed(tpe('2026-10-12T19:00:00'), tpe('2026-10-13T10:00:00'))).toBe(2 * H);
    expect(clock.elapsed(tpe('2026-10-16T19:30:00'), tpe('2026-10-19T09:30:00'))).toBe(60 * M);
    expect(clock.elapsed(tpe('2026-10-12T09:00:00'), tpe('2026-10-19T09:00:00'))).toBe(5 * 11 * H);
    expect(clock.elapsed(tpe('2026-10-13T10:00:00'), tpe('2026-10-12T10:00:00'))).toBe(0);
  });
  it('elapsed over four weeks is 20 weekdays × 11 hours (pets left alone for a long time)', () => {
    expect(clock.elapsed(tpe('2026-10-12T00:00:00'), tpe('2026-11-09T00:00:00'))).toBe(20 * 11 * H);
  });
  it('segments are clipped to [from, to)', () => {
    expect(clock.segments(tpe('2026-10-12T19:00:00'), tpe('2026-10-13T10:00:00'))).toEqual([
      [tpe('2026-10-12T19:00:00'), tpe('2026-10-12T20:00:00')],
      [tpe('2026-10-13T09:00:00'), tpe('2026-10-13T10:00:00')],
    ]);
  });
  it('addOpen skips closed time', () => {
    expect(clock.addOpen(tpe('2026-10-12T19:59:30'), 60_000)).toBe(tpe('2026-10-13T09:00:30'));
    expect(clock.addOpen(tpe('2026-10-16T19:59:30'), 60_000)).toBe(tpe('2026-10-19T09:00:30'));
    expect(clock.addOpen(tpe('2026-10-17T12:00:00'), 60_000)).toBe(tpe('2026-10-19T09:01:00'));
  });
  it('openingsIn lists opening times in (from, to]', () => {
    expect(clock.openingsIn(tpe('2026-10-12T20:00:00'), tpe('2026-10-13T09:00:00'))).toEqual([tpe('2026-10-13T09:00:00')]);
    expect(clock.openingsIn(tpe('2026-10-13T09:00:00'), tpe('2026-10-13T10:00:00'))).toEqual([]);
    expect(clock.openingsIn(tpe('2026-10-16T19:00:00'), tpe('2026-10-20T10:00:00'))).toEqual([tpe('2026-10-19T09:00:00'), tpe('2026-10-20T09:00:00')]);
    expect(ALWAYS_OPEN.openingsIn(0, 1e12)).toEqual([]);
  });
  it('status gives the next opening and the current closing', () => {
    expect(clock.status(tpe('2026-10-12T10:00:00'))).toEqual({ open: true, closes_at: tpe('2026-10-12T20:00:00'), opens_at: tpe('2026-10-13T09:00:00') });
    expect(clock.status(tpe('2026-10-16T20:00:00'))).toEqual({ open: false, closes_at: null, opens_at: tpe('2026-10-19T09:00:00') });
  });
  it('phaseAt: closing in the last 5 minutes', () => {
    expect(phaseAt(clock, tpe('2026-10-12T19:54:59'))).toBe('open');
    expect(phaseAt(clock, tpe('2026-10-12T19:55:00'))).toBe('closing');
    expect(phaseAt(clock, tpe('2026-10-12T20:00:00'))).toBe('closed');
    expect(phaseAt(ALWAYS_OPEN, 0)).toBe('open');
  });
  it('a clock with no open days is always closed and never opens', () => {
    const never = makeClock({ days: [], openMin: 0, closeMin: 1, offsetMin: 480 });
    expect(never.isOpen(Date.now())).toBe(false);
    expect(never.addOpen(0, 1)).toBe(Infinity);
    expect(never.status(0)).toEqual({ open: false, closes_at: null, opens_at: null });
  });
});
