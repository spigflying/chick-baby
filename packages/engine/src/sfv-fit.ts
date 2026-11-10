// @ts-nocheck
// 美術姿勢 ↔ 判定：每個 tick 畫哪張圖是玩家狀態的純函數（不讀時間、不用亂數），
// 引擎用同一個函數換出貼合美術的受擊判定，所以伺服器與瀏覽器算出來完全一樣。
// 移植自 fight-art poc4 fit_pose.js（只拿掉 ?walkfit / ?live / ?nofit 等原型開關）。
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
  // 跳躍重攻擊、摔、系統動作（衝刺／炸毛）：cap = 非持續幀的受擊前緣封頂（跳 18、其他 22 = 原本方框前緣）
  '8HP': { startup: [['n_japex', '*']], active: [['n_j_hp', '*']], recovery: [['n_j_hp', 3], ['n_japex', '*']], cap: 18 },
  '8HK': { startup: [['n_japex', '*']], active: [['n_j_hk', '*']], recovery: [['n_j_hk', 3], ['n_japex', '*']], cap: 18 },
  THROW: { startup: [['body_1', 2], ['n_th_grab', '*']], active: [['n_th_grab', '*']], recovery: [['n_th_grab', 8], ['body_1', '*']], cap: 22 },
  VT: { recovery: [['n_vt_dash', 14], ['body_1', '*']], cap: 22 },
  FDASH: { recovery: [['n_dash_f', 12], ['n_w9_contact', '*']], cap: 22 },
  BDASH: { recovery: [['n_dash_b', 14], ['n_crouch', 4], ['body_1', '*']], cap: 22 },
  HADO: { fireball: true, startup: [['1', 1], ['1_5', 1], ['2', 2], ['3', 3], ['4', 2], ['5', '*']], recovery: [['6', 10], ['7', 10], ['7_5', 6], ['8', '*']] },
};
const ALIAS = { HADO_L: 'HADO', HADO_H: 'HADO', HADO_EX: 'HADO' };
// CA 每段用哪張踢腿圖：高／中／低輪流，最後一段往上踢飛（段數改了也對得上）
const CA_KICKS = [['n_ca_hi', 'high'], ['n_ca_mid', 'mid'], ['n_ca_lo', 'low']], CA_LAUNCH = ['n_ca_up', 'launch'];
const caKick = (k, n) => (k === n - 1 ? CA_LAUNCH : CA_KICKS[k % CA_KICKS.length]);
/** 用到的所有圖（前端預載用） */
export const FIT_IMAGES = [
  'body_1', 'body_1_5', 'body_2', 'body_3', 'body_4', 'body_5', 'body_6', 'body_7', 'body_7_5', 'body_8',
  'fxb_1', 'fxb_1_5', 'fxb_2', 'fxb_5', 'fxb_7', 'fxb_7_5', 'fxb_8', 'fxf_1', 'fxf_1_5', 'fxf_2', 'fxf_3', 'fxf_4', 'fxf_5', 'fxf_7_5', 'fxf_8',
  'a1', 'a4', 'a5', 'a8', 'n_a6fix', 'n_lowkick', 'n_walkB', 'n_2lp', 'n_2lk', 'n_2hp', 'n_sweep', 'n_crouch', 'n_cblock', 'n_sblock', 'n_crouchhit',
  'n_hitL', 'n_hitH', 'n_kd', 'n_getup', 'n_jrise', 'n_japex', 'n_jfall', 'n_sland', 'n_wk0', 'n_wk1', 'n_wk3', 'n_wk8', 'n_wk11', 'n_wk5', 'n_w9_contact',
  'n_j_hp', 'n_j_hk', 'n_th_grab', 'n_th_lift', 'n_th_slam', 'n_th_victim', 'n_th_tech', 'n_vt_dash', 'n_dash_f', 'n_dash_b', 'n_dz1', 'n_dz2',
  'n_dp1', 'n_dp2', 'n_dp3', 'n_dp4', 'n_ts1', 'n_ts2', 'n_ts3', 'n_ca0', 'n_ca_hi', 'n_ca_mid', 'n_ca_lo', 'n_ca_up', 'n_ca_ch', 'n_sk_charge', 'n_sk_thrust', 'n_sk_rec',
];

export function createFit(E) {
  const NEUT = D.neutralOff, K = D.K;
  // 走路 w10：每步 6 張（左右腳兩步共 12 格），站立腳釘在地上；Q = 每張圖身體累計前進（圖層 px），SL = 一步長。
  // 是 p.x 的純函數；M = 一步內平均落後量，讓身體平均位置等於站姿。前緣封頂 22 = 原本站姿前緣，走路時被打的距離不變
  const WALK = { poses: ['n_wk0', 'n_wk1', 'n_wk3', 'n_wk8', 'n_wk11', 'n_wk5'], names: ['contact', 'down', 'lift', 'passing', 'knee', 'reach'], Q: [0, 19.12, 43.77, 60.62, 80.72, 119.67], SL: 144, cap: 22 };
  WALK.S = WALK.SL * K;
  { let m = 0; for (let i = 0; i < 1000; i++) { const d = i / 1000 * WALK.SL; let j = 0; while (j + 1 < WALK.Q.length && WALK.Q[j + 1] <= d) j++; m += (WALK.Q[j] - d) / 1000; } WALK.M = m * K; }
  const THROW_ID = E.MOVE_LIST.findIndex((m) => m.id === 'THROW');
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
    SCHED[mv.id] = { arr, fireball: !!a.fireball, cap: a.cap ?? null };
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
        return w === 4 && k < mv.hits - 1 && !(p.hs > 0 && (p.hm >> k) & 1) ? mk2('n_ca_ch', 'active', 'chamber' + (k + 1)) : mk2(caKick(k, mv.hits)[0], 'active', caKick(k, mv.hits)[1] + k);
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
  function pose(p, s = null) {
    const st = p.st, N = E.ST, mk = (img, ph, extra) => { const [sc0, dx] = sc(img); return { img, off: NEUT + dx, s: sc0, ph, box: img, cap: null, ...extra }; };
    // SF5 近身防禦姿勢（無 blockstun；判定用防禦圖）
    if (s && (st === N.IDLE || st === N.CROUCH)) {
      const i = s.p.indexOf(p);
      if (i >= 0) {
        const pg = E.proxGuard(s, i);
        if (pg === 1) return mk('n_cblock', 'prox_crouch', { cap: 24 });
        if (pg === 4) return mk('n_sblock', 'prox_stand', { cap: 22 });
      }
    }
    if (st === N.MOVE) {
      const mv = E.MOVE_LIST[p.mv];
      if (SPECIAL.test(mv.id)) return special(p, mv);
      const S = SCHED[mv.id];
      if (!S) return { img: null, off: NEUT, s: 1, ph: 'noart', id: mv.id, box: null, cap: null };
      const q = S.arr[Math.min(p.mt, S.arr.length - 1)] || S.arr[1], [scv, dx] = sc(q.img), fm = D.moves[mv.id];
      const off = q.ph === 'active' && fm ? fm.offA : NEUT + dx;
      // 起手：前緣封頂在原本站姿 22／蹲姿 24（起手圖前傾，不封頂會被輕拳搶先）；持續幀用擬合封頂；收招不封頂（引擎再補原本的伸出框）
      return { img: q.img, tag: q.tag, off, s: scv, ph: q.ph, fb: S.fireball, id: mv.id, box: q.img, cap: q.ph === 'active' && fm ? fm.cap : S.cap != null ? S.cap : q.ph === 'startup' ? (mv.posture === 'crouch' ? 24 : 22) : null };
    }
    if (st === N.IDLE && p.vx !== 0) {
      const S = WALK.S, w = p.x * p.f, k = Math.floor(w / S), d = w - k * S, nP = WALK.poses.length;
      let q = 0; while (q + 1 < nP && WALK.Q[q + 1] * K <= d) q++;
      const slot = q + nP * (((k % 2) + 2) % 2), img = WALK.poses[q];
      return { img, off: NEUT + sc(img)[1] + WALK.Q[q] * K - d - WALK.M, s: 1, ph: p.vx * p.f > 0 ? 'walkF' : 'walkB', key: WALK.names[q] + (slot >= nP ? '2' : '1'), slot, box: img, cap: WALK.cap };
    }
    if (st === N.LAND && p.mv === THROW_ID && THROW_ID >= 0) return mk('n_th_slam', 'throw_recover', { cap: 22 });   // 摔完的收招（引擎在 LAND 標 mv = THROW）
    if (st === N.LAND && p.t > 4) return mk('n_sland', 'land_special');
    if (st === N.IDLE) return mk('body_1', 'idle');
    if (st === N.CROUCH || st === N.PREJUMP || st === N.LAND) return mk('n_crouch', 'crouch');
    if (st === N.BLOCK) return p.cr ? mk('n_cblock', 'block_crouch') : mk('n_sblock', 'block_stand');
    if (st === N.HIT) return p.cr ? mk('n_crouchhit', 'hit_crouch') : { ...mk('n_hitL', 'hit_stand'), box: 'hit_stand' };
    if (st === N.KD) return p.t <= 16 && p.y === 0 ? mk('n_getup', 'getup') : mk(p.y === 0 ? 'n_kd' : 'n_hitH', 'kd');
    if (st === N.KO) return mk('n_kd', 'ko');
    if (st === N.AIRHIT) return mk('n_hitH', 'airhit');
    if (st === N.THROWN) return mk('n_th_victim', 'thrown');   // 引擎被摔時受擊判定本來就是空的；翻轉角度由前端畫
    if (st === N.THROWING) { const n = E.THROW_ANIM - p.t; return p.t > E.THROW_ANIM ? mk('n_th_grab', 'throw_hold') : n <= 12 ? mk('n_th_lift', 'throw_lift') : mk('n_th_slam', 'throw_slam'); }
    if (st === N.DIZZY) return mk(Math.floor(p.t / 20) % 2 ? 'n_dz2' : 'n_dz1', 'dizzy', { cap: 22 });
    if (st === N.TECH) return mk('n_th_tech', 'tech', { cap: 22 });
    if (st === N.JUMP) return p.vy < -4 ? mk('n_jrise', 'jump_rise') : p.vy > 4 ? mk('n_jfall', 'jump_fall') : mk('n_japex', 'jump_apex');
    return { img: null, off: NEUT, s: 1, ph: 'other', box: null, cap: null };
  }
  /** 貼合美術的受擊判定（null = 用引擎原本的方框：還沒有圖的招式） */
  function hurt(p, s = null) {
    const q = pose(p, s); if (!q.box) return null;
    const b = D.hurt[q.box]; if (!b) return null;
    const off = q.box === 'hit_stand' ? NEUT : q.off - sc(q.img)[1];
    const out = [];
    for (const [x0, y, w0, h] of b) { const x = x0 + off; let w = w0; if (q.cap != null && x + w > q.cap) w = q.cap - x; if (w > 0) out.push([x, y, w, h]); }
    // B：空中下盤瘦身 — 受擊框底不高於 y=-40（引擎 HURT.air 同步），避免腳尖擦到蛋波
    if (p.y < 0 || stAir(p)) {
      const slim = [];
      for (const [x, y, w, h] of out) {
        if (y + h <= -40) slim.push([x, y, w, h]);
        else if (y < -40) slim.push([x, y, w, -40 - y]);
      }
      return slim;
    }
    return out;
  }
  const stAir = (p) => p.st === E.ST.JUMP || p.st === E.ST.AIRHIT;
  const hit = (p) => (p.st === E.ST.MOVE && D.moves[E.MOVE_LIST[p.mv].id]?.hit) || null;
  return { pose, hurt, hit, SCHED, WALK, K, NEUT, scale: sc };
}
