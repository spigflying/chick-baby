// v1.5 道具：用金幣在動作列的「道具店」購買；以「場」計算，每場有用到就扣 1 場（在對戰結算時扣）。
import { ITEMS, ITEM_IDS, isItemId, type ItemId } from '@chick/engine';
import type { Db, Tx } from './db';
import { changeBalance, lockWallets, notify, runAction, type ReqCtx } from './core';
import { fail } from './errors';

export async function listItems(db: Db | Tx, userId: string): Promise<Partial<Record<ItemId, number>>> {
  const rows = await db.selectFrom('user_items').select(['item_id', 'fights_left']).where('user_id', '=', userId).where('fights_left', '>', 0).execute();
  const out: Partial<Record<ItemId, number>> = {};
  for (const r of rows) if (isItemId(r.item_id)) out[r.item_id] = r.fights_left;
  return out;
}
export function itemCatalog() { return ITEM_IDS.map((id) => ({ id, ...ITEMS[id] })); }

/** 購買：冪等（request_id）＋稽核（runAction），金幣走 coin_ledger（reason = item）。對戰中不能買。 */
export async function buyItem(db: Db, ctx: ReqCtx, itemId: unknown, requestId: unknown, inFight: (u: string) => boolean = () => false) {
  if (!isItemId(itemId)) return fail('BAD_REQUEST');
  const id: ItemId = itemId;
  return runAction(db, ctx, 'item.buy', requestId, { item_id: id }, async (tx) => {
    if (inFight(ctx.userId)) fail('IN_FIGHT');
    const it = ITEMS[id];
    const [w] = await lockWallets(tx, [ctx.userId]);
    if (!w || w.balance < it.price) fail('INSUFFICIENT_COINS');
    const balance = await changeBalance(tx, ctx.userId, -it.price, 'item', { type: 'item', id });
    const row = await tx.insertInto('user_items').values({ user_id: ctx.userId, item_id: id, fights_left: it.fights })
      .onConflict((oc) => oc.columns(['user_id', 'item_id']).doUpdateSet((eb: any) => ({ fights_left: eb('user_items.fights_left', '+', it.fights), updated_at: new Date() })))
      .returning('fights_left').executeTakeFirstOrThrow();
    await notify(tx, { t: 'arena.items', user: ctx.userId });
    return { ok: true, item_id: id, fights_left: row.fights_left as number, balance, items: await listItems(tx, ctx.userId) };
  }, { type: 'item', id });
}
