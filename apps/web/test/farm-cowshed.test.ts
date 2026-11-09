import { describe, expect, it } from 'vitest';
import { ALWAYS_OPEN, describeFarm, newFarm } from '@chick/engine';
import { FarmView } from '../src/farm-view';

function cowshedView(owner: boolean, wheat: number, ready: number | null, now: number) {
  const state = newFarm(42, now, ALWAYS_OPEN);
  state.level = 10; state.inv.wheat = wheat;
  state.animals.cowshed[1] = { start: now - 1_000, ready };
  const el = { classList: { toggle: () => {} }, hidden: true, innerHTML: '' };
  const view = Object.create(FarmView.prototype) as any;
  view.root = { querySelector: () => el };
  view.theme = 'storybook'; view.loadedAt = now; view.panel = { k: 'animal', st: 'cowshed' };
  view.data = { owner: { id: 'demo', display_name: 'Demo' }, is_owner: owner, state, derived: describeFarm(state, now, ALWAYS_OPEN), server_time: now };
  view.renderPanel();
  return { view, html: el.innerHTML };
}

describe('仙境手繪牛棚', () => {
  it('uses the cow, wheat, and milk assets with per-cow actions', () => {
    const now = Date.now();
    const { view, html } = cowshedView(true, 2, now - 1, now);
    expect(html).toContain('farm/cowshed/cow.webp');
    expect(html).toContain('farm/bakery/wheat.webp');
    expect(html).toContain('farm/dairy/milk.webp');
    expect(html).toContain('3 / 2');
    expect(html).toContain('cp-feed short');
    expect(html).toContain('data-act="feed" data-i="0" disabled');
    expect(html).toContain('data-act="collect" data-i="1"');
    const actions: unknown[] = [];
    view.doAct = (action: unknown) => { actions.push(action); };
    view.onAct({ dataset: { act: 'collect', i: '1' } });
    expect(actions).toEqual([{ type: 'collect', station: 'cowshed', i: 1 }]);
  });
  it('shows production time and allows feeding when wheat is sufficient', () => {
    const now = Date.now();
    const { html } = cowshedView(true, 3, now + 30 * 60_000, now);
    expect(html).toContain('data-act="feed" data-i="0"');
    expect(html).not.toContain('data-act="feed" data-i="0" disabled');
    expect(html).toContain('牛奶產出中');
    expect(html).toContain('30 分');
  });
  it('lets visitors collect ready milk without feed controls', () => {
    const now = Date.now();
    const { html } = cowshedView(false, 0, now - 1, now);
    expect(html).toContain('data-act="visitAnimal" data-i="1"');
    expect(html).not.toContain('data-act="feed"');
  });
});
