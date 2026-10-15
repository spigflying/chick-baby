import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { fitWidth, FIT_MAX, FIT_MIN } from '../src/eggfit';
import { SHELL } from '../src/shell';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
describe('photo shell frame', () => {
  it('fitWidth keeps the full width when it fits, else the widest width that fits', () => {
    expect(fitWidth(() => true)).toBe(FIT_MAX);
    expect(fitWidth(() => false)).toBe(FIT_MIN);
    const w = fitWidth((x) => x <= 0.8);
    expect(w).toBeLessThanOrEqual(0.8); expect(w).toBeGreaterThan(0.79);
  });
  it('shell ratio is fixed to the photo (635:733) in CSS and never changed by code', () => {
    expect(css).toMatch(/\.egg\{[^}]*aspect-ratio:635\/733/);
    expect(css).toMatch(/background:url\(\/shell-white\.webp\) center\/100% 100%/);
    for (const f of ['device.ts', 'main.ts', 'eggfit.ts']) expect(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')).not.toMatch(/aspectRatio/);
    expect(SHELL.w / SHELL.h).toBeCloseTo(635 / 733, 6);
  });
  it('the CSS LCD box matches SHELL.lcd and sits inside the shell', () => {
    const m = css.match(/\.inner\{position:absolute;left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)%;height:([\d.]+)%/)!;
    expect(m.slice(1).map(Number)).toEqual([SHELL.lcd.left, SHELL.lcd.top, SHELL.lcd.width, SHELL.lcd.height].map((v) => +(v * 100).toFixed(2)));
    expect(SHELL.lcd.left + SHELL.lcd.width).toBeLessThan(1); expect(SHELL.lcd.top + SHELL.lcd.height).toBeLessThan(1);
  });
  it('the shell image is small', () => {
    expect(statSync(new URL('../public/shell-white.webp', import.meta.url)).size).toBeLessThan(300_000);
  });
});
