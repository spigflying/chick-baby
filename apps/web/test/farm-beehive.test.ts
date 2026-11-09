import { describe, expect, it } from 'vitest';
import { ALWAYS_OPEN, describeFarm, newFarm } from '@chick/engine';
import { FarmView } from '../src/farm-view';

function beehiveView(owner: boolean, strawberries: number, ready: number | null, now: number) {
  const state = newFarm(42, now, ALWAYS_OPEN);
  state.level = 8; state.inv.strawberry = strawberries;
  state.animals.beehive[1] = { start: now - 1_000, ready };
  const el = { classList: { toggle: () => {} }, hidden: true, innerHTML: '' };
  const view = Object.create(FarmView.prototype) as any;
  view.root = { querySelector: () => el };
  view.theme = 'storybook'; view.loadedAt = now; view.panel = { k: 'animal', st: 'beehive' };
  view.data = { owner: { id: 'demo', display_name: 'Demo' }, is_owner: owner, state, derived: describeFarm(state, now, ALWAYS_OPEN), server_time: now };
  view.renderPanel();
  return { view, html: el.innerHTML };
}

describe('仙境手繪蜂箱', () => {
  it('uses the hashed bee, strawberry, and honey assets with per-hive actions', () => {
    const now = Date.now();
    const { view, html } = beehiveView(true, 0, now - 1, now);
    expect(html).toContain('farm/beehive/bee.webp');
    expect(html).toContain('farm/jamhouse/strawberry.webp');
    expect(html).toContain('farm/bakery/honey.webp');
    expect(html).toContain('1 / 0');
    expect(html).toContain('cp-feed short');
    expect(html).toContain('data-act="feed" data-i="0" disabled');
    expect(html).toContain('data-act="collect" data-i="1"');
    const actions: unknown[] = [];
    view.doAct = (action: unknown) => { actions.push(action); };
    view.onAct({ dataset: { act: 'collect', i: '1' } });
    expect(actions).toEqual([{ type: 'collect', station: 'beehive', i: 1 }]);
  });
  it('shows production time and allows feeding when strawberries are available', () => {
    const now = Date.now();
    const { html } = beehiveView(true, 1, now + 30 * 60_000, now);
    expect(html).toContain('data-act="feed" data-i="0"');
    expect(html).not.toContain('data-act="feed" data-i="0" disabled');
    expect(html).toContain('蜂蜜產出中');
    expect(html).toContain('30 分');
  });
  it('lets visitors collect ready honey without showing feed controls', () => {
    const now = Date.now();
    const { html } = beehiveView(false, 0, now - 1, now);
    expect(html).toContain('data-act="visitAnimal" data-i="1"');
    expect(html).not.toContain('data-act="feed"');
  });
});
