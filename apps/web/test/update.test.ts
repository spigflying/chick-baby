import { describe, it, expect } from 'vitest';
import { isOutdated, noticeAction, justUpdated, noticeHtml, SEEN_KEY } from '../src/update';
const mem = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
describe('new-version notice', () => {
  it('outdated only when the server reports a different build id', () => {
    expect(isOutdated('a1', { build: 'b2' })).toBe(true);
    expect(isOutdated('a1', { build: 'a1' })).toBe(false);
    expect(isOutdated('a1', { build: null })).toBe(false); // 本機開發
    expect(isOutdated('a1', null)).toBe(false);
  });
  it('waits while a fight or stairs match is active, shows after it ends, only once', () => {
    expect(noticeAction({ outdated: true, busy: true, shown: false })).toBe('wait');
    expect(noticeAction({ outdated: true, busy: false, shown: false })).toBe('show');
    expect(noticeAction({ outdated: true, busy: false, shown: true })).toBe('none');
    expect(noticeAction({ outdated: false, busy: false, shown: false })).toBe('none');
  });
  it('after reload shows the notes once (last seen id in localStorage); new players skip it', () => {
    const s = mem({ [SEEN_KEY]: 'old' });
    expect(justUpdated(s, 'new', { build: 'new' }, true)).toBe(true);
    expect(s.m.get(SEEN_KEY)).toBe('new');
    expect(justUpdated(s, 'new', { build: 'new' }, true)).toBe(false); // 第二次不再顯示
    expect(justUpdated(mem(), 'new', { build: 'new' }, false)).toBe(false); // 全新玩家
    expect(justUpdated(mem(), 'new', { build: 'new' }, true)).toBe(true); // 舊玩家（有寵物快取）第一次拿到這個功能
    const t = mem({ [SEEN_KEY]: 'old' });
    expect(justUpdated(t, 'old', { build: 'new' }, true)).toBe(false); // 自己還是舊版 → 走「有新版本」
    expect(t.m.get(SEEN_KEY)).toBe('old');
  });
  it('notice text: title, bullet notes, 立即更新; never a version number', () => {
    const h = noticeHtml('new', ['丟大便可以無限丟了', '<x>']);
    expect(h).toContain('有新版本，請更新'); expect(h).toContain('<li>丟大便可以無限丟了</li>'); expect(h).toContain('立即更新'); expect(h).toContain('data-reload');
    expect(h).not.toContain('<x>'); expect(h).not.toMatch(/v\d|build/i);
    expect(noticeHtml('done', ['a'])).toContain('更新完成');
  });
});
