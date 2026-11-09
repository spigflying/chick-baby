// @ts-nocheck
// 格鬥水墨美術（poc3 移植）：圖檔在 src/art/fight/*.webp（已裁到透明邊界、縮成 0.5 倍），manifest 記原圖尺寸與裁切位移。
// 圖與 manifest 都經 Vite 打包（網址帶 hash、長快取），不用再另外 fetch manifest.json。
// 只管畫面：受擊判定在引擎（SFV_FIT），這裡讀同一個 pose 決定畫哪張圖，畫面和判定一定對得上。
import { SFV, SFV_FIT, FIT_IMAGES } from '@chick/engine';
import { art } from './art';
import manifest from './art/fight/manifest.json';

const ART = { ready: false, loading: null as Promise<void> | null, img: {} as Record<string, any>, man: {} as Record<string, number[]> };
const GROUND = 470;

/** 進格鬥畫面前預載；失敗或沒有 DOM（測試）就維持舊的火柴雞 */
export function preloadFightArt() {
  if (ART.loading || typeof Image === 'undefined') return ART.loading;
  ART.loading = (async () => {
    try {
      ART.man = manifest;
      await Promise.all(FIT_IMAGES.filter((n) => ART.man[n]).map((n) => new Promise<void>((ok) => {
        const im = new Image(); im.decoding = 'async';
        im.onload = () => { ART.img[n] = im; ok(); }; im.onerror = () => ok(); im.src = art(`fight/${n}.webp`);
      })));
      ART.ready = !!ART.img.body_1;
    } catch { ART.ready = false; }
  })();
  return ART.loading;
}
export const fightArtReady = () => ART.ready;

const tintCv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function tinted(im, color) {
  const c = tintCv, t = c.getContext('2d');
  if (c.width < im.width) c.width = im.width; if (c.height < im.height) c.height = im.height;
  t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, c.width, c.height); t.drawImage(im, 0, 0);
  t.globalCompositeOperation = 'source-atop'; t.fillStyle = color; t.fillRect(0, 0, im.width, im.height);
  return c;
}
/** poc3 drawPose：圖的錨點（1100 寬 320／900 寬 120，y 510）對到世界 (p.x + f·off, 地面 − p.y) */
function drawLayer(ctx, name, p, off, o) {
  const im = ART.img[name], m = ART.man[name]; if (!im || !m) return false;
  const ax = m[0] === 1100 ? 320 : 120, ay = 510, f = p.f, ks = SFV_FIT.K * (o.s || 1);
  ctx.save(); ctx.translate(Math.round(p.x + f * off + (o.shake || 0)), Math.round(GROUND + p.y));
  if (o.rot) ctx.rotate(o.rot * f);
  ctx.scale(f * ks, ks * (o.sy || 1)); ctx.translate(-ax, -ay);
  ctx.drawImage(o.tint ? tinted(im, o.tint) : im, 0, 0, im.width, im.height, m[2], m[3], m[4], m[5]);
  ctx.restore(); return true;
}

// ---------- 受擊／防禦特效（純畫面，從狀態的邊緣推出來：防守方 hs 由 0 變正） ----------
// HIT＝黃白星爆（貼在受擊框重疊處）；BLOCK＝不畫光（3D 模型純畫面抖動）；大招＝全場變色。
const FX = { list: [] as any[], prev: null as any };
const hrng = (seed) => { let s = (seed | 0) || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
/** light / special / heavy / super → 命中火花大小（防禦不再畫光圈） */
const FX_STR = {
  light: { hitLife: 9, hitR: 22, spikes: 8 },
  special: { hitLife: 10, hitR: 28, spikes: 10 },
  heavy: { hitLife: 12, hitR: 34, spikes: 12 },
  super: { hitLife: 12, hitR: 40, spikes: 14 },
};
function fxStr(s, ai, a, d, dmg) {
  const mv = a.mv >= 0 ? SFV.MOVE_LIST[a.mv] : null;
  if (mv?.kind === 'super') return 'super';
  if (mv?.kind === 'special' || (mv && mv.projectile)) return 'special';
  if (!SFV.hitboxOf(a) && s.pr.some((q) => q.o === ai)) return 'special';
  // 飛彈命中當幀彈已消耗、攻擊方常已收招（mv=-1）：用 hs／傷害區分（蛋波 hs=8 dmg=60；輕常規 hs=9）
  if (!mv) {
    if (d.hs >= 13) return 'heavy';
    if (d.hs <= 8 || dmg >= 50) return 'special';
    return 'light';
  }
  if (mv.light || d.hs < 13) return 'light';
  return 'heavy';
}
/** AABB 交集；無重疊回 null */
function aabbOverlap(a, b) {
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  if (x1 <= x0 || y1 <= y0) return null;
  return [x0, y0, x1 - x0, y1 - y0];
}
/** 命中點＝攻擊框／飛彈 ∩ 防守受擊框的重心，再夾進防守方身體剪影內側 */
function contactPoint(s, ai, a, d) {
  const hurts = SFV.hurtboxes(d);
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const h of hurts) {
    bx0 = Math.min(bx0, h[0]); by0 = Math.min(by0, h[1]);
    bx1 = Math.max(bx1, h[0] + h[2]); by1 = Math.max(by1, h[1] + h[3]);
  }
  if (!hurts.length || !(bx1 > bx0 && by1 > by0)) {
    return { wx: d.x + d.f * 10, wy: d.y - (d.cr ? 40 : 55) };
  }
  const bodyW = bx1 - bx0, bodyH = by1 - by0;
  let atk = null;
  const hb = SFV.hitboxOf(a);
  if (hb) atk = hb.box;
  else {
    const q = s.pr.find((p) => p.o === ai && p.n > 0);
    if (q) atk = SFV.projBox(q);
  }
  let cx, cy;
  if (atk) {
    let best = null, bestArea = 0;
    for (const h of hurts) {
      const inter = aabbOverlap(atk, h);
      if (!inter) continue;
      const area = inter[2] * inter[3];
      if (area > bestArea) { bestArea = area; best = inter; }
    }
    if (best) { cx = best[0] + best[2] / 2; cy = best[1] + best[3] / 2; }
  }
  if (cx == null) {
    // 飛彈已消耗等：取防守方朝向攻擊者的身體前緣
    const toward = Math.sign(a.x - d.x) || d.f;
    cx = toward > 0 ? bx1 - bodyW * 0.22 : bx0 + bodyW * 0.22;
    cy = by0 + bodyH * 0.42;
  }
  const m = 0.16; // 夾進剪影內側，避免飄到身外
  cx = Math.min(Math.max(cx, bx0 + bodyW * m), bx1 - bodyW * m);
  cy = Math.min(Math.max(cy, by0 + bodyH * m), by1 - bodyH * m);
  return { wx: cx, wy: cy, body: [bx0, by0, bodyW, bodyH] };
}
function trackFx(s) {
  const pv = FX.prev;
  if (pv && s.tick !== pv.tick) {
    const dt = Math.max(0, Math.min(10, s.tick - pv.tick));
    for (const f of FX.list) f.t += dt;
    FX.list = FX.list.filter((f) => f.t < 30);
    if (s.tick < pv.tick) FX.list = [];
    for (let i = 0; i < 2; i++) {
      const d = s.p[i], a = s.p[1 - i], ai = 1 - i;
      const started = d.hs > 0 && (pv.hs[i] === 0 || d.hs > pv.hs[i]);
      const st = SFV.ST_NAME[d.st];
      if (!started || !(st === 'HIT' || st === 'BLOCK' || st === 'AIRHIT' || st === 'KD' || st === 'DIZZY' || st === 'KO')) continue;
      const kind = st === 'BLOCK' ? 'block' : 'hit';
      const { wx, wy } = contactPoint(s, ai, a, d);
      const dmg = Math.max(0, pv.hp[i] - d.hp);
      const str = fxStr(s, ai, a, d, dmg);
      FX.list.push({
        kind, t: 0, wx, wy, f: d.f, str, heavy: str === 'heavy' || str === 'super' || d.hs >= 13,
        dmg,
        counter: kind === 'hit' && d.ch > 0 && pv.ch[i] === 0,
        def: i, seed: s.tick * 31 + i,
      });
    }
  }
  FX.prev = { tick: s.tick, hs: s.p.map((p) => p.hs), hp: s.p.map((p) => p.hp), ch: s.p.map((p) => p.ch) };
}
function hitFx(ctx, f) {
  if (f.kind !== 'hit') return;
  const cfg = FX_STR[f.str] || FX_STR.light, life = cfg.hitLife;
  const x = f.wx, y = GROUND + f.wy, t = f.t, r = hrng(f.seed * 7 + 1);
  if ((f.str === 'special' || f.str === 'super') && t < 5) hadoDissipate(ctx, f);
  if (t < life) {
    const u = t / life;
    const pop = t < 2 ? 0.7 + t * 0.2 : 1 - (t - 2) / Math.max(1, life - 2) * 0.85;
    const R = cfg.hitR * Math.max(0.2, pop);
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - u * 0.95);
    const g = ctx.createRadialGradient(x, y, 1, x, y, Math.max(2, R));
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,240,120,0.95)');
    g.addColorStop(0.7, 'rgba(255,190,40,0.55)');
    g.addColorStop(1, 'rgba(255,140,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, Math.max(2, R * 0.72), 0, 7); ctx.fill();
    ctx.lineCap = 'round';
    for (let i = 0; i < cfg.spikes; i++) {
      const an = (i / cfg.spikes) * Math.PI * 2 + r() * 0.35;
      const L0 = R * 0.25, L1 = R * (1.05 + r() * 0.45);
      ctx.strokeStyle = i % 2 ? 'rgba(255,255,230,0.95)' : 'rgba(255,210,60,0.9)';
      ctx.lineWidth = (i % 2 ? 2.8 : 2) * (1 - u * 0.5);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(an) * L0, y + Math.sin(an) * L0);
      ctx.lineTo(x + Math.cos(an) * L1, y + Math.sin(an) * L1);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (f.dmg > 0 && t < 12) {
    const sc = cfg.hitR / 28;
    ctx.save(); ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 3; ctx.strokeStyle = '#140604'; ctx.fillStyle = '#ffd9a0'; ctx.globalAlpha = 1 - t / 12;
    const ty = y - 26 * sc - t; ctx.strokeText(String(f.dmg), x + 10, ty); ctx.fillText(String(f.dmg), x + 10, ty); ctx.restore();
  }
}
/** 畫面晃動（命中用，短）：回傳位移。防禦抖動改由 3D 模型純畫面 offset，不經這裡。 */
export function fightShake(s) {
  trackFx(s);
  const ev = FX.list[FX.list.length - 1]; if (!ev || ev.kind !== 'hit') return [0, 0];
  const amp = (ev.heavy ? 2.5 : 1.5) * Math.max(0, 1 - ev.t / 4); if (amp <= 0.3) return [0, 0];
  return [(s.tick % 2 ? 1 : -1) * amp, (s.tick % 3 - 1) * amp * 0.5];
}
/** 只畫命中火花；防禦不再畫藍白圈 */
export function drawFightFx(ctx) {
  for (const f of FX.list) {
    if (f.kind === 'hit') hitFx(ctx, f);
    else if (f.kind === 'block' && (f.str === 'special' || f.str === 'super')) hadoDissipate(ctx, f);
  }
}
/** 蛋波命中／被防消散的一小圈青白爆（短命，不回藍盾） */
function hadoDissipate(ctx, f) {
  if (f.t >= 6) return;
  const x = f.wx, y = GROUND + f.wy, u = f.t / 6, R = 10 + f.t * 5;
  ctx.save(); ctx.globalAlpha = (1 - u) * 0.9;
  const g = ctx.createRadialGradient(x, y, 0, x, y, R);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.4, 'rgba(160,230,255,0.55)');
  g.addColorStop(1, 'rgba(40,120,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(220,250,255,0.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, R * 0.75, 0, 7); ctx.stroke();
  ctx.restore();
}


/** 大招全場變色：從暗場／起動到招式完全結束（含 SHINKU 光束段）。純畫面，由狀態推導。 */
const SUPER_FADE = 6;
export function superScreenTint(s) {
  let owner = -1, mv = null;
  if (s.frz > 0 && s.fo) {
    owner = s.fo - 1;
    const p = s.p[owner];
    mv = p.mv >= 0 ? SFV.MOVE_LIST[p.mv] : null;
    if (mv?.kind !== 'super') mv = null;
  }
  if (!mv) {
    owner = -1;
    for (let i = 0; i < 2; i++) {
      const p = s.p[i];
      if (p.st !== SFV.ST.MOVE) continue;
      const m = SFV.MOVE_LIST[p.mv];
      if (m?.kind !== 'super') continue;
      owner = i; mv = m; break;
    }
  }
  if (owner < 0 || !mv) return { active: false, owner: -1, id: '', alpha: 0, color: 'rgba(0,0,0,0)', hex: 0x000000 };
  const id = mv.id;
  const freezeTotal = 30; // SFV.SUPER_FREEZE
  const moveLen = mv.S + mv.A + mv.R;
  const total = freezeTotal + moveLen;
  // 凍結段＋招式段串成一條時間軸，避免凍結結束又淡入一次
  const elapsed = (s.frz > 0 && s.fo === owner + 1)
    ? (freezeTotal - s.frz)
    : (freezeTotal + Math.max(0, s.p[owner].mt));
  let alpha = 1;
  if (elapsed < SUPER_FADE) alpha = (elapsed + 1) / SUPER_FADE;
  else if (total - elapsed <= SUPER_FADE) alpha = Math.max(0, (total - elapsed) / SUPER_FADE);
  const ca = id === 'CA';
  const color = ca ? 'rgba(90, 18, 8, 1)' : 'rgba(28, 16, 72, 1)';
  const hex = ca ? 0x1a0806 : 0x0c0820;
  return { active: true, owner, id, alpha, color, hex, elapsed, total };
}
/** 大招染色只改 3D 舞台背景／地板／牆，不再蓋全螢幕疊層（避免角色／HUD 一起變色）。 */

export const __fxTest = {
  reset() { FX.list = []; FX.prev = null; },
  list: () => FX.list,
  str: FX_STR,
  track: trackFx,
  contactPoint,
  superScreenTint,
  drawHadoBall,
};

/** 用水墨圖畫一隻雞；沒圖（還沒畫的招式）回 false，呼叫端改畫舊的火柴雞 */
export function drawArtChick(ctx, s, i) {
  if (!ART.ready) return false;
  const p = s.p[i], q = SFV_FIT.pose(p, s);
  let name = q.img; if (!name || !ART.img[name]) return false;
  const st = SFV.ST_NAME[p.st];
  // 受擊姿勢：hit-stop 開始時 ≥13 用重受擊圖
  const fx = [...FX.list].reverse().find((f) => f.def === i);
  if (st === 'HIT' && !p.cr && fx && fx.kind === 'hit' && fx.heavy && ART.img.n_hitH) name = 'n_hitH';
  let shake = 0, tint = i === 1 ? 'rgba(90,110,140,0.25)' : null;
  if (p.hs > 0 && fx && fx.t < 4) shake = (s.tick % 2 ? 1 : -1) * (fx.heavy ? 2 : 1);
  if (fx && fx.kind === 'hit') { if (fx.t < 1) tint = 'rgba(255,240,230,0.85)'; else if (fx.t < 2) tint = 'rgba(255,90,60,0.45)'; }
  let rot = st === 'HIT' && !p.cr && name === 'n_hitL' ? -0.09 : 0, off = q.off;
  // 只影響畫面：被摔的翻轉（抓住時用重受擊圖，拋起後依摔的進度轉半圈）、暈眩搖晃
  const op = s.p[1 - i];
  if (st === 'THROWN') {
    if (op.st === SFV.ST.THROWING && op.t > SFV.THROW_ANIM) { name = 'n_hitH'; off = SFV_FIT.NEUT + SFV_FIT.scale('n_hitH')[1]; }
    else rot = -Math.PI * Math.min(1, (SFV.THROW_ANIM - (op.st === SFV.ST.THROWING ? op.t : 0)) / SFV.THROW_ANIM);
  }
  if (st === 'DIZZY') rot = 0.04 * Math.sin(p.t * 2 * Math.PI / 40);
  const o = { s: q.s, sy: q.breath, shake, tint, rot };
  if (q.fb && q.tag) {
    const fr = q.tag;
    if (!['3', '4', '6'].includes(fr.split('_')[0]) || fr === '7_5') drawLayer(ctx, 'fxb_' + fr, p, q.off, { s: q.s });
    drawLayer(ctx, name, p, off, o);
    if (!['6', '7'].includes(fr)) drawLayer(ctx, 'fxf_' + fr, p, q.off, { s: q.s });
  } else drawLayer(ctx, name, p, off, o);
  if (st === 'DIZZY') dizzyStars(ctx, s, p);
  if (q.id === 'SHINKU' && q.ph === 'active') drawBeam(ctx, s, p);
  return true;
}
/** 3D 模式：雞交給 3D 畫，這裡只補 2D 疊加的暈眩星星與真空蛋波光束 */
export function drawArtExtras(ctx, s, i) {
  const p = s.p[i];
  if (SFV.ST_NAME[p.st] === 'DIZZY') dizzyStars(ctx, s, p);
  if (p.st === SFV.ST.MOVE && SFV.MOVE_LIST[p.mv].id === 'SHINKU' && p.mt >= SFV.MOVE_LIST[p.mv].S && p.mt < SFV.MOVE_LIST[p.mv].S + SFV.MOVE_LIST[p.mv].A) drawBeam(ctx, s, p);
}
/** 暈眩：頭上繞圈的小星星（只畫面） */
function dizzyStars(ctx, s, p) {
  ctx.save(); ctx.strokeStyle = '#2a1a10'; ctx.fillStyle = '#f3d27a'; ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    const an = s.tick * 0.12 + k * 2.094, x = p.x + Math.cos(an) * 16, y = GROUND + p.y - 112 + Math.sin(an) * 4, r = 4;
    ctx.beginPath();
    for (let j = 0; j < 10; j++) { const rr = j % 2 ? r * 0.45 : r, a2 = j * Math.PI / 5 - Math.PI / 2; ctx.lineTo(x + Math.cos(a2) * rr, y + Math.sin(a2) * rr); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
/** 真空蛋波光束：同能量球風格的加長版（白芯＋青藍暈），貼引擎長判定 */
function drawBeam(ctx, s, p) {
  const mv = SFV.MOVE_LIST[p.mv], hb = mv.hitbox, f = p.f, k = p.mt - mv.S, per = mv.A / mv.hits, ph = (k % per) / per;
  const x0 = p.x + f * hb[0], x1 = p.x + f * (hb[0] + hb[2]);
  const yc = GROUND + p.y + hb[1] + hb[3] / 2, h = hb[3] * (0.62 + 0.28 * (1 - ph));
  const left = Math.min(x0, x1), w = Math.abs(x1 - x0);
  ctx.save();
  // 外暈
  const g0 = ctx.createLinearGradient(0, yc - h, 0, yc + h);
  g0.addColorStop(0, 'rgba(40,120,255,0)'); g0.addColorStop(0.25, 'rgba(80,180,255,0.35)');
  g0.addColorStop(0.5, 'rgba(200,245,255,0.55)'); g0.addColorStop(0.75, 'rgba(80,180,255,0.35)'); g0.addColorStop(1, 'rgba(40,120,255,0)');
  ctx.globalAlpha = 0.85; ctx.fillStyle = g0; ctx.fillRect(left, yc - h, w, h * 2);
  // 白芯
  const g1 = ctx.createLinearGradient(0, yc - h * 0.45, 0, yc + h * 0.45);
  g1.addColorStop(0, 'rgba(180,230,255,0)'); g1.addColorStop(0.3, 'rgba(230,250,255,0.9)');
  g1.addColorStop(0.5, 'rgba(255,255,255,1)'); g1.addColorStop(0.7, 'rgba(230,250,255,0.9)'); g1.addColorStop(1, 'rgba(180,230,255,0)');
  ctx.globalAlpha = 0.95; ctx.fillStyle = g1; ctx.fillRect(left, yc - h * 0.45, w, h * 0.9);
  // 旋流細線（seed＝tick，rollback 安全）
  const rnd = hrng(s.tick * 5 + p.mt * 3 + 11);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const y = yc + (rnd() - 0.5) * h * 0.7, a = left + rnd() * w * 0.85;
    ctx.globalAlpha = 0.35 + rnd() * 0.45; ctx.lineWidth = 1 + rnd() * 2;
    ctx.beginPath(); ctx.moveTo(a, y); ctx.lineTo(a + f * (24 + rnd() * 60), y + (rnd() - 0.5) * 8); ctx.stroke();
  }
  // 前緣脈衝球
  const tipX = f > 0 ? left + w : left, pulse = 1 + 0.08 * Math.sin(s.tick * 0.5);
  const tipR = h * 0.55 * pulse;
  const tg = ctx.createRadialGradient(tipX, yc, 0, tipX, yc, tipR * 1.8);
  tg.addColorStop(0, '#ffffff'); tg.addColorStop(0.35, 'rgba(180,240,255,0.9)'); tg.addColorStop(1, 'rgba(40,120,255,0)');
  ctx.globalAlpha = 0.95; ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(tipX, yc, tipR * 1.8, 0, 7); ctx.fill();
  ctx.restore();
}

/**
 * SF 風格蛋波能量球：白熱核心、青藍光暈、旋流外圈、短拖尾、微脈衝。
 * 半徑跟引擎 projBox 高／2，位置＝彈體中心——不改判定。
 * lv：0/1 一般、2 EX（更亮更大暈）。
 */
export function drawHadoBall(ctx, q, s) {
  const b = SFV.projBox(q), cx = q.x, cy = GROUND + q.y, r = b[3] / 2;
  const dir = Math.sign(q.vx) || 1, ex = q.lv >= 2;
  const pulse = 1 + 0.07 * Math.sin(s.tick * 0.45 + q.x * 0.03);
  const R = r * pulse * (ex ? 1.08 : 1);
  ctx.save();
  // 拖尾
  for (let k = 4; k >= 1; k--) {
    const tx = cx - dir * k * (R * 0.58);
    const tr = R * (1 - k * 0.13);
    ctx.globalAlpha = 0.1 * (5 - k);
    const g = ctx.createRadialGradient(tx, cy, 0, tx, cy, tr * 1.7);
    g.addColorStop(0, 'rgba(220,250,255,0.95)');
    g.addColorStop(0.45, 'rgba(80,190,255,0.45)');
    g.addColorStop(1, 'rgba(30,100,220,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(tx, cy, tr * 1.7, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 外暈（在染色背景上也清楚）
  const haloR = R * (ex ? 2.35 : 2.05);
  const halo = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, haloR);
  halo.addColorStop(0, 'rgba(255,255,255,1)');
  halo.addColorStop(0.22, 'rgba(200,245,255,0.95)');
  halo.addColorStop(0.5, 'rgba(60,170,255,0.5)');
  halo.addColorStop(1, 'rgba(20,80,200,0)');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, 7); ctx.fill();
  // 白熱核心
  const core = ctx.createRadialGradient(cx - dir * R * 0.12, cy - R * 0.12, 0, cx, cy, R * 0.72);
  core.addColorStop(0, '#ffffff');
  core.addColorStop(0.45, '#eafcff');
  core.addColorStop(1, 'rgba(90,190,255,0.25)');
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, R * 0.7, 0, 7); ctx.fill();
  // 旋流外圈
  ctx.translate(cx, cy);
  const a0 = (s.tick * 0.22 + q.x * 0.01) % (Math.PI * 2);
  for (let i = 0; i < (ex ? 4 : 3); i++) {
    ctx.rotate(a0 * (i % 2 ? 1 : -1) + i * 0.85);
    ctx.strokeStyle = i === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(140,220,255,0.75)';
    ctx.lineWidth = (ex ? 2.4 : 1.8) - i * 0.25;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(0, 0, R * (1.02 - i * 0.07), R * (0.58 - i * 0.05), 0.35, 0, Math.PI * 1.7);
    ctx.stroke();
  }
  ctx.restore();
}

/** @deprecated 舊水墨球入口改走能量球（保留名稱以免外部引用炸掉） */
export function drawInkOrb(ctx, cx, cy, r, dir, seed, col) {
  drawHadoBall(ctx, { x: cx, y: cy - GROUND, vx: dir, lv: 0, n: 1 }, { tick: seed | 0 });
  return true;
}
