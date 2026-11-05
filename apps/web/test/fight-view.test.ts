import { describe, expect, it, vi } from 'vitest';
import { SFV } from '@chick/engine';
import { FightView, fightCandidates, smoothFightState, tally } from '../src/fight-view';

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

describe('fight record text', () => {
  it('shows draws only when there are any', () => {
    expect(tally({ win: 3, loss: 2, draw: 0 })).toBe('3 勝 2 敗');
    expect(tally({ win: 0, loss: 0, draw: 1 })).toBe('0 勝 0 敗 1 平');
  });
});

describe('fight rendering', () => {
  it('sends each player’s chosen mode with the invitation and acceptance', () => {
    const view = Object.create(FightView.prototype) as any;
    const send = vi.fn(() => true);
    view.live = { send };
    view.dialog = { hidden: false };
    view.pendingMode = 'beginner';
    view.dialogClick({ target: { closest: () => ({ dataset: { to: 'friend' } }) } });
    expect(send).toHaveBeenLastCalledWith({ type: 'fight.invite', to: 'friend', mode: 'beginner' });
    view.dialogClick({ target: { closest: () => ({ dataset: { accept: '1', invite: 'round-1', mode: 'classic' } }) } });
    expect(send).toHaveBeenLastCalledWith({ type: 'fight.reply', invite: 'round-1', accept: true, mode: 'classic' });
  });

  it('players get a rematch button that re-invites the same opponent with their own mode; spectators auto-close', () => {
    vi.useFakeTimers();
    try {
      const el = { hidden: true, innerHTML: '' };
      const send = vi.fn(() => true);
      const view = Object.create(FightView.prototype) as any;
      view.root = { querySelector: () => el };
      view.live = { send };
      view.current = { id: 'f1', pid: 2, players: [{ user_id: 'a', pid: 1, mode: 'classic' }, { user_id: 'me', pid: 2, mode: 'beginner' }] };
      view.finishView = vi.fn();
      view.showResult('你贏了！', '合計 +◎20', true);
      expect(el.innerHTML).toContain('再打一場');
      vi.advanceTimersByTime(10_000);
      expect(view.finishView).not.toHaveBeenCalled();
      view.rematch();
      expect(send).toHaveBeenLastCalledWith({ type: 'fight.invite', to: 'a', mode: 'beginner' });
      view.showResult('a 獲勝', '比賽結束');
      expect(el.innerHTML).not.toContain('再打一場');
      vi.advanceTimersByTime(6000);
      expect(view.finishView).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the chosen mode’s own move list', () => {
    const help = { innerHTML: '', textContent: '' };
    const view = Object.create(FightView.prototype) as any;
    view.root = { querySelector: () => help };
    view.current = { pid: 1, players: [{ mode: 'classic' }, { mode: 'beginner' }] };
    view.held = new Set(['KeyO']);
    view.updateHelp();
    expect(help.innerHTML).toContain('↓↘→＋拳');
    expect(view.mask()).toBe(0);
    view.current.pid = 2;
    view.updateHelp();
    expect(help.innerHTML).toContain('O 蛋波');
    expect(help.innerHTML).not.toContain('↓↘→＋拳');
    expect(view.mask()).toBe(SFV.EASY_HADO);
  });

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
