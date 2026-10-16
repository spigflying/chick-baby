import { describe, expect, it } from 'vitest';
import { fitWidth, FIT_MAX, FIT_MIN } from '../src/eggfit';
import { eggE, SHINE, drawShell, SHELL_W, SHELL_H } from '../src/shell';
import { readFileSync } from 'node:fs';

describe('egg frame fit', () => {
  it('keeps the full width when it fits, else the widest width that fits', () => {
    expect(fitWidth(() => true)).toBe(FIT_MAX);
    expect(fitWidth(() => false)).toBe(FIT_MIN);
    const w = fitWidth((x) => x <= 0.47);
    expect(w).toBeLessThanOrEqual(0.47); expect(w).toBeGreaterThan(0.465);
  });
  it('the shine pixels sit inside the shell fill (no white corner on the outline), ', () => {
    for (const [x, y] of SHINE) expect(eggE((x + 0.5) / SHELL_W, (y + 0.5) / SHELL_H)).toBeLessThan(0.78);
  });
  it('egg shape: centre inside, corners outside', () => {
    expect(eggE(0.5, 0.54)).toBe(0);
    expect(eggE(0, 0)).toBeGreaterThan(1); expect(eggE(1, 1)).toBeGreaterThan(1);
  });
  it('egg ratio is always exactly 40:56 (canvas, CSS, and the fit code never changes it)', () => {
    const c: any = { width: 0, height: 0, getContext: () => ({ fillRect() {}, set fillStyle(_v: string) {} }) };
    drawShell(c); expect([c.width, c.height]).toEqual([40, 56]); expect(SHELL_W / SHELL_H).toBe(40 / 56);
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.device\{[^}]*aspect-ratio:40\/56/);
    const dev = readFileSync(new URL('../src/device.ts', import.meta.url), 'utf8');
    expect(dev).not.toMatch(/aspectRatio|drawShell\([^)]*,[^)]*,[^)]*,/);
  });
});
