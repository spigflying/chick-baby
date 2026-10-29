import { describe, expect, it } from 'vitest';
import { SFV, SFVServer } from '@chick/engine';
import { SFVClient } from '../src/sfv-net';

const mods = { SFV, SFVServer, SFVClient };
const { UP, DOWN, LEFT, RIGHT, LP, HP, LK, HK, ST, M } = SFV;

/** 跳過開場、把兩人擺到指定位置 */
function fight(x1 = 450, x2 = 500) {
  const s = SFV.createState();
  s.rs = SFV.RS.FIGHT; s.p[0].x = x1; s.p[1].x = x2;
  return s;
}
function run(s: any, p1: number[], p2: number[] = []) {
  const n = Math.max(p1.length, p2.length);
  for (let k = 0; k < n; k++) SFV.simulateSFVTick(s, p1[k] ?? 0, p2[k] ?? 0);
  return s;
}
const hold = (mask: number, n: number) => new Array(n).fill(mask);
function lcg(seed: number) { let x = seed >>> 0; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

describe('defineMove', () => {
  it('5LP: 4T startup, 2 active ticks', () => {
    const mv = SFV.MOVE_LIST[M['5LP']];
    expect([3, 4, 5, 6].map((t) => mv.hitIndex(t))).toEqual([-1, 0, 0, -1]);
  });
  it('multi-hit moves split the active window evenly', () => {
    const ca = SFV.MOVE_LIST[M.CA];
    expect(ca.dmg.reduce((a: number, b: number) => a + b, 0)).toBe(350);
    expect([4, 8, 9, 33, 34].map((t) => ca.hitIndex(t))).toEqual([0, 0, 1, 5, -1]);
  });
  it('heavy and EX 衝天啄 have no hurtbox on ticks 1-6', () => {
    for (const id of ['DP_H', 'DP_EX']) {
      const s = fight(300, 600);
      const seen: number[] = [];
      run(s, [RIGHT, DOWN, DOWN | RIGHT | (id === 'DP_EX' ? LP | HP : HP)]);
      s.p[0].ex = 100;
      expect(SFV.MOVE_LIST[s.p[0].mv].id).toBe(id === 'DP_EX' ? 'DP_H' : id); // 沒氣 → 不會變 EX
      const s2 = fight(300, 600); s2.p[0].ex = 100;
      run(s2, [RIGHT, DOWN, DOWN | RIGHT | (id === 'DP_EX' ? LP | HP : HP)]);
      expect(SFV.MOVE_LIST[s2.p[0].mv].id).toBe(id);
      for (let k = 0; k < 8; k++) { seen.push(SFV.hurtboxes(s2.p[0]).length); SFV.simulateSFVTick(s2, 0, 0); }
      // 第 3 個輸入那一 tick mt=1，所以 seen[0..5] 對應 mt 1..6
      expect(seen.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(seen[6]).toBeGreaterThan(0);
    }
  });
});

describe('command parser', () => {
  const started = (s: any) => SFV.MOVE_LIST[s.p[0].mv]?.id;
  it('236P = 蛋波, 623P / 626P / 6236P = 衝天啄, 214K = 旋風翅', () => {
    expect(started(run(fight(300, 600), [DOWN, DOWN | RIGHT, RIGHT | LP]))).toBe('HADO_L');
    expect(started(run(fight(300, 600), [RIGHT, DOWN, DOWN | RIGHT | HP]))).toBe('DP_H');
    expect(started(run(fight(300, 600), [RIGHT, DOWN, RIGHT | LP]))).toBe('DP_L');
    expect(started(run(fight(300, 600), [RIGHT, DOWN, DOWN | RIGHT, RIGHT | LP]))).toBe('DP_L');
    expect(started(run(fight(300, 600), [DOWN, DOWN | LEFT, LEFT | HK]))).toBe('TATSU_H');
  });
  it('directions flip with facing (right side: 236 = ↓↙←)', () => {
    const s = fight(600, 300); s.p[0].f = -1; s.p[1].f = 1;
    expect(started(run(s, [DOWN, DOWN | LEFT, LEFT | LP]))).toBe('HADO_L');
  });
  it('a 15-tick window: motion older than 15 ticks does not count', () => {
    expect(started(run(fight(300, 600), [DOWN, DOWN | RIGHT, RIGHT, ...hold(0, 14), LP]))).toBe('5LP');
  });
  it('EX needs a bar and both punches; spends 100', () => {
    const s = fight(300, 600); s.p[0].ex = 100;
    run(s, [DOWN, DOWN | RIGHT, RIGHT | LP | HP]);
    expect(started(s)).toBe('HADO_EX'); expect(s.p[0].ex).toBe(0);
  });
  it('236236K needs 3 bars and freezes the screen 30 ticks', () => {
    const seq = [DOWN, DOWN | RIGHT, RIGHT, DOWN, DOWN | RIGHT, RIGHT | HK];
    expect(started(run(fight(300, 600), seq))).not.toBe('CA');
    const s = fight(300, 600); s.p[0].ex = 300;
    run(s, seq);
    expect(started(s)).toBe('CA'); expect(s.frz).toBe(30); expect(s.p[0].ex).toBe(0);
  });
  it('one projectile per player on screen', () => {
    const s = run(fight(200, 800), [DOWN, DOWN | RIGHT, RIGHT | LP, ...hold(0, 50)]);
    expect(s.pr.length).toBe(1);
    run(s, [DOWN, DOWN | RIGHT, RIGHT | LP]);
    expect(started(s)).not.toBe('HADO_L');
  });
});

describe('衝天啄 priority', () => {
  const dp = (btn: number) => [RIGHT, DOWN, DOWN | RIGHT | btn];
  it('heavy: beats a heavy punch that is already coming (invincible ticks 1-6)', () => {
    for (const late of [0, 1, 2, 3]) {
      const s = fight(440, 500), start = 6 - late;
      run(s, Array.from({ length: 40 }, (_, t) => (t >= start && t < start + 3 ? dp(HP)[t - start] : 0)), hold(HP, 40));
      expect([s.p[0].hp, s.p[1].hp]).toEqual([1000, 860]);
    }
  });
  /** 提早搓好 →↓、按住 ↘ 等，波距離 ≤ gap 時才按拳（衝天啄在那一 tick 出招） */
  function vsFireball(btn: number, gap: number, x2: number, ex = 0) {
    const s = fight(300, x2), p2 = [DOWN, DOWN | LEFT, LEFT | HP];
    s.p[0].ex = ex;
    let phase = 0, at = -1;
    for (let t = 0; t < 120; t++) {
      const q = s.pr[0], d = q ? q.x - s.p[0].x : Infinity;
      let m = 0;
      if (phase === 0 && d <= gap + 40) { phase = 1; at = t; }
      if (phase >= 1) {
        const k = t - at;
        m = k === 0 ? RIGHT : k === 1 ? DOWN : DOWN | RIGHT;
        if (phase === 1 && k >= 2 && d <= gap) { m |= btn; phase = 2; }
        if (phase === 2 && SFV.MOVE_LIST[s.p[0].mv]?.id?.startsWith('DP')) m = 0;
      }
      SFV.simulateSFVTick(s, m, p2[t] ?? 0);
    }
    return s;
  }
  it('heavy and EX go through a fireball at any timing', () => {
    // 波和身體相距約 40px 就碰到（波寬一半 16＋蹲姿受擊框一半 24），而波每 tick 前進 8 → 最晚 48 以內按都還來得及
    for (const gap of [96, 80, 64, 50]) {
      expect(vsFireball(HP, gap, 600).p[0].hp).toBe(1000);
      expect(vsFireball(LP | HP, gap, 600, 100).p[0].hp).toBe(1000);
    }
  });
  it('close range: goes through the fireball and hits the thrower', () => {
    // 近身看到對方做出放波動作（波還沒出手）就按：無敵期間波出手、穿過去，打中還在收招的對方
    const s = fight(300, 380), p2 = [DOWN, DOWN | LEFT, LEFT | HP];
    let at = -1;
    for (let t = 0; t < 120; t++) {
      if (at < 0 && SFV.MOVE_LIST[s.p[1].mv]?.id === 'HADO_H' && s.p[1].mt >= 8) at = t;
      SFV.simulateSFVTick(s, at >= 0 && t - at < 3 ? dp(HP)[t - at] : 0, p2[t] ?? 0);
    }
    expect(s.p[0].hp).toBe(1000); expect(s.p[1].hp).toBe(860);
  });
  it('light has no invincibility: the fireball hits it', () => {
    for (const gap of [80, 64, 50]) expect(vsFireball(LP, gap, 600).p[0].hp).toBe(940);
  });
});

describe('dashes (double tap)', () => {
  it('←← back dash: throw-invulnerable 2 ticks, then a short hop, ends ~80px back', () => {
    const s = fight(480, 700), x0 = s.p[0].x;
    run(s, [LEFT, 0, LEFT]);
    expect(SFV.MOVE_LIST[s.p[0].mv].id).toBe('BDASH');
    const ys: number[] = [];
    for (let k = 0; k < 25; k++) { ys.push(s.p[0].y); SFV.simulateSFVTick(s, LEFT, 0); }
    expect(Math.min(...ys)).toBeLessThan(0);
    expect(s.p[0].st).not.toBe(ST.MOVE);
    expect(x0 - s.p[0].x).toBeGreaterThanOrEqual(80);
  });
  it('holding back is a walk, not a dash; a slow second tap is not a dash', () => {
    expect(run(fight(480, 700), hold(LEFT, 12)).p[0].st).toBe(ST.IDLE);
    expect(SFV.MOVE_LIST[run(fight(480, 700), [LEFT, ...hold(0, 11), LEFT]).p[0].mv]?.id).not.toBe('BDASH');
  });
  it('→→ forward dash', () => {
    const s = run(fight(300, 700), [RIGHT, 0, RIGHT]);
    expect(SFV.MOVE_LIST[s.p[0].mv].id).toBe('FDASH');
  });
  it('a back dash escapes a throw', () => {
    const s = fight(450, 490);
    run(s, [LP | LK, 0, 0, 0, 0, 0], [RIGHT, 0, RIGHT, RIGHT, RIGHT, RIGHT]); // P2 在右邊，後＝→
    expect(s.p[1].st).not.toBe(ST.THROWN); expect(s.p[1].hp).toBe(1000);
  });
});

describe('physics', () => {
  it('pushboxes never overlap when walking into each other, also in the corner', () => {
    const s = run(fight(400, 560), hold(RIGHT, 80), hold(LEFT, 80));
    expect(SFV.overlap(SFV.pushbox(s.p[0]), SFV.pushbox(s.p[1]))).toBe(false);
    const c = run(fight(SFV.STAGE_W - 120, SFV.STAGE_W - 40), hold(RIGHT, 120));
    expect(c.p[1].x).toBe(SFV.STAGE_W - SFV.WALL);
    expect(SFV.overlap(SFV.pushbox(c.p[0]), SFV.pushbox(c.p[1]))).toBe(false);
  });
  it('auto-facing turns around after crossing', () => {
    const s = fight(450, 500);
    s.p[0].x = 600;
    run(s, [0]);
    expect(s.p[0].f).toBe(-1); expect(s.p[1].f).toBe(1);
  });
});

describe('combat', () => {
  it('5LP lands on tick 4 with 8T hitstop', () => {
    const s = run(fight(), [LP, LP, LP, LP]);
    expect(s.p[1].hp).toBe(970); expect(s.p[1].hs).toBe(8); expect(s.p[0].hs).toBe(8);
  });
  it('same-tick jabs trade (both take damage)', () => {
    const s = run(fight(), [LP, LP, LP, LP], [LP, LP, LP, LP]);
    expect([s.p[0].hp, s.p[1].hp]).toEqual([970, 970]);
  });
  it('crouch block (1) stops lows, stand block (4) does not', () => {
    const c = run(fight(), hold(DOWN | LK, 5), hold(DOWN | RIGHT, 5));
    expect(c.p[1].st).toBe(ST.BLOCK); expect(c.p[1].hp).toBe(1000);
    const st = run(fight(), hold(DOWN | LK, 5), hold(RIGHT, 5));
    expect(st.p[1].st).toBe(ST.HIT); expect(st.p[1].hp).toBe(980);
  });
  it('overheads need stand block', () => {
    const s = fight();
    s.p[1].hist[s.tick % SFV.HIST] = DOWN | RIGHT;
    expect(SFV.canBlock(s, s.p[1], s.p[0].x, 'overhead')).toBe(false);
    expect(SFV.canBlock(s, s.p[1], s.p[0].x, 'low')).toBe(true);
    s.p[1].hist[s.tick % SFV.HIST] = RIGHT;
    expect(SFV.canBlock(s, s.p[1], s.p[0].x, 'overhead')).toBe(true);
    expect(SFV.canBlock(s, s.p[1], s.p[0].x, 'low')).toBe(false);
  });
  it('2HK is a low hard knockdown', () => {
    const s = run(fight(440, 500), hold(DOWN | HK, 8));
    expect(s.p[1].st).toBe(ST.KD); expect(s.p[1].hp).toBe(910);
  });
  it('blocked specials leave white damage that regenerates', () => {
    const s = fight(300, 420);
    run(s, [DOWN, DOWN | RIGHT, RIGHT | HP], hold(RIGHT, 3));
    let n = 0; while (s.p[1].st !== ST.BLOCK && n++ < 60) SFV.simulateSFVTick(s, 0, RIGHT); // 按後會邊退邊防
    expect(s.p[1].st).toBe(ST.BLOCK); expect(s.p[1].wd).toBe(15); expect(s.p[1].hp).toBe(985);
    run(s, hold(0, 200));
    expect(s.p[1].wd).toBe(0); expect(s.p[1].hp).toBe(1000);
  });
  it('throw: 5T, no tech within 7 ticks → lifted over the head, slammed in front: 120 damage + knockdown', () => {
    const s = run(fight(450, 490), [LP | LK, ...hold(0, 4 + 7 + SFV.THROW_ANIM / 2 - 1)]); // 第 5 tick 抓到，再 7 tick 解摔窗，再半段動畫＝頭頂
    expect(s.p[1].st).toBe(ST.THROWN); expect(s.p[1].y).toBeLessThan(-90); expect(s.p[1].hp).toBe(1000);
    run(s, hold(0, SFV.THROW_ANIM / 2 + 2));
    expect(s.p[1].hp).toBe(880); expect(s.p[1].st).toBe(ST.KD); expect(s.p[1].y).toBe(0);
    expect(s.p[1].x - s.p[0].x).toBe(64);
  });
  it('no tech once the lift has started', () => {
    const s = run(fight(450, 490), [LP | LK, ...hold(0, 12)]);
    run(s, [0], [LP | LK]);
    expect(s.p[1].st).toBe(ST.THROWN);
  });
  it('throw tech: U+J within 7 ticks of being grabbed', () => {
    const s = run(fight(450, 490), hold(0, 0).concat([LP | LK, 0, 0, 0, 0]));
    expect(s.p[1].st).toBe(ST.THROWN);
    run(s, [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, LP | LK]);
    expect(s.p[0].st).toBe(ST.TECH); expect(s.p[1].st).toBe(ST.TECH); expect(s.p[1].hp).toBe(1000);
  });
  it('stun gauge full → DIZZY for 120 ticks after hitstun', () => {
    const s = fight(); s.p[1].sg = 990;
    run(s, [LP, LP, LP, LP]);
    expect(s.p[1].dz).toBe(1);
    let n = 0; while (s.p[1].st !== ST.DIZZY && n++ < 100) SFV.simulateSFVTick(s, 0, 0);
    expect(s.p[1].st).toBe(ST.DIZZY);
    run(s, hold(0, 119));
    expect(s.p[1].st).toBe(ST.DIZZY);
    run(s, [0]);
    expect(s.p[1].st).toBe(ST.IDLE); expect(s.p[1].sg).toBe(0);
  });
  it('special cancel input during hitstop fires the moment hitstop ends', () => {
    const s = fight(440, 500);
    run(s, hold(HP, 9));
    expect(s.p[1].st).toBe(ST.HIT); expect(s.p[0].hs).toBe(13);
    run(s, [DOWN, DOWN | RIGHT, RIGHT | LP]);
    expect(s.p[0].bf).toBe(M.HADO_L + 1);
    let n = 0; while (s.p[0].hs > 0 && n++ < 20) SFV.simulateSFVTick(s, 0, 0);
    expect(SFV.MOVE_LIST[s.p[0].mv].id).toBe('5HP');
    run(s, [0]);
    expect(SFV.MOVE_LIST[s.p[0].mv].id).toBe('HADO_L');
  });
  it('opposing projectiles cancel out', () => {
    const s = fight(200, 760);
    run(s, [DOWN, DOWN | RIGHT, RIGHT | LP, ...hold(0, 80)], [DOWN, DOWN | LEFT, LEFT | LP, ...hold(0, 80)]);
    expect(s.pr.length).toBe(0); expect([s.p[0].hp, s.p[1].hp]).toEqual([1000, 1000]);
  });
  it('V-Trigger: full gauge, I+K, +20% damage', () => {
    const s = fight(); s.p[0].vg = 300;
    run(s, [HP | HK]);
    expect(SFV.MOVE_LIST[s.p[0].mv].id).toBe('VT'); expect(s.p[0].vg).toBe(0); expect(s.p[0].vt).toBe(SFV.VT_TICKS - 1);
    run(s, hold(0, 20));
    s.p[0].x = 450; s.p[1].x = 500; s.p[1].st = ST.IDLE;
    run(s, [LP, LP, LP, LP]);
    expect(s.p[1].hp).toBe(1000 - 36);
  });
});

describe('determinism & snapshot', () => {
  function randomMatch(seed: number, ticks: number) {
    const r = lcg(seed), s = SFV.createState();
    let m1 = 0, m2 = 0, maxBytes = 0;
    for (let k = 0; k < ticks; k++) {
      if (r() < 0.15) m1 = (r() * 256) | 0;
      if (r() < 0.15) m2 = (r() * 256) | 0;
      SFV.simulateSFVTick(s, m1, m2);
      if (k % 7 === 0) { maxBytes = Math.max(maxBytes, SFV.packState(s).length); expect(SFV.cloneState(s)).toEqual(s); }
    }
    return { s, maxBytes };
  }
  it('same inputs → same state hash', () => {
    expect(SFV.hashState(randomMatch(7, 6000).s)).toBe(SFV.hashState(randomMatch(7, 6000).s));
  });
  it('packed state stays under 600 bytes and round-trips exactly', () => {
    for (const seed of [1, 2, 3]) expect(randomMatch(seed, 6000).maxBytes).toBeLessThan(600);
  });
});

describe('server (simulated sfv-room)', () => {
  const { SFVServer } = mods;
  function room(extra: any = {}) {
    const out: any[] = [];
    const r = new SFVServer.SFVRoom({ matchId: 'm-' + Math.random(), now: 0, send: (pid: number, msg: any) => out.push([pid, msg]), ...extra });
    return { r, out };
  }
  it('rate limiter: 35 input messages per second, the 36th is dropped (not disconnected)', () => {
    const l = new SFVServer.RateLimiter(SFVServer.INPUT_LIMIT);
    for (let k = 0; k < 35; k++) expect(l.allow(k)).toBe(true);
    expect(l.allow(500)).toBe(false);
    expect(l.allow(1000)).toBe(true);
  });
  it('input repeat: a mask stays until the next change', () => {
    const { r, out } = room();
    r.receive(1, { type: 'sfv.input', seq: 1, inputs: [{ tick: 3, mask: LEFT }, { tick: 6, mask: 0 }] }, 0);
    r.update(SFV.TICK_MS * 8 + 1);
    expect([2, 3, 4, 5, 6, 7].map((t) => SFV.maskAt(r.state.p[0], t))).toEqual([0, LEFT, LEFT, LEFT, 0, 0]);
    expect(r.seq[0]).toBe(1);
    expect(out.find(([, m]) => m.type === 'sfv.ticks')?.[1].ack).toEqual([1, 0]);
  });
  it('late input is counted and applied on the next tick', () => {
    const { r } = room();
    for (let k = 1; k <= 10; k++) r.update(SFV.TICK_MS * k + 1);
    expect(r.tick).toBe(10);
    r.receive(1, { type: 'sfv.input', seq: 1, inputs: [{ tick: 8, mask: RIGHT }] }, SFV.TICK_MS * 10 + 2);
    expect(r.stats.late[0]).toBe(1);
    r.update(SFV.TICK_MS * 11 + 1);
    expect(SFV.maskAt(r.state.p[0], 11)).toBe(RIGHT);
  });
  it('cumulative packets do not reapply an already accepted edge', () => {
    const { r } = room();
    r.receive(1, { type: 'sfv.input', seq: 1, inputs: [{ tick: 3, mask: LEFT }] }, 0);
    r.update(SFV.TICK_MS * 4 + 1);
    r.receive(1, { type: 'sfv.input', seq: 2, inputs: [{ tick: 3, mask: LEFT }, { tick: 6, mask: 0 }] }, SFV.TICK_MS * 4 + 2);
    r.update(SFV.TICK_MS * 7 + 1);
    expect(r.stats.late[0]).toBe(0);
    expect([5, 6, 7].map((t) => SFV.maskAt(r.state.p[0], t))).toEqual([LEFT, 0, 0]);
  });
  it('rejects junk input entries', () => {
    const { r } = room();
    r.receive(1, { type: 'sfv.input', seq: 1, inputs: [{ tick: 3, mask: 999 }, { tick: 'x', mask: 1 }, { tick: 500, mask: 1 }] }, 0);
    expect(r.stats.bad[0]).toBe(3);
  });
  it('20:00 closing aborts without settling', () => {
    const { r, out } = room({ closesAt: 1000 });
    r.update(1000);
    expect(r.status).toBe('aborted'); expect(r.result).toBeUndefined();
    expect(out.at(-1)[1]).toMatchObject({ type: 'sfv.ended', aborted: true, reason: 'GAME_CLOSED' });
  });
});

describe('netcode: prediction + rollback over a laggy link', () => {
  const { SFVClient } = mods;
  it('new input packets carry unacknowledged edges and ACK clears them', () => {
    const sent: any[] = [];
    const c = new SFVClient.NetClient({ pid: 1, sample: () => 0, send: (m: any) => sent.push(m) });
    c.queue = [{ tick: 3, mask: LEFT }]; c.flush(0, 2);
    c.queue = [{ tick: 5, mask: 0 }]; c.flush(40, 4);
    expect(sent.filter((m) => m.type === 'sfv.input').map((m) => m.inputs)).toEqual([
      [{ tick: 3, mask: LEFT }],
      [{ tick: 3, mask: LEFT }, { tick: 5, mask: 0 }],
    ]);
    c.onAck(2); expect(c.unacked.size).toBe(0);
  });
  function simulate(rtt: number, jitter: number, seconds: number, seed: number) {
    const r1 = lcg(seed), r2 = lcg(seed + 1), net = lcg(seed + 2);
    const serverHash = new Map<number, number>();
    let stopAt = (seconds - 3) * 1000, now = 0;
    // 兩邊都亂按（約每 10 tick 換一次），最後 3 秒放手，等全部收斂
    const rand = (r: () => number) => { let m = 0; return () => { if (now < stopAt && r() < 0.1) m = (r() * 256) | 0; else if (now >= stopAt) m = 0; return m; }; };
    const w = SFVClient.createWorld({ matchId: 'net-' + seed, now: 0, net: { rtt, jitter }, rng: net, samplers: [rand(r1), rand(r2)],
      onTick: (t: number, s: any) => serverHash.set(t, SFV.hashState(s)) });
    let maxPerSec = 0;
    for (now = 0; now < seconds * 1000; now += 2) {
      w.pump(now);
      for (const c of w.clients) maxPerSec = Math.max(maxPerSec, c.perSec(now));
    }
    // 客戶端本來就跑在伺服器前面：再讓伺服器（和網路）單獨跑 1 秒，才有第 L tick 的權威狀態可比
    for (const end = now + 1000; now < end; now += 2) { for (const l of w.up) l.pump(now); w.room.update(now); }
    return { w, serverHash, maxPerSec };
  }
  it.each([[60, 5], [160, 30], [300, 60]])('rtt %ims jitter %ims: ≤30 msg/s, nothing dropped, both clients converge to the server', (rtt, jitter) => {
    const { w, serverHash, maxPerSec } = simulate(rtt, jitter, 12, rtt);
    expect(maxPerSec).toBeLessThanOrEqual(30);
    expect(w.room.stats.dropped).toEqual([0, 0]);
    expect(w.room.stats.oversize).toBe(0);
    expect(w.room.stats.maxBytes).toBeLessThan(SFVServer_NOTIFY());
    expect(w.room.stats.maxSnapBytes).toBeLessThan(600);
    for (const c of w.clients) {
      expect(c.stats.desync).toBe(0);
      expect(c.stats.rollbacks).toBeGreaterThan(0);
      expect(c.C).toBeGreaterThan(500);
      expect(c.histConf.length).toBe(4 * SFV.TICK_HZ); // 輸入紀錄保留最近 4 秒
      expect(SFV.hashState(c.confirmed)).toBe(serverHash.get(c.C));
      expect(SFV.hashState(c.predicted)).toBe(serverHash.get(c.L)); // 放手 3 秒後預測必然正確
    }
  });
  function SFVServer_NOTIFY() { return mods.SFVServer.NOTIFY_MAX; }
});
