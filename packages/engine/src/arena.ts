// v1.4 打架模式：家裡畫面的伺服器權威模擬（決定性、無亂數）。tick 頻率與下樓梯相同。
export const ARENA_PARAMS = {
  tickRate: 30, snapshotEvery: 3,
  width: 120, ground: 86, top: 14,
  petW: 12, petH: 12,
  moveSpeed: 1.2, gravity: 0.25, jumpVy: -3.6, maxFall: 3.5, stompBounceVy: -2.6,
  hpMax: 100, peckRange: 6, peckDamage: 10, stompDamage: 15,
  knockback: 3, knockUp: -1.6, knockDecay: 0.8,
  attackCooldownTicks: 15, attackAnimTicks: 6, hitInvulnTicks: 10,
  fightTicks: 30 * 60, pairCooldownMs: 60_000, maxFighters: 8,
};
export type ArenaParams = typeof ARENA_PARAMS;
export interface Fighter {
  userId: string; petId: string; species: string; name: string;
  x: number; y: number; vy: number; kx: number; dir: 1 | -1; onGround: boolean;
  left: boolean; right: boolean; jump: boolean; attack: boolean; prevAttack: boolean;
  /** 快速點按（按下又放開都在同一 tick 內）也要算：按下時先記起來，下個 tick 消耗 */ qAttack: boolean; qJump: boolean;
  cd: number; atk: number; inv: number; hp: number; fightId: string | null;
}
export interface Fight { id: string; a: string; b: string; startTick: number; endTick: number }
export interface ArenaState { tick: number; fighters: Fighter[]; fights: Fight[]; params: ArenaParams }
export type FightEnd = { type: 'end'; fight: Fight; winner: string | null; loser: string | null; hpA: number; hpB: number; reason: 'ko' | 'timeout' | 'forfeit' | 'cancel' };
export type ArenaEvent =
  | { type: 'start'; fight: Fight }
  | { type: 'hit'; fightId: string | null; from: string; to: string; kind: 'peck' | 'stomp'; damage: number; hp: number }
  | { type: 'refused'; from: string; to: string; reason: string }
  | FightEnd;
export interface ArenaHooks { canStart(a: string, b: string): string | null; newId(): string }

export function createArena(params: ArenaParams = ARENA_PARAMS): ArenaState { return { tick: 0, fighters: [], fights: [], params }; }

/** 加入（已存在則忽略）。x 由呼叫端決定（例如原本的跑道位置）。 */
export function addFighter(s: ArenaState, f: { userId: string; petId: string; species: string; name: string; x?: number }) {
  if (s.fighters.some((g) => g.userId === f.userId)) return false;
  if (s.fighters.length >= s.params.maxFighters) return false;
  const P = s.params;
  s.fighters.push({ ...f, x: clampX(P, f.x ?? (P.width - P.petW) / 2), y: P.ground - P.petH, vy: 0, kx: 0, dir: 1, onGround: true,
    left: false, right: false, jump: false, attack: false, prevAttack: false, qAttack: false, qJump: false, cd: 0, atk: 0, inv: 0, hp: P.hpMax, fightId: null });
  s.fighters.sort((a, b) => (a.userId < b.userId ? -1 : 1)); // 決定性順序
  return true;
}
export function setArenaInput(s: ArenaState, userId: string, i: { left?: boolean; right?: boolean; jump?: boolean; attack?: boolean }) {
  const f = s.fighters.find((g) => g.userId === userId); if (!f) return;
  if (i.attack && !f.attack) f.qAttack = true;
  if (i.jump && !f.jump) f.qJump = true;
  f.left = !!i.left; f.right = !!i.right; f.jump = !!i.jump; f.attack = !!i.attack;
}
const clampX = (P: ArenaParams, x: number) => Math.max(0, Math.min(P.width - P.petW, x));
const byId = (s: ArenaState, id: string) => s.fighters.find((f) => f.userId === id);

function endFight(s: ArenaState, fight: Fight, reason: FightEnd['reason'], forcedLoser?: string): FightEnd {
  const a = byId(s, fight.a), b = byId(s, fight.b);
  const hpA = a?.hp ?? 0, hpB = b?.hp ?? 0;
  let winner: string | null = null, loser: string | null = null;
  if (reason === 'cancel') { /* 不分勝負 */ }
  else if (forcedLoser) { loser = forcedLoser; winner = forcedLoser === fight.a ? fight.b : fight.a; }
  else if (hpA !== hpB) { winner = hpA > hpB ? fight.a : fight.b; loser = winner === fight.a ? fight.b : fight.a; }
  s.fights = s.fights.filter((x) => x.id !== fight.id);
  for (const f of [a, b]) if (f) { f.fightId = null; f.hp = s.params.hpMax; }
  return { type: 'end', fight, winner, loser, hpA, hpB, reason };
}
/** 離開／不再符合資格：進行中的對戰算這位輸（防止快輸時逃跑）。 */
export function removeFighter(s: ArenaState, userId: string): FightEnd | null {
  const f = byId(s, userId); if (!f) return null;
  const fight = f.fightId ? s.fights.find((x) => x.id === f.fightId) : undefined;
  const ev = fight ? endFight(s, fight, 'forfeit', userId) : null;
  s.fighters = s.fighters.filter((g) => g.userId !== userId);
  return ev;
}
/** 關門／重啟：取消所有對戰，不分勝負。 */
export function cancelFights(s: ArenaState): FightEnd[] { return [...s.fights].map((f) => endFight(s, f, 'cancel')); }

function hit(s: ArenaState, f: Fighter, g: Fighter, kind: 'peck' | 'stomp', hooks: ArenaHooks, ev: ArenaEvent[]) {
  const P = s.params;
  if (g.inv > 0) return;
  if (f.fightId || g.fightId) {
    if (f.fightId !== g.fightId) return; // 第三者：完全忽略
  } else {
    const why = hooks.canStart(f.userId, g.userId);
    if (why) { ev.push({ type: 'refused', from: f.userId, to: g.userId, reason: why }); return; }
    const fight: Fight = { id: hooks.newId(), a: f.userId, b: g.userId, startTick: s.tick, endTick: s.tick + P.fightTicks };
    s.fights.push(fight); f.fightId = g.fightId = fight.id; f.hp = g.hp = P.hpMax;
    ev.push({ type: 'start', fight });
  }
  const dmg = kind === 'stomp' ? P.stompDamage : P.peckDamage;
  g.hp = Math.max(0, g.hp - dmg); g.inv = P.hitInvulnTicks;
  const dir = kind === 'stomp' ? (g.x >= f.x ? 1 : -1) : f.dir;
  g.kx = dir * P.knockback; g.vy = P.knockUp; g.onGround = false;
  ev.push({ type: 'hit', fightId: g.fightId, from: f.userId, to: g.userId, kind, damage: dmg, hp: g.hp });
}

export function stepArena(s: ArenaState, hooks: ArenaHooks): ArenaEvent[] {
  const P = s.params, ev: ArenaEvent[] = [], floorY = P.ground - P.petH;
  s.tick++;
  for (const f of s.fighters) {
    if (f.cd > 0) f.cd--; if (f.atk > 0) f.atk--; if (f.inv > 0) f.inv--;
    const mv = (f.right ? 1 : 0) - (f.left ? 1 : 0);
    if (mv) f.dir = mv > 0 ? 1 : -1;
    f.x = clampX(P, f.x + mv * P.moveSpeed + f.kx);
    f.kx = Math.abs(f.kx) < 0.05 ? 0 : f.kx * P.knockDecay;
    if ((f.jump || f.qJump) && f.onGround) { f.vy = P.jumpVy; f.onGround = false; }
    f.qJump = false;
  }
  // 垂直移動 + 踩頭
  for (const f of s.fighters) {
    const prevBottom = f.y + P.petH;
    f.vy = Math.min(P.maxFall, f.vy + P.gravity); f.y += f.vy;
    if (f.y >= floorY) { f.y = floorY; f.vy = 0; f.onGround = true; }
    if (prevBottom < f.y + P.petH && f.vy >= 0) {
      for (const g of s.fighters) {
        if (g === f || Math.abs(f.x - g.x) >= P.petW - 2) continue;
        const top = g.y;
        if (prevBottom <= top + 1 && f.y + P.petH >= top) { f.y = top - P.petH; f.vy = P.stompBounceVy; f.onGround = false; hit(s, f, g, 'stomp', hooks, ev); break; }
      }
    }
  }
  // 啄：按下的瞬間觸發，面向方向短距離內最近的一隻
  for (const f of s.fighters) {
    const pressed = f.qAttack; f.qAttack = false; f.prevAttack = f.attack;
    if (!pressed || f.cd > 0) continue;
    f.cd = P.attackCooldownTicks; f.atk = P.attackAnimTicks;
    let best: Fighter | null = null, bd = Infinity;
    for (const g of s.fighters) {
      if (g === f) continue;
      const dx = (g.x - f.x) * f.dir;
      if (dx <= -2 || dx > P.petW + P.peckRange || Math.abs(g.y - f.y) >= P.petH) continue;
      if (dx < bd) { bd = dx; best = g; }
    }
    if (best) hit(s, f, best, 'peck', hooks, ev);
  }
  for (const fight of [...s.fights]) {
    const a = byId(s, fight.a), b = byId(s, fight.b);
    if (!a || !b) continue;
    if (a.hp <= 0 || b.hp <= 0) ev.push(endFight(s, fight, 'ko'));
    else if (s.tick >= fight.endTick) ev.push(endFight(s, fight, 'timeout'));
  }
  return ev;
}
/** 對戰勝方拿走 min(上限, 輸家餘額)。 */
export function fightTransfer(loserBalance: number, cap = 20) { return Math.max(0, Math.min(cap, Math.floor(loserBalance))); }
/** 對戰前提：寵物活著、醒著、沒生病。 */
export function canFightPet(p: { status: string; sleeping: boolean; sick: boolean } | null | undefined) { return !!p && p.status === 'alive' && !p.sleeping && !p.sick; }
