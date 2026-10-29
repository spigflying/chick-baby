import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALWAYS_OPEN, makeClock, SFV, SFVRoom } from '@chick/engine';
import { setClock } from '../src/hours';
import { PresenceStore, type PresenceUser } from '../src/presence';
import { _fightCooldowns, _fightInvites, _fights, abortFights, fightPool, initFight1v1, input, invite, onFightBus, onFightPresence, reply, routeFightIntent, stepFights } from '../src/fight1v1';

const home = 'home-1';
const pet = (id: string) => ({ id: `pet-${id}`, name: id, species: 'chicken', status: 'alive' as const, sleeping: false, sick: false, mood: 'happy' as const });
const user = (id: string, touch = false): PresenceUser => ({ id, display_name: id, avatar_url: null, pet: pet(id), touch });

function setup() {
  const presence = new PresenceStore();
  presence.setOwner(home, 'a');
  presence.set(home, 'i1:a', user('a'));
  presence.set(home, 'i1:b', user('b'));
  presence.set(home, 'i1:c', user('c'));
  const sent: any[] = [], rows: any[] = [];
  const db: any = {
    insertInto: () => ({ values: (row: any) => ({ execute: async () => { rows.push(row); return []; } }) }),
    updateTable: () => {
      const q: any = { set: () => q, where: () => q, returning: () => q, execute: async () => [], executeTakeFirst: async () => ({ id: rows.at(-1)?.id ?? 'fight' }) };
      return q;
    },
  };
  initFight1v1({ db, bus: { publish: async () => {} } as any, presence, instance: () => 'i1', local: (m) => sent.push(m) });
  return { db, presence, sent, rows };
}

beforeEach(() => { setClock(ALWAYS_OPEN); _fightInvites.clear(); _fights.clear(); _fightCooldowns.clear(); });
afterEach(() => { vi.restoreAllMocks(); _fightInvites.clear(); _fights.clear(); _fightCooldowns.clear(); });

describe('formal home 1v1', () => {
  it('only the named desktop opponent can accept, then DB insert finishes before start is announced', async () => {
    const { sent, rows } = setup();
    invite(home, 'a', 'b', Date.now(), 'i1:a');
    const id = _fightInvites.get(home)!.id;
    reply(home, 'c', id, true, 'i1:c');
    expect(_fightInvites.get(home)?.id).toBe(id);
    expect(sent.at(-1)).toMatchObject({ t: 'fight.notice', user: 'c', code: 'INVITE_GONE' });

    reply(home, 'b', id, true, 'i1:b');
    for (let i = 0; i < 20 && !_fights.has(home); i++) await new Promise((r) => setTimeout(r, 0));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ home_id: home, a_user_id: 'a', b_user_id: 'b', status: 'playing' });
    const started = sent.find((m) => m.t === 'fight.event' && m.kind === 'start');
    expect(started).toMatchObject({ fight_id: rows[0].id, controllers: ['i1:a', 'i1:b'] });
    expect(_fights.has(home)).toBe(true);

    onFightPresence(home);
    expect(sent.some((m) => m.t === 'fight.event' && m.kind === 'sync' && m.fight_id === rows[0].id)).toBe(true);
  });

  it('times out after ten seconds and a phone-only opponent is not eligible', () => {
    const { presence, sent } = setup();
    presence.set(home, 'i1:b', null);
    presence.set(home, 'i1:b-phone', user('b', true));
    invite(home, 'a', 'b');
    expect(sent.at(-1)).toMatchObject({ code: 'NOT_ELIGIBLE' });

    presence.set(home, 'i1:b-desktop', user('b'));
    invite(home, 'a', 'b', 100, 'i1:a');
    const id = _fightInvites.get(home)!.id;
    stepFights(10_100);
    expect(_fightInvites.has(home)).toBe(false);
    expect(sent.at(-1)).toMatchObject({ kind: 'invite_cancel', invite: id, code: 'TIMEOUT' });
  });

  it('refuses a new match when less than 315 seconds remain before closing', () => {
    const { sent } = setup();
    const now = Date.now(), utcMin = Math.floor((now % 86_400_000) / 60_000);
    setClock(makeClock({ days: [0, 1, 2, 3, 4, 5, 6], openMin: 0, closeMin: 12 * 60 + 4, offsetMin: 12 * 60 - utcMin }));
    invite(home, 'a', 'b', now, 'i1:a');
    expect(sent.at(-1)).toMatchObject({ t: 'fight.notice', user: 'a', code: 'GAME_CLOSING' });
    expect(_fightInvites.has(home)).toBe(false);
  });

  it('pins input to the accepting connections and rejects another tab or stale fight id', async () => {
    const { presence } = setup();
    presence.set(home, 'i1:a2', user('a'));
    invite(home, 'a', 'b', Date.now(), 'i1:a');
    reply(home, 'b', _fightInvites.get(home)!.id, true, 'i1:b');
    for (let i = 0; i < 20 && !_fights.has(home); i++) await new Promise((r) => setTimeout(r, 0));
    const f: any = _fights.get(home)!;
    f.room.receive = vi.fn();
    input(home, 'a', { fight_id: 'stale', key: 'i1:a', seq: 1, inputs: [] });
    input(home, 'a', { fight_id: f.id, key: 'i1:a2', seq: 1, inputs: [] });
    expect(f.room.receive).not.toHaveBeenCalled();
    input(home, 'a', { fight_id: f.id, key: 'i1:a', seq: 2, inputs: [{ tick: 3, mask: 1 }] });
    expect(f.room.receive).toHaveBeenCalledWith(1, { type: 'sfv.input', seq: 2, inputs: [{ tick: 3, mask: 1 }] }, expect.any(Number));
    f.room.seq[0] = 9; f.room.last[0] = 8; f.room.inbox[0].set(100, 8);
    presence.set(home, 'i1:a', null);
    onFightPresence(home);
    expect(f.players[0].control).toBe('i1:a2');
    expect(f.room.seq[0]).toBe(0);
    expect(f.room.last[0]).toBe(0);
    expect(f.room.inbox[0].size).toBe(0);
  });

  it('splits an untouched pool 25/25 and otherwise apportions all 50 coins', () => {
    expect(fightPool(['a', 'b'], [0, 0])).toEqual({ a: 25, b: 25 });
    const p = fightPool(['a', 'b'], [30, 10]);
    expect(p.a + p.b).toBe(50);
    expect(p.a).toBeGreaterThan(p.b);
  });

  it('routes a non-authority intent through the bus and aborts an active fight on shutdown', async () => {
    const { db, presence, sent } = setup();
    const published: any[] = [];
    initFight1v1({ db, bus: { publish: async (m: any) => { published.push(m); } } as any, presence, instance: () => 'i2', local: vi.fn() });
    routeFightIntent({ t: 'fight.invite', home, user: 'a', key: 'i1:a', to: 'b' });
    expect(published).toEqual([{ t: 'fight.invite', home, user: 'a', key: 'i1:a', to: 'b' }]);
    expect(_fightInvites.has(home)).toBe(false);

    initFight1v1({ db, bus: { publish: async () => {} } as any, presence, instance: () => 'i1', local: (m) => sent.push(m) });
    onFightBus(published[0]);
    const id = _fightInvites.get(home)!.id;
    reply(home, 'b', id, true, 'i1:b');
    for (let i = 0; i < 20 && !_fights.has(home); i++) await new Promise((r) => setTimeout(r, 0));
    const fightId = _fights.get(home)!.id;
    await abortFights('SIGTERM');
    expect(_fights.has(home)).toBe(false);
    expect(sent).toContainEqual(expect.objectContaining({ t: 'fight.event', kind: 'ended', fight_id: fightId, aborted: true, reason: 'SIGTERM' }));
  });
});

describe('25-room load smoke test', () => {
  it('keeps the expected 32 downstream messages/s/room under the NOTIFY size limit', () => {
    let messages = 0;
    const rooms = Array.from({ length: 25 }, (_, i) => new (SFVRoom as any)({
      matchId: `load-${i}`, now: 0,
      send: (pid: number) => { if (pid === 1) messages++; },
    }));
    const started = performance.now();
    for (let tick = 1; tick <= 600; tick++) {
      const now = tick * SFV.TICK_MS + 0.1;
      for (const room of rooms) room.update(now);
    }
    const elapsed = performance.now() - started;
    expect(messages).toBe(25 * 10 * 32);
    expect(Math.max(...rooms.map((r) => r.stats.maxBytes))).toBeLessThan(8000);
    expect(Math.max(...rooms.map((r) => r.stats.maxSnapBytes))).toBeLessThan(600);
    // 這是本機純模擬的寬鬆煙霧門檻，主要用來抓意外的 O(rooms²) 或 payload 膨脹。
    expect(elapsed).toBeLessThan(2000);
  });
});
