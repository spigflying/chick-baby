import { describe, expect, it } from 'vitest';
import { ARENA_PARAMS as P, startFightWith, poolShares, createInvite, replyInvite, inviteOutcome, addFighter, cancelFights, canFightPet, createArena, fightTransfer, meleeTransfers, removeFighter, setArenaInput, stepArena, type ArenaEvent, type ArenaState } from '../src';

let n = 0;
const hooks = (why: string | null = null) => ({ canStart: () => why, newId: () => `f${++n}` });
const FLOOR = P.ground - P.petH;
/** v1.6：預設所有人已經接受邀請、對戰進行中（noFight = 對戰外）。 */
function arena(xs: number[] = [40, 54], items: any = {}, noFight = false) {
  const s = createArena();
  xs.forEach((x, i) => addFighter(s, { userId: 'abcdefgh'[i], petId: 'p' + i, species: 'chicken', name: 'N' + i, x, items: items['abcdefgh'[i]] }));
  if (!noFight) startFightWith(s, s.fighters.map((f) => f.userId), `f${++n}`);
  return s;
}
const F = (s: ArenaState, u: string) => s.fighters.find((f) => f.userId === u)!;
const run = (s: ArenaState, k: number, h = hooks()) => { const out: ArenaEvent[] = []; for (let i = 0; i < k; i++) out.push(...stepArena(s, h)); return out; };
const tap = (s: ArenaState, u: string, i: any, h = hooks()) => { setArenaInput(s, u, i); const e = stepArena(s, h); setArenaInput(s, u, {}); return e; };
const peck = (s: ArenaState, u: string, h = hooks()) => tap(s, u, { attack: true }, h);
const reset = (s: ArenaState, u: string, patch: any = {}) => Object.assign(F(s, u), { inv: 0, kx: 0, vy: 0, y: FLOOR, onGround: true, cd: 0, upCd: 0, itemCd: 0 }, patch);

describe('arena v2: attacks', () => {
  it('peck reaches ~14px in front (was 6), 10 dmg, more knockback', () => {
    const s = arena([40, 40 + P.petW + 13]); F(s, 'a').dir = 1;
    const e = peck(s, 'a');
    expect(e.map((x) => x.type)).toEqual(['hit']);
    expect(F(s, 'b').hp).toBe(100 - P.peckDamage);
    expect(F(s, 'b').kx).toBeGreaterThan(3);
    expect(P.peckRange).toBe(14); expect(P.hitInvulnTicks).toBe(15); expect(P.attackCooldownTicks).toBe(15);
    const t = arena([40, 40 + P.petW + 16]); F(t, 'a').dir = 1; expect(peck(t, 'a')).toEqual([]);
    expect(F(t, 'a').swingN).toBe(1); // 揮空也有揮擊（畫面畫弧線）
  });
  it('peck cooldown 0.5s; invulnerability 0.5s', () => {
    const s = arena([40, 54]); F(s, 'a').dir = 1; peck(s, 'a');
    reset(s, 'b', { x: 54, inv: F(s, 'b').inv }); F(s, 'a').cd = 0;
    expect(peck(s, 'a').filter((e) => e.type === 'hit')).toHaveLength(0); // 還在無敵
    run(s, P.hitInvulnTicks); reset(s, 'b', { x: 54 });
    expect(peck(s, 'a').filter((e) => e.type === 'hit')).toHaveLength(1);
    reset(s, 'b', { x: 54 }); expect(F(s, 'a').cd).toBeGreaterThan(0);
    expect(peck(s, 'a').filter((e) => e.type === 'hit')).toHaveLength(0); // 冷卻中
  });
  it('up-peck always jumps, hits only directly above the head, 0.8s cooldown', () => {
    const s = arena([40, 54]); F(s, 'a').dir = 1;
    const e = tap(s, 'a', { upAtk: true });
    expect(e.filter((x) => x.type === 'hit')).toHaveLength(0); // 前方的不打
    expect(F(s, 'a').onGround).toBe(false); expect(F(s, 'a').vy).toBeLessThan(0);
    expect(F(s, 'a').upCd).toBe(P.upPeckCooldownTicks - 0);
    // 目標在頭上（例如正在跳）
    const t = arena([40, 41]); reset(t, 'b', { y: FLOOR - P.petH - 4, onGround: false, vy: -0.5 });
    const h = tap(t, 'a', { upAtk: true }).find((x) => x.type === 'hit') as any;
    expect(h).toMatchObject({ from: 'a', to: 'b', kind: 'up', damage: P.upPeckDamage });
    // ↑ 按住 + 空白 也是上啄
    const u = arena([40, 41]); reset(u, 'b', { y: FLOOR - P.petH - 4, onGround: false, vy: -0.5 });
    expect((tap(u, 'a', { jump: true, attack: true }).find((x) => x.type === 'hit') as any)?.kind).toBe('up');
    expect(P.upPeckCooldownTicks).toBe(24);
  });
  it('stomp does 12', () => {
    const s = arena([40, 40]);
    Object.assign(F(s, 'a'), { y: FLOOR - P.petH - 6, onGround: false, vy: 2 });
    const h = run(s, 6).find((x) => x.type === 'hit') as any;
    expect(h).toMatchObject({ kind: 'stomp', damage: 12 });
  });
});

describe('arena v2: wall jump', () => {
  it('wall slide slows the fall; jump kicks away once per contact; resets on landing / other wall', () => {
    const s = arena([0, 100]); const a = F(s, 'a');
    Object.assign(a, { x: 0, y: 30, onGround: false, vy: 3 });
    setArenaInput(s, 'a', { left: true }); run(s, 1);
    expect(a.vy).toBeLessThanOrEqual(P.wallSlideMaxFall);
    expect(a.wall).toBe(-1);
    setArenaInput(s, 'a', { left: true, jump: true }); run(s, 1); setArenaInput(s, 'a', { left: false });
    expect(a.vy).toBeLessThan(0); expect(a.kx).toBeGreaterThan(0); expect(a.dir).toBe(1); expect(a.kicked).toBe(-1);
    // 回到同一面牆：不能再蹬
    Object.assign(a, { x: 0, vy: 1, kx: 0 }); setArenaInput(s, 'a', { left: true }); run(s, 1);
    setArenaInput(s, 'a', { left: true, jump: true }); run(s, 1);
    expect(a.vy).toBeGreaterThan(0);
    // 碰到另一面牆 → 可以蹬
    setArenaInput(s, 'a', {}); Object.assign(a, { x: P.width - P.petW, vy: 1, kx: 0 }); run(s, 1);
    setArenaInput(s, 'a', { jump: true }); run(s, 1); setArenaInput(s, 'a', {});
    expect(a.vy).toBeLessThan(0); expect(a.kx).toBeLessThan(0);
    // 落地重置
    run(s, 80); expect(a.onGround).toBe(true); expect(a.kicked).toBe(0);
  });
  it('no wall kick on the ground', () => {
    const s = arena([0, 100]); setArenaInput(s, 'a', { left: true, jump: true }); run(s, 1);
    expect(F(s, 'a').kx).toBe(0);
  });
});

describe('arena v2: items', () => {
  it('sword: ~42px reach, 12 dmg, 0.7s cooldown, counted as used', () => {
    const s = arena([20, 20 + 40], { a: { sword: 3 } }); F(s, 'a').dir = 1;
    expect(F(s, 'a').equip).toBe('sword');
    const h = tap(s, 'a', { item: true }).find((x) => x.type === 'hit') as any;
    expect(h).toMatchObject({ kind: 'sword', damage: 12 });
    expect(F(s, 'a').itemCd).toBe(P.swordCooldownTicks); expect(F(s, 'a').used).toEqual(['sword']);
    const t = arena([20, 20 + 46], { a: { sword: 3 } }); F(t, 'a').dir = 1; expect(tap(t, 'a', { item: true })).toEqual([]);
    const u = arena([20, 60]); expect(tap(u, 'a', { item: true })).toEqual([]); // 沒有道具
  });
  it('kamehameha: 1s charge (frozen), beam across the arena, 30 dmg, once per fight', () => {
    const s = arena([10, 30, 100], { a: { kame: 5 } }); F(s, 'a').dir = 1;
    setArenaInput(s, 'a', { item: true, right: true });
    const e = run(s, P.kameChargeTicks - 1);
    expect(e).toEqual([]); expect(F(s, 'a').x).toBe(10); expect(F(s, 'a').charge).toBe(P.kameChargeTicks - 1);
    const hits = run(s, 1).filter((x) => x.type === 'hit') as any[];
    expect(hits.map((h) => [h.to, h.damage])).toEqual([['b', 30], ['c', 30]]);
    expect(F(s, 'a').used).toEqual(['kame']);
    setArenaInput(s, 'a', {}); run(s, 2); reset(s, 'b'); reset(s, 'c');
    setArenaInput(s, 'a', { item: true }); expect(run(s, P.kameChargeTicks + 2).filter((x) => x.type === 'hit')).toHaveLength(0);
    // 放開就取消蓄力
    const t = arena([10, 30], { a: { kame: 1 } }); setArenaInput(t, 'a', { item: true }); run(t, 10); setArenaInput(t, 'a', {}); run(t, 1); expect(F(t, 'a').charge).toBe(0);
  });
  it('poop: arc projectile, 8 dmg, slip; unlimited throws in a fight, limited only by the 0.5s cooldown', () => {
    const s = arena([10, 40], { a: { poop: 2 } }); F(s, 'a').dir = 1;
    tap(s, 'a', { item: true });
    expect(s.proj).toHaveLength(1);
    const ys: number[] = []; let hit: any;
    for (let i = 0; i < 40 && !hit; i++) { hit = stepArena(s, hooks()).find((x) => x.type === 'hit'); if (s.proj[0]) ys.push(s.proj[0].y); }
    expect(Math.min(...ys)).toBeLessThan(ys[0]); // 先往上再落下（拋物線）
    expect(hit).toMatchObject({ kind: 'poop', damage: 8, to: 'b' });
    expect(F(s, 'b').slip).toBeGreaterThan(0);
    // 不需要彈藥：連丟很多次；冷卻 15 tick（0.5 秒）內按不出來
    const t = arena([10, 100], { a: { poop: 1 } }); F(t, 'a').dir = -1; let n = 0;
    for (let k = 0; k < 12; k++) {
      const sn = F(t, 'a').swingN;
      tap(t, 'a', { item: true }); expect(F(t, 'a').swingN).toBe(sn + 1); n++; // 丟出去了
      tap(t, 'a', { item: true }); expect(F(t, 'a').swingN).toBe(sn + 1); // 冷卻中
      run(t, P.poopCooldownTicks);
    }
    expect(n).toBe(12);
    expect(F(t, 'a').used.filter((x) => x === 'poop')).toEqual(['poop']); // 每場只扣一次
    expect(P.poopCooldownTicks).toBe(15);
  });
  it('poop needs the item: no throw without owning it', () => {
    const s = arena([10, 40]); F(s, 'a').equip = 'poop' as any; tap(s, 'a', { item: true }); expect(s.proj).toHaveLength(0);
  });
  it('X cycles only to owned items', () => {
    const s = arena([10, 40], { a: { sword: 1, poop: 1 } });
    setArenaInput(s, 'a', { equip: 'poop' }); expect(F(s, 'a').equip).toBe('poop');
    setArenaInput(s, 'a', { equip: 'kame' }); expect(F(s, 'a').equip).toBe('poop');
  });
});

describe('arena v2: melee', () => {
  it('accepted pets fight together; KO\'d pets spectate; last standing wins', () => {
    const s = arena([40, 54, 90]); F(s, 'a').dir = 1;
    peck(s, 'a'); const st = { fight: s.fights[0] };
    expect(st.fight.parts.map((p: any) => p.u)).toEqual(['a', 'b', 'c']);
    expect(s.fighters.every((f) => f.fightId === st.fight.id)).toBe(true);
    // c 被 KO
    reset(s, 'c', { hp: 5, x: 66 }); reset(s, 'b', { x: 20 }); F(s, 'a').dir = 1; F(s, 'a').cd = 0; F(s, 'a').x = 50;
    const k = peck(s, 'a'); expect(k.some((x) => x.type === 'ko')).toBe(true);
    expect(F(s, 'c').out).toBe(true);
    // 觀戰中不能被打、不能動
    F(s, 'a').cd = 0; reset(s, 'c', { x: 66, out: true }); expect(peck(s, 'a').filter((x) => x.type === 'hit')).toHaveLength(0);
    reset(s, 'b', { hp: 5, x: 66 }); F(s, 'a').cd = 0;
    const end = peck(s, 'a').find((x) => x.type === 'end') as any;
    expect(end).toMatchObject({ winner: 'a', reason: 'ko', draw: false });
    expect(end.losers.sort()).toEqual(['b', 'c']);
    expect(end.fight.parts.find((p: any) => p.u === 'a')).toMatchObject({ hits: 3, dmg: 30 });
    expect(end.fight.parts.find((p: any) => p.u === 'b')).toMatchObject({ taken: 2, hp: 0 });
    expect(s.fighters.every((f) => f.hp === 100 && !f.out && !f.fightId)).toBe(true);
  });
  it('timeout: highest HP wins; a tie for the top is a draw', () => {
    const s = arena([40, 54, 90]); F(s, 'a').dir = 1; peck(s, 'a');
    F(s, 'c').hp = 90; // b 90, c 90, a 100
    const e = run(s, P.fightTicks).find((x) => x.type === 'end') as any;
    expect(e).toMatchObject({ winner: 'a', reason: 'timeout' }); expect(e.losers.sort()).toEqual(['b', 'c']);
    const t = arena([40, 54, 90]); F(t, 'a').dir = 1; peck(t, 'a'); F(t, 'a').hp = 90; F(t, 'c').hp = 90;
    const d = run(t, P.fightTicks).find((x) => x.type === 'end') as any;
    expect(d).toMatchObject({ winner: null, draw: true, losers: [] });
  });
  it('leaving forfeits (loses); fight continues while 2+ stand; cancel is no-decision', () => {
    const s = arena([40, 54, 90]); F(s, 'a').dir = 1; peck(s, 'a');
    expect(removeFighter(s, 'c')).toBeNull();
    const e = removeFighter(s, 'b') as any;
    expect(e).toMatchObject({ winner: 'a', reason: 'forfeit' }); expect(e.losers.sort()).toEqual(['b', 'c']);
    const t = arena(); F(t, 'a').dir = 1; peck(t, 'a');
    expect(cancelFights(t)[0]).toMatchObject({ winner: null, draw: true, reason: 'cancel', losers: [] });
  });
  it('v1.6: hits outside a fight do nothing; only invited participants fight; spectators are untouchable', () => {
    const s = arena([40, 54, 66], {}, true); F(s, 'a').dir = 1;
    expect(peck(s, 'a')).toEqual([]); expect(F(s, 'b').hp).toBe(100); expect(s.fights).toHaveLength(0);
    const fight = startFightWith(s, ['a', 'c'], 'fx')!; // b 選觀戰
    expect(fight.parts.map((p) => p.u)).toEqual(['a', 'c']);
    expect(F(s, 'b').fightId).toBeNull();
    reset(s, 'a'); expect((peck(s, 'a').filter((x) => x.type === 'hit') as any[]).map((h) => h.to)).toEqual(['c']); expect(F(s, 'b').hp).toBe(100); // 較近的 b 是觀眾 → 穿過去打到 c
    expect(startFightWith(s, ['b', 'a'], 'fy')).toBeNull(); // 已有對戰
    const t = arena([10, 50], {}, true); expect(startFightWith(t, ['a'], 'z')).toBeNull(); expect(startFightWith(t, ['a', 'zz'], 'z')).toBeNull();
    addFighter(s, { userId: 'z', petId: 'pz', species: 'duck', name: 'Z', x: 60 }); expect(F(s, 'z').fightId).toBeNull();
  });
  it('v1.6 invites: accept/decline, early finish when all answered, 10s timeout = spectator, <2 = cancel', () => {
    const inv = createInvite('i', 'a', ['b', 'c', 'a'], 1000);
    expect(inv.to).toEqual(['b', 'c']); expect(inv.deadline).toBe(1000 + P.inviteMs);
    expect(inviteOutcome(inv, 2000)).toEqual({ done: false });
    expect(replyInvite(inv, 'b', true)).toBe(true); expect(replyInvite(inv, 'b', false)).toBe(false); expect(replyInvite(inv, 'x', true)).toBe(false);
    expect(inviteOutcome(inv, 2000)).toEqual({ done: false });
    replyInvite(inv, 'c', false);
    expect(inviteOutcome(inv, 2000)).toEqual({ done: true, participants: ['a', 'b'] }); // 全部回覆 → 立刻開始
    const t = createInvite('j', 'a', ['b', 'c'], 0); replyInvite(t, 'c', true);
    expect(inviteOutcome(t, P.inviteMs - 1)).toEqual({ done: false });
    expect(inviteOutcome(t, P.inviteMs)).toEqual({ done: true, participants: ['a', 'c'] }); // b 沒回覆 → 觀戰
    const u = createInvite('k', 'a', ['b'], 0); replyInvite(u, 'b', false);
    expect(inviteOutcome(u, 1)).toEqual({ done: true, participants: null });
    expect(inviteOutcome(createInvite('l', 'a', ['b'], 0), P.inviteMs)).toEqual({ done: true, participants: null });
  });
  it('v1.6 pool: 50 coins by damage share, largest remainder, exact total; all-zero = nobody', () => {
    expect(poolShares({ a: 30, b: 30, c: 30 })).toEqual({ a: 17, b: 17, c: 16 });
    expect(poolShares({ a: 100, b: 0 })).toEqual({ a: 50, b: 0 });
    expect(poolShares({ a: 0, b: 0 })).toEqual({ a: 0, b: 0 });
    const r = poolShares({ a: 13, b: 29, c: 41, d: 7 });
    expect(Object.values(r).reduce((x, y) => x + y, 0)).toBe(50);
    expect(r).toEqual({ a: 7, b: 16, c: 23, d: 4 }); // 7.22 16.11 22.78 3.89 → 餘數最大的 d、c 各 +1
    for (let k = 0; k < 50; k++) { const sc: Record<string, number> = {}; for (let i = 0; i < 1 + (k % 6); i++) sc['u' + i] = (k * 7 + i * 13) % 37; const v = poolShares(sc); const tot = Object.values(v).reduce((x, y) => x + y, 0); expect(tot).toBe(Object.values(sc).some((x) => x > 0) ? 50 : 0); }
  });
  it('multi-loser transfers: each loser pays min(20, own balance)', () => {
    expect(meleeTransfers({ winner: 'a', losers: ['b', 'c', 'd'] }, { a: 1, b: 50, c: 7, d: 0 })).toEqual({ b: -20, c: -7, d: -0, a: 27 });
    expect(meleeTransfers({ winner: null, losers: [] }, { a: 5 })).toEqual({});
    expect(fightTransfer(7)).toBe(7); expect(fightTransfer(500)).toBe(20);
  });
  it('is deterministic; eligibility', () => {
    const go = () => { n = 0; const s = arena([30, 50, 70]); const inputs = (t: number) => { setArenaInput(s, 'a', { right: t % 40 < 20, attack: t % 7 === 0, jump: t % 33 === 0 }); setArenaInput(s, 'b', { left: t % 50 < 25, upAtk: t % 11 === 0 }); setArenaInput(s, 'c', { left: t % 9 < 4, attack: t % 5 === 0 }); };
      const ev: ArenaEvent[] = []; for (let t = 0; t < 600; t++) { inputs(t); ev.push(...stepArena(s, hooks())); } return JSON.stringify([ev, s.fighters]); };
    expect(go()).toBe(go());
    expect(canFightPet({ status: 'alive', sleeping: false, sick: false })).toBe(true);
    expect(canFightPet({ status: 'alive', sleeping: true, sick: false })).toBe(false);
    expect(canFightPet(null)).toBe(false);
  });
});
