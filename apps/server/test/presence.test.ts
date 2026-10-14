import { describe, expect, it } from 'vitest';
import { PresenceStore, petSummary } from '../src/presence';

const u = (id: string, pet: any = null) => ({ id, display_name: id, avatar_url: null, pet });
describe('PresenceStore', () => {
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
