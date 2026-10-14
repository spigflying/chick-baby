export type FoodId = 'rice' | 'candy' | 'worm' | 'corn' | 'cake' | 'rosetea';
export interface Food {
  id: FoodId; name: string; price: number; snack: boolean; visitorAllowed: boolean;
  /** 飲料：前端播放慢慢喝光的動畫（v1.3） */ drink?: boolean; /** 喝完立刻拉出的便便數（v1.3，不受自然便便上限限制） */ poop?: number;
  hunger: number; happiness: number; health: number; weight: number; strength: number; speed: number; stamina: number;
}
export const FOODS: Food[] = [
  { id: 'rice', name: '米粒', price: 0, snack: false, visitorAllowed: false, hunger: 20, happiness: 2, health: 1, weight: 1, strength: 0, speed: 0, stamina: 0.5 },
  { id: 'candy', name: '糖果', price: 3, snack: true, visitorAllowed: true, hunger: 5, happiness: 20, health: -3, weight: 2, strength: 0, speed: 1, stamina: 0 },
  { id: 'worm', name: '蟲蟲', price: 5, snack: false, visitorAllowed: true, hunger: 20, happiness: 8, health: 3, weight: 1, strength: 4, speed: 1, stamina: 1 },
  { id: 'corn', name: '玉米', price: 10, snack: false, visitorAllowed: true, hunger: 35, happiness: 6, health: 4, weight: 2, strength: 2, speed: 3, stamina: 4 },
  { id: 'cake', name: '蛋糕', price: 15, snack: true, visitorAllowed: true, hunger: 10, happiness: 35, health: -5, weight: 4, strength: 2, speed: 0, stamina: 2 },
  // v1.3：玫瑰茶。很貴的飲料，喝完立刻拉 20 坨（惡作劇用）；算點心，所以快吃飽時也能喝；所有階段都可以喝。
  { id: 'rosetea', name: '玫瑰茶', price: 500, snack: true, visitorAllowed: true, drink: true, poop: 20, hunger: 5, happiness: 25, health: 2, weight: 0, strength: 0, speed: 0, stamina: 1 },
];
/** 便便數的硬上限（自然便便上限 3 + 玫瑰茶 20）。 */
export const POOP_HARD_MAX = 23;
export const FOOD_BY_ID: Record<string, Food> = Object.fromEntries(FOODS.map((f) => [f.id, f]));
