import { describe, expect, it } from 'vitest';
import { racePetKey } from '../src/racing';
describe('pet riding on the race car', () => {
  it('maps pet state to sprite key', () => {
    expect(racePetKey(null)).toBeNull();
    expect(racePetKey({ species: 'duck', status: 'egg' })).toBe('egg');
    expect(racePetKey({ species: 'duck', status: 'dead' })).toBe('ghost');
    expect(racePetKey({ species: 'penguin', status: 'alive', outfits: [] })).toBe('penguin');
    const k = racePetKey({ species: 'chicken', status: 'alive', outfits: ['bow'] })!;
    expect(k.startsWith('chicken')).toBe(true);
  });
});
