import { describe, expect, it } from 'vitest';
import { accessoryLine } from '../src/accLine';
describe('status 配件 line', () => {
  it('before evolving', () => { expect(accessoryLine({ bao: null })).toBe('還沒進化'); });
  it('lists evolution items in Chinese with stage', () => {
    expect(accessoryLine({ bao: { items: ['unicorn', 'bow'] }, look: 'unicorn,bow', outfits: [], bao_stage: 1 })).toBe('第 1 階・獨角、蝴蝶結');
  });
  it('marks worn outfits and follows look (crown replaces head items)', () => {
    expect(accessoryLine({ bao: { items: ['horns', 'bow'] }, outfits: ['shades', 'crown'], look: 'shades,crown', bao_stage: 2 })).toBe('第 2 階・墨鏡（服飾）、皇冠（服飾）');
  });
  it('falls back without look', () => {
    expect(accessoryLine({ bao: { items: ['horns'] }, outfits: ['shades'] })).toBe('墨鏡（服飾）、小彎角');
  });
});
