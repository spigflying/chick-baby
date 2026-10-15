import { describe, it, expect } from 'vitest';
import { isOutdated, toastVisible, justUpdated, noticeHtml, SEEN_KEY, DONE_MS } from '../src/update';
const mem = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
describe('new-version notice', () => {
  it('outdated only when the server reports a different build id', () => {
    expect(isOutdated('a1', { build: 'b2' })).toBe(true);
    expect(isOutdated('a1', { build: 'a1' })).toBe(false);
    expect(isOutdated('a1', { build: null })).toBe(false); // 本機開發
    expect(isOutdated('a1', null)).toBe(false);
  });
  it('hidden entirely during fight/invite/result/stairs; shown after; closed stays closed', () => {
    expect(toastVisible({ has: true, busy: true, closed: false })).toBe(false);
    expect(toastVisible({ has: true, busy: false, closed: false })).toBe(true);
    expect(toastVisible({ has: true, busy: false, closed: true })).toBe(false);
    expect(toastVisible({ has: false, busy: false, closed: false })).toBe(false);
    expect(DONE_MS).toBe(8000);
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
  it('small toast: 有新版本 + 更新 + expand toggle + close; notes only when expanded; no version number; buttons never take focus', () => {
    const h = noticeHtml('new', ['丟大便可以無限丟了', '<x>']);
    expect(h).toContain('有新版本'); expect(h).toContain('>更新<'); expect(h).toContain('data-reload'); expect(h).toContain('data-toggle'); expect(h).toContain('data-close');
    expect(h).not.toContain('<li>');
    const o = noticeHtml('new', ['丟大便可以無限丟了', '<x>'], true);
    expect(o).toContain('<li>丟大便可以無限丟了</li>'); expect(o).not.toContain('<x>'); expect(o).not.toMatch(/v\d|build/i);
    expect((h.match(/<button/g) ?? []).length).toBe((h.match(/tabindex="-1"/g) ?? []).length);
    const d = noticeHtml('done', ['a']); expect(d).toContain('更新完成'); expect(d).not.toContain('data-reload');
  });

});
