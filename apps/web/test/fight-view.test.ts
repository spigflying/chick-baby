import { describe, expect, it } from 'vitest';
import { fightCandidates } from '../src/fight-view';

const pet = (extra: Record<string, unknown> = {}) => ({ status: 'alive', sleeping: false, sick: false, ...extra });

describe('formal fight opponent picker', () => {
  it('shows only another user with an eligible pet and at least one desktop connection', () => {
    const users = [
      { id: 'me', touch: false, pet: pet() },
      { id: 'desktop', touch: false, pet: pet() },
      { id: 'phone', touch: true, pet: pet() },
      { id: 'sleeping', touch: false, pet: pet({ sleeping: true }) },
      { id: 'sick', touch: false, pet: pet({ sick: true }) },
      { id: 'egg', touch: false, pet: pet({ status: 'egg' }) },
    ];
    expect(fightCandidates(users, 'me').map((u) => u.id)).toEqual(['desktop']);
  });
});
