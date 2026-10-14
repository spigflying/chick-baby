import { describe, expect, it } from 'vitest';
import { ARENA_PARAMS as P, addFighter, cancelFights, canFightPet, createArena, fightTransfer, removeFighter, setArenaInput, stepArena, type ArenaEvent } from '../src';

let n = 0;
const hooks = (why: string | null = null) => ({ canStart: () => why, newId: () => `f${++n}` });
function arena(xa = 40, xb = 54) {
  const s = createArena();
  addFighter(s, { userId: 'a', petId: 'pa', species: 'chicken', name: 'A', x: xa });
  addFighter(s, { userId: 'b', petId: 'pb', species: 'duck', name: 'B', x: xb });
  return s;
}
const run = (s: any, k: number, h = hooks()) => { const out: ArenaEvent[] = []; for (let i = 0; i < k; i++) out.push(...stepArena(s, h)); return out; };
const peck = (s: any, u: string, h = hooks()) => { setArenaInput(s, u, { attack: true }); const e = stepArena(s, h); setArenaInput(s, u, { attack: false }); return e; };

describe('arena (v1.4)', () => {
  it('first peck starts a 1v1 fight with damage + knockback', () => {
    const s = arena(); s.fighters[0].dir = 1;
    const e = peck(s, 'a');
    expect(e.map((x) => x.type)).toEqual(['start', 'hit']);
    const b = s.fighters[1];
    expect(b.hp).toBe(P.hpMax - P.peckDamage); expect(b.kx).toBeGreaterThan(0);
    expect(s.fights).toHaveLength(1); expect(s.fights[0].endTick - s.fights[0].startTick).toBe(30 * 60);
  });
  it('peck has a 0.5s cooldown and needs a fresh press', () => {
    const s = arena(); s.fighters[0].dir = 1; peck(s, 'a');
    run(s, P.hitInvulnTicks); s.fighters[1].x = 54; s.fighters[1].kx = 0;
    expect(peck(s, 'a').filter((x) => x.type === 'hit')).toHaveLength(0); // still cooling down
    run(s, P.attackCooldownTicks); s.fighters[1].x = 54; s.fighters[1].kx = 0;
    expect(peck(s, 'a').filter((x) => x.type === 'hit')).toHaveLength(1);
  });
  it('a quick tap (press+release within one tick) still pecks once', () => {
    const s = arena(); s.fighters[0].dir = 1;
    setArenaInput(s, 'a', { attack: true }); setArenaInput(s, 'a', { attack: false });
    expect(stepArena(s, hooks()).map((x) => x.type)).toEqual(['start', 'hit']);
    expect(run(s, 30).filter((x) => x.type === 'hit')).toHaveLength(0); // 不會連發
  });
  it('facing away or out of range misses', () => {
    const s = arena(); s.fighters[0].dir = -1;
    expect(peck(s, 'a')).toEqual([]);
    const t = arena(10, 80); t.fighters[0].dir = 1; expect(peck(t, 'a')).toEqual([]);
  });
  it('stomp from a jump counts as a hit', () => {
    const s = arena(40, 40);
    s.fighters[0].y = s.fighters[1].y - P.petH - 6; s.fighters[0].onGround = false; s.fighters[0].vy = 2;
    const e = run(s, 6);
    const h = e.find((x) => x.type === 'hit') as any;
    expect(h).toMatchObject({ from: 'a', to: 'b', kind: 'stomp', damage: P.stompDamage });
  });
  it('third parties are ignored during a fight', () => {
    const s = arena(); addFighter(s, { userId: 'c', petId: 'pc', species: 'dino', name: 'C', x: 66 });
    s.fighters[0].dir = 1; peck(s, 'a');
    const c = s.fighters.find((f) => f.userId === 'c')!; c.dir = -1; const b = s.fighters.find((f) => f.userId === 'b')!;
    b.x = 54; b.kx = 0; c.x = 66; b.inv = 0;
    expect(peck(s, 'c')).toEqual([]); expect(b.hp).toBe(P.hpMax - P.peckDamage);
  });
  it('KO ends with the higher-HP pet winning; HP resets', () => {
    const s = arena(); s.fighters[0].dir = 1; peck(s, 'a');
    run(s, 1); const b = s.fighters[1]; Object.assign(b, { hp: 5, inv: 0, x: 54, kx: 0, vy: 0, y: P.ground - P.petH, onGround: true }); s.fighters[0].cd = 0;
    const e = peck(s, 'a'); const end = e.find((x) => x.type === 'end') as any;
    expect(end).toMatchObject({ winner: 'a', loser: 'b', reason: 'ko', hpB: 0 });
    expect(s.fights).toEqual([]); expect(s.fighters.every((f) => f.hp === P.hpMax && f.fightId === null)).toBe(true);
  });
  it('timeout: higher HP wins, equal HP is a draw', () => {
    const s = arena(); s.fighters[0].dir = 1; peck(s, 'a');
    const e = run(s, P.fightTicks); const end = e.find((x) => x.type === 'end') as any;
    expect(end).toMatchObject({ winner: 'a', reason: 'timeout' });
    const t = arena(); t.fighters[0].dir = 1; peck(t, 'a'); t.fighters[1].hp = P.hpMax;
    const e2 = run(t, P.fightTicks); expect(e2.find((x) => x.type === 'end')).toMatchObject({ winner: null, loser: null, reason: 'timeout' });
  });
  it('refused start (closing / pair cooldown) does nothing', () => {
    const s = arena(); s.fighters[0].dir = 1;
    expect(peck(s, 'a', hooks('PAIR_COOLDOWN'))).toEqual([{ type: 'refused', from: 'a', to: 'b', reason: 'PAIR_COOLDOWN' }]);
    expect(s.fighters[1].hp).toBe(P.hpMax);
  });
  it('leaving forfeits; cancel is a no-decision', () => {
    const s = arena(); s.fighters[0].dir = 1; peck(s, 'a');
    expect(removeFighter(s, 'a')).toMatchObject({ winner: 'b', loser: 'a', reason: 'forfeit' });
    const t = arena(); t.fighters[0].dir = 1; peck(t, 'a');
    expect(cancelFights(t)).toEqual([expect.objectContaining({ winner: null, reason: 'cancel' })]);
  });
  it('is deterministic, transfer is min(20, balance), and eligibility', () => {
    const go = () => { const s = arena(); setArenaInput(s, 'a', { right: true, jump: true }); setArenaInput(s, 'b', { left: true }); run(s, 40, { canStart: () => null, newId: () => 'x' }); return s; };
    expect(go()).toEqual(go());
    expect([fightTransfer(500), fightTransfer(7), fightTransfer(0)]).toEqual([20, 7, 0]);
    expect(canFightPet({ status: 'alive', sleeping: false, sick: false })).toBe(true);
    expect(canFightPet({ status: 'alive', sleeping: true, sick: false })).toBe(false);
    expect(canFightPet({ status: 'alive', sleeping: false, sick: true })).toBe(false);
    expect(canFightPet({ status: 'dead', sleeping: false, sick: false })).toBe(false);
  });
});
