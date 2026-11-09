// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { SFV } from '../src/index';

const { DOWN, LEFT, RIGHT, LP, HP, LK, ST, M, MOVE_LIST, WAKE_THROW_INV } = SFV;

function fight(x1: number, x2: number) {
  const s = SFV.createState();
  s.rs = SFV.RS.FIGHT; s.p[0].x = x1; s.p[1].x = x2;
  return s;
}
// 重衝天啄：P1 面右（→↓↘+I）、P2 面左（←↓↙+I）。第 3 個輸入那一 tick 出招（mt=1）
const DP1 = [RIGHT, DOWN, DOWN | RIGHT | HP], DP2 = [LEFT, DOWN, DOWN | LEFT | HP];
/** P1 在第 0 tick 開始搓、P2 晚 off tick；回傳最後血量與各自第一次被打中的 tick */
function dpVsDp(off: number, dist: number, n = 90) {
  const s = fight(480 - dist / 2, 480 + dist / 2), first = [-1, -1], mv = [-1, -1];
  for (let k = 0; k < n; k++) {
    const m1 = DP1[k] ?? 0, m2 = k >= off ? DP2[k - off] ?? 0 : 0;
    SFV.simulateSFVTick(s, m1, m2);
    if (k === 2) mv[0] = s.p[0].mv;
    if (k === off + 2) mv[1] = s.p[1].mv;
    for (let i = 0; i < 2; i++) if (first[i] < 0 && s.p[i].hp < 1000) first[i] = k;
  }
  return { hp: [s.p[0].hp, s.p[1].hp], first, mv };
}

describe('衝天啄：無敵只到判定出來前（SF5/SF6 式）', () => {
  it('無敵區間都在 1..startup-1：判定出來那一幀就吃得到；輕版比重版弱', () => {
    for (const id of ['DP_L', 'DP_H', 'DP_EX']) {
      const mv = MOVE_LIST[M[id]];
      expect(mv.hitIndex(mv.S)).toBe(0); // 判定第 S 幀出來（press tick 的 mt=1）
      expect(mv.hitIndex(mv.S - 1)).toBe(-1);
      for (const kind of ['full', 'air', 'proj', 'throw']) expect(mv.invulnAt(mv.S, kind)).toBe(false);
      for (let t = mv.S; t < 40; t++) expect(['full', 'air', 'proj', 'throw'].some((k) => mv.invulnAt(t, k))).toBe(false);
    }
    const H = MOVE_LIST[M.DP_H], EX = MOVE_LIST[M.DP_EX], L = MOVE_LIST[M.DP_L];
    for (let t = 1; t <= 4; t++) expect(H.invulnAt(t, 'full')).toBe(true);
    for (let t = 1; t <= 3; t++) expect(EX.invulnAt(t, 'full')).toBe(true);
    for (let t = 1; t <= 2; t++) { expect(L.invulnAt(t, 'air')).toBe(true); expect(L.invulnAt(t, 'full')).toBe(false); }
    // 其他超必殺／必殺的無敵沒動
    expect(MOVE_LIST[M.CA].invulnAt(10, 'full')).toBe(true);
    expect(MOVE_LIST[M.SHINKU].invulnAt(10, 'full')).toBe(true);
    expect(MOVE_LIST[M.TATSU_EX].invulnAt(7, 'full')).toBe(true);
    expect(MOVE_LIST[M.BDASH].invulnAt(2, 'throw')).toBe(true);
  });

  it('兩人同一 tick 出重衝天啄 → 相殺（雙方都被打中）', () => {
    for (const dist of [40, 60, 90, 120]) {
      const r = dpVsDp(0, dist);
      expect(MOVE_LIST[r.mv[0]].id).toBe('DP_H'); expect(MOVE_LIST[r.mv[1]].id).toBe('DP_H');
      expect(r.hp[0]).toBeLessThan(1000); expect(r.hp[1]).toBeLessThan(1000);
      expect(r.first[0]).toBe(r.first[1]);
      expect(r.first[0]).toBe(2 + MOVE_LIST[M.DP_H].S - 1); // 判定出來第一幀就相殺
    }
  });

  it('晚 1～4 tick 出的重衝天啄：相殺，不會乾淨贏', () => {
    for (const dist of [40, 60, 90]) for (const off of [1, 2, 3, 4]) {
      const r = dpVsDp(off, dist);
      expect(r.hp[0]).toBeLessThan(1000); // 先出的人可能被打到（相殺）……
      expect(r.hp[1]).toBeLessThan(1000); // ……但晚出的人一定也被打到
      expect(r.hp[1]).toBeLessThanOrEqual(r.hp[0]);
    }
  });

  it('對手判定已經出來才按衝天啄 → 自己被打中（近：還沒出招就被打；遠：頂多相殺）', () => {
    // 近距離：先出的判定一出來就打到，後按的根本出不了招
    for (const off of [5, 6, 8]) {
      const r = dpVsDp(off, 60);
      expect(r.hp[0]).toBe(1000);
      expect(r.hp[1]).toBeLessThan(1000);
      expect(r.first[1]).toBe(2 + MOVE_LIST[M.DP_H].S - 1);
    }
    // 遠一點：先出的判定已經出來（還沒碰到）才按 → 後按的那個也被打中（相殺）
    const r = dpVsDp(5, 120);
    expect(r.hp[1]).toBeLessThan(1000);
    expect(r.hp[0]).toBeLessThan(1000);
  });

  it('對手衝天啄落空、在落地硬直時出衝天啄 → 照樣確反', () => {
    const s = fight(300, 560);
    for (let k = 0; k < 3; k++) SFV.simulateSFVTick(s, DP1[k], 0);
    let guard = 0;
    while (s.p[0].st !== ST.LAND && guard++ < 120) SFV.simulateSFVTick(s, 0, 0);
    expect(s.p[0].st).toBe(ST.LAND);
    s.p[1].x = s.p[0].x + 60; // 走到旁邊
    for (let k = 0; k < 3; k++) SFV.simulateSFVTick(s, 0, DP2[k]);
    for (let k = 0; k < 12; k++) SFV.simulateSFVTick(s, 0, 0);
    expect(s.p[0].hp).toBeLessThan(1000);
    expect(s.p[1].hp).toBe(1000);
  });
});

describe('起身不能被摔', () => {
  /** P2 倒地、t=kd → 第 kd+1 tick 起身；P1 在 P2 旁邊，從第 press tick 開始按摔（U+J） */
  function wake(kd: number, press: number, btn = LP | LK, n = 40) {
    const s = fight(450, 490); s.p[0].f = 1; s.p[1].f = -1;
    s.p[1].st = ST.KD; s.p[1].t = kd;
    let woke = -1;
    for (let k = 1; k <= n; k++) {
      const before = s.p[1].st;
      SFV.simulateSFVTick(s, k === press ? btn : 0, 0);
      if (woke < 0 && before === ST.KD && s.p[1].st !== ST.KD) woke = k;
      if (s.p[1].st === ST.THROWN || s.p[1].st === ST.THROWING || s.p[1].hp < 1000) break;
    }
    return { s, woke };
  }
  const THROW_S = MOVE_LIST[M.THROW].S; // 第 press tick 的 mt=1，判定在 press+S-1、press+S 兩 tick

  it('WAKE_THROW_INV = 6；狀態快照有 wk 欄位（回滾／網路同步一致）', () => {
    expect(WAKE_THROW_INV).toBe(6);
    expect(SFV.P_FIELDS).toContain('wk');
    const { s } = wake(3, 999, 0, 4); // 第 4 tick 起身
    expect(s.p[1].st).toBe(ST.IDLE);
    expect(s.p[1].wk).toBe(WAKE_THROW_INV - 1);
    const c = SFV.cloneState(s);
    expect(c.p[1].wk).toBe(s.p[1].wk);
    expect(SFV.hashState(c)).toBe(SFV.hashState(s));
    const d = SFV.cloneState(s); d.p[1].wk = 0;
    expect(SFV.hashState(d)).not.toBe(SFV.hashState(s));
    // 從快照接著跑跟原本的一模一樣
    for (let k = 0; k < 20; k++) { SFV.simulateSFVTick(s, LP | LK, 0); SFV.simulateSFVTick(c, LP | LK, 0); }
    expect(SFV.packState(c)).toBe(SFV.packState(s));
  });

  it('壓起身摔（判定落在起身那一幀與防摔區間內）→ 抓不到', () => {
    const kd = 10, W = kd + 1;
    for (const first of [W, W + 2, W + WAKE_THROW_INV - 2]) { // 兩個判定幀都落在 W..W+5
      const { s, woke } = wake(kd, first - THROW_S + 1);
      expect(woke).toBe(W);
      expect(s.p[1].st).not.toBe(ST.THROWN);
      expect(s.p[1].hp).toBe(1000);
    }
  });

  it('防摔區間一過（第 W+6 tick）摔得到', () => {
    const kd = 10, W = kd + 1;
    const { s } = wake(kd, W + WAKE_THROW_INV - THROW_S + 1);
    expect(s.p[1].st).toBe(ST.THROWN);
    // 判定第二幀剛好落在 W+6 也抓得到
    const r = wake(kd, W + WAKE_THROW_INV - THROW_S);
    expect(r.s.p[1].st).toBe(ST.THROWN);
  });

  it('打擊技照樣打得到剛起身的人', () => {
    const kd = 10, W = kd + 1, lp = MOVE_LIST[M['5LP']];
    const { s } = wake(kd, W - lp.S + 1, LP);
    expect(s.p[1].hp).toBeLessThan(1000);
    expect(s.p[1].st).toBe(ST.HIT);
  });

  it('被摔（硬倒地）起身也有防摔', () => {
    const s = fight(450, 490);
    SFV.simulateSFVTick(s, LP | LK, 0);
    let g = 0;
    while (s.p[1].st !== ST.KD && g++ < 100) SFV.simulateSFVTick(s, 0, 0);
    expect(s.p[1].st).toBe(ST.KD);
    // 找起身那一 tick
    const probe = SFV.cloneState(s); let W = 0;
    while (probe.p[1].st === ST.KD && W < 200) { SFV.simulateSFVTick(probe, 0, 0); W++; }
    expect(probe.p[1].st).toBe(ST.IDLE);
    // P1 摔完的收招已經結束；把人擺回貼身，判定第一幀＝起身那一幀
    s.p[0].x = s.p[1].x - 40; s.p[0].f = 1; s.p[1].f = -1;
    for (let k = 1; k <= W + 4; k++) SFV.simulateSFVTick(s, k === W - THROW_S + 1 ? LP | LK : 0, 0);
    expect(s.p[1].st).not.toBe(ST.THROWN);
    expect(s.p[1].hp).toBe(880); // 只吃了第一次摔
  });
});
