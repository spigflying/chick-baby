import { describe, expect, it } from 'vitest';
import { ALWAYS_OPEN, describeFarm, newFarm } from '@chick/engine';
import { FarmView } from '../src/farm-view';

describe('仙境手繪烘焙屋', () => {
  it('shows product choices, ingredient amounts, and only finished slots as collectable', () => {
    const now = Date.now(), state = newFarm(42, now, ALWAYS_OPEN);
    state.level = 9;
    state.jobs.bakery = [{ recipe: 'bread', ready: now - 1 }, { recipe: 'honeycake', ready: now + 60_000 }];
    const el = { classList: { toggle: () => {} }, hidden: true, innerHTML: '' };
    const view = Object.create(FarmView.prototype) as any;
    view.root = { querySelector: () => el };
    view.theme = 'storybook'; view.loadedAt = now; view.panel = { k: 'craft', st: 'bakery' }; view.selectedCraftRecipe = { bakery: 'bread', jamhouse: 'jam', dairy: 'cheese' };
    view.data = { owner: { id: 'demo', display_name: 'Demo' }, is_owner: true, state, derived: describeFarm(state, now, ALWAYS_OPEN), server_time: now };
    view.renderPanel();

    expect(el.innerHTML).toContain('data-act="selectCraftRecipe" data-recipe="honeycake"');
    expect(el.innerHTML).toContain('farm/bakery/egg.webp');
    expect(el.innerHTML).toContain('1 / 0');
    expect(el.innerHTML).toContain('data-act="collectJob" data-i="0"');
    expect(el.innerHTML).not.toContain('data-act="collectJob" data-i="1"');
    expect(el.innerHTML).toContain('data-act="collectJobs"');
    view.onAct({ dataset: { act: 'selectCraftRecipe', recipe: 'honeycake' } });
    expect(view.selectedCraftRecipe.bakery).toBe('honeycake');
    expect(el.innerHTML).toContain('farm/bakery/honey.webp');
    const actions: unknown[] = [];
    view.doAct = (action: unknown) => { actions.push(action); };
    view.onAct({ dataset: { act: 'collectJob', i: '0' } });
    view.onAct({ dataset: { act: 'collectJobs' } });
    expect(actions).toEqual([{ type: 'collectJob', station: 'bakery', i: 0 }, { type: 'collectJobs', station: 'bakery' }]);
  });
  it('uses the same queue layout for the jam workshop', () => {
    const now = Date.now(), state = newFarm(42, now, ALWAYS_OPEN);
    state.level = 6; state.inv.strawberry = 2;
    state.jobs.jamhouse = [{ recipe: 'jam', ready: now - 1 }];
    const el = { classList: { toggle: () => {} }, hidden: true, innerHTML: '' };
    const view = Object.create(FarmView.prototype) as any;
    view.root = { querySelector: () => el };
    view.theme = 'storybook'; view.loadedAt = now; view.panel = { k: 'craft', st: 'jamhouse' };
    view.selectedCraftRecipe = { bakery: 'bread', jamhouse: 'jam', dairy: 'cheese' };
    view.data = { owner: { id: 'demo', display_name: 'Demo' }, is_owner: true, state, derived: describeFarm(state, now, ALWAYS_OPEN), server_time: now };
    view.renderPanel();
    expect(el.innerHTML).toContain('果醬工坊');
    expect(el.innerHTML).toContain('farm/jamhouse/strawberry.webp');
    expect(el.innerHTML).toContain('farm/jamhouse/jam.webp');
    expect(el.innerHTML).toContain('3 / 2');
    expect(el.innerHTML).toContain('bk-ingredient short');
    expect(el.innerHTML).toContain('data-act="collectJob" data-i="0"');
    expect(el.innerHTML).toContain('data-act="collectJobs"');
  });
});
