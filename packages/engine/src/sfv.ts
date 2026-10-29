// @ts-nocheck
// 決定性 1v1 格鬥引擎；由離線原型與正式伺服器共用。
// === [MODULE 1: packages/engine/sfv.ts] ===
// 純決定性格鬥引擎：零 DOM、不用 Math.random、不讀時間，全部整數運算 → 伺服器（Node）與瀏覽器跑出來一模一樣。
// 座標：x = 角色中心（px），y = 腳底高度（0 = 地面，往上為負），vy 往上為負。
export const SFV = (() => {
  'use strict';
  const TICK_HZ = 60, TICK_MS = 1000 / TICK_HZ;
  const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8, LP = 16, HP = 32, LK = 64, HK = 128;
  const EASY_HADO = 256, EASY_DP = 512, EASY_TATSU = 1024, EASY_CA = 2048, INPUT_MASK = 4095;
  const PUNCH = LP | HP, KICK = LK | HK, BUTTONS = 0xff0;
  const STAGE_W = 960, WALL = 24;
  const HP_MAX = 1000, STUN_MAX = 1000, EX_BAR = 100, EX_MAX = 300, VG_MAX = 300;
  // 狀態裡的輸入環形緩衝：搓招最長看 24 tick（236236K），32 夠用，也讓快照維持在 600 bytes 以下
  const HIST = 32, CMD_WINDOW = 15, CA_WINDOW = 24, MULTI_PRESS = 3;
  const HS_LIGHT = 8, HS_HEAVY = 13;
  const GRAVITY = 1, JUMP_VY = -15, WALK_F = 4, WALK_B = 3, JUMP_VX = 4, PREJUMP_T = 3, JUMP_LAND = 3;
  const KD_SOFT = 40, KD_HARD = 60, DIZZY_T = 120, TECH_WINDOW = 7, TECH_T = 16, THROW_RECOVERY = 14, THROW_ANIM = 24, DASH_WINDOW = 10;
  const WHITE_DELAY = 90, WHITE_REGEN = 3, STUN_DELAY = 120, STUN_DECAY = 3;
  const SUPER_FREEZE = 30, VT_TICKS = 480;
  const ROUND_TICKS = 99 * TICK_HZ, INTRO_T = 90, KO_T = 150, WINS = 2, JUGGLE_MAX = 3, PROJ_CD = 6;
  const AIR_RESET = [3, -6];
  const ST = Object.freeze({ IDLE: 0, CROUCH: 1, PREJUMP: 2, JUMP: 3, MOVE: 4, HIT: 5, BLOCK: 6, AIRHIT: 7, KD: 8, THROWN: 9, THROWING: 10, DIZZY: 11, LAND: 12, KO: 13, TECH: 14 });
  const ST_NAME = Object.keys(ST);
  const RS = Object.freeze({ FIGHT: 0, KO: 1, OVER: 2, INTRO: 3 });

  // 盒子都是 [x, y, w, h]，x 以「面向前方」為正，相對角色中心與腳底
  const HURT = { stand: [[-18, -92, 36, 42], [-22, -50, 44, 50]], crouch: [[-20, -62, 40, 28], [-24, -34, 48, 34]], air: [[-18, -86, 36, 44], [-16, -42, 32, 30]] };
  const PUSH = { stand: [-16, -82, 32, 82], crouch: [-18, -56, 36, 56], air: [-14, -80, 28, 60], down: [-30, -18, 60, 18] };

  // ---------- defineMove：用區間算每一 tick 的判定與速度，不寫逐幀表 ----------
  function keyframes(list, dflt) {
    return (mt) => { for (const [a, b, vx, vy] of list) if (mt >= a && mt <= b) return [vx, vy]; return dflt; };
  }
  function defineMove(c) {
    const S = c.startup, A = c.active ?? 0, R = c.recovery ?? 0;
    const hits = c.hits ?? (c.hitbox || c.throwBox ? 1 : 0);
    const dmg = Array.isArray(c.dmg) ? c.dmg : new Array(Math.max(hits, 1)).fill(c.dmg ?? 0);
    const inv = c.invuln ?? [], hover = c.hover ?? null;
    const vel = typeof c.vel === 'function' ? c.vel : keyframes(c.vel ?? [], c.air || c.untilLand ? [null, null] : [0, null]);
    return Object.freeze({
      kind: 'normal', guard: 'high', cancel: [], posture: c.air ? 'air' : 'stand', hs: HS_HEAVY, pb: 8, stun: 0, hitstun: 0, blockstun: 0,
      ...c, S, A, R, hits, dmg, vel,
      total: c.untilLand ? Infinity : S + A + R,
      /** 第幾段攻擊判定（-1 = 沒有）：active 區間平均切成 hits 段 */
      hitIndex(mt) { if (!hits || mt < S || mt >= S + A) return -1; return Math.min(hits - 1, ((mt - S) * hits / A) | 0); },
      phase(mt) { return mt < S ? 0 : mt < S + A ? 1 : 2; },
      invulnAt(mt, kind) { for (const [a, b, k] of inv) if (mt >= a && mt <= b && (k === kind || k === 'full')) return true; return false; },
      hoverAt(mt) { return !!hover && mt >= hover[0] && mt <= hover[1]; },
    });
  }

  const LIGHT = { hs: HS_LIGHT, pb: 6, light: true }, HEAVY = { hs: HS_HEAVY, pb: 9 };
  const variants = (list, make) => list.map(make);
  const MOVE_LIST = [
    defineMove({ id: '5LP', limb: 'arm', name: '站輕拳', ...LIGHT, startup: 4, active: 2, recovery: 7, dmg: 30, stun: 70, hitstun: 13, blockstun: 11, hitbox: [18, -80, 44, 14], hurtExt: [18, -84, 40, 20], cancel: ['chain', 'special'] }),
    defineMove({ id: '5HP', limb: 'arm', name: '站重拳', ...HEAVY, startup: 9, active: 3, recovery: 18, dmg: 90, stun: 150, hitstun: 22, blockstun: 17, hitbox: [18, -84, 60, 18], hurtExt: [18, -88, 52, 24], cancel: ['special'] }),
    defineMove({ id: '5LK', limb: 'leg', name: '站輕腳', ...LIGHT, startup: 5, active: 2, recovery: 10, dmg: 30, stun: 70, hitstun: 14, blockstun: 12, hitbox: [16, -30, 52, 14], hurtExt: [16, -34, 46, 18], cancel: ['chain', 'special'] }),
    defineMove({ id: '5HK', limb: 'leg', name: '站重腳', ...HEAVY, pb: 12, startup: 10, active: 3, recovery: 20, dmg: 100, stun: 150, hitstun: 22, blockstun: 16, hitbox: [16, -96, 66, 20], hurtExt: [16, -100, 58, 26] }),
    defineMove({ id: '2LP', limb: 'arm', name: '蹲輕拳', ...LIGHT, posture: 'crouch', startup: 4, active: 2, recovery: 8, dmg: 30, stun: 70, hitstun: 13, blockstun: 11, hitbox: [16, -52, 42, 12], hurtExt: [16, -56, 36, 18], cancel: ['chain', 'special'] }),
    defineMove({ id: '2HP', limb: 'arm', reach: [18, -120], name: '蹲重拳（對空）', ...HEAVY, posture: 'crouch', startup: 6, active: 4, recovery: 20, dmg: 80, stun: 150, hitstun: 20, blockstun: 16, hitbox: [6, -124, 36, 70], hurtExt: [4, -116, 30, 54], cancel: ['special'] }),
    defineMove({ id: '2LK', limb: 'leg', name: '蹲輕腳', ...LIGHT, posture: 'crouch', guard: 'low', startup: 5, active: 2, recovery: 9, dmg: 20, stun: 50, hitstun: 12, blockstun: 10, hitbox: [16, -16, 48, 14], hurtExt: [16, -20, 42, 20], cancel: ['chain', 'special'] }),
    defineMove({ id: '2HK', limb: 'leg', name: '掃堂腿', ...HEAVY, posture: 'crouch', guard: 'low', kd: true, startup: 8, active: 3, recovery: 26, dmg: 90, stun: 150, blockstun: 16, hitbox: [14, -14, 74, 14], hurtExt: [14, -18, 66, 18] }),
    defineMove({ id: '8HP', limb: 'arm', name: '跳重拳', ...HEAVY, air: true, guard: 'overhead', startup: 7, active: 5, recovery: 8, dmg: 80, stun: 150, hitstun: 18, blockstun: 15, hitbox: [10, -62, 44, 26], hurtExt: [10, -66, 36, 30] }),
    defineMove({ id: '8HK', limb: 'leg', name: '跳重腳', ...HEAVY, air: true, guard: 'overhead', startup: 8, active: 6, recovery: 8, dmg: 90, stun: 150, hitstun: 18, blockstun: 15, hitbox: [6, -38, 60, 20], hurtExt: [6, -42, 52, 24] }),
    defineMove({ id: 'THROW', limb: 'arm', both: true, name: '摔技', kind: 'throw', startup: 5, active: 2, recovery: 20, dmg: 120, stun: 150, throwBox: [12, -84, 40, 64], hurtExt: [12, -80, 30, 40] }),
    // 快按兩下：後退步前 2 tick 不會被摔、3～9 tick 小跳離地（地面摔抓不到，但打得到），之後是破綻；前衝沒有無敵
    defineMove({ id: 'BDASH', name: '後退步', kind: 'system', startup: 1, recovery: 22, invuln: [[1, 2, 'throw']], vel: [[1, 2, -7, null], [3, 3, -7, -4], [4, 10, -7, null], [11, 14, -3, null]] }),
    defineMove({ id: 'FDASH', name: '前衝', kind: 'system', startup: 1, recovery: 16, vel: [[1, 12, 8, null], [13, 16, 2, null]] }),
    defineMove({ id: 'VT', name: '炸毛衝刺', kind: 'system', startup: 1, recovery: 17, vel: [[1, 14, 9, null]] }),
    ...variants([['L', 0, '輕'], ['H', 1, '重'], ['EX', 2, 'EX']], ([v, lv, n]) => defineMove({
      id: 'HADO_' + v, limb: 'arm', both: true, reach: [40, -66], name: `蛋波（${n}）`, kind: 'special', ex: lv === 2, projectile: lv, startup: 12, recovery: 33, hurtExt: [14, -84, 30, 22], cancel: ['super'],
    })),
    // 衝天啄：重／EX 版前 6 tick 完全無敵（拳腳壓過來打不到），整段上升攻擊都不吃飛行道具（穿波）；輕版沒有無敵
    defineMove({ id: 'DP_L', limb: 'arm', reach: [22, -112], name: '衝天啄（輕）', kind: 'special', untilLand: true, landRec: 14, startup: 3, active: 8, dmg: 100, stun: 150, blockstun: 20, launch: [2, -12], hitbox: [8, -110, 34, 84], hurtExt: [4, -100, 34, 60], vel: [[1, 2, 0, null], [3, 3, 2, -15]], cancel: ['super'] }),
    defineMove({ id: 'DP_H', limb: 'arm', reach: [22, -112], name: '衝天啄（重）', kind: 'special', untilLand: true, landRec: 22, startup: 5, active: 8, dmg: 140, stun: 200, blockstun: 20, launch: [2, -12], hitbox: [8, -110, 34, 84], hurtExt: [4, -100, 34, 60], invuln: [[1, 6, 'full'], [1, 12, 'proj']], vel: [[1, 4, 0, null], [5, 5, 3, -15]], cancel: ['super'] }),
    defineMove({ id: 'DP_EX', limb: 'arm', reach: [22, -112], name: '衝天啄（EX）', kind: 'special', ex: true, untilLand: true, landRec: 22, startup: 4, active: 10, hits: 2, dmg: [80, 80], stun: 120, blockstun: 20, launch: [2, -12], launchLast: true, hitbox: [8, -110, 34, 84], hurtExt: [4, -100, 34, 60], invuln: [[1, 6, 'full'], [1, 13, 'proj']], vel: [[1, 3, 0, null], [4, 4, 3, -15]], cancel: ['super'] }),
    ...variants([['L', 4, [40, 40, 40], null, '輕'], ['H', 6, [45, 45, 45], null, '重'], ['EX', 6, [50, 50, 60], [1, 7, 'full'], 'EX']], ([v, spd, dmg, inv, n]) => defineMove({
      id: 'TATSU_' + v, limb: 'spin', name: `旋風翅（${n}）`, kind: 'special', ex: v === 'EX', untilLand: true, landRec: 10, startup: 7, active: 24, hits: 3, dmg, stun: 60,
      hitstun: 18, blockstun: 14, pb: 4, launch: [3, -9], launchLast: true, hitbox: [-56, -58, 112, 40], hover: [5, 30],
      // 下半身沒有受擊判定、飛行道具穿過（越過下段與波）
      invuln: [[7, 30, 'lower'], [7, 30, 'proj'], ...(inv ? [inv] : [])],
      vel: [[1, 4, 0, -7], [5, 30, spd, 0], [31, 31, 0, null]], cancel: ['super'],
    })),
    defineMove({
      id: 'CA', limb: 'kicks', name: '火雞連環踢', kind: 'super', startup: 4, active: 30, recovery: 24, hits: 6, dmg: [55, 55, 55, 55, 55, 75], hitstun: 24, blockstun: 12, pb: 2,
      launch: [4, -10], launchLast: true, hitbox: [10, -90, 56, 80], hurtExt: [10, -86, 46, 70], invuln: [[1, 10, 'full']],
      vel: (mt, cn) => [mt < 4 ? 0 : mt < 34 ? (cn ? 3 : 11) : 0, null],
    }),
  ];
  const M = {}; MOVE_LIST.forEach((m, i) => { M[m.id] = i; });
  const PROJ = [
    { speed: 5, n: 1, dmg: 60, stun: 100, hitstun: 20, blockstun: 16, hs: HS_HEAVY, pb: 8, kind: 'special', w: 32, h: 24 },
    { speed: 8, n: 1, dmg: 60, stun: 100, hitstun: 20, blockstun: 16, hs: HS_HEAVY, pb: 8, kind: 'special', w: 32, h: 24 },
    { speed: 7, n: 2, dmg: 50, stun: 80, hitstun: 20, blockstun: 16, hs: HS_HEAVY, pb: 8, kind: 'special', w: 40, h: 30 },
  ];

  // ---------- 狀態 ----------
  const P_FIELDS = ['x', 'y', 'vx', 'vy', 'f', 'st', 't', 'mv', 'mt', 'hm', 'cn', 'hs', 'bf', 'hp', 'wd', 'wdT', 'sg', 'sgT', 'dz', 'ex', 'vg', 'vt', 'cb', 'jg', 'kb', 'air', 'cr'];
  const Q_FIELDS = ['o', 'x', 'y', 'vx', 'n', 'lv', 'cd'];
  const S_FIELDS = ['tick', 'frz', 'fo', 'rs', 'rt', 'rnd', 'tm', 'win', 'to', 'lw'];
  function newPlayer(x, f) {
    const p = {}; for (const k of P_FIELDS) p[k] = 0;
    Object.assign(p, { x, f, mv: -1, hp: HP_MAX }); p.hist = new Array(HIST).fill(0);
    return p;
  }
  function createState(modes = [0, 0]) {
    return { tick: 0, frz: 0, fo: 0, rs: RS.INTRO, rt: INTRO_T, rnd: 1, tm: ROUND_TICKS, win: -1, to: 0, lw: -1, w: [0, 0],
      mode: modes.slice(), p: [newPlayer(STAGE_W / 2 - 120, 1), newPlayer(STAGE_W / 2 + 120, -1)], pr: [] };
  }
  const hexOf = (a) => a.map((v) => v.toString(16).padStart(3, '0')).join('');
  const histOf = (h) => { const a = new Array(HIST); for (let i = 0; i < HIST; i++) a[i] = parseInt(h.substr(i * 3, 3), 16); return a; };
  /** 快照：純數字陣列＋輸入歷史 hex 字串，整包 < 600 bytes */
  function packState(s) {
    return JSON.stringify([S_FIELDS.map((k) => s[k]), s.w, s.p.map((p) => [...P_FIELDS.map((k) => p[k]), hexOf(p.hist)]), s.pr.map((q) => Q_FIELDS.map((k) => q[k])), s.mode]);
  }
  function unpackState(str) {
    const [g, w, ps, qs, mode] = JSON.parse(str), s = { mode: mode ?? [0, 0] };
    S_FIELDS.forEach((k, j) => { s[k] = g[j]; });
    s.w = w.slice();
    s.p = ps.map((a) => { const p = {}; P_FIELDS.forEach((k, j) => { p[k] = a[j]; }); p.hist = histOf(a[P_FIELDS.length]); return p; });
    s.pr = qs.map((a) => { const q = {}; Q_FIELDS.forEach((k, j) => { q[k] = a[j]; }); return q; });
    return s;
  }
  const cloneState = (s) => unpackState(packState(s));
  function hashStr(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
  const hashState = (s) => hashStr(packState(s));

  // ---------- 輸入 ----------
  const maskAt = (p, t) => p.hist[((t % HIST) + HIST) % HIST];
  const pressAt = (p, t) => maskAt(p, t) & ~maskAt(p, t - 1) & BUTTONS;
  /** 數字鍵方向（相對面向）：6 = 前、4 = 後；左右同按、上下同按都算沒按 */
  function dirOf(mask, f) {
    const l = mask & LEFT, r = mask & RIGHT, u = mask & UP, d = mask & DOWN;
    const h = l && !r ? -1 : r && !l ? 1 : 0, v = u && !d ? 1 : d && !u ? -1 : 0;
    return 5 + h * f + v * 3;
  }
  /** 往回找：seq 依序出現在最近 win 個 tick 裡（中間可夾雜其他方向，鍵盤寬容） */
  function motion(p, t, f, seq, win) {
    let i = seq.length - 1;
    for (let k = 0; k < win && i >= 0; k++) if (dirOf(maskAt(p, t - k), f) === seq[i]) i--;
    return i < 0;
  }
  /** 快按兩下同一方向：這一 tick 剛按下 d，往回只隔著放開（5）就碰到上一次的 d */
  function doubleTap(p, t, f, d) {
    if (dirOf(maskAt(p, t), f) !== d || dirOf(maskAt(p, t - 1), f) === d) return false;
    for (let k = 1; k <= DASH_WINDOW; k++) { const dk = dirOf(maskAt(p, t - k), f); if (dk === d) return true; if (dk !== 5) return false; }
    return false;
  }
  function recentPress(p, t) { let r = 0; for (let k = 0; k < MULTI_PRESS; k++) r |= pressAt(p, t - k); return r; }
  /** 雙鍵：兩顆都在最近 3 tick 內按下，而且其中一顆是這一 tick 按的 */
  const comboPressed = (p, t, bits) => (recentPress(p, t) & bits) === bits && (pressAt(p, t) & bits) !== 0;

  // ---------- 判定框 ----------
  const overlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  const wbox = (p, b) => (p.f === 1 ? [p.x + b[0], p.y + b[1], b[2], b[3]] : [p.x - b[0] - b[2], p.y + b[1], b[2], b[3]]);
  function poseOf(p) {
    if (p.y < 0) return 'air';
    if (p.st === ST.CROUCH) return 'crouch';
    if (p.st === ST.MOVE) return MOVE_LIST[p.mv].posture === 'crouch' ? 'crouch' : 'stand';
    if (p.st === ST.HIT || p.st === ST.BLOCK) return p.cr ? 'crouch' : 'stand';
    return 'stand';
  }
  function pushbox(p) {
    const lying = (p.st === ST.KD || p.st === ST.KO) && p.y === 0;
    return wbox(p, PUSH[lying ? 'down' : poseOf(p)]);
  }
  function hurtboxes(p) {
    const st = p.st;
    if (st === ST.KD || st === ST.KO || st === ST.THROWN || st === ST.THROWING || st === ST.TECH) return [];
    if (st === ST.AIRHIT && p.jg >= JUGGLE_MAX) return [];
    let boxes = HURT[poseOf(p)];
    if (st === ST.MOVE) {
      const mv = MOVE_LIST[p.mv];
      if (mv.invulnAt(p.mt, 'full')) return [];
      if (mv.invulnAt(p.mt, 'lower')) boxes = boxes.slice(0, 1);
      if (mv.hurtExt && p.mt >= mv.S) boxes = [...boxes, mv.hurtExt];
    }
    return boxes.map((b) => wbox(p, b));
  }
  function hitboxOf(p) {
    if (p.st !== ST.MOVE) return null;
    const mv = MOVE_LIST[p.mv], k = mv.hitIndex(p.mt);
    if (k < 0) return null;
    return { box: wbox(p, mv.throwBox ?? mv.hitbox), used: (p.hm >> k) & 1, thr: !!mv.throwBox, k };
  }
  const projBox = (q) => { const d = PROJ[q.lv]; return [q.x - d.w / 2, q.y - d.h / 2, d.w, d.h]; };
  const projInvuln = (p) => p.st === ST.MOVE && MOVE_LIST[p.mv].invulnAt(p.mt, 'proj');
  function throwable(p) {
    if (p.y !== 0) return false;
    if (p.st === ST.MOVE) return !MOVE_LIST[p.mv].invulnAt(p.mt, 'throw');
    return p.st === ST.IDLE || p.st === ST.CROUCH || p.st === ST.LAND || p.st === ST.PREJUMP || p.st === ST.DIZZY;
  }
  /** 後(4) 站防擋中段/上段（overhead）；後下(1) 蹲防擋中段/下段 */
  function canBlock(s, B, fromX, guard) {
    if (B.y !== 0 || !(B.st === ST.IDLE || B.st === ST.CROUCH || B.st === ST.BLOCK)) return false;
    const toward = fromX === B.x ? B.f : fromX > B.x ? 1 : -1;
    const d = dirOf(maskAt(B, s.tick), toward);
    if (guard === 'low') return d === 1;
    if (guard === 'overhead') return d === 4;
    return d === 1 || d === 4;
  }

  // ---------- 指令解析（優先序：炸毛 > 火雞連環踢 > 衝天啄 > 蛋波 > 旋風翅 > 摔 > 普通技） ----------
  function pickCommand(s, i, o) {
    const p = s.p[i], t = s.tick, f = p.f, press = pressAt(p, t);
    if (!press) return -1;
    if (s.mode[i] === 1) {
      if (o.sup && p.ex >= EX_MAX && (press & EASY_CA)) return M.CA;
      if (o.special) {
        if (press & EASY_DP) return M.DP_H;
        if ((press & EASY_HADO) && !s.pr.some((q) => q.o === i)) return M.HADO_L;
        if (press & EASY_TATSU) return M.TATSU_L;
      }
    }
    if (o.air) return press & PUNCH ? M['8HP'] : press & KICK ? M['8HK'] : -1;
    const recent = recentPress(p, t), both = (b) => comboPressed(p, t, b);
    const has = (seq, win = CMD_WINDOW) => motion(p, t, f, seq, win);
    if (o.vt && p.vt === 0 && p.vg >= VG_MAX && both(HP | HK)) return M.VT;
    if (o.sup && p.ex >= EX_MAX && (press & KICK) && has([2, 3, 6, 2, 3, 6], CA_WINDOW)) return M.CA;
    if (o.special) {
      const exP = (recent & PUNCH) === PUNCH && p.ex >= EX_BAR, exK = (recent & KICK) === KICK && p.ex >= EX_BAR;
      if ((press & PUNCH) && (has([6, 2, 3]) || has([6, 2, 6]))) return exP ? M.DP_EX : press & HP ? M.DP_H : M.DP_L;
      if ((press & PUNCH) && has([2, 3, 6]) && !s.pr.some((q) => q.o === i)) return exP ? M.HADO_EX : press & HP ? M.HADO_H : M.HADO_L;
      if ((press & KICK) && has([2, 1, 4])) return exK ? M.TATSU_EX : press & HK ? M.TATSU_H : M.TATSU_L;
    }
    if (o.thrw && both(LP | LK)) return M.THROW;
    if (o.normal || o.chain) {
      const btn = press & HP ? 'HP' : press & HK ? 'HK' : press & LP ? 'LP' : press & LK ? 'LK' : null;
      if (btn) {
        const id = M[(dirOf(maskAt(p, t), f) <= 3 ? '2' : '5') + btn];
        if (o.normal || MOVE_LIST[id].light) return id;
      }
    }
    return -1;
  }
  /** 這個狀態下能出什麼：中立全開；出招中看命中後的取消（必殺／超必殺／連打）與前 2 tick 的改招 */
  function optionsFor(p) {
    switch (p.st) {
      case ST.IDLE: case ST.CROUCH: return { vt: true, sup: true, special: true, thrw: true, normal: true };
      case ST.LAND: return { vt: true };
      case ST.JUMP: return p.air ? null : { air: true };
      case ST.MOVE: {
        const mv = MOVE_LIST[p.mv], c = p.cn === 1;
        const conv = p.mt <= 2 && p.y === 0 && (mv.kind === 'normal' || (mv.kind === 'special' && !mv.ex));
        return {
          vt: mv.kind !== 'super' && mv.kind !== 'system',
          sup: conv || (c && (mv.cancel.includes('special') || mv.cancel.includes('super'))),
          special: conv || (c && mv.cancel.includes('special')),
          thrw: conv && mv.kind === 'normal',
          chain: c && mv.cancel.includes('chain'),
        };
      }
      default: return null;
    }
  }
  function startMove(s, i, id) {
    const p = s.p[i], mv = MOVE_LIST[id];
    p.st = ST.MOVE; p.mv = id; p.mt = 0; p.hm = 0; p.cn = 0; p.bf = 0;
    if (mv.air) p.air = 1;
    if (mv.ex) p.ex -= EX_BAR;
    else if (mv.kind === 'special') p.ex = Math.min(EX_MAX, p.ex + 10);
    if (mv.kind === 'super') { p.ex -= EX_MAX; s.frz = SUPER_FREEZE; s.fo = i + 1; }
    if (mv.id === 'VT') { p.vg = 0; p.vt = VT_TICKS; }
  }
  function walk(p, m) {
    const d = dirOf(m, p.f);
    if (d >= 7) { p.st = ST.PREJUMP; p.t = PREJUMP_T; p.vx = d === 9 ? JUMP_VX * p.f : d === 7 ? -JUMP_VX * p.f : 0; return; }
    if (d <= 3) { p.st = ST.CROUCH; p.vx = 0; return; }
    p.st = ST.IDLE; p.vx = d === 6 ? WALK_F * p.f : d === 4 ? -WALK_B * p.f : 0;
  }
  function decide(s, i) {
    const p = s.p[i], t = s.tick;
    if (p.st === ST.THROWN) { // 被抓後 7 tick 內按 U+J 解摔
      const A = s.p[1 - i];
      if (comboPressed(p, t, LP | LK) && A.st === ST.THROWING && A.t > THROW_ANIM) techPair(s);
      return;
    }
    const opts = optionsFor(p);
    if (p.hs > 0) { // Hitstop 中：先記下取消，Hitstop 一結束就出
      if (p.st === ST.MOVE && opts) { const id = pickCommand(s, i, { ...opts, normal: false }); if (id >= 0) p.bf = id + 1; }
      return;
    }
    if (p.bf) { const id = p.bf - 1; p.bf = 0; startMove(s, i, id); return; }
    if (!opts) return;
    const id = pickCommand(s, i, opts);
    if (id >= 0) { startMove(s, i, id); return; }
    if (p.st === ST.IDLE && doubleTap(p, t, p.f, 4)) { startMove(s, i, M.BDASH); return; }
    if (p.st === ST.IDLE && doubleTap(p, t, p.f, 6)) { startMove(s, i, M.FDASH); return; }
    if (p.st === ST.IDLE || p.st === ST.CROUCH) walk(p, maskAt(p, t));
  }

  // ---------- Phase 1：移動 ----------
  function fly(p) {
    p.vy += GRAVITY; p.x += p.vx; p.y += p.vy;
    if (p.y >= 0) { p.y = 0; p.vy = 0; p.vx = 0; return true; }
    return false;
  }
  function toIdle(p) { p.st = ST.IDLE; p.t = 0; p.mv = -1; p.vx = 0; p.vy = 0; p.air = 0; p.cn = 0; p.hm = 0; }
  function recover(p) {
    if (p.dz) { p.st = ST.DIZZY; p.t = DIZZY_T; p.dz = 0; p.vx = 0; p.mv = -1; return; }
    toIdle(p); p.cb = 0;
  }
  function spawnProjectile(s, i, lv) {
    const p = s.p[i], d = PROJ[lv];
    s.pr.push({ o: i, x: p.x + 46 * p.f, y: -66, vx: d.speed * p.f, n: d.n, lv, cd: 0 });
  }
  function moveTick(s, i) {
    const p = s.p[i], mv = MOVE_LIST[p.mv];
    p.mt++;
    const [vx, vy] = mv.vel(p.mt, p.cn);
    if (vx !== null) p.vx = vx === 0 ? 0 : vx * p.f; // 避免 -0（JSON 會變成 0，快照比對就不一致）
    if (vy !== null) p.vy = vy;
    if (mv.projectile !== undefined && p.mt === mv.S) spawnProjectile(s, i, mv.projectile);
    if (p.y < 0 || p.vy < 0) {
      if (!mv.hoverAt(p.mt)) p.vy += GRAVITY;
      p.x += p.vx; p.y += p.vy;
      if (p.y >= 0) {
        p.y = 0; p.vy = 0; p.vx = 0;
        if (mv.air || mv.untilLand) { p.st = ST.LAND; p.t = mv.landRec ?? JUMP_LAND; p.mv = -1; p.air = 0; p.cn = 0; p.hm = 0; }
        return;
      }
    } else p.x += p.vx;
    if (p.mt >= mv.total) { p.mv = -1; p.cn = 0; p.hm = 0; if (p.y < 0) p.st = ST.JUMP; else toIdle(p); }
  }
  function throwLands(s, i) {
    const A = s.p[i], B = s.p[1 - i], mv = MOVE_LIST[M.THROW];
    let dmg = mv.dmg[0]; if (A.vt > 0) dmg = (dmg * 6 / 5) | 0;
    B.wd = 0; B.wdT = 0; B.hp -= dmg; B.cb = 1;
    if (!B.dz) { B.sg = Math.min(STUN_MAX, B.sg + mv.stun); B.sgT = STUN_DELAY; if (B.sg >= STUN_MAX) B.dz = 1; }
    A.ex = Math.min(EX_MAX, A.ex + ((dmg / 5) | 0)); B.vg = Math.min(VG_MAX, B.vg + ((dmg / 2) | 0));
    B.st = ST.KD; B.t = KD_HARD; B.y = 0; B.vx = 0; B.x = Math.max(WALL, Math.min(STAGE_W - WALL, A.x + 64 * A.f));
    B.hs = HS_HEAVY; // 摔到地上的震動
    A.st = ST.LAND; A.t = THROW_RECOVERY;
  }
  /** 摔的動畫：抓住 → 舉過頭頂 → 往前摔（整數拋物線，伺服器與瀏覽器算得一樣） */
  function throwArc(s, i) {
    const A = s.p[i], B = s.p[1 - i], n = THROW_ANIM - A.t, half = THROW_ANIM >> 1;
    const off = n <= half ? 30 - ((20 * n / half) | 0) : 10 + ((54 * (n - half) / half) | 0);
    B.x = Math.max(WALL, Math.min(STAGE_W - WALL, A.x + off * A.f));
    B.y = -((400 * n * (THROW_ANIM - n) / (THROW_ANIM * THROW_ANIM)) | 0);
  }
  function physics(s, i) {
    const p = s.p[i];
    if (p.hs > 0) { p.hs--; return; }
    switch (p.st) {
      case ST.IDLE: case ST.CROUCH: p.x += p.vx; break;
      case ST.PREJUMP: if (--p.t <= 0) { p.st = ST.JUMP; p.vy = JUMP_VY; p.air = 0; } break;
      case ST.JUMP: if (fly(p)) { p.st = ST.LAND; p.t = JUMP_LAND; p.air = 0; } break;
      case ST.MOVE: moveTick(s, i); break;
      case ST.HIT: case ST.BLOCK: case ST.KD: if (--p.t <= 0) recover(p); break;
      case ST.AIRHIT: if (fly(p)) { p.st = ST.KD; p.t = KD_SOFT; p.jg = 0; } break;
      case ST.DIZZY: if (--p.t <= 0) { p.sg = 0; p.dz = 0; p.cb = 0; toIdle(p); } break;
      case ST.LAND: case ST.TECH: if (--p.t <= 0) toIdle(p); break;
      case ST.THROWING: if (--p.t <= 0) throwLands(s, i); else if (p.t < THROW_ANIM) throwArc(s, i); break;
      case ST.KO: if (p.y < 0) fly(p); break;
      default: break;
    }
    if (p.kb !== 0) { p.x += p.kb; p.kb -= Math.sign(p.kb); }
  }
  /** Pushbox 交集雙向對稱推開；卡牆時整段推給另一邊（角落不會穿過去） */
  function resolvePush(s) {
    const [a, b] = s.p, lo = WALL, hi = STAGE_W - WALL;
    const held = a.st === ST.THROWN || b.st === ST.THROWN; // 摔的過程兩人重疊，不推開
    const aLeft = a.x < b.x || (a.x === b.x && a.f === 1);
    const [L, R] = aLeft ? [a, b] : [b, a];
    let A = pushbox(L), B = pushbox(R);
    if (!held && overlap(A, B)) {
      const ov = A[0] + A[2] - B[0], half = ov >> 1;
      L.x -= half; R.x += ov - half;
    }
    for (const p of s.p) p.x = Math.max(lo, Math.min(hi, p.x));
    A = pushbox(L); B = pushbox(R);
    if (!held && overlap(A, B)) {
      const ov = A[0] + A[2] - B[0];
      if (L.x <= lo) R.x = Math.min(hi, R.x + ov); else L.x = Math.max(lo, L.x - ov);
    }
  }
  function autoFace(s) {
    for (let i = 0; i < 2; i++) {
      const p = s.p[i], o = s.p[1 - i];
      if (p.y === 0 && o.x !== p.x && (p.st === ST.IDLE || p.st === ST.CROUCH || p.st === ST.LAND || p.st === ST.PREJUMP)) p.f = o.x > p.x ? 1 : -1;
    }
  }

  // ---------- Phase 2：兩階段判定（先收集雙方命中，再一起結算 → 同 tick 相殺公平） ----------
  function strikeData(h) {
    if (h.q) return { ...PROJ[h.q.lv], launch: null, kd: false };
    const mv = h.mv, last = h.k === mv.hits - 1;
    return { dmg: mv.dmg[h.k], stun: mv.stun, hitstun: mv.hitstun, blockstun: mv.blockstun, hs: mv.hs, pb: mv.pb, kind: mv.kind, kd: !!mv.kd,
      launch: mv.launch && (!mv.launchLast || last) ? mv.launch : null };
  }
  function pushback(A, B, dir, pb, isProj) {
    const atWall = dir > 0 ? B.x >= STAGE_W - WALL - 2 : B.x <= WALL + 2;
    if (!isProj && atWall) A.kb = -dir * pb; else B.kb = dir * pb;
  }
  function applyStrike(s, h) {
    const A = s.p[h.i], B = s.p[1 - h.i], d = strikeData(h);
    const dir = h.q ? Math.sign(h.q.vx) : A.f;
    if (h.q) { h.q.n--; h.q.cd = PROJ_CD; if (A.st === ST.MOVE && MOVE_LIST[A.mv].projectile !== undefined) A.cn = 1; }
    else { A.hm |= 1 << h.k; A.cn = 1; }
    B.mv = -1; B.bf = 0; B.vx = 0;
    if (h.blocked) {
      B.st = ST.BLOCK; B.t = d.blockstun; B.cr = h.crouch;
      if (d.kind !== 'normal') { // 必殺技被擋：白殘血（不會被白血打死）
        const chip = Math.min((d.dmg / 4) | 0, B.hp - 1);
        if (chip > 0) { B.hp -= chip; B.wd += chip; }
        B.wdT = WHITE_DELAY;
      }
      A.ex = Math.min(EX_MAX, A.ex + ((d.dmg / 10) | 0));
      pushback(A, B, dir, d.pb, !!h.q);
    } else {
      const scale = d.kind === 'super' || B.cb < 2 ? 100 : Math.max(50, 100 - 10 * (B.cb - 1));
      let dmg = (d.dmg * scale / 100) | 0;
      if (A.vt > 0) dmg = (dmg * 6 / 5) | 0; // 炸毛中攻擊力 +20%
      B.wd = 0; B.wdT = 0; B.hp -= dmg; B.cb++;
      if (B.st === ST.DIZZY) { B.sg = 0; B.dz = 0; }
      else if (!B.dz && d.stun) { B.sg = Math.min(STUN_MAX, B.sg + d.stun); B.sgT = STUN_DELAY; if (B.sg >= STUN_MAX) B.dz = 1; }
      A.ex = Math.min(EX_MAX, A.ex + ((dmg / 5) | 0));
      B.ex = Math.min(EX_MAX, B.ex + ((dmg / 10) | 0));
      B.vg = Math.min(VG_MAX, B.vg + ((dmg / 2) | 0));
      if (d.launch || B.y < 0) { const l = d.launch ?? AIR_RESET; B.st = ST.AIRHIT; B.vx = l[0] * dir; B.vy = l[1]; B.jg++; B.air = 0; }
      else if (d.kd) { B.st = ST.KD; B.t = KD_HARD; B.cr = 0; }
      else { B.st = ST.HIT; B.t = d.hitstun; B.cr = h.crouch; pushback(A, B, dir, d.pb, !!h.q); }
    }
    B.hs = d.hs;
    if (!h.q) A.hs = Math.max(A.hs, d.hs);
  }
  function grab(s, i) {
    const A = s.p[i], B = s.p[1 - i];
    A.st = ST.THROWING; A.t = TECH_WINDOW + THROW_ANIM; A.mv = -1; A.vx = 0; A.cn = 0; A.hs = 0;
    B.st = ST.THROWN; B.t = 0; B.mv = -1; B.bf = 0; B.vx = 0; B.hs = 0;
  }
  function techPair(s) { for (const p of s.p) { p.st = ST.TECH; p.t = TECH_T; p.mv = -1; p.vx = 0; p.vy = 0; p.kb = -p.f * 7; } }
  function collect(s, i, h, fromX) {
    const B = s.p[1 - i], guard = h.q ? 'high' : h.mv.guard;
    const blocked = canBlock(s, B, fromX, guard);
    const toward = fromX === B.x ? B.f : fromX > B.x ? 1 : -1;
    const crouch = blocked ? dirOf(maskAt(B, s.tick), toward) === 1 : poseOf(B) === 'crouch';
    return { i, ...h, blocked, crouch: crouch ? 1 : 0 };
  }
  function combat(s) {
    for (let a = 0; a < s.pr.length; a++) for (let b = a + 1; b < s.pr.length; b++) { // 雙方的波互撞抵銷
      const A = s.pr[a], B = s.pr[b];
      if (A.o !== B.o && A.n > 0 && B.n > 0 && overlap(projBox(A), projBox(B))) { const k = Math.min(A.n, B.n); A.n -= k; B.n -= k; }
    }
    const hits = [];
    for (let i = 0; i < 2; i++) {
      const A = s.p[i], B = s.p[1 - i], hb = hitboxOf(A);
      if (hb && !hb.used) {
        if (hb.thr) { if (throwable(B) && overlap(hb.box, pushbox(B))) hits.push({ i, thr: true }); }
        else if (hurtboxes(B).some((b) => overlap(hb.box, b))) hits.push(collect(s, i, { mv: MOVE_LIST[A.mv], k: hb.k }, A.x));
      }
      for (const q of s.pr) {
        if (q.o === i && q.cd === 0 && q.n > 0 && !projInvuln(B) && hurtboxes(B).some((b) => overlap(projBox(q), b))) hits.push(collect(s, i, { q }, q.x));
      }
    }
    for (const h of hits) if (!h.thr) applyStrike(s, h);
    const th = hits.filter((h) => h.thr);
    if (th.length === 2) techPair(s); // 同時互摔 → 彈開
    else if (th.length === 1) { const A = s.p[th[0].i], B = s.p[1 - th[0].i]; if (A.st === ST.MOVE && throwable(B)) grab(s, th[0].i); }
    s.pr = s.pr.filter((q) => q.n > 0);
  }

  // ---------- 回合 ----------
  function gauges(p) {
    if (p.wdT > 0) p.wdT--; else if (p.wd > 0) { const r = Math.min(p.wd, WHITE_REGEN); p.wd -= r; p.hp += r; }
    if (p.st !== ST.DIZZY && !p.dz) { if (p.sgT > 0) p.sgT--; else if (p.sg > 0) p.sg = Math.max(0, p.sg - STUN_DECAY); }
    if (p.vt > 0) p.vt--;
  }
  function checkRound(s) {
    const [a, b] = s.p, ko0 = a.hp <= 0, ko1 = b.hp <= 0;
    if (!ko0 && !ko1 && --s.tm > 0) return;
    let w0, w1;
    if (ko0 || ko1) {
      w0 = ko1; w1 = ko0;
      for (const [p, k] of [[a, ko0], [b, ko1]]) if (k) { p.hp = 0; p.wd = 0; p.st = ST.KO; p.mv = -1; p.bf = 0; }
    } else { w0 = a.hp >= b.hp; w1 = b.hp >= a.hp; s.tm = 0; s.to = 1; }
    if (w0) s.w[0]++;
    if (w1) s.w[1]++;
    s.lw = w0 && w1 ? 2 : w0 ? 0 : 1; s.rs = RS.KO; s.rt = KO_T;
  }
  function endRound(s) {
    const [w0, w1] = s.w;
    if (w0 >= WINS || w1 >= WINS) { s.rs = RS.OVER; s.win = w0 >= WINS && w1 >= WINS ? 2 : w0 >= WINS ? 0 : 1; return; }
    const old = s.p;
    s.p = [newPlayer(STAGE_W / 2 - 120, 1), newPlayer(STAGE_W / 2 + 120, -1)];
    s.p.forEach((p, i) => { p.ex = old[i].ex; p.hist = old[i].hist; }); // EX 氣帶到下一回合
    s.pr = []; s.rnd++; s.tm = ROUND_TICKS; s.rs = RS.INTRO; s.rt = INTRO_T; s.to = 0; s.lw = -1;
  }

  /** 一個 tick：記輸入 → 決策 → Phase 1 移動與推擠 → Phase 2 判定 → 量表與回合 */
  function simulateSFVTick(s, m1, m2) {
    s.tick++;
    const t = s.tick;
    s.p[0].hist[t % HIST] = m1 & INPUT_MASK; s.p[1].hist[t % HIST] = m2 & INPUT_MASK;
    if (s.frz > 0) { s.frz--; return s; } // 超必殺暗場：全部凍結
    if (s.rs === RS.OVER) return s;
    if (s.rs === RS.INTRO) { if (--s.rt <= 0) s.rs = RS.FIGHT; return s; }
    if (s.rs === RS.FIGHT) { decide(s, 0); decide(s, 1); }
    physics(s, 0); physics(s, 1);
    for (const q of s.pr) { if (q.cd > 0) q.cd--; q.x += q.vx; }
    s.pr = s.pr.filter((q) => q.x > -40 && q.x < STAGE_W + 40);
    resolvePush(s);
    autoFace(s);
    if (s.rs === RS.FIGHT) { combat(s); gauges(s.p[0]); gauges(s.p[1]); checkRound(s); }
    else if (s.rs === RS.KO && --s.rt <= 0) endRound(s);
    return s;
  }

  return {
    TICK_HZ, TICK_MS, THROW_ANIM, UP, DOWN, LEFT, RIGHT, LP, HP, LK, HK, EASY_HADO, EASY_DP, EASY_TATSU, EASY_CA, INPUT_MASK, PUNCH, KICK, STAGE_W, WALL, HP_MAX, STUN_MAX, EX_BAR, EX_MAX, VG_MAX, VT_TICKS, HIST,
    ST, ST_NAME, RS, MOVE_LIST, M, PROJ, P_FIELDS, defineMove, createState, simulateSFVTick, packState, unpackState, cloneState, hashState, hashStr,
    dirOf, maskAt, motion, canBlock, hurtboxes, hitboxOf, pushbox, projBox, overlap,
  };
})();
