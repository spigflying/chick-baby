import { describe, expect, it } from 'vitest';
import { PresenceStore, petSummary } from '../src/presence';

const u = (id: string, pet: any = null) => ({ id, display_name: id, avatar_url: null, pet });
describe('PresenceStore', () => {
  it('counts online users across pages and instances, and expires missing heartbeats', () => {
    const s = new PresenceStore();
    s.setOnline('i1:1', 'a', 0); s.setOnline('i2:1', 'a', 0); s.setOnline('i2:2', 'b', 0);
    expect([...s.onlineUserIds(1_000)]).toEqual(['a', 'b']);
    s.setOnline('i1:1', null, 1_000); s.setOnline('i2:2', 'b', 60_000);
    expect([...s.onlineUserIds(80_000)]).toEqual(['b']);
    s.set('home', 'old:1', u('c'), 80_000);
    expect([...s.onlineUserIds(80_001)]).toEqual(['b', 'c']);
  });
  it('dedupes users across tabs/instances and keeps join order', () => {
    const s = new PresenceStore();
    s.set('h', 'i1:1', u('a')); s.set('h', 'i2:7', u('b')); s.set('h', 'i1:2', u('a'));
    expect(s.users('h').map((x) => x.id)).toEqual(['b', 'a']);
    s.set('h', 'i1:2', null);
    expect(s.users('h').map((x) => x.id)).toEqual(['a', 'b']);
    s.set('h', 'i1:1', null); s.set('h', 'i2:7', null);
    expect(s.users('h')).toEqual([]);
  });
  it('updates a visiting pet in every home it is in', () => {
    const s = new PresenceStore();
    const p = { id: 'p1', name: 'x', species: 'duck', status: 'alive', sleeping: false, sick: false, mood: 'ok' } as const;
    s.set('h1', 'k1', u('a', p)); s.set('h2', 'k2', u('a', p)); s.set('h3', 'k3', u('b'));
    expect(s.hasPet('p1')).toBe(true);
    expect(s.updatePet('p1', { ...p, status: 'dead' })).toEqual(['h1', 'h2']);
    expect(s.users('h2')[0].pet?.status).toBe('dead');
  });
  it('summarises mood from happiness', () => {
    const base: any = { id: 'p', name: 'n', species: 'chicken', status: 'alive', sleeping: false, sick: false };
    expect(petSummary({ ...base, happiness: 80 })?.mood).toBe('happy');
    expect(petSummary({ ...base, happiness: 40 })?.mood).toBe('ok');
    expect(petSummary({ ...base, happiness: 10 })?.mood).toBe('sad');
    expect(petSummary(null)).toBeNull();
  });
});

describe('owner away (v1.4)', () => {
  it('owner visiting elsewhere is away; at home in any tab or offline is not', () => {
    const s = new PresenceStore();
    s.setOwner('hA', 'A'); s.setOwner('hB', 'B');
    expect(s.ownerAway('hA')).toBe(false); // 離線 → 寵物在家
    s.set('hB', 'i:1', u('A'));
    expect(s.ownerAway('hA')).toBe(true);
    expect(s.users('hA').map((x) => x.id)).not.toContain('A');
    s.set('hA', 'i:2', u('A')); // 另一個分頁在自己家
    expect(s.ownerAway('hA')).toBe(false);
    s.set('hA', 'i:2', null); s.set('hB', 'i:1', null);
    expect(s.ownerAway('hA')).toBe(false);
    expect(s.homeOf('A')).toBe('hA'); expect(s.whereIs('A')).toEqual([]);
  });
  it('stale entries (dead instance) expire; heartbeats keep them and keep join order', () => {
    const s = new PresenceStore();
    s.set('h', 'dead:1', u('a'), 0); s.set('h', 'live:1', u('b'), 0);
    expect(s.touch('h', 'live:1', u('b'), 60_000)).toBe(false);
    expect(s.touch('h', 'new:1', u('c'), 60_000)).toBe(true); // 新執行個體從心跳得知
    expect(s.sweep(80_000)).toEqual(['h']);
    expect(s.users('h').map((x) => x.id)).toEqual(['b', 'c']);
  });
});
