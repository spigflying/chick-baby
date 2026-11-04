import { describe, expect, it } from 'vitest';
import { ALWAYS_OPEN, applyFarm, describeFarm, newFarm, applyHelp, FARM_ERROR_CODES, type FarmState } from '@chick/engine';
import { remainText, fieldBadge, plantChoices, hudModel, helpTargets, FARM_ERR, farmCellState, loadErrorAction, feedChoices, stallDefaults, expandOffer, type FarmPayload } from '../src/farm-model';

const T0 = Date.parse('2026-11-02T10:00:00+08:00');
const M = 60_000;
function payload(s: FarmState, isOwner = true, now = T0): FarmPayload {
  return { owner: { id: 'own', display_name: '小美' }, is_owner: isOwner, state: s, derived: describeFarm(s, now, ALWAYS_OPEN), server_time: now };
}

describe('remainText', () => {
  it('formats open-time remaining', () => {
    expect(remainText(0)).toBe('可收成');
    expect(remainText(59_000)).toBe('不到 1 分');
    expect(remainText(12 * M)).toBe('12 分');
    expect(remainText(75 * M)).toBe('1 小時 15 分');
    expect(remainText(120 * M)).toBe('2 小時');
  });
});

describe('fieldBadge', () => {
  it('ready / timer / locked / empty', () => {
    const s = newFarm(1, T0, ALWAYS_OPEN);
    applyFarm(s, { type: 'plant', idx: 0, crop: 'wheat' }, T0, ALWAYS_OPEN);
    applyFarm(s, { type: 'plant', idx: 1, crop: 'carrot' }, T0, ALWAYS_OPEN);
    const d = describeFarm(s, T0 + 2 * M, ALWAYS_OPEN);
    expect(fieldBadge(d.fields[0], true)).toEqual({ text: '可收成', tone: 'ready' });
    expect(fieldBadge(d.fields[1], true)).toEqual({ text: '28 分', tone: 'timer' });
    expect(fieldBadge(d.fields[9], true)).toEqual({ text: 'Lv 6 解鎖', tone: 'lock' });
    expect(fieldBadge(d.fields[2], true)).toEqual({ text: '', tone: 'none' });
  });
});

describe('plantChoices', () => {
  it('lists unlocked crops, level locks, coin and friend-point costs', () => {
    const s = newFarm(1, T0, ALWAYS_OPEN);
    const c = plantChoices(payload(s), 100);
    const by = Object.fromEntries(c.map((x) => [x.crop, x]));
    expect(by.wheat.enabled).toBe(true); expect(by.carrot.enabled).toBe(true);
    expect(by.strawberry).toMatchObject({ enabled: false, reason: 'Lv 3 解鎖' });
    expect(by.pumpkin.cost).toBe('友情 3');
    expect(by.wheat.cost).toBe('◎2');
    expect(plantChoices(payload(s), 2).find((x) => x.crop === 'carrot')).toMatchObject({ enabled: false, reason: '金幣不夠' });
    s.level = 3;
    expect(plantChoices(payload(s), 100).find((x) => x.crop === 'pumpkin')).toMatchObject({ enabled: false, reason: '友情點數不夠' });
  });
});

describe('hudModel', () => {
  it('level, xp percent, coins, barn, friend points', () => {
    const s = newFarm(1, T0, ALWAYS_OPEN); s.xp = 10; s.inv = { wheat: 32 }; s.friendPts = 4;
    expect(hudModel(payload(s), 1280)).toEqual({ level: 1, xpPct: 33, coins: 1280, barn: '32 / 50', friendPts: 4 });
  });
});

describe('helpTargets', () => {
  it('only unwatered growing fields and a withered tree; empty for the owner', () => {
    const s = newFarm(1, T0, ALWAYS_OPEN);
    applyFarm(s, { type: 'plant', idx: 0, crop: 'carrot' }, T0, ALWAYS_OPEN);
    applyFarm(s, { type: 'plant', idx: 1, crop: 'carrot' }, T0, ALWAYS_OPEN);
    applyHelp(s, { kind: 'water', idx: 1 }, { id: 'x', name: 'X' }, T0, ALWAYS_OPEN);
    expect(helpTargets(payload(s, false, T0 + M))).toEqual([{ kind: 'water', idx: 0 }]);
    expect(helpTargets(payload(s, true, T0 + M))).toEqual([]);
    const late = T0 + 11 * 60 * M;
    expect(helpTargets(payload(s, false, late))).toEqual([{ kind: 'rescue' }]);
  });
});

describe('FARM_ERR', () => {
  it('has copy for every farm error and help error', () => {
    for (const c of [...FARM_ERROR_CODES, 'HELP_DAILY_CAP', 'HELP_FARM_CAP', 'HELP_SELF', 'BUY_SELF', 'BUY_DAILY_CAP', 'PET_SLEEPING', 'PET_DEAD', 'PET_EGG', 'TOO_FULL', 'SNACK_ONLY']) expect(FARM_ERR[c], c).toBeTruthy();
  });
});

describe('farmCellState', () => {
  it('hidden when the flag is off, disabled on touch devices', () => {
    expect(farmCellState(false, false)).toBe('hidden');
    expect(farmCellState(false, true)).toBe('hidden');
    expect(farmCellState(true, true)).toBe('disabled');
    expect(farmCellState(true, false)).toBe('enabled');
  });
});

describe('loadErrorAction', () => {
  it('closes the farm when access is gone, otherwise pauses auto-reload', () => {
    expect(['FORBIDDEN', 'NOT_FOUND', 'UNAUTHORIZED'].map(loadErrorAction)).toEqual(['close', 'close', 'close']);
    expect(['INTERNAL', 'RATE_LIMITED', 'DB_UNAVAILABLE', 'GAME_CLOSED', 'network'].map(loadErrorAction)).toEqual(['pause', 'pause', 'pause', 'pause', 'pause']);
  });
});

describe('phase 2 models', () => {
  it('feedChoices lists edible barn items with counts', () => {
    const s = newFarm(1, T0, ALWAYS_OPEN); s.inv = { wheat: 4, bread: 2, honeycake: 1, egg: 3 };
    expect(feedChoices(payload(s))).toEqual([{ item: 'bread', name: '麵包', n: 2, snack: false }, { item: 'honeycake', name: '蜂蜜蛋糕', n: 1, snack: true }]);
  });
  it('stallDefaults: price range per qty, default at 2x, qty capped by stock and 10', () => {
    expect(stallDefaults('strawberry', 3, 20)).toEqual({ qty: 3, min: 18, max: 54, price: 36 });
    expect(stallDefaults('wheat', 15, 15)).toEqual({ qty: 10, min: 10, max: 30, price: 20 });
    expect(stallDefaults('jam', 0, 0)).toEqual({ qty: 0, min: 0, max: 0, price: 0 });
  });
  it('expandOffer: which locked east field can be bought now', () => {
    const s = newFarm(1, T0, ALWAYS_OPEN); s.level = 9; s.expand = 1;
    expect(expandOffer(payload(s), 13)).toEqual({ kind: 'buy', cost: 200 });
    expect(expandOffer(payload(s), 14)).toEqual({ kind: 'later', text: '先買前一格' });
    s.expand = 2; expect(expandOffer(payload(s), 14)).toEqual({ kind: 'later', text: 'Lv 11 才能買' });
    expect(expandOffer(payload(s), 12)).toEqual({ kind: 'open' });
  });
});
