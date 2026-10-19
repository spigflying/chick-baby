import { describe, expect, it } from 'vitest';
import { ACCESSORIES, OUTFITS } from '@chick/engine';
import { S, speciesSprite, frontSprite, accAnchor } from '../src/sprites';
import { ACC_SPRITES } from '../src/bao-sprites';
import { SIDE_ANCHORS } from '../src/species-acc';
import { accessoryLine } from '../src/accLine';

const NEW35 = ['pan', 'dumbbell', 'gloves', 'mace', 'shield', 'armband', 'skateboard', 'skates', 'boltband', 'goggles', 'copter', 'cape',
  'propcap', 'monitor', 'hardhat', 'flashlight', 'bottle', 'snorkel', 'tie', 'chef', 'donut', 'bib', 'nightcap', 'beanie',
  'heartclip', 'cherry', 'dandelion', 'star', 'rainbow', 'wizard', 'eyepatch', 'headphones', 'monocle', 'paperbag', 'eggshell'];
const SPECIES = ['chicken', 'duck', 'penguin', 'dino'];

describe('v2.0 35 件新配件的圖', () => {
  it('35 件都有圖、都有中文名稱', () => {
    expect(NEW35.length).toBe(35);
    for (const id of NEW35) { expect(ACC_SPRITES[id], id).toBeTruthy(); expect((ACCESSORIES as any)[id]?.name, id).toBeTruthy(); }
  });
  it('每個物種 × 每件新配件 × 每個畫面（側面走路 2 格、睡覺、正面）都跟沒戴的不一樣', () => {
    for (const sp of SPECIES) for (const id of NEW35) {
      for (const k of [1, 2, 's'] as const) expect(S[speciesSprite(`${sp}|${id}`, k)].join('\n'), `${sp} ${id} ${k}`).not.toBe(S[speciesSprite(sp, k)].join('\n'));
      expect(S[frontSprite(`${sp}|${id}`)].join('\n'), `${sp} ${id} front`).not.toBe(S[frontSprite(sp)].join('\n'));
    }
  });
  it('領帶、圍兜跟著脖子（鴨子的脖子比身體高）', () => {
    expect(accAnchor('tie')).toBe('neck'); expect(accAnchor('bib')).toBe('neck'); expect(accAnchor('scarf')).toBe('neck');
    expect(SIDE_ANCHORS.duck.neck).not.toEqual(SIDE_ANCHORS.duck.body);
    const top = (n: string) => S[n].findIndex((r) => r.includes('2') || r.includes('3'));
    expect(S[speciesSprite('duck|tie', 1)].join('\n')).not.toBe(S[speciesSprite('duck|armband', 1)].join('\n'));
    expect(top(speciesSprite('duck|tie', 1))).toBeGreaterThanOrEqual(0);
  });
  it('狀態頁的配件那行顯示中文名稱，服飾標（服飾）', () => {
    expect(accessoryLine({ bao: { items: ['mace', 'cape', 'heartclip'] }, outfits: ['wizard'], bao_stage: 1 } as any)).toContain('狼牙棒');
    const line = accessoryLine({ bao: { items: ['tie'] }, outfits: [], look: 'wizard,monocle,tie', bao_stage: 2 } as any);
    expect(line).toContain(`${OUTFITS.wizard.name}（服飾）`); expect(line).toContain('單片眼鏡（服飾）'); expect(line).toContain('領帶');
  });
});
