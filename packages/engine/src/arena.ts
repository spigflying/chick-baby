// v1.5 打架模式 v2：家裡畫面的伺服器權威模擬（決定性、無亂數）。tick 頻率與下樓梯相同。
// 混戰（free-for-all）：第一下命中時，場上所有寵物一起開打；剩 1 隻或時間到結束。
export const ARENA_PARAMS = {
  tickRate: 30, snapshotEvery: 3,
  width: 120, ground: 86, top: 14,
  petW: 12, petH: 12,
  moveSpeed: 1.2, gravity: 0.25, jumpVy: -3.6, maxFall: 3.5, stompBounceVy: -2.6,
  hpMax: 100,
  /** 啄：面向方向「貼身 + peckRange」內最近的一隻 */
  peckRange: 14, peckDamage: 10, attackCooldownTicks: 15, attackAnimTicks: 5,
  /** 上啄（↑ + 空白）：一定會跳（空中則小跳），只打頭頂正上方 */
  upPeckDamage: 10, upPeckCooldownTicks: 24, upPeckReach: 12, airHopVy: -1.2,
  stompDamage: 12,
  knockback: 4.5, knockUp: -2, knockDecay: 0.8,
  hitInvulnTicks: 15,
  /** 蹬牆跳 */
  wallSlideMaxFall: 0.8, wallKickVx: 3.2, wallKickVy: -3.4,
  // 道具
  swordRange: 42, swordDamage: 12, swordCooldownTicks: 21, swordAnimTicks: 6,
  kameChargeTicks: 30, kameDamage: 30, kameBeamTicks: 9,
  poopVx: 2.4, poopVy: -1.8, poopDamage: 8, poopCooldownTicks: 15, slipTicks: 20, slipKx: 1.6, slipDecay: 0.95,
  fightTicks: 30 * 60, homeCooldownMs: 30_000, maxFighters: 8,
  /** v1.6 邀請制：等回覆的時間、系統獎金池 */
  inviteMs: 10_000, bonusPool: 50,
};
export type ArenaParams = typeof ARENA_PARAMS;
export type ItemId = 'sword' | 'kame' | 'poop';
export const ITEMS: Record<ItemId, { name: string; price: number; fights: number }> = {
  sword: { name: '長劍', price: 150, fights: 10 },
  kame: { name: '龜派氣功', price: 300, fights: 5 },
  poop: { name: '丟大便', price: 50, fights: 10 },
};
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const isItemId = (x: unknown): x is ItemId => typeof x === 'string' && x in ITEMS;
export type Swing = 'peck' | 'up' | 'sword' | 'beam' | 'throw' | null;
export interface Fighter {
  userId: string; petId: string; species: string; name: string;
  x: number; y: number; vy: number; kx: number; dir: 1 | -1; onGround: boolean;
  left: boolean; right: boolean; jump: boolean; attack: boolean; upAtk: boolean; item: boolean; prevAttack: boolean;
  /** 快速點按（按下又放開都在同一 tick 內）也要算：按下時先記起來，下個 tick 消耗 */ qAttack: boolean; qJump: boolean; qUp: boolean; qItem: boolean;
  cd: number; upCd: number; itemCd: number; atk: number; inv: number; hp: number; fightId: string | null;
  /** 被 KO：本場觀戰（不能動、不能被打） */ out: boolean;
  /** 畫面用：最近一次揮擊種類／次數；最近一次被打的傷害／次數 */ swing: Swing; swingN: number; hitN: number; hitDmg: number;
  /** 蹬牆：目前貼著哪面牆（-1 左、1 右、0 無）；已經蹬過的牆 */ wall: -1 | 0 | 1; kicked: -1 | 0 | 1;
  /** 擁有的道具（伺服器載入）與裝備中的道具 */ items: Partial<Record<ItemId, number>>; equip: ItemId | null;
  charge: number; kameFight: string | null; slip: number;
  /** 本場用過的道具（結算時各扣 1 場） */ used: ItemId[];
}
export interface Part { u: string; pet: string; name: string; dmg: number; hits: number; taken: number; hp: number; out: boolean; forfeit: boolean; used?: ItemId[] }
export interface Fight { id: string; parts: Part[]; startTick: number; endTick: number }
export interface Proj { id: number; from: string; fightId: string | null; x: number; y: number; vx: number; vy: number }
export interface ArenaState { tick: number; fighters: Fighter[]; fights: Fight[]; params: ArenaParams; proj: Proj[]; projSeq: number }
export type FightEnd = { type: 'end'; fight: Fight; winner: string | null; losers: string[]; draw: boolean; reason: 'ko' | 'timeout' | 'forfeit' | 'cancel'; used: Record<string, ItemId[]> };
export type HitKind = 'peck' | 'up' | 'stomp' | 'sword' | 'beam' | 'poop';
export type ArenaEvent =
  | { type: 'start'; fight: Fight }
  | { type: 'hit'; fightId: string | null; from: string; to: string; kind: HitKind; damage: number; hp: number }
  | { type: 'ko'; fightId: string; user: string }
  | { type: 'refused'; from: string; to: string; reason: string }
  | FightEnd;
export interface ArenaHooks { canStart(users: string[]): string | null; newId(): string }

export function createArena(params: ArenaParams = ARENA_PARAMS): ArenaState { return { tick: 0, fighters: [], fights: [], params, proj: [], projSeq: 0 }; }

/** 加入（已存在則忽略）。x 由呼叫端決定（例如原本的跑道位置）。 */
export function addFighter(s: ArenaState, f: { userId: string; petId: string; species: string; name: string; x?: number; items?: Partial<Record<ItemId, number>> }) {
  if (s.fighters.some((g) => g.userId === f.userId)) return false;
  if (s.fighters.length >= s.params.maxFighters) return false;
  const P = s.params; const items = { ...(f.items ?? {}) };
  s.fighters.push({ userId: f.userId, petId: f.petId, species: f.species, name: f.name, x: clampX(P, f.x ?? (P.width - P.petW) / 2), y: P.ground - P.petH, vy: 0, kx: 0, dir: 1, onGround: true,
    left: false, right: false, jump: false, attack: false, upAtk: false, item: false, prevAttack: false, qAttack: false, qJump: false, qUp: false, qItem: false,
    cd: 0, upCd: 0, itemCd: 0, atk: 0, inv: 0, hp: P.hpMax, fightId: null, out: false, swing: null, swingN: 0, hitN: 0, hitDmg: 0, wall: 0, kicked: 0,
    items, equip: firstItem(items), charge: 0, kameFight: null, slip: 0, used: [] });
  s.fighters.sort((a, b) => (a.userId < b.userId ? -1 : 1)); // 決定性順序
  return true;
}
const firstItem = (items: Partial<Record<ItemId, number>>) => ITEM_IDS.find((i) => (items[i] ?? 0) > 0) ?? null;
/** 伺服器重新載入道具（買了新道具）。 */
export function setFighterItems(s: ArenaState, userId: string, items: Partial<Record<ItemId, number>>) {
  const f = byId(s, userId); if (!f) return;
  f.items = { ...items }; if (!f.equip || !(items[f.equip]! > 0)) f.equip = firstItem(items);
}
export function setArenaInput(s: ArenaState, userId: string, i: { left?: boolean; right?: boolean; jump?: boolean; attack?: boolean; upAtk?: boolean; item?: boolean; equip?: unknown }) {
  const f = s.fighters.find((g) => g.userId === userId); if (!f) return;
  if (i.attack && !f.attack) f.qAttack = true;
  if (i.upAtk && !f.upAtk) f.qUp = true;
  if (i.jump && !f.jump) f.qJump = true;
  if (i.item && !f.item) f.qItem = true;
  f.left = !!i.left; f.right = !!i.right; f.jump = !!i.jump; f.attack = !!i.attack; f.upAtk = !!i.upAtk; f.item = !!i.item;
  if (isItemId(i.equip) && (f.items[i.equip] ?? 0) > 0 && f.charge === 0) f.equip = i.equip;
}
const clampX = (P: ArenaParams, x: number) => Math.max(0, Math.min(P.width - P.petW, x));
const byId = (s: ArenaState, id: string) => s.fighters.find((f) => f.userId === id);
const partOf = (fight: Fight, u: string) => fight.parts.find((p) => p.u === u);

function endFight(s: ArenaState, fight: Fight, reason: FightEnd['reason']): FightEnd {
  for (const p of fight.parts) { const f = byId(s, p.u); if (f) p.hp = f.hp; }
  const standing = fight.parts.filter((p) => !p.out && !p.forfeit);
  let winner: string | null = null, draw = false;
  if (reason === 'cancel') draw = true;
  else if (standing.length === 1) winner = standing[0].u;
  else if (standing.length === 0) draw = true;
  else {
    const top = Math.max(...standing.map((p) => p.hp));
    const best = standing.filter((p) => p.hp === top);
    if (best.length === 1) winner = best[0].u; else draw = true;
  }
  const losers = winner ? fight.parts.filter((p) => p.u !== winner).map((p) => p.u) : [];
  const used: Record<string, ItemId[]> = {};
  s.fights = s.fights.filter((x) => x.id !== fight.id);
  s.proj = s.proj.filter((p) => p.fightId !== fight.id);
  for (const p of fight.parts) {
    const f = byId(s, p.u);
    if (f) { if (f.used.length) used[p.u] = [...f.used]; f.used = []; f.fightId = null; f.hp = s.params.hpMax; f.out = false; f.charge = 0; f.slip = 0; }
    else if (p.used?.length) used[p.u] = [...p.used];
  }
  return { type: 'end', fight, winner, losers, draw, reason, used };
}
function checkEnd(s: ArenaState, fight: Fight, why: 'ko' | 'forfeit' = 'ko'): FightEnd | null {
  const standing = fight.parts.filter((p) => !p.out && !p.forfeit);
  if (standing.length <= 1) return endFight(s, fight, why);
  if (s.tick >= fight.endTick) return endFight(s, fight, 'timeout');
  return null;
}
/** 離開／不再符合資格：進行中的對戰算這位輸（防止快輸時逃跑）；剩一隻時對戰結束。 */
export function removeFighter(s: ArenaState, userId: string): FightEnd | null {
  const f = byId(s, userId); if (!f) return null;
  const fight = f.fightId ? s.fights.find((x) => x.id === f.fightId) : undefined;
  if (fight) { const p = partOf(fight, userId)!; p.forfeit = true; p.hp = f.hp; p.used = [...f.used]; }
  s.fighters = s.fighters.filter((g) => g.userId !== userId);
  return fight ? checkEnd(s, fight, 'forfeit') : null;
}
/** 關門／重啟：取消所有對戰，不分勝負。 */
export function cancelFights(s: ArenaState): FightEnd[] { return [...s.fights].map((f) => endFight(s, f, 'cancel')); }

/** v1.6 邀請制：用指定的參賽者（發起人＋接受者）開打；回傳 null = 人數不足或有人不在場／已在對戰。 */
export function startFightWith(s: ArenaState, users: string[], id: string): Fight | null {
  const P = s.params;
  const all = [...new Set(users)].map((u) => byId(s, u)).filter((x): x is Fighter => !!x && !x.fightId);
  if (all.length < 2 || s.fights.length) return null;
  all.sort((a, b) => (a.userId < b.userId ? -1 : 1));
  const fight: Fight = { id, startTick: s.tick, endTick: s.tick + P.fightTicks,
    parts: all.map((x) => ({ u: x.userId, pet: x.petId, name: x.name, dmg: 0, hits: 0, taken: 0, hp: P.hpMax, out: false, forfeit: false })) };
  s.fights.push(fight);
  for (const x of all) { x.fightId = fight.id; x.hp = P.hpMax; x.inv = 0; x.out = false; x.used = []; x.kameFight = null; }
  return fight;
}
const DMG: Record<HitKind, keyof ArenaParams> = { peck: 'peckDamage', up: 'upPeckDamage', stomp: 'stompDamage', sword: 'swordDamage', beam: 'kameDamage', poop: 'poopDamage' };
/** 命中：沒有對戰時開打（場上所有寵物一起），對戰中只有同一場、還沒被 KO 的才算。回傳是否真的造成傷害。 */
function hit(s: ArenaState, f: Fighter, g: Fighter, kind: HitKind, hooks: ArenaHooks, ev: ArenaEvent[], dir?: number): boolean {
  const P = s.params;
  if (g.inv > 0 || g.out || f.out) return false;
  // v1.6：只有同一場對戰中的寵物互打才算；對戰外的攻擊一律無效（改成邀請制開打）
  if (!f.fightId || f.fightId !== g.fightId) return false;
  const fight = s.fights.find((x) => x.id === g.fightId)!;
  const dmg = P[DMG[kind]] as number;
  g.hp = Math.max(0, g.hp - dmg); g.inv = P.hitInvulnTicks; g.hitN++; g.hitDmg = dmg;
  const d = dir ?? (kind === 'stomp' ? (g.x >= f.x ? 1 : -1) : f.dir);
  g.kx = d * P.knockback; g.vy = P.knockUp; g.onGround = false; g.charge = 0;
  if (kind === 'poop') { g.slip = P.slipTicks; g.kx = d * P.slipKx; }
  const pf = partOf(fight, f.userId), pg = partOf(fight, g.userId);
  if (pf) { pf.dmg += dmg; pf.hits++; }
  if (pg) { pg.taken++; pg.hp = g.hp; }
  ev.push({ type: 'hit', fightId: g.fightId, from: f.userId, to: g.userId, kind, damage: dmg, hp: g.hp });
  if (g.hp <= 0) { g.out = true; if (pg) pg.out = true; g.inv = 0; ev.push({ type: 'ko', fightId: fight.id, user: g.userId }); }
  return true;
}
const canHitTarget = (f: Fighter, g: Fighter) => g !== f && !g.out && !!f.fightId && g.fightId === f.fightId;
/** 面向方向 range 內（貼身 + range）最近的一隻。 */
function nearestInFront(s: ArenaState, f: Fighter, range: number): Fighter | null {
  const P = s.params; let best: Fighter | null = null, bd = Infinity;
  for (const g of s.fighters) {
    if (!canHitTarget(f, g)) continue;
    const dx = (g.x - f.x) * f.dir;
    if (dx <= -2 || dx > P.petW + range || Math.abs(g.y - f.y) >= P.petH) continue;
    if (dx < bd) { bd = dx; best = g; }
  }
  return best;
}
function useItem(f: Fighter, id: ItemId) { if (!f.used.includes(id)) f.used.push(id); }
/** 龜派氣功每場一次（對戰外可以練習）。 */
const kameOk = (f: Fighter) => f.fightId === null || f.kameFight !== f.fightId;
const has = (f: Fighter, id: ItemId) => (f.items[id] ?? 0) > 0;

export function stepArena(s: ArenaState, hooks: ArenaHooks): ArenaEvent[] {
  const P = s.params, ev: ArenaEvent[] = [], floorY = P.ground - P.petH, maxX = P.width - P.petW;
  s.tick++;
  for (const f of s.fighters) {
    if (f.cd > 0) f.cd--; if (f.upCd > 0) f.upCd--; if (f.itemCd > 0) f.itemCd--; if (f.atk > 0) f.atk--; if (f.inv > 0) f.inv--; if (f.slip > 0) f.slip--;
    if (f.out) { f.qAttack = f.qJump = f.qUp = f.qItem = false; f.charge = 0; f.kx *= P.knockDecay; continue; }
    const charging = f.charge > 0 || ((f.item || f.qItem) && f.equip === 'kame' && has(f, 'kame') && kameOk(f));
    const mv = charging || f.slip > 0 ? 0 : (f.right ? 1 : 0) - (f.left ? 1 : 0);
    if (mv) f.dir = mv > 0 ? 1 : -1;
    f.x = clampX(P, f.x + mv * P.moveSpeed + f.kx);
    f.kx = Math.abs(f.kx) < 0.05 ? 0 : f.kx * (f.slip > 0 ? P.slipDecay : P.knockDecay);
    // 貼牆（空中、往牆的方向或剛好碰到）
    const touch: -1 | 0 | 1 = f.onGround ? 0 : f.x <= 0 ? -1 : f.x >= maxX ? 1 : 0;
    if (touch && touch !== f.wall && f.kicked && f.kicked !== touch) f.kicked = 0; // 碰到另一面牆 → 重置
    f.wall = touch;
    if (!charging) {
      if (f.qJump && f.wall && f.kicked !== f.wall) { // 蹬牆跳：往牆的反方向
        f.vy = P.wallKickVy; f.kx = -f.wall * P.wallKickVx; f.dir = (-f.wall) as 1 | -1; f.kicked = f.wall; f.wall = 0;
      } else if ((f.jump || f.qJump) && f.onGround && !f.qUp && !f.upAtk) { f.vy = P.jumpVy; f.onGround = false; }
    }
    f.qJump = false;
  }
  // 垂直移動 + 踩頭 + 牆滑
  for (const f of s.fighters) {
    const prevBottom = f.y + P.petH;
    f.vy = Math.min(P.maxFall, f.vy + P.gravity);
    if (f.wall && f.vy > P.wallSlideMaxFall) f.vy = P.wallSlideMaxFall;
    f.y += f.vy;
    if (f.y >= floorY) { f.y = floorY; f.vy = 0; if (!f.onGround) { f.kicked = 0; f.wall = 0; } f.onGround = true; }
    if (f.out) continue;
    if (prevBottom < f.y + P.petH && f.vy >= 0) {
      for (const g of s.fighters) {
        if (g === f || g.out || !f.fightId || g.fightId !== f.fightId || Math.abs(f.x - g.x) >= P.petW - 2) continue;
        const top = g.y;
        if (prevBottom <= top + 1 && f.y + P.petH >= top) { f.y = top - P.petH; f.vy = P.stompBounceVy; f.onGround = false; hit(s, f, g, 'stomp', hooks, ev); break; }
      }
    }
  }
  // 攻擊：按下的瞬間觸發
  for (const f of s.fighters) {
    const up = f.qUp || (f.qAttack && f.jump); const pressed = f.qAttack; const item = f.qItem;
    f.qAttack = false; f.qUp = false; f.qItem = false; f.prevAttack = f.attack;
    if (f.out) continue;
    if (up) {
      if (f.upCd > 0) continue;
      // 上啄：一定會跳（在空中則小跳），只打頭頂正上方（沒有前方距離）——空中的寵物很脆弱
      f.upCd = P.upPeckCooldownTicks; f.atk = P.attackAnimTicks; f.swing = 'up'; f.swingN++;
      if (f.onGround) { f.vy = P.jumpVy; f.onGround = false; } else f.vy = Math.min(f.vy, P.airHopVy);
      const head = f.y;
      let best: Fighter | null = null, bd = Infinity;
      for (const g of s.fighters) {
        if (!canHitTarget(f, g) || Math.abs(g.x - f.x) >= P.petW) continue;
        const bottom = g.y + P.petH;
        if (bottom > head + 3 || bottom < head - P.upPeckReach) continue;
        const d = head - bottom; if (d < bd) { bd = d; best = g; }
      }
      if (best) hit(s, f, best, 'up', hooks, ev, best.x >= f.x ? 1 : -1);
      continue;
    }
    if (pressed && f.cd <= 0 && f.charge === 0) {
      f.cd = P.attackCooldownTicks; f.atk = P.attackAnimTicks; f.swing = 'peck'; f.swingN++;
      const g = nearestInFront(s, f, P.peckRange); if (g) hit(s, f, g, 'peck', hooks, ev);
    }
    // 道具
    const eq = f.equip && has(f, f.equip) ? f.equip : null;
    if (eq === 'kame') {
      const usable = kameOk(f);
      if (f.item && usable && (f.charge > 0 || item)) {
        f.charge++;
        if (f.charge >= P.kameChargeTicks) {
          f.charge = 0; f.atk = P.kameBeamTicks; f.swing = 'beam'; f.swingN++;
          const targets = s.fighters.filter((g) => canHitTarget(f, g) && (g.x - f.x) * f.dir > 0 && Math.abs(g.y - f.y) < P.petH);
          for (const g of targets) hit(s, f, g, 'beam', hooks, ev);
          if (f.fightId) { useItem(f, 'kame'); f.kameFight = f.fightId; }
        }
      } else f.charge = 0;
    } else if (item && eq && f.itemCd <= 0) {
      if (eq === 'sword') {
        f.itemCd = P.swordCooldownTicks; f.atk = P.swordAnimTicks; f.swing = 'sword'; f.swingN++;
        const g = nearestInFront(s, f, P.swordRange - P.petW); if (g) hit(s, f, g, 'sword', hooks, ev);
        if (f.fightId) useItem(f, 'sword');
      } else if (eq === 'poop') { // 擁有就能無限丟（只受 0.5 秒冷卻限制），和地上的便便無關
        f.itemCd = P.poopCooldownTicks; f.atk = P.attackAnimTicks; f.swing = 'throw'; f.swingN++;
        s.proj.push({ id: ++s.projSeq, from: f.userId, fightId: f.fightId, x: f.x + P.petW / 2 + f.dir * 6, y: f.y + 2, vx: f.dir * P.poopVx, vy: P.poopVy });
        if (f.fightId) useItem(f, 'poop');
      }
    }
  }
  // 便便飛行（受重力影響）
  for (const p of [...s.proj]) {
    p.vy = Math.min(P.maxFall, p.vy + P.gravity); p.x += p.vx; p.y += p.vy;
    const thrower = byId(s, p.from);
    let done = p.y >= P.ground - 2 || p.x < 0 || p.x > P.width;
    if (!done && thrower) for (const g of s.fighters) {
      if (!canHitTarget(thrower, g) || g.inv > 0) continue;
      if (p.x >= g.x - 2 && p.x <= g.x + P.petW + 2 && p.y >= g.y - 4 && p.y <= g.y + P.petH) {
        hit(s, thrower, g, 'poop', hooks, ev, p.vx > 0 ? 1 : -1);
        if (thrower.fightId) useItem(thrower, 'poop');
        done = true; break;
      }
    }
    if (done || !thrower) s.proj = s.proj.filter((x) => x !== p);
  }
  for (const fight of [...s.fights]) { const e = checkEnd(s, fight); if (e) ev.push(e); }
  return ev;
}
/** 每個輸家付 min(上限, 自己的餘額) 給贏家。 */
export function fightTransfer(loserBalance: number, cap = 20) { return Math.max(0, Math.min(cap, Math.floor(loserBalance))); }
/** 多輸家結算：回傳每人的金幣變化（贏家 = 所有輸家付出的總和）。平手全部 0。 */
export function meleeTransfers(e: { winner: string | null; losers: string[] }, balances: Record<string, number>, cap = 20): Record<string, number> {
  const out: Record<string, number> = {};
  if (!e.winner) return out;
  let sum = 0;
  for (const l of e.losers) { const a = fightTransfer(balances[l] ?? 0, cap); out[l] = -a; sum += a; }
  out[e.winner] = sum;
  return out;
}
/** 對戰前提：寵物活著、醒著、沒生病。 */
export function canFightPet(p: { status: string; sleeping: boolean; sick: boolean } | null | undefined) { return !!p && p.status === 'alive' && !p.sleeping && !p.sick; }

/** v1.6 系統獎金池：依攻擊分數（造成的總傷害）比例分配，整數、最大餘數法，總和剛好 = pool；全部 0 分則沒人拿。 */
export function poolShares(scores: Record<string, number>, pool = ARENA_PARAMS.bonusPool): Record<string, number> {
  const ids = Object.keys(scores).sort();
  const total = ids.reduce((t, u) => t + Math.max(0, scores[u]), 0);
  const out: Record<string, number> = {};
  if (total <= 0 || pool <= 0) { for (const u of ids) out[u] = 0; return out; }
  const rem: [string, number][] = [];
  let given = 0;
  for (const u of ids) { const exact = (Math.max(0, scores[u]) * pool) / total; out[u] = Math.floor(exact); given += out[u]; rem.push([u, exact - out[u]]); }
  rem.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)); // 餘數大的先；同餘數依 id（決定性）
  for (let i = 0; given < pool; i++, given++) out[rem[i % rem.length][0]]++;
  return out;
}
/** v1.6 邀請：發起人＋被邀請者（其他合格寵物的主人），10 秒內回覆「參戰／觀戰」，沒回覆＝觀戰。 */
export interface Invite { id: string; from: string; to: string[]; accepted: string[]; declined: string[]; deadline: number }
export function createInvite(id: string, from: string, others: string[], now: number, ms = ARENA_PARAMS.inviteMs): Invite {
  return { id, from, to: [...new Set(others)].filter((u) => u !== from).sort(), accepted: [], declined: [], deadline: now + ms };
}
export function replyInvite(inv: Invite, user: string, accept: boolean): boolean {
  if (!inv.to.includes(user) || inv.accepted.includes(user) || inv.declined.includes(user)) return false;
  (accept ? inv.accepted : inv.declined).push(user); return true;
}
/** 全部回覆或時間到 → 結束；參賽者 = 發起人＋接受者（至少 2 隻，否則取消）。 */
export function inviteOutcome(inv: Invite, now: number): { done: false } | { done: true; participants: string[] | null } {
  const answered = inv.accepted.length + inv.declined.length >= inv.to.length;
  if (!answered && now < inv.deadline) return { done: false };
  const parts = [inv.from, ...inv.accepted].sort();
  return { done: true, participants: parts.length >= 2 ? parts : null };
}
