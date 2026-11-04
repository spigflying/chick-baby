// @ts-nocheck
// 格鬥水墨美術（poc3 移植）：圖檔在 /fight/*.webp（已裁到透明邊界、縮成 0.5 倍），manifest 記原圖尺寸與裁切位移。
// 只管畫面：受擊判定在引擎（SFV_FIT），這裡讀同一個 pose 決定畫哪張圖，畫面和判定一定對得上。
import { SFV, SFV_FIT, FIT_IMAGES } from '@chick/engine';

const ART = { ready: false, loading: null as Promise<void> | null, img: {} as Record<string, any>, man: {} as Record<string, number[]> };
const GROUND = 470;

/** 進格鬥畫面前預載；失敗或沒有 DOM（測試）就維持舊的火柴雞 */
export function preloadFightArt(base = '/fight/') {
  if (ART.loading || typeof Image === 'undefined') return ART.loading;
  ART.loading = (async () => {
    try {
      ART.man = await (await fetch(base + 'manifest.json')).json();
      await Promise.all(FIT_IMAGES.filter((n) => ART.man[n]).map((n) => new Promise<void>((ok) => {
        const im = new Image(); im.decoding = 'async';
        im.onload = () => { ART.img[n] = im; ok(); }; im.onerror = () => ok(); im.src = base + n + '.webp';
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
const FX = { list: [] as any[], prev: null as any };
const hrng = (seed) => { let s = (seed | 0) || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
function trackFx(s) {
  const pv = FX.prev;
  if (pv && s.tick !== pv.tick) {
    const dt = Math.max(0, Math.min(10, s.tick - pv.tick));
    for (const f of FX.list) f.t += dt;
    FX.list = FX.list.filter((f) => f.t < 30);
    if (s.tick < pv.tick) FX.list = [];
    for (let i = 0; i < 2; i++) {
      const d = s.p[i], a = s.p[1 - i];
      const started = d.hs > 0 && (pv.hs[i] === 0 || d.hs > pv.hs[i]);
      const st = SFV.ST_NAME[d.st];
      if (!started || !(st === 'HIT' || st === 'BLOCK' || st === 'AIRHIT' || st === 'KD' || st === 'DIZZY' || st === 'KO')) continue;
      const kind = st === 'BLOCK' ? 'block' : 'hit';
      const hb = SFV.hitboxOf(a), wy = hb ? hb.box[1] + hb.box[3] / 2 : d.y - (d.cr ? 45 : 70);
      FX.list.push({ kind, t: 0, wx: d.x + d.f * 16, wy, f: d.f, heavy: d.hs >= 13, dmg: Math.max(0, pv.hp[i] - d.hp), counter: kind === 'hit' && d.ch > 0 && pv.ch[i] === 0, def: i, seed: s.tick * 31 + i });
    }
  }
  FX.prev = { tick: s.tick, hs: s.p.map((p) => p.hs), hp: s.p.map((p) => p.hp), ch: s.p.map((p) => p.ch) };
}
function blockFx(ctx, f) {
  const life = f.heavy ? 4 : 3; if (f.t >= life) return;
  const x = f.wx, y = GROUND + f.wy, sc = 0.75, r = hrng(f.seed * 13 + 3), face = -f.f;
  ctx.save(); ctx.globalAlpha = 1 - f.t / life; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(120,200,240,0.9)'; ctx.lineWidth = 2 * sc;
  for (let i = 0; i < 3; i++) { const an = (face > 0 ? Math.PI : 0) + (r() - 0.5) * 1.6, L = (8 + r() * 6) * sc; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 3 * sc, y + Math.sin(an) * 3 * sc); ctx.lineTo(x + Math.cos(an) * L, y + Math.sin(an) * L); ctx.stroke(); }
  ctx.fillStyle = 'rgba(235,250,255,1)'; ctx.beginPath(); ctx.arc(x, y, 3 * sc, 0, 7); ctx.fill(); ctx.restore();
}
function hitFx(ctx, f) {
  const life = f.heavy ? 7 : 5, x = f.wx, y = GROUND + f.wy, sc = f.heavy ? 1.2 : 0.85, t = f.t, r = hrng(f.seed * 7 + 1);
  if (t < life) {
    const R = (f.heavy ? 15 : 14) * sc * (t < 2 ? 1 : 1 - (t - 2) / life);
    ctx.save(); ctx.globalAlpha = 1 - t / life;
    const g = ctx.createRadialGradient(x, y, 1, x, y, Math.max(2, R)); g.addColorStop(0, 'rgba(255,250,235,1)'); g.addColorStop(0.45, 'rgba(255,140,40,0.9)'); g.addColorStop(1, 'rgba(230,60,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, Math.max(2, R), 0, 7); ctx.fill();
    ctx.strokeStyle = '#140604'; ctx.lineCap = 'round'; ctx.lineWidth = 2.5 * sc;
    for (let i = 0; i < (f.heavy ? 6 : 4); i++) { const an = r() * 6.283, L0 = R * 0.6, L = R * (1.1 + r() * 0.5); ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * L0, y + Math.sin(an) * L0); ctx.lineTo(x + Math.cos(an) * L, y + Math.sin(an) * L); ctx.stroke(); }
    ctx.restore();
  }
  if (f.dmg > 0 && t < 12) {
    ctx.save(); ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 3; ctx.strokeStyle = '#140604'; ctx.fillStyle = '#ffd9a0'; ctx.globalAlpha = 1 - t / 12;
    const ty = y - 26 * sc - t; ctx.strokeText(String(f.dmg), x + 10, ty); ctx.fillText(String(f.dmg), x + 10, ty); ctx.restore();
  }
}
/** 畫面晃動（4 tick，不綁 hit-stop 長度）：回傳位移，呼叫端 translate */
export function fightShake(s) {
  trackFx(s);
  const ev = FX.list[FX.list.length - 1]; if (!ev || ev.kind !== 'hit') return [0, 0];
  const amp = (ev.heavy ? 2.5 : 1.5) * Math.max(0, 1 - ev.t / 4); if (amp <= 0.3) return [0, 0];
  return [(s.tick % 2 ? 1 : -1) * amp, (s.tick % 3 - 1) * amp * 0.5];
}
export function drawFightFx(ctx) { if (!ART.ready) return; for (const f of FX.list) (f.kind === 'block' ? blockFx : hitFx)(ctx, f); }

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
  const rot = st === 'HIT' && !p.cr && name === 'n_hitL' ? -0.09 : 0;
  const o = { s: q.s, sy: q.breath, shake, tint, rot };
  if (q.fb && q.tag) {
    const fr = q.tag;
    if (!['3', '4', '6'].includes(fr.split('_')[0]) || fr === '7_5') drawLayer(ctx, 'fxb_' + fr, p, q.off, { s: q.s });
    drawLayer(ctx, name, p, q.off, o);
    if (!['6', '7'].includes(fr)) drawLayer(ctx, 'fxf_' + fr, p, q.off, { s: q.s });
  } else drawLayer(ctx, name, p, q.off, o);
  if (q.id === 'SHINKU' && q.ph === 'active') drawBeam(ctx, s, p);
  return true;
}
/** 真空蛋波的光束：沿著引擎的長判定畫（圖只有推掌，光束要另外畫才看得出打多遠）；每段開始時亮一下 */
function drawBeam(ctx, s, p) {
  const mv = SFV.MOVE_LIST[p.mv], hb = mv.hitbox, f = p.f, k = p.mt - mv.S, per = mv.A / mv.hits, ph = (k % per) / per;
  const x0 = p.x + f * hb[0], x1 = p.x + f * (hb[0] + hb[2]), yc = GROUND + p.y + hb[1] + hb[3] / 2, h = hb[3] * (0.55 + 0.25 * (1 - ph));
  ctx.save();
  const g = ctx.createLinearGradient(0, yc - h / 2, 0, yc + h / 2);
  g.addColorStop(0, 'rgba(120,210,255,0)'); g.addColorStop(0.3, 'rgba(140,225,255,0.75)'); g.addColorStop(0.5, 'rgba(250,255,255,0.95)'); g.addColorStop(0.7, 'rgba(140,225,255,0.75)'); g.addColorStop(1, 'rgba(120,210,255,0)');
  ctx.globalAlpha = 0.65 + 0.35 * (1 - ph); ctx.fillStyle = g;
  ctx.fillRect(Math.min(x0, x1), yc - h / 2, Math.abs(x1 - x0), h);
  ctx.strokeStyle = '#000'; ctx.globalAlpha = 0.5; const r = hrng(s.tick * 3 + 1);
  for (let i = 0; i < 10; i++) { const y = yc + (r() - 0.5) * h * 0.8, a = x0 + f * r() * Math.abs(x1 - x0) * 0.8; ctx.lineWidth = 0.8 + r() * 1.6; ctx.beginPath(); ctx.moveTo(a, y); ctx.lineTo(a + f * (20 + r() * 50), y); ctx.stroke(); }
  ctx.restore();
}

/** 水墨蛋波：毛邊墨球 + 乾筆拖尾，外圈一層玩家顏色的光讓它在暗色舞台上看得見 */
export function drawInkOrb(ctx, cx, cy, r, dir, seed, col) {
  if (!ART.ready) return false;
  const g = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.9); g.addColorStop(0, col); g.addColorStop(1, col + '00');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 1.9, 0, 7); ctx.fill();
  let s = 99; const rb = () => (s = (s * 16807) % 2147483647) / 2147483647;
  ctx.strokeStyle = '#000';
  for (let b = 0; b < 16; b++) { const off = rb() * 2 - 1; ctx.lineWidth = 0.8 + rb() * 2.4; ctx.beginPath();
    for (let k = 0; k <= 12; k++) { const u = k / 12, X = cx - dir * (r * 0.4 + u * r * 4), Y = cy + off * r * (1 - 0.75 * u); (rb() < 0.08 + 0.45 * u) ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); }
    ctx.stroke(); }
  const rnd = hrng(seed | 1);
  ctx.fillStyle = '#000'; ctx.beginPath();
  for (let k = 0; k <= 48; k++) { const a = k / 48 * Math.PI * 2, rr = r * (0.92 + 0.12 * Math.sin(a * 5 + 1) + 0.06 * rnd()); ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  ctx.fill();
  for (let k = 0; k < 30; k++) { const a = rnd() * 6.283, l = r * (1.05 + rnd() * 0.4); ctx.lineWidth = 0.8 + rnd() * 1.5; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * .8, cy + Math.sin(a) * r * .8); ctx.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); ctx.stroke(); }
  return true;
}
