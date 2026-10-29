import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 原型是單一 HTML 檔：把三個 MODULE 區塊抽出來在 Node 跑（引擎零 DOM，伺服器／客戶端網路層也不碰 DOM）。
const html = readFileSync(new URL('../sfv-proto.html', import.meta.url), 'utf8');
function block(n: number) {
  const a = html.indexOf(`// === [MODULE ${n}:`), b = html.indexOf(`// === [END MODULE ${n}] ===`);
  return a >= 0 && b > a ? html.slice(a, b) : '';
}
const code = [1, 2, 3].map(block).join('\n');
const mods = new Function(`${code}\nreturn { SFV, SFVServer: typeof SFVServer === 'undefined' ? null : SFVServer, SFVClient: typeof SFVClient === 'undefined' ? null : SFVClient };`)();
const { SFV } = mods;
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
  it('throw: 5T, no tech within 7 ticks → 120 damage + knockdown', () => {
    const s = run(fight(450, 490), [LP | LK, ...hold(0, 12)]);
    expect(s.p[1].hp).toBe(880); expect(s.p[1].st).toBe(ST.KD);
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
    const { r } = room();
    r.receive(1, { type: 'sfv.input', seq: 1, inputs: [{ tick: 3, mask: LEFT }, { tick: 6, mask: 0 }] }, 0);
    r.update(SFV.TICK_MS * 8 + 1);
    expect([2, 3, 4, 5, 6, 7].map((t) => SFV.maskAt(r.state.p[0], t))).toEqual([0, LEFT, LEFT, LEFT, 0, 0]);
    expect(r.seq[0]).toBe(1);
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
  it('rejects junk input entries', () => {
    const { r } = room();
    r.receive(1, { type: 'sfv.input', seq: 1, inputs: [{ tick: 3, mask: 999 }, { tick: 'x', mask: 1 }, { tick: 500, mask: 1 }] }, 0);
    expect(r.stats.bad[0]).toBe(3);
  });
  it('20:00 closing aborts without settling', () => {
    const { r, out } = room({ closesAt: 1000 });
    r.update(1000);
    expect(r.status).toBe('aborted'); expect(r.result).toBe(null);
    expect(out.at(-1)[1]).toMatchObject({ type: 'sfv.ended', aborted: true, reason: 'GAME_CLOSED' });
  });
  it('settlement is idempotent per match id', () => {
    const a = SFVServer.settleMatch('dup-1', { win: 0, users: ['a', 'b'] });
    const b = SFVServer.settleMatch('dup-1', { win: 0, users: ['a', 'b'] });
    expect(a.applied).toBe(true); expect(b.applied).toBe(false);
    expect(a.transfers).toEqual([{ from: 'b', to: 'a', coins: 20 }]); expect(b.transfers).toEqual(a.transfers);
    expect(SFVServer.settleMatch('dup-2', { win: 2, users: ['a', 'b'] }).transfers).toEqual([]);
  });
});

describe('netcode: prediction + rollback over a laggy link', () => {
  const { SFVClient } = mods;
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
      expect(SFV.hashState(c.confirmed)).toBe(serverHash.get(c.C));
      expect(SFV.hashState(c.predicted)).toBe(serverHash.get(c.L)); // 放手 3 秒後預測必然正確
    }
  });
  function SFVServer_NOTIFY() { return mods.SFVServer.NOTIFY_MAX; }
});
