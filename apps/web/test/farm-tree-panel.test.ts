import { describe, expect, it } from 'vitest';
import { ALWAYS_OPEN, describeFarm, newFarm } from '@chick/engine';
import { FarmView } from '../src/farm-view';

function treeView(owner: boolean, ready: number, now: number) {
  const state = newFarm(42, now, ALWAYS_OPEN);
  state.level = 4; state.tree = { start: ready - 120 * 60_000, ready };
  const el = { classList: { toggle: () => {} }, hidden: true, innerHTML: '' };
  const view = Object.create(FarmView.prototype) as any;
  view.root = { querySelector: () => el };
  view.theme = 'storybook'; view.loadedAt = now; view.panel = { k: 'tree' };
  view.data = { owner: { id: 'demo', display_name: 'Demo' }, is_owner: owner, state, derived: describeFarm(state, now, ALWAYS_OPEN), server_time: now };
  view.renderPanel();
  return { view, html: el.innerHTML };
}

describe('仙境手繪蘋果樹', () => {
  it('shows the apple asset and harvests three mature apples through the panel', () => {
    const now = Date.now();
    const { view, html } = treeView(true, now - 60_000, now);
    expect(html).toContain('farm/tree/apple.webp');
    expect(html).toContain('farm/storybook-ro-a/tree-ready.webp');
    expect(html).toContain('蘋果 ×3');
    expect(html).toContain('data-act="harvestTree"');
    const actions: unknown[] = [];
    view.doAct = (action: unknown) => { actions.push(action); };
    view.onAct({ dataset: { act: 'harvestTree' } });
    expect(actions).toEqual([{ type: 'tree' }]);
    let opened: unknown;
    view.openPanel = (panel: unknown) => { opened = panel; };
    view.onHit('tree');
    expect(opened).toEqual({ k: 'tree' });
  });
  it('shows a countdown while the tree is growing', () => {
    const now = Date.now();
    const { html } = treeView(true, now + 30 * 60_000, now);
    expect(html).toContain('farm/storybook-ro-a/tree-growing.webp');
    expect(html).toContain('30 分');
    expect(html).not.toContain('data-act="harvestTree"');
  });
  it('shows the rescue cost after the tree withers', () => {
    const now = Date.now();
    const { view, html } = treeView(true, now - 9 * 60 * 60_000, now);
    expect(html).toContain('farm/storybook-ro-a/tree-withered.webp');
    expect(html).toContain('花 ◎30 救樹');
    const actions: unknown[] = [];
    view.doAct = (action: unknown) => { actions.push(action); };
    view.onAct({ dataset: { act: 'rescue' } });
    expect(actions).toEqual([{ type: 'rescue' }]);
  });
  it('offers visitors the existing collect action when the tree is mature', () => {
    const now = Date.now();
    const { view, html } = treeView(false, now - 60_000, now);
    expect(html).toContain('data-act="visitTree"');
    const actions: unknown[] = [];
    view.doVisitCollect = (action: unknown) => { actions.push(action); };
    view.onAct({ dataset: { act: 'visitTree' } });
    expect(actions).toEqual([{ kind: 'tree' }]);
  });
});
