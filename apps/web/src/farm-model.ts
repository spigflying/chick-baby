// 小雞農場畫面的資料模型（純函式，給 farm-view.ts 用）：把伺服器回的 state + derived 轉成畫面要顯示的文字與狀態。
import { CROPS, FARM, FARM_FOODS, FARM_ITEMS, stallPriceRange, type CropId, type FarmDerived, type FarmItemId, type FarmState } from '@chick/engine';

export interface FarmPayload { owner: { id: string; display_name: string }; is_owner: boolean; state: FarmState; derived: FarmDerived; server_time: number; balance?: number; leveled?: number[] }

const MIN = 60_000;
/** 剩餘的開放時間 → 「12 分」「1 小時 15 分」。 */
export function remainText(ms: number): string {
  if (ms <= 0) return '可收成';
  if (ms < MIN) return '不到 1 分';
  const m = Math.ceil(ms / MIN);
  if (m < 60) return `${m} 分`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} 小時 ${r} 分` : `${h} 小時`;
}

export function fieldBadge(f: FarmDerived['fields'][number], _isOwner: boolean): { text: string; tone: 'ready' | 'timer' | 'lock' | 'none' } {
  if (f.locked) return { text: `Lv ${f.unlockLevel} 解鎖`, tone: 'lock' };
  if (f.stage === null) return { text: '', tone: 'none' };
  if (f.stage === 3) return { text: '可收成', tone: 'ready' };
  return { text: remainText(f.remainMs), tone: 'timer' };
}

export function plantChoices(p: FarmPayload, balance: number): { crop: CropId; name: string; cost: string; enabled: boolean; reason: string | null }[] {
  const s = p.state;
  return (Object.keys(CROPS) as CropId[]).map((crop) => {
    const c = CROPS[crop];
    const cost = c.seedFriendPts ? `友情 ${c.seedFriendPts}` : `◎${c.seedCoins}`;
    const reason = s.level < c.level ? `Lv ${c.level} 解鎖`
      : c.seedFriendPts && s.friendPts < c.seedFriendPts ? '友情點數不夠'
        : balance < c.seedCoins ? '金幣不夠' : null;
    return { crop, name: c.name, cost, enabled: reason === null, reason };
  });
}

export function hudModel(p: FarmPayload, balance: number) {
  const s = p.state;
  const xpPct = s.level >= FARM.maxLevel ? 100 : Math.min(100, Math.floor((s.xp / p.derived.xpToNext) * 100));
  return { level: s.level, xpPct, coins: balance, barn: `${p.derived.barn.used} / ${p.derived.barn.cap}`, friendPts: s.friendPts };
}

/** 訪客在這座農場可以幫忙的東西。 */
export function helpTargets(p: FarmPayload): ({ kind: 'water'; idx: number } | { kind: 'rescue' })[] {
  if (p.is_owner) return [];
  const out: ({ kind: 'water'; idx: number } | { kind: 'rescue' })[] = [];
  p.state.fields.forEach((f, idx) => { const d = p.derived.fields[idx]; if (f.crop && !f.wateredBy && d.stage !== 3) out.push({ kind: 'water', idx }); });
  if (p.derived.tree.state === 'withered') out.push({ kind: 'rescue' });
  return out;
}

export const FARM_ERR: Record<string, string> = {
  BAD_REQUEST: '這個動作怪怪的，重新整理再試一次',
  NOT_UNLOCKED: '等級還不夠，升級後就能用',
  SLOT_BUSY: '這裡已經在用了',
  NOT_READY: '還沒好喔，再等一下',
  BARN_FULL: '倉庫滿了，先賣掉一些或升級倉庫',
  NOT_ENOUGH_ITEMS: '材料不夠',
  QUEUE_FULL: '加工排滿了，等做好或加格子',
  WITHERED: '果樹枯掉了，請朋友來救，或花 ◎30 自己救',
  NOT_WITHERED: '果樹好好的，不用救',
  ALREADY_WATERED: '這塊田已經有人澆過水了',
  NOT_GROWING: '這塊田沒有在長，不用澆水',
  MAX_LEVEL: '已經升到最高了',
  NOT_ENOUGH_FRIEND_POINTS: '友情點數不夠，去幫朋友就能拿',
  NO_ORDER: '這張訂單已經不見了',
  HELP_DAILY_CAP: '今天已經幫忙 10 次了，明天再來',
  HELP_FARM_CAP: '今天已經幫這座農場 5 次了',
  HELP_SELF: '自己的農場不能幫自己喔',
  // 第二階段
  NO_PET: '要先有一隻活著的寵物才行',
  CHICK_TIRED: '小雞今天澆累了，明天再來（寵物體力越高，每天能澆越多次）',
  NO_BALLOON: '熱氣球現在不在',
  CRATE_DONE: '這個貨箱已經裝好了',
  NO_LISTING: '這格已經賣掉或下架了',
  BAD_PRICE: '價格要在範圍內',
  NOT_EDIBLE: '這個不能給寵物吃',
  BUY_SELF: '自己的小攤不能買',
  BUY_DAILY_CAP: '今天已經在小攤買 10 次了，明天再來',
  PET_SLEEPING: '寵物在睡覺，等牠醒來再餵',
  PET_DEAD: '寵物已經不在了',
  PET_EGG: '還是蛋，孵出來才能吃東西',
  TOO_FULL: '寵物吃太飽了',
  SNACK_ONLY: '寵物快吃飽了，只能吃點心（草莓、果醬、蜂蜜、蜂蜜蛋糕）',
};

/** 倉庫裡可以餵寵物的東西。 */
export function feedChoices(p: FarmPayload): { item: FarmItemId; name: string; n: number; snack: boolean }[] {
  return (Object.keys(FARM_FOODS) as FarmItemId[]).filter((i) => (p.state.inv[i] ?? 0) > 0)
    .map((item) => ({ item, name: FARM_ITEMS[item].name, n: p.state.inv[item]!, snack: FARM_FOODS[item]!.snack }));
}
/** 小攤上架表單：數量上限（最多 10、不超過庫存）、每個的價格範圍（賣價 1–3 倍）與預設（2 倍）。用每個的價格，改數量才不會超出範圍。 */
export function stallDefaults(item: FarmItemId, have: number) {
  const [unitMin, unitMax] = stallPriceRange(item, 1);
  return { maxQty: Math.max(0, Math.min(FARM.stall.maxQty, have)), unitMin, unitMax, unit: unitMin * 2 };
}
/** 打開中的子畫面還對不對得上現在的資料（例如「田在長」的面板，田已經收成了就關掉）。 */
export function panelValid(pn: { k: string; idx?: number } | null, p: FarmPayload): boolean {
  if (pn?.k === 'grow') { const f = p.state.fields[pn.idx!]; return !!f?.crop && p.derived.fields[pn.idx!].stage !== 3; }
  return true;
}
/** 東邊新地的田（idx 12–17）：已開、現在能買、還不能買。 */
export function expandOffer(p: FarmPayload, idx: number): { kind: 'open' } | { kind: 'buy'; cost: number } | { kind: 'later'; text: string } {
  const k = idx - FARM.baseFields, s = p.state;
  if (k < s.expand) return { kind: 'open' };
  if (k > s.expand) return { kind: 'later', text: '先買前一格' };
  if (s.level < FARM.expand.levels[k]) return { kind: 'later', text: `Lv ${FARM.expand.levels[k]} 才能買` };
  return { kind: 'buy', cost: FARM.expand.costs[k] };
}

/** 蛋殼動作列上的「農場」格子：開關沒開就不出現，手機上變灰。 */
export function farmCellState(cfgFarm: boolean, touch: boolean): 'hidden' | 'disabled' | 'enabled' {
  if (!cfgFarm) return 'hidden';
  return touch ? 'disabled' : 'enabled';
}

/** 背景重讀失敗時怎麼辦：沒有權限了（被黑名單、家關起來、登出）就關掉農場；其他錯誤先暫停自動重讀，等下一次成功的操作。 */
export function loadErrorAction(code: string): 'close' | 'pause' {
  return code === 'FORBIDDEN' || code === 'NOT_FOUND' || code === 'UNAUTHORIZED' ? 'close' : 'pause';
}
