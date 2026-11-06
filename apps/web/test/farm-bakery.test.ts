import { describe, expect, it } from 'vitest';
import { ALWAYS_OPEN, describeFarm, newFarm } from '@chick/engine';
import { FarmView } from '../src/farm-view';
import { bakeryIcons } from '../src/farm-art-storybook';

describe('仙境手繪烘焙屋', () => {
  it('shows RO item icons and makes only finished slots individually collectable', () => {
    const now = Date.now(), state = newFarm(42, now, ALWAYS_OPEN);
    state.level = 9;
    state.jobs.bakery = [{ recipe: 'bread', ready: now - 1 }, { recipe: 'honeycake', ready: now + 60_000 }];
    const el = { classList: { toggle: () => {} }, hidden: true, innerHTML: '' };
    const view = Object.create(FarmView.prototype) as any;
    view.root = { querySelector: () => el };
    view.theme = 'storybook'; view.loadedAt = now; view.panel = { k: 'craft', st: 'bakery' };
    view.data = { owner: { id: 'demo', display_name: 'Demo' }, is_owner: true, state, derived: describeFarm(state, now, ALWAYS_OPEN), server_time: now };
    view.renderPanel();

    expect(bakeryIcons()).toContain('id="fi-ro-honeycake"');
    expect(el.innerHTML).toContain('href="#fi-ro-egg"');
    expect(el.innerHTML).toContain('data-act="collectJob" data-i="0"');
    expect(el.innerHTML).not.toContain('data-act="collectJob" data-i="1"');
    expect(el.innerHTML).toContain('data-act="collectJobs"');
    const actions: unknown[] = [];
    view.doAct = (action: unknown) => { actions.push(action); };
    view.onAct({ dataset: { act: 'collectJob', i: '0' } });
    view.onAct({ dataset: { act: 'collectJobs' } });
    expect(actions).toEqual([{ type: 'collectJob', station: 'bakery', i: 0 }, { type: 'collectJobs', station: 'bakery' }]);
  });
});
