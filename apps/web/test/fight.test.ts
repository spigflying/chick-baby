import { describe, expect, it } from 'vitest';
import { hintFor, padPress, TOUCH_HINT, controlMode, petKey, PadState, lerpFighters, resultText, HINT, showFightbar, resultView, nextEquip, itemHud, diffFx, RESULT_AUTO_MS, type ResultMsg, fightBlocker, petBlock, ranking, resultInput, lockSecs, RESULT_LOCK_MS, inviteSecs, NOTICE_TEXT } from '../src/fight';

const base = { isOwner: false, submenuOpen: false, navOpen: false, inArena: true, inFight: false };
describe('fight input mode (v1.4)', () => {
  it('visiting: arrows control the pet by default; Enter opens the action bar', () => {
    expect(controlMode(base)).toBe('pet');
    expect(controlMode({ ...base, navOpen: true })).toBe('nav');
    expect(controlMode({ ...base, submenuOpen: true })).toBe('menu');
    expect(controlMode({ ...base, inArena: false })).toBe('menu'); // 沒有能打的寵物
  });
  it('own home: menu navigation when alone, unless in an active fight', () => {
    expect(controlMode({ ...base, isOwner: true })).toBe('menu');
    expect(controlMode({ ...base, isOwner: true, visitors: false })).toBe('menu');
    expect(controlMode({ ...base, isOwner: true, inFight: true })).toBe('pet');
    expect(controlMode({ ...base, isOwner: true, inFight: true, navOpen: true })).toBe('nav');
  });
  it('key mapping and pad edge detection', () => {
    expect(petKey('ArrowLeft')).toBe('left'); expect(petKey('ArrowUp')).toBe('jump'); expect(petKey(' ')).toBe('attack'); expect(petKey('Enter')).toBe('nav'); expect(petKey('q')).toBeNull(); expect(petKey('z')).toBe('item'); expect(petKey('x')).toBe('cycle');
    const p = new PadState();
    expect(p.set('left', true)).toBe(true); expect(p.set('left', true)).toBe(false);
    expect(p.clear()).toBe(true); expect(p.clear()).toBe(false);
  });
  it('interpolates between snapshots', () => {
    const f = (x: number) => ({ u: 'a', pet: 'p', sp: 'duck', name: 'A', x, y: 70, dir: 1 as const, atk: 0, inv: 0, hp: 100, fight: null });
    const prev = { tick: 1, server_time: 0, fighters: [f(10)], fights: [] as any[], hp_max: 100 }, cur = { ...prev, tick: 4, fighters: [f(20)] };
    expect(lerpFighters(prev, cur, 0.5)[0].x).toBe(15);
    expect(lerpFighters(null, cur, 0.5)[0].x).toBe(20);
  });
  it('result texts and hints', () => {
    const n = (id: string) => ({ a: 'Benson', b: '仲軍' } as any)[id];
    expect(resultText({ winner: 'a', amount: 20, reason: 'ko' }, n)).toBe('Benson 贏了！拿走 ◎20');
    expect(resultText({ winner: null, amount: 0, reason: 'timeout' }, n)).toBe('平手！不轉帳');
    expect(resultText({ winner: null, amount: 0, reason: 'cancel' }, n)).toContain('取消');
    expect(HINT.pet).toContain('Enter');
  });
});

describe('fight v2 (v1.5): owner controls', () => {
  it('owner gets pet control and the control panel whenever visitors are present; Enter opens the menu', () => {
    const own = { ...base, isOwner: true, visitors: true };
    expect(controlMode(own)).toBe('pet'); expect(showFightbar(controlMode(own))).toBe(true);
    expect(controlMode({ ...own, navOpen: true })).toBe('nav'); expect(showFightbar('nav')).toBe(true);
    expect(showFightbar(controlMode({ ...own, visitors: false }))).toBe(false); // 自己一個人
    expect(showFightbar(controlMode({ ...own, inArena: false }))).toBe(false); // 寵物不能打
    expect(HINT.pet).toContain('上啄'); expect(HINT.pet).toContain('Z 道具');
  });
  it('X cycles owned items; HUD shows equipped item + fights left', () => {
    expect(nextEquip({ sword: 3, poop: 1 }, 'sword')).toBe('poop');
    expect(nextEquip({ sword: 3, poop: 1 }, 'poop')).toBe('sword');
    expect(nextEquip({ kame: 0 }, null)).toBeNull();
    expect(itemHud('sword', { sword: 9 })).toBe('長劍 剩9場');
    expect(itemHud('poop', { poop: 4, sword: 1 }, 3)).toBe('丟大便 剩4場・便便×3・X換');
    expect(itemHud(null, {})).toBe('');
  });
  it('detects new swings and hits between snapshots', () => {
    const f = (o: any) => ({ u: 'a', pet: 'p', sp: 'duck', name: 'A', x: 0, y: 0, dir: 1 as const, atk: 0, inv: 0, hp: 100, fight: null, sn: 0, hn: 0, ...o });
    const d = diffFx([f({}), f({ u: 'b' })], [f({ sn: 1, sw: 'peck' }), f({ u: 'b', hn: 1, hd: 10 })]);
    expect(d).toEqual({ swings: [{ u: 'a', kind: 'peck' }], hits: [{ u: 'b', dmg: 10 }] });
  });
});

describe('fight v2 (v1.5): result screen', () => {
  const r: ResultMsg = { fight: 'f', winner: 'a', winner_name: '小黃（Benson）', losers: ['b', 'c'], draw: false, amount: 27, reason: 'ko', parts: [
    { u: 'a', name: '小黃（Benson）', dmg: 230, hits: 23, taken: 2, hp: 80, out: false, forfeit: false, delta: 27 },
    { u: 'b', name: '鴨鴨（仲軍）', dmg: 40, hits: 4, taken: 10, hp: 0, out: true, forfeit: false, delta: -7 },
    { u: 'c', name: '企企（Dora）', dmg: 20, hits: 2, taken: 10, hp: 0, out: true, forfeit: false, delta: -20 },
  ] };
  it('winner: banner with pet name (nickname) and own +coins, no loss line', () => {
    const v = resultView(r, 'a')!;
    expect(v.banner).toContain('小黃（Benson）'); expect(v.role).toBe('winner'); expect(v.coin).toBe('◎+27');
    expect(v.lostLine).toBeNull(); expect(v.stats).toEqual([]);
  });
  it('loser: banner, -coins, 「你輸了」 and stats (damage, hits, taken, HP left, coins lost)', () => {
    const v = resultView(r, 'b')!;
    expect(v.banner).toContain('小黃（Benson）'); expect(v.role).toBe('loser'); expect(v.coin).toBe('◎-7'); expect(v.lostLine).toBe('你輸了');
    expect(v.stats).toEqual([['造成傷害', '40'], ['命中次數', '4'], ['被打次數', '10'], ['剩餘 HP', '0']]);
  });
  it('spectator: banner only', () => {
    const v = resultView(r, 'zz')!;
    expect(v).toMatchObject({ role: 'spectator', coin: null, lostLine: null, stats: [] }); expect(v.banner).toContain('贏了');
  });
  it('draw shows 平手 and ±0; cancel shows no screen; auto-dismiss ~8s', () => {
    const d = resultView({ ...r, winner: null, winner_name: null, losers: [], draw: true, amount: 0, reason: 'timeout', parts: r.parts.map((p) => ({ ...p, delta: 0 })) }, 'b')!;
    expect(d).toMatchObject({ banner: '平手！', role: 'draw', coin: '◎±0', lostLine: null });
    expect(resultView({ ...r, reason: 'cancel' }, 'a')).toBeNull();
    expect(RESULT_AUTO_MS).toBe(8000);
  });
});

describe('mobile fight controls', () => {
  it('pad buttons work in pet mode, and pull you out of the action menu instead of being swallowed', () => {
    expect(padPress('pet', true)).toEqual({ exitNav: false, apply: true });
    expect(padPress('nav', true)).toEqual({ exitNav: true, apply: true });
    expect(padPress('menu', true)).toEqual({ exitNav: false, apply: false });
    expect(padPress('menu', false).apply).toBe(true); // 放開一律送出
  });
  it('touch devices get an on-screen hint instead of keyboard keys', () => {
    expect(hintFor('pet', true)).toBe(TOUCH_HINT); expect(TOUCH_HINT).not.toContain('Enter');
    expect(hintFor('pet', false)).toContain('Enter');
    // 手機沒有 Enter：訪客與有訪客時的主人預設就是寵物控制
    expect(controlMode({ ...base })).toBe('pet');
    expect(controlMode({ ...base, isOwner: true, visitors: true })).toBe('pet');
  });
});

describe('v1.6: result lock, ranking, ineligibility, invite countdown', () => {
  it('result screen ignores input for 3s, shows the countdown, then dismisses', () => {
    expect(RESULT_LOCK_MS).toBe(3000);
    expect(resultInput(0)).toBe('locked'); expect(resultInput(2999)).toBe('locked'); expect(resultInput(3000)).toBe('dismiss');
    expect([lockSecs(0), lockSecs(1200), lockSecs(2500), lockSecs(3100)]).toEqual([3, 2, 1, 0]);
  });
  it('ranking by score with pool share and transfer; viewer net change', () => {
    const r: ResultMsg = { fight: 'f', winner: 'a', winner_name: 'A', losers: ['b', 'c'], draw: false, amount: 27, reason: 'ko', pool: 50, parts: [
      { u: 'b', name: 'B', dmg: 10, hits: 1, taken: 3, hp: 0, out: true, forfeit: false, transfer: -7, pool: 17, delta: 10 },
      { u: 'a', name: 'A', dmg: 30, hits: 3, taken: 0, hp: 90, out: false, forfeit: false, transfer: 27, pool: 33, delta: 60 },
      { u: 'c', name: 'C', dmg: 0, hits: 0, taken: 1, hp: 0, out: true, forfeit: false, transfer: -20, pool: 0, delta: -20 },
    ] };
    expect(ranking(r, 'b').map((x) => [x.rank, x.u, x.score, x.pool, x.transfer, x.me])).toEqual([[1, 'a', 30, 33, 27, false], [2, 'b', 10, 17, -7, true], [3, 'c', 0, 0, -20, false]]);
    expect(resultView(r, 'b')!.net).toBe('你的變化 ◎+10');
    expect(resultView(r, 'zz')!.net).toBeNull();
  });
  const ok = { status: 'alive', sleeping: false, sick: false };
  const base = { isOwner: false, ownerPresent: true, ownerAway: false, ownerPet: ok, myPet: ok, cooldownMs: 0, opponents: 1 };
  it('ineligibility reasons in someone else\'s home', () => {
    expect(fightBlocker(base)).toBeNull();
    expect(fightBlocker({ ...base, ownerPresent: false })).toBe('主人離線，不能打架');
    expect(fightBlocker({ ...base, ownerAway: true, ownerPresent: false })).toBe('主人外出中，不能打架');
    expect(fightBlocker({ ...base, ownerPet: { ...ok, sleeping: true } })).toBe('主人的寵物在睡覺，不能打架');
    expect(fightBlocker({ ...base, ownerPet: { ...ok, sick: true } })).toBe(NOTICE_TEXT.OWNER_SICK);
    expect(fightBlocker({ ...base, myPet: { ...ok, sleeping: true } })).toBe('你的寵物在睡覺，不能打架');
    expect(fightBlocker({ ...base, myPet: null })).toBe('你還沒有寵物');
    expect(fightBlocker({ ...base, cooldownMs: 12_300 })).toBe('剛打完，還要休息 13 秒');
    expect(fightBlocker({ ...base, opponents: 0 })).toBe(NOTICE_TEXT.NO_OPPONENT);
    expect(fightBlocker({ ...base, busy: true })).toBe(NOTICE_TEXT.FIGHT_BUSY);
    expect(fightBlocker({ ...base, isOwner: true, ownerPresent: false })).toBeNull(); // 自己家不看主人
  });
  it('per-pet eligibility and invite countdown seconds', () => {
    expect(petBlock({ status: 'egg', sleeping: false, sick: false })).toBe('你的寵物還是蛋');
    expect(petBlock({ status: 'dead', sleeping: false, sick: false })).toBe('你的寵物已經死了');
    expect(petBlock({ ...ok, sick: true })).toBe('你的寵物生病了，不能打架');
    expect([inviteSecs(10_000), inviteSecs(9_001), inviteSecs(1), inviteSecs(-5)]).toEqual([10, 10, 1, 0]);
  });
});
