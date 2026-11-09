import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RECIPES } from '@chick/engine';
import { art, artPaths } from '../src/art';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

describe('圖檔經 Vite 打包（網址帶 hash、長快取）', () => {
  it('src/art 底下的農場與格鬥圖都被收進來', () => {
    const p = artPaths();
    expect(p).toContain('farm/barn.png');
    expect(p).toContain('farm/storybook-ro-a/background.webp');
    expect(p).toContain('farm/coop/hen.webp');
    for (const item of ['rabbit', 'carrot', 'wool']) expect(p).toContain(`farm/hutch/${item}.webp`);
    expect(p).toContain('farm/beehive/bee.webp');
    expect(p).toContain('farm/cowshed/cow.webp');
    expect(p).toContain('farm/tree/apple.webp');
    expect(p).toContain('fight/face_a.webp');
    expect(p.filter((x) => x.startsWith('fight/')).length).toBeGreaterThan(50);
  });
  it('art() 給出可用的網址；找不到的圖回空字串並警告一次，不讓畫面整個壞掉', () => {
    expect(art('farm/barn.png')).toMatch(/barn.*\.png/);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(art('farm/nope.png')).toBe('');
    expect(art('farm/nope.png')).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it('每個工坊的產品與原料都有圖', () => {
    for (const r of Object.values(RECIPES)) {
      for (const item of [...r.in.map((x) => x.item), r.out.item]) {
        expect(artPaths(), `${r.station}/${item}`).toContain(`farm/${r.station}/${item}.webp`);
      }
    }
  });
  it('程式不再用寫死的 /farm/*.png、/fight/* 或 BASE_URL 組圖檔網址（那些不會帶 hash、無法長快取）', () => {
    const files = readdirSync(SRC).filter((f) => /\.ts$/.test(f) && f !== 'art.ts');
    for (const f of files) {
      const s = readFileSync(SRC + f, 'utf8');
      expect(s, f).not.toMatch(/import\.meta\.env\.BASE_URL/);
      expect(s, f).not.toMatch(/['"`]\/fight\//);
      expect(s, f).not.toMatch(/\/farm\/[\w${}-]+(\/[\w${}-]+)*\.(png|jpg|webp)/);
    }
  });
});
