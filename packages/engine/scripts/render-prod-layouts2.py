# 讀 /workspace/prod-layouts2.json → 每國一張總覽 + 全部一張。Pillow。
import json, math, sys
from PIL import Image, ImageDraw, ImageFont
D = json.load(open('/workspace/prod-layouts2.json'))
FP = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
def font(sz):
    for i in range(6):
        f = ImageFont.truetype(FP, sz, index=i)
        if 'TC' in f.getname()[0]: return f
    return ImageFont.truetype(FP, sz)
FB = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
def bold(sz):
    for i in range(6):
        f = ImageFont.truetype(FB, sz, index=i)
        if 'TC' in f.getname()[0]: return f
    return font(sz)
COL = {'straight': (120, 124, 132), 'fast': (40, 170, 120), 'lift': (240, 140, 30), 'brake': (220, 40, 50)}
WX = {'clear': '晴', 'rain': '雨', 'night': '夜', 'snow': '雪', 'fog': '霧'}
SC = {'city': '城市', 'coast': '海岸', 'desert': '沙漠', 'forest': '森林', 'snow': '雪地', 'farm': '田園'}
def band(p):
    if 'a' not in p: return 'straight'
    return 'fast' if p['r'] >= 400 else ('lift' if p['r'] > 200 else 'brake')
def segs(t):
    ps, st, out = t['pieces'], t['pieceStart'], []
    for k, p in enumerate(ps):
        en = st[k + 1] if k + 1 < len(ps) else len(t['pts']) - 1
        out += [k] * (en - st[k])
    return out
def wrap(d, s, f, w):
    lines, cur = [], ''
    for ch in s:
        if d.textlength(cur + ch, font=f) > w: lines.append(cur); cur = ch
        else: cur += ch
    return lines + [cur]
def cell(t, W=620, H=760):
    im = Image.new('RGB', (W, H), (250, 250, 246)); d = ImageDraw.Draw(im)
    pts = t['pts']; xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    top = 168; mapH = H - top - 40; pad = 40
    sc = min((W - 2 * pad) / (max(xs) - min(xs) + 1), (mapH - 2 * pad) / (max(ys) - min(ys) + 1))
    ox = (W - (max(xs) - min(xs)) * sc) / 2 - min(xs) * sc; oy = top + (mapH - (max(ys) - min(ys)) * sc) / 2 - min(ys) * sc
    P = lambda p: (ox + p[0] * sc, oy + p[1] * sc)
    d.line([(20, H - 22), (20 + 300 * sc, H - 22)], fill=(60, 60, 60), width=3); d.text((26 + 300 * sc, H - 34), '300 m', font=font(16), fill=(60, 60, 60))
    sg = segs(t); ps = t['pieces']; rw = max(6, int(14 * sc * 2.2)); hd = t['hardest']
    hz = [i for i in range(len(pts) - 1) if hd['i0'] <= sg[i] <= hd['i1']]
    for i in hz: d.line([P(pts[i]), P(pts[i + 1])], fill=(255, 215, 0), width=rw + 26)
    for i in hz: x, y = P(pts[i]); r = (rw + 26) / 2; d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 215, 0))
    d.line([P(p) for p in pts], fill=(40, 40, 44), width=rw + 6, joint='curve')
    for i in range(len(pts) - 1): d.line([P(pts[i]), P(pts[i + 1])], fill=COL[band(ps[sg[i]])], width=rw)
    for i in range(1, len(pts) - 1):
        x, y = P(pts[i]); c = COL[band(ps[sg[i]])]; d.ellipse([x - rw / 2, y - rw / 2, x + rw / 2, y + rw / 2], fill=c)
    N = len(pts) - 1; step = max(8, N // 9)
    for i in range(step // 2, N, step):
        (x0, y0), (x1, y1) = P(pts[i]), P(pts[i + 1]); a = math.atan2(y1 - y0, x1 - x0); cx, cy = (x0 + x1) / 2, (y0 + y1) / 2; L = 12
        d.polygon([(cx + L * math.cos(a), cy + L * math.sin(a)), (cx + L * math.cos(a + 2.5), cy + L * math.sin(a + 2.5)), (cx + L * math.cos(a - 2.5), cy + L * math.sin(a - 2.5))], fill=(255, 255, 255), outline=(0, 0, 0))
    # 最難彎標籤
    mid = hz[len(hz) // 2] if hz else 0; hx, hy = P(pts[mid]); lab = f"最難：{hd['deg']:.0f}° R{hd['rmin']}"
    tw_ = d.textlength(lab, font=bold(17)); lx = min(max(hx - tw_ / 2, 4), W - tw_ - 8); ly = hy - rw - 40 if hy - rw - 40 > top else hy + rw + 16
    d.rectangle([lx - 4, ly - 2, lx + tw_ + 4, ly + 22], fill=(255, 235, 120), outline=(0, 0, 0)); d.text((lx, ly - 1), lab, font=bold(17), fill=(0, 0, 0))
    (x0, y0), (x1, y1) = P(pts[0]), P(pts[1]); a = math.atan2(y1 - y0, x1 - x0); nx, ny = -math.sin(a), math.cos(a); tx, ty = math.cos(a), math.sin(a)
    sq = rw / 2.5
    for r in range(-3, 3):
        for c in range(2):
            col = (0, 0, 0) if (r + c) % 2 else (255, 255, 255)
            bx, by = x0 + nx * r * sq + tx * c * sq, y0 + ny * r * sq + ty * c * sq
            d.polygon([(bx, by), (bx + nx * sq, by + ny * sq), (bx + nx * sq + tx * sq, by + ny * sq + ty * sq), (bx + tx * sq, by + ty * sq)], fill=col)
    fx, fy = x0 + nx * (rw + 14), y0 + ny * (rw + 14)
    d.line([(fx, fy), (fx, fy - 40)], fill=(30, 30, 30), width=3)
    for r in range(3):
        for c in range(4):
            d.rectangle([fx + c * 7, fy - 40 + r * 6, fx + c * 7 + 7, fy - 40 + r * 6 + 6], fill=(0, 0, 0) if (r + c) % 2 else (255, 255, 255), outline=(0, 0, 0))
    d.text((fx + 32, fy - 40), 'START', font=bold(13), fill=(0, 0, 0))
    sc_ = t['score']; scol = (40, 150, 60) if sc_ < 3.5 else ((230, 130, 0) if sc_ < 6.5 else (200, 30, 40))
    d.text((20, 8), f"{t['id']}  {t['name']}", font=bold(32), fill=(20, 20, 20))
    bt = f"難度 {sc_:.1f}"; bw = d.textlength(bt, font=bold(26)); d.rounded_rectangle([W - bw - 34, 10, W - 12, 50], 8, fill=scol); d.text((W - bw - 23, 12), bt, font=bold(26), fill=(255, 255, 255))
    y = 50
    for ln in wrap(d, '取材：' + t['insp'], font(17), W - 40)[:2]: d.text((20, y), ln, font=font(17), fill=(70, 40, 120)); y += 22
    y = max(y, 96)
    d.text((20, y), f"{t['len']} m（現在 {t['cur']}，{(t['len'] / t['cur'] - 1) * 100:+.0f}%）× {t['laps']} 圈 · {SC[t['scenery']]}／{WX[t['weather']]} · AI {t['ai']:.2f}", font=font(17), fill=(50, 50, 50))
    d.text((20, y + 24), f"彎 {t['corners']}（需收油 {t['hardCorners']}）髮夾 {t['hp']} 連鎖 {t['combos']} · 總轉角 {t['totalDeg']}° · 彎道收油 {t['liftShare'] * 100:.0f}% · 最緊 R{t['rmin']}", font=font(17), fill=(50, 50, 50))
    return im
def legend(W):
    im = Image.new('RGB', (W, 46), (255, 255, 255)); d = ImageDraw.Draw(im); x = 20
    for k, n in [('straight', '直線'), ('fast', 'R≥400 全油'), ('lift', 'R200–400 收油'), ('brake', 'R≤200 煞車')]:
        d.rectangle([x, 14, x + 36, 30], fill=COL[k]); d.text((x + 44, 8), n, font=font(20), fill=(0, 0, 0)); x += 210
    d.rectangle([x, 12, x + 36, 32], fill=(255, 215, 0)); d.text((x + 44, 8), '最難的彎', font=font(20), fill=(0, 0, 0)); x += 160
    d.text((x, 8), '白三角＝行進方向', font=font(20), fill=(0, 0, 0))
    return im
cells = {t['id']: cell(t) for t in D}
by = {}
for t in D: by.setdefault(t['countryId'], []).append(t)
CW, CH = 620, 760
for cid, ts in by.items():
    W = CW * 2; im = Image.new('RGB', (W, 70 + 46 + CH * 2), (255, 255, 255)); d = ImageDraw.Draw(im)
    d.text((20, 12), f"{ts[0]['country']}（{cid}）— 高難度佈局 v2（草稿，取材真實賽道）", font=bold(36), fill=(0, 0, 0))
    im.paste(legend(W), (0, 70))
    for i, t in enumerate(ts): im.paste(cells[t['id']], ((i % 2) * CW, 116 + (i // 2) * CH))
    im.save(f'/workspace/prod-layouts2-{cid}.png')
W = CW * 4; im = Image.new('RGB', (W, 70 + 46 + CH * len(by)), (255, 255, 255)); d = ImageDraw.Draw(im)
d.text((20, 12), '全部正式賽道 — 高難度佈局 v2（草稿，每列一國：台灣／日本／美國／德國）', font=bold(36), fill=(0, 0, 0)); im.paste(legend(W), (0, 70))
for r, (cid, ts) in enumerate(by.items()):
    for i, t in enumerate(ts): im.paste(cells[t['id']], (i * CW, 116 + r * CH))
im.save('/workspace/prod-layouts2-all.png'); print('rendered')
