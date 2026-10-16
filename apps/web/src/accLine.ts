import { ACCESSORIES, OUTFITS, isAccId, isOutfitId } from '@chick/engine';
/** 狀態頁「配件」那一行：寶身上看得到的配件（進化配件＋穿著的服飾，皇冠會蓋掉頭上配件所以以 look 為準）。 */
export function accessoryLine(p: { bao?: { items: string[] } | null; outfits?: string[] | null; look?: string | null; bao_stage?: number | null } | null | undefined): string {
  if (!p?.bao) return '還沒進化';
  const worn = p.look != null ? p.look.split(',').filter(Boolean) : [...(p.outfits ?? []), ...p.bao.items];
  const names = worn.map((id) => isOutfitId(id) ? `${OUTFITS[id].name}（服飾）` : isAccId(id) ? ACCESSORIES[id].name : id);
  const stage = p.bao_stage ? `第 ${p.bao_stage} 階・` : '';
  return stage + (names.length ? names.join('、') : '沒有');
}
