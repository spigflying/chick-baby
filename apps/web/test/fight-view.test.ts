import { describe, expect, it, vi } from 'vitest';
import { FightView, fightCandidates, smoothFightState } from '../src/fight-view';

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

describe('fight rendering', () => {
  it('clears the previous result and its timer when a new fight starts', () => {
    vi.useFakeTimers();
    try {
      const result = { hidden: false };
      const view = Object.create(FightView.prototype) as any;
      view.root = { querySelector: () => result };
      view.banner = { hidden: true, innerHTML: '' };
      view.dialog = { hidden: true };
      view.live = { inFight: false };
      view.current = { id: 'old', result: { winner: 'a' } };
      view.closeTimer = setTimeout(() => view.finishView(), 6000);

      view.onEvent({ kind: 'start', fight_id: 'new', players: [{ name: 'A' }, { name: 'B' }], you_pid: null });
      expect(result.hidden).toBe(true);
      expect(view.current.id).toBe('new');
      vi.advanceTimersByTime(6000);
      expect(view.current.id).toBe('new');
    } finally {
      vi.useRealTimers();
    }
  });

  it('smooths a remote fighter without changing simulation positions, and snaps on round reset', () => {
    const previous = { rnd: 1, p: [{ x: 10, y: 0 }, { x: 100, y: -20 }] };
    const current = { rnd: 1, p: [{ x: 30, y: 0 }, { x: 120, y: -40 }] };
    const shown = smoothFightState(current, previous, 16, 1);
    expect(shown.p[0].x).toBeGreaterThan(10);
    expect(shown.p[0].x).toBeLessThan(30);
    expect(shown.p[1].x).toBeGreaterThan(100);
    expect(shown.p[1].x).toBeLessThan(120);
    expect(current.p).toEqual([{ x: 30, y: 0 }, { x: 120, y: -40 }]);
    expect(smoothFightState({ ...current, rnd: 2 }, shown, 16, 1).p).toEqual(current.p);
  });
});
