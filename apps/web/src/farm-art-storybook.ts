// 手繪冒險畫風沿用農場既有的互動素材與狀態圖，只替換兩座場景的底圖。
// 同一組 Box 與 SVG hit area 可保留原本的種田、熱氣球和拜訪操作。
import { LAYOUT, SCENE } from './farm-layout';

export * from './farm-art';

const backgroundImage = (name: string) => `<image href="${import.meta.env.BASE_URL}farm/${name}.jpg" x="0" y="0" width="${SCENE.w}" height="${SCENE.h}" preserveAspectRatio="none"/>`;
export function background(): string {
  const pond = LAYOUT.pond;
  return backgroundImage('background-main-storybook') + `<image class="storybook-pond" href="${import.meta.env.BASE_URL}farm/pond.png" x="${pond.x}" y="${pond.y - 18}" width="${pond.w}" height="${pond.h + 36}" preserveAspectRatio="none"/>`;
}
export function eastBackground(): string { return backgroundImage('background-east-storybook'); }
