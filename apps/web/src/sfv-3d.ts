// @ts-nocheck
// 格鬥即時 3D 畫面（three.js）：只管畫面，判定照引擎（含 SFV_FIT 擬合的受擊判定），完全不讀也不改 state。
// 座標：1 單位 = 2D 畫面 1 px；地面 y=0 對到畫面 y=470；相機正對 z=0 平面，所以 z=0 上的點跟 2D 疊加層（血條、蛋波、特效）完全對齊。
// 姿勢由 state 直接算（第幾招、進行到第幾幀），不是另外播動畫：網路回滾重算後畫面自動跟著對。
import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { SFV } from '@chick/engine';
import { art } from './art';
import { superScreenTint } from './sfv-art';
import { P, mix, keyed, smooth, overshoot, FighterAnim, interpPose, Spring, solveLeg, footOf } from './sfv-anim';

const W = 960, H = 540, GROUND = 470, FOV = 30;

// ---------- 照片臉：貼在雞頭原本的臉上（朝 +x），傷的效果對準照片上的五官 ----------
// 圖：512×512 去背 webp（src/art/fight/face_*.webp）；座標是圖上的 (u, v)，0～1、左上為原點
export const FACES = {
  chick: null,
  a: { name: '臉 A', src: art('fight/face_a.webp'), eyes: [[0.371, 0.463], [0.654, 0.463]], nose: [0.514, 0.625], cheek: [0.31, 0.62] },
  b: { name: '臉 B', src: art('fight/face_b.webp'), eyes: [[0.371, 0.457], [0.625, 0.457]], nose: [0.514, 0.598], cheek: [0.31, 0.6] },
  c: { name: '臉 C', src: art('fight/face_c.webp'), eyes: [[0.35, 0.479], [0.646, 0.47]], nose: [0.504, 0.661], cheek: [0.3, 0.64] },
};
export const FACE_IDS = Object.keys(FACES);
// 照片貼在頭上的範圍：經度 PW、緯度 T0～T0+TH（弧長寬高都約 50 px，圖不會變形）
const PW = 2.4, T0 = 0.2, TH = 2.5, PHI0 = Math.PI - PW / 2;
const FACE_TURN = 0.9, FACE_HEAD = 1.25; // 照片臉往鏡頭轉約 50°（不然側面只看到一條）；頭放大 1.25 倍比較認得出是誰
const faceDir = (u, v, out) => { const ph = PHI0 + u * PW, th = T0 + v * TH; return out.set(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th)); };
const texCache = new Map();
function faceTexture(src) {
  if (!texCache.has(src)) { const t = new THREE.TextureLoader().load(src); t.colorSpace = THREE.SRGBColorSpace; texCache.set(src, t); }
  return texCache.get(src);
}
const CAM_D = (H / 2) / Math.tan((FOV / 2) * Math.PI / 180);
const YAW = 0.32; // 身體往鏡頭轉一點，看得出立體
const PI = Math.PI, HALF = PI / 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- 姿勢 ----------
// 角度都在「面向 +x」的側面平面：0 = 朝前，正 = 往上；手：a 上臂方向、e 手肘相對彎曲；腳：h 大腿方向、k 膝蓋相對彎曲
// 曲線、淡入、內插、彈簧、腳 IK 在 sfv-anim.ts（純函數，有單元測試）
// plant：2 = 腳貼地（站、蹲、防禦、落地），1 = 只防腳穿進地板（出招、走路）
const GUARD = P({ drop: 2 }); // 跟待機上下彈的平均高度一樣，出招／收招接回待機不會跳
const CROUCH = P({ drop: 22, lean: 0.15, hF: -0.35, kF: -1.9, hB: -2.5, kB: 1.6, aF: -0.3, eF: 1.9, aB: -0.6, eB: 2.2, sy: 0.92, sx: 1.06, plant: 2 });
const BLOCK_ST = P({ lean: -0.12, aF: 0.2, eF: 2.6, aB: 0.0, eB: 2.7, head: -0.15, drop: 3, plant: 2 });
const BLOCK_CR = P({ ...CROUCH, aF: 0.3, eF: 2.6, aB: 0.1, eB: 2.7, head: -0.2 });
/** 一般技：準備（預備動作）→ 打出（一幀到位、手腳伸長到判定、髖略沉）→ 停一下 → 收回略過頭（overshoot）→ 回架式 */
function attack(mv, t, base, chamber, strike) {
  const S = mv.S, A = mv.A, R = mv.R, hit = { ...strike, drop: strike.drop + 3, ik: 1 }, hold = { ...strike, drop: strike.drop + 2, ik: 0.85 };
  return keyed([[0, base], [Math.max(1, S - 1), chamber], [S, hit], [S + A - 1, hit], [S + A + R * 0.2, hold], [S + A + R * 0.8, overshoot(hold, base)], [S + A + R, base]], t);
}
/** 姿勢分組：組別一換，畫面就淡入（出招、被打第一幀等刻意的瞬間切換除外，見 blendTicks） */
function groupOf(p, s) {
  const st = SFV.ST_NAME[p.st];
  if (st === 'IDLE' || st === 'CROUCH') {
    const i = s.p.indexOf(p), prox = i >= 0 ? SFV.proxGuard(s, i) : 0;
    if (prox === 1 || prox === 4) return 'prox';
    return st === 'CROUCH' ? 'crouch' : p.vx !== 0 ? 'walk' : 'idle';
  }
  if (st === 'MOVE') return 'move:' + SFV.MOVE_LIST[p.mv].id;
  return st.toLowerCase();
}
/** ctx.age：進入目前這組幾個 tick（走路步幅慢慢放大用；畫面記憶給的，不是引擎 state） */
function poseFor(p, s, ctx = { age: 99 }) {
  const o = poseRaw(p, s, ctx);
  return { ...o, g: groupOf(p, s), plant: o.plant ?? (p.y === 0 && Math.abs(o.roll) < 0.3 ? 1 : 0) };
}
const LYING = P({ roll: -HALF, drop: 0, aF: 2.6, eF: 0.2, aB: 2.4, eB: 0.4, hF: -0.2, kF: -0.6, hB: -0.6, kB: -0.3, head: -0.3 });
const SIT_UP = P({ ...CROUCH, plant: 0, roll: -0.75, drop: 18, aF: 0.5, eF: 1.0, aB: 0.9, eB: 0.8, head: 0.1 });
const JUMP_EXT = { hF: -HALF + 0.25, kF: -0.35, hB: -HALF - 0.35, kB: 0.35 }, JUMP_TUCK = { hF: -0.6, kF: -1.6, hB: -1.4, kB: -1.2 };
function poseRaw(p, s, ctx) {
  const st = SFV.ST_NAME[p.st], tick = s.tick;
  // SF5 近身防禦：跟 2D 一樣用引擎 proxGuard（純函數），站＝BLOCK_ST、蹲＝BLOCK_CR
  const prox = (() => { const i = s.p.indexOf(p); return i >= 0 ? SFV.proxGuard(s, i) : 0; })();
  switch (st) {
    case 'IDLE': {
      if (prox === 4) return BLOCK_ST;
      if (prox === 1) return BLOCK_CR;
      if (p.vx !== 0) {
        // 走路：步伐跟著 x 走（不會滑步）；前幾步步幅慢慢放大；髖上下（一步兩次）＋重心前後換
        const amp = Math.min(1, (ctx.age + 1) / 6), ph = (p.x * p.f) / 16, sw = Math.sin(ph), back = p.vx * p.f < 0, bob = Math.abs(Math.cos(ph));
        const W = P({ drop: 3 - bob * 4.5, lean: (back ? -0.12 : 0.1) + 0.05 * Math.cos(2 * ph), hF: -HALF + 0.75 * sw, kF: -0.4 - 0.6 * Math.max(0, -sw), hB: -HALF - 0.75 * sw, kB: -0.4 - 0.6 * Math.max(0, sw), aF: -0.6 + 0.25 * sw, aB: -0.9 - 0.25 * sw, head: 0.08 * sw - 0.03 * Math.cos(2 * ph) });
        return mix(GUARD, W, amp);
      }
      // 待機：SF5 式有節奏的上下彈（約 0.7 秒一下），腳踩地、手跟著晃
      const ph = tick * (2 * PI / 44), b = Math.sin(ph);
      return P({ drop: 2 + 2.4 * b, sy: 1 + 0.015 * b, sx: 1 - 0.008 * b, head: 0.045 * Math.sin(ph + 1), lean: 0.025 * Math.sin(ph - 0.5), aF: -0.95 + 0.07 * Math.sin(ph + 0.6), eF: 1.25 - 0.09 * b, aB: -0.65 + 0.06 * Math.sin(ph + 0.9), eB: 1.35 - 0.07 * b, plant: 2 });
    }
    case 'CROUCH':
      if (prox === 1) return BLOCK_CR;
      if (prox === 4) return BLOCK_ST;
      return CROUCH;
    case 'PREJUMP': {
      // 依剩餘預跳幀（PREJUMP_T）下蹲加深，不要寫死舊的 3 幀
      const u = Math.max(0, Math.min(1, p.t / Math.max(1, SFV.PREJUMP_T)));
      return P({ ...CROUCH, drop: 8 + 8 * u, aF: -0.5 + 0.5 * (1 - u), aB: -0.4 + 0.6 * (1 - u), sy: 0.92 - 0.04 * u }); // 手從架式往上帶，接起跳
    }
    case 'LAND': {
      // 依落地硬直剩餘幀（JUMP_LAND 或招式 landRec）壓扁
      const landT = (p.mv >= 0 && SFV.MOVE_LIST[p.mv]?.landRec) ? SFV.MOVE_LIST[p.mv].landRec : SFV.JUMP_LAND;
      const u = Math.max(0, Math.min(1, p.t / Math.max(1, landT)));
      return P({ ...CROUCH, drop: 8 + 12 * u, sx: 1.06 + 0.08 * u, sy: 0.92 - 0.1 * u, aF: CROUCH.aF + 0.6 * u, aB: CROUCH.aB + 1.1 * u }); // 剛落地手還在上面，慢慢收
    }
    case 'JUMP': {
      const u = Math.max(-1, Math.min(1, p.vy / 12)); // -1 上升、+1 下降
      // 起跳腳先伸直、到頂點縮起來、落下前再伸出去準備著地
      const tuck = p.vy < 0 ? 0.2 + 0.8 * smooth(Math.max(0, Math.min(1, (p.vy + 18) / 12))) : 1 - 0.7 * smooth(Math.max(0, Math.min(1, p.vy / 14)));
      const legs = {}; for (const k in JUMP_EXT) legs[k] = JUMP_EXT[k] + (JUMP_TUCK[k] - JUMP_EXT[k]) * tuck;
      return P({ aF: 0.3 + (0.9 - u * 0.4) * tuck, eF: 0.4 + 0.8 * (1 - tuck), aB: 0.4 + (1.2 - u * 0.4) * tuck, eB: 0.3 + 1.0 * (1 - tuck), ...legs, lean: 0.1, sy: 1 - u * 0.06, sx: 1 + u * 0.06, head: -0.1 * u });
    }
    case 'BLOCK': return p.cr ? BLOCK_CR : BLOCK_ST;
    case 'HIT': {
      // 被打第一幀直接到最大後仰；最後 12 幀整個姿勢（含手）慢慢回到架式，硬直結束不會跳
      const k = Math.min(1, p.t / 12), base = p.cr ? CROUCH : GUARD;
      return mix(base, P({ ...base, lean: -0.45, head: -0.6, aF: -1.6, eF: 0.3, aB: 1.4, eB: 0.6, sx: base.sx + 0.08, sy: base.sy - 0.08 }), k);
    }
    case 'AIRHIT': return P({ roll: -0.6 - 0.4 * smooth(Math.max(0, Math.min(1, (p.vy + 2) / 6))), // 往上→往下翻身連續（大招鎖定時每段托一下也不跳）
      aF: 2.2, eF: 0.4, aB: 2.6, eB: 0.2, hF: 0.2, kF: -0.4, hB: -0.5, kB: 0.3, head: -0.5 });
    case 'KD': {
      // 起身：從躺姿 → 坐起 → 蹲（最後 16 幀），接回待機時再淡入
      if (p.t <= 16 && p.y === 0) return keyed([[0, LYING], [8, SIT_UP], [16, P({ ...CROUCH, drop: 18 })]], 16 - p.t);
      return LYING;
    }
    case 'KO': return P({ roll: -HALF, aF: 2.8, eF: 0.1, aB: 2.7, eB: 0.1, hF: 0.4, kF: -0.2, hB: 0.1, kB: -0.1, head: -0.4, puff: 0.2 });
    case 'THROWN': {
      const op = s.p[0] === p ? s.p[1] : s.p[0];
      const u = op.st === SFV.ST.THROWING ? Math.min(1, (SFV.THROW_ANIM - op.t) / SFV.THROW_ANIM) : 1;
      return P({ roll: -PI * Math.max(0, u), aF: 2.4, eF: 0.4, aB: 2.0, eB: 0.4, hF: 0.6, kF: -0.4, hB: 0.2, kB: -0.4, head: -0.5 });
    }
    case 'THROWING': {
      // 抓住 → 舉起 → 往前摔（關鍵格之間用曲線補）
      const grab = P({ aF: 0.1, eF: 0.4, aB: 0.2, eB: 0.4, lean: 0.25 }), lift = P({ aF: 1.4, eF: 0.2, aB: 1.6, eB: 0.2, lean: -0.25, drop: -4 }), slam = P({ aF: -1.2, eF: 0.2, aB: -1.0, eB: 0.2, lean: 0.5, drop: 8 });
      if (p.t > SFV.THROW_ANIM) return grab;
      return keyed([[0, grab], [5, lift], [11, lift], [15, slam], [SFV.THROW_ANIM, slam]], SFV.THROW_ANIM - p.t);
    }
    case 'DIZZY': return P({ lean: 0.18 * Math.sin(p.t * 0.16), head: 0.3 * Math.sin(p.t * 0.16 + 1), aF: -1.4, eF: 0.4, aB: -1.5, eB: 0.4, drop: 4 });
    case 'TECH': return P({ lean: -0.3, aF: 0.2, eF: 0.2, aB: 0.3, eB: 0.2 });
    case 'MOVE': return movePose(p, s);
  }
  return GUARD;
}

const CHAMBER_PUNCH = P({ lean: -0.24, drop: 5, aF: -1.2, eF: 2.7, aB: -0.4, eB: 2.0, head: 0.06 });
const STRIKE_PUNCH = P({ lean: 0.22, aF: 0, eF: 0, aB: -1.2, eB: 2.4, hF: -HALF + 0.65, kF: -0.4, hB: -HALF - 0.7, kB: 0.1 });
const CHAMBER_KICK = P({ lean: -0.3, drop: 2, hF: 0.0, kF: -2.4, aF: 0.25, eF: 1.6, aB: 0.55, eB: 1.4 });
const STRIKE_KICK = P({ lean: -0.38, hF: 0, kF: 0, aF: 0.5, eF: 1.2, aB: 0.9, eB: 1.0, hB: -HALF - 0.15, kB: 0 });

function movePose(p, s) {
  const mv = SFV.MOVE_LIST[p.mv], t = p.mt, id = mv.id;
  const air = !!mv.air, crouch = mv.posture === 'crouch';
  const base = crouch ? CROUCH : air ? poseFor({ ...p, st: SFV.ST.JUMP }, s) : GUARD;
  if (id === 'BDASH') return P({ lean: -0.35, drop: t < 4 ? -6 : 0, hF: -0.7, kF: -0.8, hB: -2.0, kB: 0.6, aF: 0.4, eF: 1.2, aB: 0.8, eB: 1.0 });
  if (id === 'FDASH') return P({ lean: 0.45, hF: -0.4, kF: -1.0, hB: -2.4, kB: -0.4, aF: -2.2, eF: 0.4, aB: -2.4, eB: 0.4, head: 0.1 });
  if (id === 'VT') return P({ puff: Math.min(1, t / 8), aF: 1.8, eF: 0.6, aB: 2.0, eB: 0.6, lean: -0.3, head: -0.5, sx: 1.15, sy: 1.1 });
  if (id === 'THROW') return attack(mv, t, GUARD, P({ lean: -0.1, aF: 0.4, eF: 1.2, aB: 0.5, eB: 1.2 }), P({ lean: 0.3, aF: 0.05, eF: 0.1, aB: 0.15, eB: 0.1, ikLimb: 'aF' }));
  if (id.startsWith('HADO') || id === 'SHINKU') {
    const push = P({ lean: 0.2, aF: 0.0, eF: 0.0, aB: 0.05, eB: 0.0, hF: -HALF + 0.7, kF: -0.4, hB: -HALF - 0.6, kB: 0.1, head: 0.05 });
    const charge = P({ lean: -0.3, drop: 6, aF: -1.6, eF: 2.2, aB: -1.7, eB: 2.3, hF: -0.6, kF: -1.2, hB: -2.3, kB: 0.6 });
    const tail = mv.R ?? 20, end = mv.S + (mv.A || 1) + tail;
    return keyed([[0, GUARD], [mv.S - 1, charge], [mv.S, { ...push, sx: 1.08 }], [mv.S + (mv.A || 1) + tail * 0.5, push], [end, GUARD]], t);
  }
  if (id.startsWith('DP')) {
    const crouchIn = P({ ...CROUCH, aF: -1.4, eF: 2.6 }), rise = P({ aF: HALF + 0.2, eF: 0.0, aB: -1.4, eB: 1.6, hF: -1.0, kF: -1.6, hB: -HALF - 0.2, kB: 0, lean: 0.15, head: 0.4, sy: 1.08, ikLimb: 'aF', ik: 1 });
    if (t < mv.S) return keyed([[0, GUARD], [mv.S - 1, crouchIn]], t);
    if (t < mv.S + mv.A) return rise;
    return mix(rise, poseFor({ ...p, st: SFV.ST.JUMP }, s), 0.6);
  }
  if (id.startsWith('TATSU')) {
    const spinLeg = P({ hF: 0, kF: 0, hB: -HALF - 0.4, kB: -0.6, aF: 1.0, eF: 0.6, aB: 1.2, eB: 0.6, lean: -0.2 });
    if (t < mv.S) return keyed([[0, GUARD], [mv.S - 1, P({ ...CHAMBER_KICK, drop: 4 })]], t);
    if (t < mv.S + mv.A) return { ...spinLeg, spin: (t - mv.S) * 0.55 };
    return mix({ ...spinLeg, spin: (mv.A * 0.55) % (2 * PI) }, GUARD, Math.min(1, (t - mv.S - mv.A) / 8));
  }
  if (id === 'CA') {
    if (t < mv.S) return keyed([[0, GUARD], [mv.S - 1, P({ ...CHAMBER_KICK, puff: 0.4 })]], t);
    const k = mv.hitIndex(t);
    if (k >= 0) {
      // 每段：高／中／低輪流踢（跟判定圖 caKick 同順序），最後一段往上踢飛；段數改了也一路踢到持續結束
      const w = (t - mv.S) % Math.max(2, Math.ceil(mv.A / mv.hits)), last = k === mv.hits - 1, h = last ? 0.9 : [0.6, 0.2, -0.15][k % 3];
      const kick = P({ ...STRIKE_KICK, hF: h, kF: 0, lean: last ? -0.6 : h > 0.4 ? -0.5 : -0.3, drop: last ? -4 : 2, ikLimb: 'hF', ik: 1 });
      return w < 2 ? mix(CHAMBER_KICK, kick, w / 2) : kick;
    }
    return mix(STRIKE_KICK, GUARD, Math.min(1, (t - mv.S - mv.A) / 14));
  }
  if (id === '2HP') return attack(mv, t, CROUCH, P({ ...CROUCH, aF: -1.4, eF: 2.6 }), P({ ...CROUCH, drop: 8, aF: 1.2, eF: 0.1, ikLimb: 'aF', head: 0.3 }));
  if (id === '8HP') return attack(mv, t, base, P({ ...base, aF: 1.6, eF: 1.8 }), P({ ...base, aF: -0.5, eF: 0, lean: 0.3, ikLimb: 'aF' }));
  if (id === '8HK') return attack(mv, t, base, P({ ...base, hF: 0.1, kF: -2.2 }), P({ ...base, hF: -0.5, kF: 0, lean: -0.2, ikLimb: 'hF' }));
  if (mv.limb === 'leg') {
    const low = mv.hitbox && mv.hitbox[1] > -40;
    const ch = crouch ? P({ ...CROUCH, hF: -0.2, kF: -2.2 }) : CHAMBER_KICK;
    const sk = crouch ? P({ ...CROUCH, hF: -0.15, kF: 0, lean: -0.2, ikLimb: 'hF' }) : P({ ...STRIKE_KICK, hF: low ? -0.5 : 0.2, ikLimb: 'hF' });
    return attack(mv, t, base, ch, sk);
  }
  // 拳（站、蹲）
  const ch = crouch ? P({ ...CROUCH, aF: -1.2, eF: 2.6 }) : CHAMBER_PUNCH;
  const sk = crouch ? P({ ...CROUCH, aF: 0, eF: 0, lean: 0.3, ikLimb: 'aF' }) : P({ ...STRIKE_PUNCH, ikLimb: 'aF' });
  return attack(mv, t, base, ch, sk);
}

// ---------- 模型：圓滾滾身體、細短腳、歪眼、超大拳套 ----------
const SKIN = [
  { body: 0xf2c33a, belly: 0xfbe39a, dark: 0xc98d1c },
  { body: 0xf1ede2, belly: 0xffffff, dark: 0xbdb5a3 },
];
function toonGrad() {
  const g = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
  g.minFilter = g.magFilter = THREE.NearestFilter; g.needsUpdate = true; return g;
}

class Chick {
  constructor(scene, i, grad) {
    const sk = SKIN[i];
    this.mats = [];
    const mat = (c, o = {}) => { const m = new THREE.MeshToonMaterial({ color: c, gradientMap: grad, ...o }); this.mats.push(m); return m; };
    const M = { body: mat(sk.body), belly: mat(sk.belly), dark: mat(sk.dark), red: mat(0xc0392b), redD: mat(0x8e2a1c), leg: mat(0xe0812a), beak: mat(0xf0a020), white: mat(0xffffff), black: mat(0x161010), bruise: mat(0x6a3d8a, { transparent: true, opacity: 0 }), blood: mat(0xd01818), swell: mat(0xe8a0a0, { transparent: true, opacity: 0 }) };
    this.M = M;
    const SPH = new THREE.SphereGeometry(1, 24, 16), CYL = new THREE.CylinderGeometry(1, 1, 1, 12), CONE = new THREE.ConeGeometry(1, 1, 14);
    const mesh = (g, m, p = [0, 0, 0], sc = [1, 1, 1], r = [0, 0, 0]) => { const o = new THREE.Mesh(g, m); o.position.set(...p); o.scale.set(...sc); o.rotation.set(...r); return o; };
    const grp = (p = [0, 0, 0], parent) => { const g = new THREE.Group(); g.position.set(...p); parent?.add(g); return g; };

    this.root = grp(); scene.add(this.root);
    this.shadow = mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }), [0, 0.6, 0], [26, 9, 1], [-HALF, 0, 0]);
    scene.add(this.shadow);
    this.yaw = grp([0, 0, 0], this.root);
    this.hipBaseY = 23.5; // 配合腿長 L1+L2=25，站立腳底貼地
    this.hips = grp([0, this.hipBaseY, 0], this.yaw);
    this.body = grp([0, 0, 0], this.hips);
    // 身體：一顆大蛋，前面淡色肚子，屁股翹尾毛
    this.belly = mesh(SPH, M.body, [0, 27, 0], [27, 31, 24]); this.body.add(this.belly);
    this.body.add(mesh(SPH, M.belly, [9, 22, 0], [19, 21, 19]));
    for (const [y, a, l] of [[34, 2.3, 16], [40, 2.0, 18], [28, 2.6, 13]]) this.body.add(mesh(CONE, M.dark, [-27, y, 0], [3, l, 3], [0, 0, a]));
    // 頭
    this.head = grp([6, 56, 0], this.body);
    this.skull = mesh(SPH, M.body, [0, 0, 0], [21, 20, 20]); this.head.add(this.skull);
    // 雞冠：越被打掉越多根（傷害 30% 起每 15% 掉一根）
    this.comb = [[-10, 15, 0.5], [-3, 21, 0.2], [5, 17, -0.15], [11, 12, -0.5]].map(([x, h, a]) => { const m = mesh(CONE, M.red, [x, 22, 0], [4, h, 3], [0, 0, a]); this.head.add(m); return m; });
    this.headband = mesh(new THREE.TorusGeometry(20.5, 2.6, 8, 32), M.red, [0, 7, 0], [1, 1, 0.98], [HALF, 0.12, 0]); this.head.add(this.headband);
    this.tails = [];
    for (const [y, a] of [[8, 0.4], [5, -0.15]]) { const t = mesh(new THREE.BoxGeometry(22, 4, 1), M.red, [-30, y, 0], [1, 1, 1], [0, 0, a]); this.head.add(t); this.tails.push(t); }
    // 臉（之後換大頭照只換這一組）：歪眼一大一小、往兩邊看，大嘴喙下垂
    this.face = grp([0, 0, 0], this.head);
    this.eyes = [];
    for (const [z, r, look] of [[10, 11, [3.5, 4]], [-8, 7.5, [-3, -2.5]]]) {
      const e = grp([14, 7, z], this.face);
      e.add(mesh(SPH, M.white, [0, 0, 0], [r * 0.75, r, r]));
      const pupil = mesh(SPH, M.black, [r * 0.62, look[1], look[0]], [r * 0.22, r * 0.26, r * 0.26]); e.add(pupil);
      const lid = mesh(SPH, mat(0xe8a0a0, { transparent: true, opacity: 0 }), [r * 0.1, r * 0.55, 0], [r * 0.7, r * 0.7, r * 1.05]); e.add(lid);
      const x1 = mesh(new THREE.BoxGeometry(1.5, r * 1.8, 1.5), M.black, [r * 0.6, 0, 0], [1, 1, 1], [0.7, 0, 0]), x2 = x1.clone(); x2.rotation.x = -0.7; e.add(x1, x2);
      this.eyes.push({ g: e, pupil, lid, xs: [x1, x2], r, look });
    }
    this.face.add(mesh(new THREE.BoxGeometry(14, 3, 4), M.black, [17, 20, 12], [1, 1, 1], [0, 0, -0.5]));
    this.beak = grp([18, -6, 1], this.face);
    this.beak.add(mesh(CONE, M.beak, [10, -1, 0], [8, 24, 7], [0, 0, -HALF - 0.45]));
    this.beak.add(mesh(CONE, M.beak, [6, -8, 0], [5, 13, 5], [0, 0, -HALF - 0.9]));
    // 兩顆大暴牙
    for (const z of [2.8, -2.8]) this.beak.add(mesh(new THREE.BoxGeometry(4, 8, 4.6), M.white, [9, -9, z], [1, 1, 1], [0, 0, 0.25]));
    // 傷（跟著扣血越來越慘）：鼻血 → 熊貓黑眼圈 → 粉紅腫包疊起來 → 眼睛腫到睜不開 → 臉貼 X 型 OK 繃、整顆頭腫
    const purple = mat(0x4a2466, { transparent: true, opacity: 0 }), lump = mat(0xf27c8c);
    this.rings = this.eyes.map((e) => { const r = mesh(new THREE.TorusGeometry(e.r * 1.12, e.r * 0.22, 8, 24), purple, [0, 0, 0], [0.75, 1, 1], [0, HALF, 0]); e.g.add(r); return r; });
    this.bumps = [[-4, 22, 4, 9], [6, 27, 9, 7], [-12, 18, -6, 6]].map(([x, y, z, r]) => mesh(SPH, lump, [x, y, z], [r, r, r]));
    const tape = mat(0xf3d9a8);
    this.plaster = new THREE.Group(); this.plaster.position.set(13, -9, 17.5); this.plaster.rotation.set(0, 0.64, 0);
    this.plaster.add(mesh(new THREE.BoxGeometry(16, 4.5, 1.2), tape, [0, 0, 0], [1, 1, 1], [0, 0, 0.7]), mesh(new THREE.BoxGeometry(16, 4.5, 1.2), tape, [0, 0, 0], [1, 1, 1], [0, 0, -0.7]));
    for (const b of [...this.bumps, this.plaster]) { b.visible = false; this.head.add(b); }
    this.drips = [0, 1].map((k) => { const d = mesh(CYL, M.blood, [26 + k * 3, -14, k ? -1 : 3], [2.2, 1, 2.2]); d.visible = false; this.head.add(d); return d; });
    this.stain = mesh(SPH, M.blood, [20, 34, 4], [5, 9, 9]); this.stain.visible = false; this.body.add(this.stain);
    // 照片臉一組：照片本身 + 對準五官的黑眼圈、腫眼皮、KO 叉叉、鼻血、OK 繃
    this.faceId = 'chick'; this.faceDef = null;
    this.pf = new THREE.Group(); this.pf.visible = false; this.pf.rotation.y = -FACE_TURN; this.head.add(this.pf);
    const pm = new THREE.MeshLambertMaterial({ transparent: true, alphaTest: 0.05 }); pm.userData.outlineParameters = { visible: false }; this.mats.push(pm);
    this.pfMesh = new THREE.Mesh(new THREE.SphereGeometry(1.035, 32, 24, PHI0, PW, T0, TH), pm); this.pf.add(this.pfMesh);
    const holder = (...ms) => { const g = new THREE.Group(); g.add(...ms); this.pf.add(g); return g; };
    this.pRings = [0, 1].map(() => holder(new THREE.Mesh(new THREE.TorusGeometry(4.3, 1.4, 8, 24), purple)));
    this.pLids = [0, 1].map(() => holder(mesh(SPH, mat(0xe8a0a0, { transparent: true, opacity: 0 }), [0, 0, 0], [5, 4.4, 1.8])));
    this.pXs = [0, 1].map(() => holder(mesh(new THREE.BoxGeometry(1.5, 8, 1), M.black, [0, 0, 0.6], [1, 1, 1], [0, 0, 0.75]), mesh(new THREE.BoxGeometry(1.5, 8, 1), M.black, [0, 0, 0.6], [1, 1, 1], [0, 0, -0.75])));
    this.pDrips = [0, 1].map(() => { const d = mesh(CYL, M.blood, [0, 0, 0], [1.5, 1, 1.5]); this.pf.add(d); return d; });
    this.pPlaster = holder(mesh(new THREE.BoxGeometry(12, 3.5, 1), tape, [0, 0, 0.5], [1, 1, 1], [0, 0, 0.7]), mesh(new THREE.BoxGeometry(12, 3.5, 1), tape, [0, 0, 0.5], [1, 1, 1], [0, 0, -0.7]));
    // 手：肩 → 上臂（可伸長）→ 肘 → 前臂 → 大拳套
    const arm = (z, near) => {
      const sh = grp([8, 38, z], this.body);
      const up = mesh(CYL, M.body, [0, 0, 0], [4, 1, 4]); const upW = grp([0, 0, 0], sh); upW.add(up);
      const el = grp([0, 0, 0], sh);
      const fo = mesh(CYL, M.body, [0, 0, 0], [3.5, 1, 3.5]); const foW = grp([0, 0, 0], el); foW.add(fo);
      const fist = grp([0, 0, 0], el);
      fist.add(mesh(SPH, near ? M.red : M.redD, [0, 0, 0], [11, 10, 10]));
      fist.add(mesh(CYL, M.white, [-8, 0, 0], [6, 3, 6], [0, 0, HALF]));
      return { base: sh, up, upW, el, fo, foW, fist, L1: 14, L2: 12 };
    };
    this.armF = arm(19, true); this.armB = arm(-19, false);
    // 腳：結實正常比例（大腿／小腿漸細、膝踝關節球、略粗腳趾）；L1/L2 給踢擊 IK
    const leg = (z) => {
      const hp = grp([0, 0, z], this.hips);
      const th = mesh(new THREE.CylinderGeometry(4.4, 3.5, 1, 14), M.leg, [0, 0, 0], [1, 1, 1]);
      const thW = grp([0, 0, 0], hp); thW.add(th);
      const kn = grp([0, 0, 0], hp);
      kn.add(mesh(SPH, M.leg, [0, 0, 0], [3.5, 3.3, 3.3]));
      const sh = mesh(new THREE.CylinderGeometry(3.2, 2.7, 1, 14), M.leg, [0, 0, 0], [1, 1, 1]);
      const shW = grp([0, 0, 0], kn); shW.add(sh);
      const ft = grp([0, 0, 0], kn);
      ft.add(mesh(SPH, M.leg, [0, 0, 0], [2.7, 2.3, 2.7]));
      for (const a of [-0.48, 0, 0.48]) ft.add(mesh(CONE, M.leg, [5.5 * Math.cos(a), 0, 5.5 * Math.sin(a)], [2.6, 12, 2.6], [0, -a, -HALF]));
      return { base: hp, th, thW, kn, sh, shW, ft, L1: 13, L2: 12 };
    };
    this.legF = leg(10); this.legB = leg(-10);
    this.particles = [];
    this.pGeo = SPH;
    this.combBase = this.comb.map((m) => m.rotation.z);
    // 次級動作彈簧（只影響畫面）：頭慢半拍、雞冠／頭巾尾巴甩、肚子落地壓扁、拳套晃
    this.spr = { head: new Spring(300, 14, 0.25), comb: new Spring(260, 7, 0.45), tail: new Spring(200, 6, 0.6), belly: new Spring(420, 12, 0.12), fistF: new Spring(380, 12, 0.35), fistB: new Spring(380, 12, 0.35) };
    this.drv = null; // 上一畫面的位置／速度（算加速度用）
  }
  resetSprings() { for (const k in this.spr) this.spr[k].reset(); this.drv = null; }
  /** 換臉：chick = 原本的雞臉；其他 = FACES 裡的照片 */
  setFace(id) {
    if (id === this.faceId) return;
    const def = FACES[id] ?? null; this.faceId = def ? id : 'chick'; this.faceDef = def;
    this.face.visible = !def; this.pf.visible = !!def;
    this.headband.position.y = def ? 14 : 7; // 照片臉：頭巾綁在額頭上，不擋眼睛
    this.head.scale.setScalar(def ? FACE_HEAD : 1);
    if (def) { this.pfMesh.material.map = faceTexture(def.src); this.pfMesh.material.needsUpdate = true; }
  }
  /** 照片上 (u, v) 對應到頭上的位置（跟著頭腫起來）＋法線；lift = 往外浮幾 px */
  facePoint(uv, lift, pos, nrm) {
    faceDir(uv[0], uv[1], nrm); const sc = this.skull.scale;
    return pos.set(nrm.x * (sc.x * 1.035 + lift), nrm.y * (sc.y * 1.035 + lift), nrm.z * (sc.z * 1.035 + lift));
  }
  /** 兩節肢體：方向 a、相對彎曲 e、整體伸長倍數 k；回傳末端位置 */
  limb(L, a, e, k = 1) {
    const l1 = L.L1 * k, l2 = L.L2 * k;
    L.upW ? (L.upW.rotation.z = a, L.up.position.set(l1 / 2, 0, 0), L.up.scale.y = l1, L.up.rotation.z = HALF)
      : (L.thW.rotation.z = a, L.th.position.set(l1 / 2, 0, 0), L.th.scale.y = l1, L.th.rotation.z = HALF);
    const j = L.el ?? L.kn, w2 = L.foW ?? L.shW, m2 = L.fo ?? L.sh, end = L.fist ?? L.ft;
    j.position.set(Math.cos(a) * l1, Math.sin(a) * l1, 0);
    const b = a + e;
    w2.rotation.z = b; m2.position.set(l2 / 2, 0, 0); m2.scale.y = l2; m2.rotation.z = HALF;
    end.position.set(Math.cos(b) * l2, Math.sin(b) * l2, 0);
    if (L.ft) end.rotation.z = 0; // 腳掌保持朝前
    if (L.fist) end.rotation.z = b;
  }
  /** 伸直指向目標（模型座標系的點），長度跟著拉長：蠢蠢的橡皮手 */
  reach(L, parent, target, w, pose, key) {
    const local = parent.worldToLocal(target.clone());
    const base = L.base.position;
    const dx = local.x - base.x, dy = local.y - base.y;
    const a = Math.atan2(dy, dx), d = Math.hypot(dx, dy), k = Math.max(1, d / (L.L1 + L.L2 + (L.fist ? 9 : 4)));
    const a0 = pose[key], e0 = pose[key === 'aF' ? 'eF' : 'kF'];
    this.limb(L, a0 + (a - a0) * w, e0 * (1 - w), 1 + (k - 1) * w);
  }
}

export function createFight3D(canvas) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch { return null; }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setSize(W, H, false);
  const outline = new OutlineEffect(renderer, { defaultThickness: 0.0045, defaultColor: [0.07, 0.04, 0.03] });
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x1b1f2e);
  const cam = new THREE.PerspectiveCamera(FOV, W / H, 1, 5000);
  const CY = GROUND - H / 2;
  cam.position.set(0, CY, CAM_D); cam.lookAt(0, CY, 0);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x5a5070, 1.5); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.0); sun.position.set(200, 500, 600); scene.add(sun);
  const grad = toonGrad();
  // 舞台：道場木地板、後牆、兩側牆（跟 2D 一樣的紅色牆邊）
  const tex = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#3b3346'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#2a2433'; g.lineWidth = 4;
    for (let y = 0; y <= 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    for (let k = 0; k < 4; k++) { const x = (k * 97) % 256; g.beginPath(); g.moveTo(x, k * 64); g.lineTo(x, k * 64 + 64); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8, 6); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(3000, 1600), new THREE.MeshLambertMaterial({ map: tex })); floor.rotation.x = -HALF; floor.position.z = -300; scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4000, 1200), new THREE.MeshLambertMaterial({ color: 0x232838 })); wall.position.set(0, 400, -1100); scene.add(wall);
  const sideWalls = [];
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - SFV.WALL / 2);
    const m = new THREE.Mesh(new THREE.BoxGeometry(SFV.WALL, GROUND - 90, 30), new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.22, depthWrite: false }));
    m.position.set(x, (GROUND - 90) / 2, -20); scene.add(m); sideWalls.push(m);
  }
  const floorBase = new THREE.Color(0xffffff), wallBase = new THREE.Color(0x232838), sideBase = new THREE.Color(0xff3b3b);
  const floorTint = new THREE.Color(), wallTint = new THREE.Color(), sideTint = new THREE.Color(), bgTmp = new THREE.Color();
  const chicks = [0, 1].map((i) => new Chick(scene, i, grad));
  const hsPrev = [0, 0], hpPrev = [SFV.HP_MAX, SFV.HP_MAX];
  let lastTick = -1, lastRnd = -1, lastNow = 0;
  const strikeAt = (p) => p.st === SFV.ST.MOVE && p.mt === SFV.MOVE_LIST[p.mv].S;
  const anims = [0, 1].map(() => new FighterAnim(poseFor, strikeAt));
  const tmp = new THREE.Vector3();

  function place(c, p, pose, px, py, s, i, freeze, dt) {
    const f = p.f;
    // 純畫面位移：不改引擎 hs／blockstun／推擠；只在既有 hs 幀抖。
    let jx = 0;
    if (p.hs > 0 && p.st === SFV.ST.BLOCK) jx = (s.tick & 1) ? 5 : -5;
    else if (p.hs > 0 && (p.st === SFV.ST.HIT || p.st === SFV.ST.AIRHIT)) jx = (s.tick & 1) ? 3 : -3;
    c.root.position.set(px - W / 2 + jx, -py, 0);
    c.root.scale.set(f, 1, 1);
    // 轉身：引擎直接換面向；畫面從舊方向經過面對鏡頭轉過來（pose.turn 0→1）
    c.yaw.rotation.set(0, -YAW + pose.spin + (1 - pose.turn) * (-PI + 2 * YAW), 0);
    // ---- 彈簧：用畫面上的位置（不含受擊抖動）算速度變化 ----
    const S = c.spr, d = c.drv;
    let dvx = 0, dvy = 0, daF = 0, daB = 0, dHead = 0;
    if (d && dt > 0) {
      const vx = (px - d.x) / dt, vy = (py - d.y) / dt;
      dvx = (vx - d.vx) * f; dvy = vy - d.vy; daF = pose.aF - d.aF; daB = pose.aB - d.aB; dHead = pose.head - d.head;
      d.x = px; d.y = py; d.vx = vx; d.vy = vy;
    } else c.drv = { x: px, y: py, vx: 0, vy: 0 };
    Object.assign(c.drv, { aF: pose.aF, aB: pose.aB, head: pose.head });
    dvx = clamp(dvx, -1500, 1500); dvy = clamp(dvy, -1500, 1500);
    const hd = S.head.step(dvx * 0.0016 + dHead * -3, dt), cb = S.comb.step(dvx * 0.006 - dvy * 0.0012 + dHead * -8, dt), tl = S.tail.step(dvx * 0.008 + dvy * 0.002, dt);
    const bl = S.belly.step(dvy * 0.0016, dt);
    const fF = pose.ik > 0 ? (S.fistF.reset(), 0) : S.fistF.step(-daF * 5, dt), fB = S.fistB.step(-daB * 5, dt);
    c.hips.position.y = c.hipBaseY - pose.drop * 0.6;
    c.hips.rotation.z = pose.roll;
    c.body.position.y = -pose.drop * 0.4;
    c.body.rotation.z = pose.lean;
    const pf = 1 + pose.puff * 0.25;
    c.body.scale.set(pose.sx * pf * (1 - bl * 0.5), pose.sy * pf * (1 + bl), pf);
    c.head.rotation.z = pose.head + hd;
    c.comb.forEach((m, k) => m.rotation.z = c.combBase[k] + cb * (0.7 + 0.15 * k));
    c.shadow.position.x = px - W / 2; const air = Math.max(0, -py); c.shadow.scale.set(26 * (1 - Math.min(0.6, air / 200)), 9, 1);
    c.limb(c.armF, pose.aF, pose.eF); c.limb(c.armB, pose.aB, pose.eB);
    // 腳：plant 2 = 踩地、1 = 只防穿地（髖上下彈、蹲時腳底都貼地板）
    const hipY = c.hipBaseY - pose.drop * 0.6 - py; // 髖離地多高（py 往上是負）
    for (const [L, a, e, key] of [[c.legF, pose.hF, pose.kF, 'hF'], [c.legB, pose.hB, pose.kB, 'hB']]) {
      let A = a, E = e;
      if (pose.plant && p.y === 0 && py === 0 && Math.abs(pose.roll) < 0.3 && !(pose.ik > 0 && pose.ikLimb === key)) {
        const [fx, fy] = footOf(L.L1, L.L2, a, e);
        if (pose.plant === 2 ? Math.abs(fy + hipY) > 0.3 : fy < -hipY) [A, E] = solveLeg(L.L1, L.L2, fx, -hipY, e);
      }
      c.limb(L, A, E);
    }
    if (c.armF.fist) c.armF.fist.rotation.z += fF;
    if (c.armB.fist) c.armB.fist.rotation.z += fB;
    // 打擊判定在哪，拳頭／腳就伸到哪（橡皮手）：目標 = 招式判定框的前 3/4 處
    const mv = p.st === SFV.ST.MOVE ? SFV.MOVE_LIST[p.mv] : null;
    if (pose.ik > 0 && pose.ikLimb && mv?.hitbox) {
      // 目標放在轉身後的身體座標：前後距離除以 cos(YAW)，投影到畫面上剛好是判定框的位置
      const hb = mv.hitbox;
      c.root.updateMatrixWorld(true);
      c.yaw.localToWorld(tmp.set((hb[0] + hb[2] * 0.75) / Math.cos(YAW), -(hb[1] + hb[3] / 2), 0));
      if (pose.ikLimb === 'aF') c.reach(c.armF, c.body, tmp, pose.ik, pose, 'aF');
      else c.reach(c.legF, c.hips, tmp, pose.ik, pose, 'hF');
    }
    face(c, p, s, i);
    // 被打瞬間白閃、接著紅閃；超必殺暗場時發動的人發亮
    const flash = p.hs > 0 && (p.st === SFV.ST.HIT || p.st === SFV.ST.AIRHIT) ? (p.hs > 8 ? 0.8 : 0.35) : 0;
    const glowOwner = freeze === i ? 0.25 : 0;
    for (const m of c.mats) if (m.emissive) m.emissive.setRGB(flash + glowOwner, (flash + glowOwner) * 0.75, (flash + glowOwner) * 0.6);
    c.tails.forEach((t, k) => t.rotation.z = (k ? -0.15 : 0.4) + 0.12 * Math.sin(s.tick * 0.2 + k) - pose.lean * 0.5 + tl * (1 + 0.3 * k));
  }

  function face(c, p, s, i) {
    const dmg = 1 - Math.max(0, p.hp) / SFV.HP_MAX, st = SFV.ST_NAME[p.st];
    const ko = st === 'KO', dizzy = st === 'DIZZY' || p.dz;
    // 鼻血（25% 起）、瘀青（45% 起，越打越深）、腫包（60% 起）、眼睛腫到睜不開（75% 起）、整顆頭腫（85% 起）
    c.drips.forEach((d, k) => {
      const on = dmg > 0.2 + k * 0.2; d.visible = on;
      const len = on ? 6 + Math.min(16, (dmg - 0.2) * 40) + 2 * Math.sin(s.tick * 0.1 + k) : 0;
      d.scale.y = len; d.position.y = -14 - len / 2;
    });
    c.stain.visible = dmg > 0.45; c.stain.scale.set(5, 9 + dmg * 6, 9 + dmg * 6);
    c.rings.forEach((r, k) => { r.visible = dmg > 0.35 + k * 0.15; r.material.opacity = Math.min(0.9, (dmg - 0.3) * 2.5); });
    c.bumps.forEach((b, k) => { b.visible = dmg > 0.5 + k * 0.12; b.scale.setScalar([9, 7, 6][k] * (1 + Math.min(0.5, (dmg - 0.5) * 1.5))); });
    c.plaster.visible = dmg > 0.7;
    c.comb.forEach((m, k) => m.visible = dmg < 0.3 + (3 - k) * 0.15 + (k === 1 ? 1 : 0)); // 中間最高那根留著，其他被打掉
    const headSwell = 1 + Math.max(0, dmg - 0.8) * 1.5;
    c.skull.scale.set(21 * headSwell, 20 * headSwell, 20 * headSwell);
    c.eyes.forEach((e, k) => {
      const puffy = Math.max(0, Math.min(1, (dmg - 0.75 + k * 0.08) * 5));
      e.lid.material.opacity = puffy * 0.95; e.lid.visible = puffy > 0;
      e.lid.scale.y = e.r * (0.5 + puffy * 0.6);
      e.xs.forEach((x) => x.visible = ko); e.pupil.visible = !ko;
      if (dizzy) { const a = s.tick * 0.35 + k * PI; e.pupil.position.set(e.r * 0.62, Math.sin(a) * e.r * 0.4, Math.cos(a) * e.r * 0.4); }
      else if (st === 'HIT' || st === 'AIRHIT') e.pupil.position.set(e.r * 0.62, (k ? 1 : -1) * e.r * 0.45, (k ? -1 : 1) * e.r * 0.3);
      else e.pupil.position.set(e.r * 0.62, e.look[1], e.look[0]);
    });
    c.beak.rotation.z = st === 'HIT' || ko ? -0.5 : st === 'MOVE' ? 0.15 : 0;
    if (c.faceDef) { c.drips.forEach((d) => d.visible = false); c.plaster.visible = false; photoFace(c, dmg, ko, s); } // 雞臉用的鼻血、OK 繃換成對準照片的那一組
  }
  // 照片臉的傷：位置都從照片上的五官座標算，頭腫起來也跟著走
  const vP = new THREE.Vector3(), vN = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
  function stick(g, c, uv, lift) { c.facePoint(uv, lift, vP, vN); g.position.copy(vP); g.quaternion.setFromUnitVectors(Z, vN); }
  function photoFace(c, dmg, ko, s) {
    const F = c.faceDef;
    c.pfMesh.scale.copy(c.skull.scale);
    F.eyes.forEach((uv, k) => {
      const ring = c.pRings[k]; ring.visible = dmg > 0.35 + k * 0.15; if (ring.visible) stick(ring, c, uv, 0.6);
      const puffy = Math.max(0, Math.min(1, (dmg - 0.75 + k * 0.08) * 5)), lid = c.pLids[k];
      lid.visible = puffy > 0 && !ko; if (lid.visible) { stick(lid, c, uv, 1); lid.children[0].material.opacity = puffy * 0.95; lid.scale.setScalar(0.6 + puffy * 0.5); }
      c.pXs[k].visible = ko; if (ko) stick(c.pXs[k], c, uv, 0.8);
    });
    c.facePoint(F.nose, 0.8, vP, vN);
    c.pDrips.forEach((d, k) => {
      const on = dmg > 0.2 + k * 0.2; d.visible = on; if (!on) return;
      const len = 5 + Math.min(14, (dmg - 0.2) * 36) + 2 * Math.sin(s.tick * 0.1 + k);
      d.scale.y = len; d.position.set(vP.x + 0.5, vP.y - 1 - len / 2, vP.z + (k ? -2.2 : 2.2));
    });
    c.pPlaster.visible = dmg > 0.7; if (c.pPlaster.visible) stick(c.pPlaster, c, F.cheek, 0.8);
  }

  // 噴鼻血：被打中的那一刻噴幾顆血珠，跟 tick 走（回滾倒帶時清掉）
  function blood(c, p, i, s) {
    if (s.tick < lastTick) for (const q of c.particles) q.m.visible = false, q.life = 0;
    const started = p.hs > 0 && (hsPrev[i] === 0 || p.hs > hsPrev[i]) && (p.st === SFV.ST.HIT || p.st === SFV.ST.AIRHIT || p.st === SFV.ST.KD || p.st === SFV.ST.KO || p.st === SFV.ST.DIZZY);
    hsPrev[i] = p.hs;
    if (started && hpPrev[i] > p.hp) {
      c.head.updateMatrixWorld(true);
      const nose = c.faceDef ? c.pf.localToWorld(c.facePoint(c.faceDef.nose, 1, new THREE.Vector3(), new THREE.Vector3())) : c.beak.localToWorld(new THREE.Vector3(8, -6, 0));
      const n = 4 + Math.round(8 * (1 - p.hp / SFV.HP_MAX));
      for (let k = 0; k < n; k++) {
        let q = c.particles.find((x) => x.life <= 0);
        if (!q) { const m = new THREE.Mesh(c.pGeo, c.M.blood); c.root.parent.add(m); q = { m, life: 0, v: new THREE.Vector3() }; c.particles.push(q); }
        const r = ((s.tick * 31 + k * 17 + i * 7) % 100) / 100, r2 = ((s.tick * 13 + k * 29) % 100) / 100;
        q.m.position.copy(nose); q.v.set(-p.f * (1.5 + r * 3), 2 + r2 * 4, (r - 0.5) * 3); q.life = 30; q.m.visible = true; q.m.scale.setScalar(1.6 + r2 * 1.6);
      }
    }
    hpPrev[i] = p.hp;
    for (const q of c.particles) {
      if (q.life <= 0) continue;
      q.life--; q.v.y -= 0.35; q.m.position.add(q.v);
      if (q.m.position.y < 0.5) { q.m.position.y = 0.5; q.v.set(0, 0, 0); q.m.scale.y = 0.4; }
      if (q.life <= 0) q.m.visible = false;
    }
  }

  return {
    render(s, opt: { shake?: [number, number]; freezeOwner?: number; faces?: string[]; prev?: any; alpha?: number; posInterp?: boolean; now?: number } = {}) {
      for (let i = 0; i < 2; i++) chicks[i].setFace(opt.faces?.[i] ?? 'chick');
      const [shx, shy] = opt.shake ?? [0, 0], fo = opt.freezeOwner ?? -1;
      cam.position.set(-shx, CY + shy, CAM_D); cam.lookAt(-shx, CY + shy, 0);
      // 大招：只染背景／地板／牆；燈光維持，角色／特效／HUD 不變色
      const tint = superScreenTint(s);
      hemi.intensity = 1.5; sun.intensity = 2.0;
      const a = tint.active ? tint.alpha : 0;
      if (a > 0) {
        bgTmp.setHex(tint.hex);
        scene.background.copy(bgTmp);
        floorTint.setHex(0xffffff).lerp(bgTmp, 0.88 * a); floor.material.color.copy(floorTint);
        wallTint.copy(wallBase).lerp(bgTmp, 0.95 * a); wall.material.color.copy(wallTint);
        sideTint.copy(sideBase).lerp(bgTmp, 0.7 * a);
        for (const m of sideWalls) m.material.color.copy(sideTint);
      } else {
        scene.background.setHex(fo >= 0 ? 0x0e1018 : 0x1b1f2e);
        floor.material.color.copy(floorBase);
        wall.material.color.copy(wallBase);
        for (const m of sideWalls) m.material.color.copy(sideBase);
      }
      const superOwner = tint.active ? tint.owner : fo;
      // 畫面時間：opt.prev（上一 tick 的 state）＋ opt.alpha（0～1）→ 在兩個 tick 之間內插，60Hz 螢幕偶爾一幀 0 或 2 tick 也看起來連續
      const now = opt.now ?? performance.now(), dt = lastNow ? clamp((now - lastNow) / 1000, 0, 0.05) : 1 / 60; lastNow = now;
      const rewind = s.tick < lastTick || s.rnd !== lastRnd; lastRnd = s.rnd;
      const prev = opt.prev && opt.prev.tick === s.tick - 1 && opt.prev.rnd === s.rnd ? opt.prev : null, alpha = clamp(opt.alpha ?? 1, 0, 1);
      for (let i = 0; i < 2; i++) {
        const c = chicks[i], p = s.p[i];
        if (rewind) c.resetSprings();
        const A = prev ? anims[i].at(prev, i) : null, B = anims[i].at(s, i), pose = interpPose(A, B, alpha);
        let px = p.x, py = p.y;
        if (A && opt.posInterp && !B.snap && alpha < 1) {
          const q = prev.p[i];
          if (Math.abs(q.x - p.x) < 60 && Math.abs(q.y - p.y) < 60) { px = q.x + (p.x - q.x) * alpha; py = q.y + (p.y - q.y) * alpha; }
        }
        if (c.drv && (Math.abs(px - c.drv.x) > 60 || Math.abs(py - c.drv.y) > 60)) c.resetSprings();
        place(c, p, pose, px, py, s, i, superOwner, dt);
        if (s.tick !== lastTick) blood(c, p, i, s);
      }
      lastTick = s.tick;
      outline.render(scene, cam);
    },
    dispose() { renderer.dispose(); },
  };
}

// 測試用：每個狀態／招式都算得出有限的姿勢
export const __test = { poseFor, groupOf, makeAnim: () => new FighterAnim(poseFor, (p) => p.st === SFV.ST.MOVE && p.mt === SFV.MOVE_LIST[p.mv].S), LEG: { L1: 13, L2: 12, hipY: 23.5, thigh: [4.4, 3.5], shin: [3.2, 2.7] } };
