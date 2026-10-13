export type SpeciesId = 'chicken' | 'duck' | 'penguin' | 'dino';
export interface Species {
  id: SpeciesId; name: string; trait: string;
  base: { strength: number; speed: number; stamina: number; weight: number };
  mult: { strength: number; speed: number; stamina: number };
}
/** 新增物種 = 加一筆定義 + 精靈圖（apps/web/src/sprites.ts） */
export const SPECIES: Record<SpeciesId, Species> = {
  chicken: { id: 'chicken', name: '雞', trait: '平均', base: { strength: 10, speed: 10, stamina: 10, weight: 20 }, mult: { strength: 1, speed: 1, stamina: 1 } },
  duck: { id: 'duck', name: '鴨', trait: '體力高', base: { strength: 9, speed: 9, stamina: 14, weight: 22 }, mult: { strength: 1, speed: 1, stamina: 1.3 } },
  penguin: { id: 'penguin', name: '企鵝', trait: '速度快', base: { strength: 9, speed: 14, stamina: 10, weight: 22 }, mult: { strength: 1, speed: 1.3, stamina: 1 } },
  dino: { id: 'dino', name: '恐龍', trait: '力量強', base: { strength: 14, speed: 8, stamina: 10, weight: 26 }, mult: { strength: 1.3, speed: 1, stamina: 1 } },
};
export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];
export function isSpecies(x: unknown): x is SpeciesId { return typeof x === 'string' && x in SPECIES; }
