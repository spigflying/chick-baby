// @ts-nocheck
// 美術姿勢 ↔ 判定：每個 tick 畫哪張圖是玩家狀態的純函數（不讀時間、不用亂數），
// 引擎用同一個函數換出貼合美術的受擊判定，所以伺服器與瀏覽器算出來完全一樣。
// 移植自 fight-art poc3 fit_pose.js（只拿掉 ?walkfit / ?live / ?nofit 等原型開關）。
import { FIT_DATA as D } from './sfv-fit-data';

const MOVES = {
  '5LP': { startup: [['body_1', '*']], active: [['a1', '*']], recovery: [['a1', 3], ['body_1', '*']] },
  '2LP': { startup: [['n_crouch', '*']], active: [['n_2lp', '*']], recovery: [['n_2lp', 4], ['n_crouch', '*']] },
  '5LK': { startup: [['body_1', 2], ['n_walkB', '*']], active: [['n_lowkick', '*']], recovery: [['n_lowkick', 4], ['n_walkB', 3], ['body_1', '*']] },
  '5HP': { startup: [['a8', '*']], active: [['a5', '*']], recovery: [['a5', 9], ['a8', '*']] },
  '5HK': { startup: [['body_1', 3], ['a4', '*']], active: [['n_a6fix', '*']], recovery: [['n_a6fix', 10], ['a4', '*']] },
  '2HK': { startup: [['n_crouch', 3], ['n_2lk', '*']], active: [['n_sweep', '*']], recovery: [['n_sweep', 14], ['n_2lk', 5], ['n_crouch', '*']] },
  '2LK': { startup: [['n_crouch', '*']], active: [['n_2lk', '*']], recovery: [['n_2lk', 4], ['n_crouch', '*']] },
  '2HP': { startup: [['n_crouch', '*']], active: [['n_2hp', '*']], recovery: [['n_2hp', 10], ['n_crouch', '*']] },
  HADO: { fireball: true, startup: [['1', 1], ['1_5', 1], ['2', 2], ['3', 3], ['4', 2], ['5', '*']], recovery: [['6', 10], ['7', 10], ['7_5', 6], ['8', '*']] },
};
const ALIAS = { HADO_L: 'HADO', HADO_H: 'HADO', HADO_EX: 'HADO' };
const CA_KICKS = [['n_ca_hi', 'high'], ['n_ca_mid', 'mid'], ['n_ca_lo', 'low'], ['n_ca_hi', 'high'], ['n_ca_mid', 'mid'], ['n_ca_up', 'launch']];
/** 用到的所有圖（前端預載用） */
export const FIT_IMAGES = [
  'body_1', 'body_1_5', 'body_2', 'body_3', 'body_4', 'body_5', 'body_6', 'body_7', 'body_7_5', 'body_8',
  'fxb_1', 'fxb_1_5', 'fxb_2', 'fxb_5', 'fxb_7', 'fxb_7_5', 'fxb_8', 'fxf_1', 'fxf_1_5', 'fxf_2', 'fxf_3', 'fxf_4', 'fxf_5', 'fxf_7_5', 'fxf_8',
  'a1', 'a4', 'a5', 'a8', 'n_a6fix', 'n_lowkick', 'n_walkB', 'n_2lp', 'n_2lk', 'n_2hp', 'n_sweep', 'n_crouch', 'n_cblock', 'n_sblock', 'n_crouchhit',
  'n_hitL', 'n_hitH', 'n_kd', 'n_getup', 'n_jrise', 'n_japex', 'n_jfall', 'n_sland', 'n_w8_contact', 'n_w8_down', 'n_w8_pass', 'n_w8_up',
  'n_dp1', 'n_dp2', 'n_dp3', 'n_dp4', 'n_ts1', 'n_ts2', 'n_ts3', 'n_ca0', 'n_ca_hi', 'n_ca_mid', 'n_ca_lo', 'n_ca_up', 'n_ca_ch', 'n_sk_charge', 'n_sk_thrust', 'n_sk_rec',
];

export function createFit(E) {
  const NEUT = D.neutralOff, K = D.K;
  // 8 張圖兩步走路：腳尖踩住的世界座標在一步內固定（p.x 的純函數）；前緣封頂 22 = 原本站姿前緣，走路時被打的距離不變
  const WALK = { poses: ['n_w8_contact', 'n_w8_down', 'n_w8_pass', 'n_w8_up'], names: ['contact', 'down', 'passing', 'up'], toe: [195, 196, 72, 52], rearToe: 49, cap: 22 };
  WALK.S = (WALK.toe[0] - WALK.rearToe) * K;
  WALK.C = NEUT + WALK.toe.reduce((a, b) => a + b, 0) / 4 * K + WALK.S / 2;
  const SCHED = {};
  for (const mv of E.MOVE_LIST) {
    const a = MOVES[ALIAS[mv.id] ?? mv.id]; if (!a) continue;
    const lens = { startup: mv.S - 1, active: mv.A, recovery: mv.R }, arr = [null];
    for (const ph of ['startup', 'active', 'recovery']) {
      const segs = a[ph] || [], n = lens[ph]; let used = 0;
      segs.forEach(([img, t], j) => {
        const c = t === '*' ? n - used - segs.slice(j + 1).reduce((s, x) => s + x[1], 0) : Math.min(t, n - used);
        for (let i = 0; i < c; i++) arr.push({ img: a.fireball ? 'body_' + img : img, tag: img, ph });
        used += c;
      });
      if (used !== n) throw new Error(`ART ${mv.id} ${ph}: ${used} != ${n}`);
    }
    SCHED[mv.id] = { arr, fireball: !!a.fireball };
  }
  const sc = (img) => D.scale[img] || [1, 0];
  function special(p, mv) {
    const S = mv.S, t = p.mt, mk2 = (img, ph, key, cap = null) => ({ img, off: NEUT, s: 1, ph, key, id: mv.id, box: img, cap });
    if (mv.id.startsWith('DP')) {
      if (t < S) return mk2('n_dp1', 'startup', 'crouch-in');
      if (t < S + mv.A) return mk2('n_dp2', 'active', 'rise');
      return p.vy < -3 ? mk2('n_dp2', 'recovery', 'rise') : p.vy <= 3 ? mk2('n_dp3', 'recovery', 'apex') : mk2('n_dp4', 'recovery', 'fall');
    }
    if (mv.id === 'CA') {
      if (t < S) return mk2('n_ca0', 'startup', 'flash', 22);
      const k = mv.hitIndex(t);
      if (k >= 0) {
        const w = t - S - Math.ceil(k * mv.A / mv.hits);
        return w === 4 && k < mv.hits - 1 && !(p.hs > 0 && (p.hm >> k) & 1) ? mk2('n_ca_ch', 'active', 'chamber' + (k + 1)) : mk2(CA_KICKS[k][0], 'active', CA_KICKS[k][1] + k);
      }
      const r = t - S - mv.A;
      return r < 6 ? mk2('n_ca_up', 'recovery', 'hold', 22) : r < 12 ? mk2('n_ca_ch', 'recovery', 'retract', 22) : mk2('n_ca0', 'recovery', 'settle', 22);
    }
    if (mv.id === 'SHINKU') {
      if (t < S) return mk2('n_sk_charge', 'startup', 'charge', 22);
      if (t < S + mv.A) return mk2('n_sk_thrust', 'active', 'beam' + (mv.hitIndex(t) + 1), 60);
      return t - S - mv.A < 30 ? mk2('n_sk_thrust', 'recovery', 'hold', 60) : mk2('n_sk_rec', 'recovery', 'recover', 60);
    }
    if (t < S) return mk2('n_ts1', 'startup', 'startup');
    if (t < S + mv.A) { const k = Math.floor((t - S) / 3) % 2; return mk2(k ? 'n_ts3' : 'n_ts2', 'active', k ? 'spinB' : 'spinA'); }
    return mk2('n_dp4', 'recovery', 'fall');
  }
  const SPECIAL = /^(DP|TATSU)_|^CA$|^SHINKU$/;
  /** -> { img, off（相對 p.x、面向右的 px）, s（圖的縮放）, ph, tag, fb（蛋波）, id, box（受擊判定用哪張圖）, cap（前緣封頂） } */
  function pose(p) {
    const st = p.st, N = E.ST, mk = (img, ph, extra) => { const [s, dx] = sc(img); return { img, off: NEUT + dx, s, ph, box: img, cap: null, ...extra }; };
    if (st === N.MOVE) {
      const mv = E.MOVE_LIST[p.mv];
      if (SPECIAL.test(mv.id)) return special(p, mv);
      const S = SCHED[mv.id];
      if (!S) return { img: null, off: NEUT, s: 1, ph: 'noart', id: mv.id, box: null, cap: null };
      const q = S.arr[Math.min(p.mt, S.arr.length - 1)] || S.arr[1], [s, dx] = sc(q.img), fm = D.moves[mv.id];
      const off = q.ph === 'active' && fm ? fm.offA : NEUT + dx;
      // 起手：前緣封頂在原本站姿 22／蹲姿 24（起手圖前傾，不封頂會被輕拳搶先）；持續幀用擬合封頂；收招不封頂（引擎再補原本的伸出框）
      return { img: q.img, tag: q.tag, off, s, ph: q.ph, fb: S.fireball, id: mv.id, box: q.img, cap: q.ph === 'active' && fm ? fm.cap : q.ph === 'startup' ? (mv.posture === 'crouch' ? 24 : 22) : null };
    }
    if (st === N.IDLE && p.vx !== 0) {
      const S = WALK.S, w = p.x * p.f, k = Math.floor(w / S), d = w - k * S, q = Math.min(3, Math.floor(d / S * 4));
      return { img: WALK.poses[q], off: WALK.C - WALK.toe[q] * K - d, s: 1, ph: p.vx * p.f > 0 ? 'walkF' : 'walkB', key: WALK.names[q], box: WALK.poses[q], cap: WALK.cap };
    }
    if (st === N.LAND && p.t > 3) return mk('n_sland', 'land_special');
    if (st === N.IDLE) return mk('body_1', 'idle');
    if (st === N.CROUCH || st === N.PREJUMP || st === N.LAND) return mk('n_crouch', 'crouch');
    if (st === N.BLOCK) return p.cr ? mk('n_cblock', 'block_crouch') : mk('n_sblock', 'block_stand');
    if (st === N.HIT) return p.cr ? mk('n_crouchhit', 'hit_crouch') : { ...mk('n_hitL', 'hit_stand'), box: 'hit_stand' };
    if (st === N.KD) return p.t <= 16 && p.y === 0 ? mk('n_getup', 'getup') : mk(p.y === 0 ? 'n_kd' : 'n_hitH', 'kd');
    if (st === N.KO) return mk('n_kd', 'ko');
    if (st === N.AIRHIT || st === N.THROWN) return mk('n_hitH', 'airhit');
    if (st === N.DIZZY) return mk('n_hitL', 'dizzy');
    if (st === N.TECH) return mk('n_getup', 'tech');
    if (st === N.JUMP) return p.vy < -4 ? mk('n_jrise', 'jump_rise') : p.vy > 4 ? mk('n_jfall', 'jump_fall') : mk('n_japex', 'jump_apex');
    return { img: null, off: NEUT, s: 1, ph: 'other', box: null, cap: null };
  }
  /** 貼合美術的受擊判定（null = 用引擎原本的方框：還沒有圖的招式） */
  function hurt(p) {
    const q = pose(p); if (!q.box) return null;
    const b = D.hurt[q.box]; if (!b) return null;
    const off = q.box === 'hit_stand' ? NEUT : q.off - sc(q.img)[1];
    const out = [];
    for (const [x0, y, w0, h] of b) { const x = x0 + off; let w = w0; if (q.cap != null && x + w > q.cap) w = q.cap - x; if (w > 0) out.push([x, y, w, h]); }
    return out;
  }
  const hit = (p) => (p.st === E.ST.MOVE && D.moves[E.MOVE_LIST[p.mv].id]?.hit) || null;
  return { pose, hurt, hit, SCHED, WALK, K, NEUT, scale: sc };
}
