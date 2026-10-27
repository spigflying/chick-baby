import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BENSON, VIEW_ANCHORS, COAT } from '../src/species-sprites';
import { POSE_ART } from '../src/pose-art';
const h = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
// 雞鴨企鵝換成 Benson 重畫的圖；恐龍（「太鬼了」）維持原樣：格子、錨點、外套、披風／翅膀都不能變。
describe('dino art is unchanged', () => {
  it('grids, anchors, coat and pose art hash', () => {
    expect(h(BENSON.dino)).toBe('d337c4db5dda5d7b');
    expect(h(VIEW_ANCHORS.dino)).toBe('bb635c21be059a0f');
    expect(h(COAT.dino)).toBe('3425ccb09e7f3d4a');
    expect(h(POSE_ART.dino)).toBe('0a288254efd12917');
  });
});
