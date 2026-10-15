// v1.7 服飾（皇冠、墨鏡）：道具店購買，每位使用者擁有一次（永久）；穿在自己目前的寵物上，可穿脫。
import { OUTFITS, OUTFIT_IDS, isOutfitId, type OutfitId } from '@chick/engine';
import type { Db, Tx } from './db';
import { changeBalance, lockWallets, notify, runAction, type ReqCtx } from './core';
import { fail } from './errors';
import { lockPet, publicPet, settle } from './pets';

export function outfitCatalog() { return OUTFIT_IDS.map((id) => ({ id, ...OUTFITS[id] })); }
export async function ownedOutfits(db: Db | Tx, userId: string): Promise<OutfitId[]> {
  const rows = await db.selectFrom('user_outfits').select('outfit_id').where('user_id', '=', userId).execute();
  return rows.map((r: any) => r.outfit_id).filter(isOutfitId);
}
async function livingPet(tx: Tx, userId: string) {
  const r = await tx.selectFrom('pets').select('id').where('owner_id', '=', userId).where('status', '=', 'alive').executeTakeFirst();
  return r ? lockPet(tx, r.id) : null;
}
async function setWorn(tx: Tx, row: any, ids: string[]) {
  await tx.updateTable('pets').set({ outfits: JSON.stringify(ids) }).where('id', '=', row.id).execute();
  row.outfits = ids;
  const home = await tx.selectFrom('homes').select('id').where('owner_id', '=', row.owner_id).executeTakeFirstOrThrow();
  await notify(tx, { t: 'pet', home: home.id, pet: row.id, ev: { type: 'outfit', outfits: ids } });
}
/** 購買：冪等＋稽核，金幣走 coin_ledger（reason = outfit）；買了就自動穿上（有活著的寵物時）。 */
export async function buyOutfit(db: Db, ctx: ReqCtx, outfitId: unknown, requestId: unknown) {
  if (!isOutfitId(outfitId)) return fail('BAD_REQUEST');
  const id: OutfitId = outfitId;
  return runAction(db, ctx, 'outfit.buy', requestId, { outfit_id: id }, async (tx) => {
    const [w] = await lockWallets(tx, [ctx.userId]);
    const has = await tx.selectFrom('user_outfits').select('outfit_id').where('user_id', '=', ctx.userId).where('outfit_id', '=', id).executeTakeFirst();
    if (has) fail('ALREADY_OWNED');
    if (!w || w.balance < OUTFITS[id].price) fail('INSUFFICIENT_COINS');
    const balance = await changeBalance(tx, ctx.userId, -OUTFITS[id].price, 'outfit', { type: 'outfit', id });
    await tx.insertInto('user_outfits').values({ user_id: ctx.userId, outfit_id: id }).execute();
    const row = await livingPet(tx, ctx.userId);
    let pet = null;
    if (row) { const { state } = await settle(tx, row); const worn = (row.outfits ?? []) as string[]; if (!worn.includes(id)) await setWorn(tx, row, [...worn, id]); pet = publicPet(row, state); }
    return { ok: true, outfit_id: id, balance, owned: await ownedOutfits(tx, ctx.userId), pet };
  }, { type: 'outfit', id });
}
/** 穿上／脫下（只能穿自己擁有的；穿在自己活著的寵物上）。 */
export async function wearOutfit(db: Db, ctx: ReqCtx, outfitId: unknown, on: unknown, requestId: unknown) {
  if (!isOutfitId(outfitId) || typeof on !== 'boolean') return fail('BAD_REQUEST');
  const id: OutfitId = outfitId;
  return runAction(db, ctx, 'outfit.wear', requestId, { outfit_id: id, on }, async (tx) => {
    const owned = await ownedOutfits(tx, ctx.userId);
    if (!owned.includes(id)) fail('NOT_OWNED');
    const row = await livingPet(tx, ctx.userId);
    if (!row) fail('PET_DEAD');
    const { state } = await settle(tx, row);
    const worn = ((row.outfits ?? []) as string[]).filter((x) => x !== id);
    await setWorn(tx, row, on ? [...worn, id] : worn);
    return { ok: true, outfits: row.outfits as string[], pet: publicPet(row, state) };
  }, { type: 'outfit', id });
}
