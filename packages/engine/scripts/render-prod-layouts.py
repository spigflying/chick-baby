# 讀 /workspace/prod-layouts.json → 每國一張總覽 + 全部一張。Pillow。
import json, math, sys
from PIL import Image, ImageDraw, ImageFont
D = json.load(open('/workspace/prod-layouts.json'))
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
COL = {'straight': (120, 124, 132), 'c90': (240, 140, 30), 'hp': (220, 40, 50), 'sbend': (40, 120, 220), 'sweep': (40, 170, 120)}
WX = {'clear': '晴', 'rain': '雨', 'night': '夜', 'snow': '雪', 'fog': '霧'}
SC = {'city': '城市', 'coast': '海岸', 'desert': '沙漠', 'forest': '森林', 'snow': '雪地', 'farm': '田園'}
def kinds(t):
    ps, ks, i = t['pieces'], [], 0
    while i < len(ps):
        p = ps[i]
        if 'a' not in p: ks.append('straight'); i += 1; continue
        a = abs(p['a']); q = ps[i + 1] if i + 1 < len(ps) else None
        if a >= 150: ks.append('hp')
        elif 70 <= a <= 110: ks.append('c90')
        elif q and 'a' in q and (q['a'] > 0) != (p['a'] > 0) and abs(q['a']) < 70: ks += ['sbend', 'sbend']; i += 2; continue
        else: ks.append('sweep')
        i += 1
    seg = []
    for k, (st, p) in enumerate(zip(t['pieceStart'], ps)):
        en = t['pieceStart'][k + 1] if k + 1 < len(ps) else len(t['pts']) - 1
        seg += [ks[k]] * (en - st)
    return seg
def cell(t, W=620, H=700):
    im = Image.new('RGB', (W, H), (250, 250, 246)); d = ImageDraw.Draw(im)
    pts = t['pts']; xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    mapH = H - 150; pad = 50
    sc = min((W - 2 * pad) / (max(xs) - min(xs) + 1), (mapH - 2 * pad) / (max(ys) - min(ys) + 1))
    ox = (W - (max(xs) - min(xs)) * sc) / 2 - min(xs) * sc; oy = 110 + (mapH - (max(ys) - min(ys)) * sc) / 2 - min(ys) * sc
    P = lambda p: (ox + p[0] * sc, oy + p[1] * sc)
    # 300m 比例尺
    d.line([(20, H - 22), (20 + 300 * sc, H - 22)], fill=(60, 60, 60), width=3); d.text((26 + 300 * sc, H - 34), '300 m', font=font(16), fill=(60, 60, 60))
    ks = kinds(t); rw = max(6, int(14 * sc * 2.2))
    d.line([P(p) for p in pts], fill=(40, 40, 44), width=rw + 6, joint='curve')
    for i in range(len(pts) - 1): d.line([P(pts[i]), P(pts[i + 1])], fill=COL[ks[i]], width=rw)
    for i in range(1, len(pts) - 1):
        x, y = P(pts[i]); d.ellipse([x - rw / 2, y - rw / 2, x + rw / 2, y + rw / 2], fill=COL[ks[i]])
    # 方向箭頭（每 ~500m）
    N = len(pts) - 1; step = max(8, N // 8)
    for i in range(step // 2, N, step):
        (x0, y0), (x1, y1) = P(pts[i]), P(pts[i + 1]); a = math.atan2(y1 - y0, x1 - x0); cx, cy = (x0 + x1) / 2, (y0 + y1) / 2; L = 13
        tri = [(cx + L * math.cos(a), cy + L * math.sin(a)), (cx + L * math.cos(a + 2.5), cy + L * math.sin(a + 2.5)), (cx + L * math.cos(a - 2.5), cy + L * math.sin(a - 2.5))]
        d.polygon(tri, fill=(255, 255, 255), outline=(0, 0, 0))
    # 起終點：格子旗（垂直於路的格紋條）＋旗子
    (x0, y0), (x1, y1) = P(pts[0]), P(pts[1]); a = math.atan2(y1 - y0, x1 - x0); nx, ny = -math.sin(a), math.cos(a); tx, ty = math.cos(a), math.sin(a)
    sq = rw / 2.5
    for r in range(-3, 3):
        for c in range(2):
            col = (0, 0, 0) if (r + c) % 2 else (255, 255, 255)
            bx, by = x0 + nx * r * sq + tx * c * sq, y0 + ny * r * sq + ty * c * sq
            d.polygon([(bx, by), (bx + nx * sq, by + ny * sq), (bx + nx * sq + tx * sq, by + ny * sq + ty * sq), (bx + tx * sq, by + ty * sq)], fill=col)
    fx, fy = x0 + nx * (rw + 14), y0 + ny * (rw + 14)
    d.line([(fx, fy), (fx, fy - 46)], fill=(30, 30, 30), width=3)
    for r in range(3):
        for c in range(4):
            col = (0, 0, 0) if (r + c) % 2 else (255, 255, 255)
            d.rectangle([fx + c * 8, fy - 46 + r * 7, fx + c * 8 + 8, fy - 46 + r * 7 + 7], fill=col, outline=(0, 0, 0))
    d.text((fx + 36, fy - 46), 'START/FINISH', font=bold(14), fill=(0, 0, 0))
    # 標題
    d.text((20, 12), f"{t['id']}  {t['name']}", font=bold(34), fill=(20, 20, 20))
    d.text((20, 56), f"{t['len']} m × {t['laps']} 圈  ·  {SC[t['scenery']]}／{WX[t['weather']]}  ·  AI {t['ai']:.2f}", font=font(20), fill=(50, 50, 50))
    d.text((20, 82), f"90°彎 {t['c90']}  髮夾 {t['hp']}  S彎 {t['sbend']}  掃彎 {t['sweep']}   (現在 {t['cur']} m)", font=font(20), fill=(50, 50, 50))
    return im
def legend(W):
    im = Image.new('RGB', (W, 46), (255, 255, 255)); d = ImageDraw.Draw(im); x = 20
    for k, n in [('straight', '直線'), ('c90', '90° 彎'), ('hp', '髮夾 180°'), ('sbend', 'S 彎'), ('sweep', '掃彎')]:
        d.rectangle([x, 14, x + 36, 30], fill=COL[k]); d.text((x + 44, 8), n, font=font(20), fill=(0, 0, 0)); x += 170
    d.text((x, 8), '白三角＝行進方向 · 起點朝北、順時針', font=font(20), fill=(0, 0, 0))
    return im
cur = {c['id']: c['len'] for c in json.load(open('/workspace/cur.json'))}
for t in D: t['cur'] = cur[t['id']]
cells = {t['id']: cell(t) for t in D}
by = {}
for t in D: by.setdefault(t['countryId'], []).append(t)
CW, CH = 620, 700
for cid, ts in by.items():
    W = CW * 2; im = Image.new('RGB', (W, 70 + 46 + CH * 2), (255, 255, 255)); d = ImageDraw.Draw(im)
    d.text((20, 12), f"{ts[0]['country']}（{cid}）— 地圖先佈局提案（草稿）", font=bold(36), fill=(0, 0, 0))
    im.paste(legend(W), (0, 70))
    for i, t in enumerate(ts): im.paste(cells[t['id']], ((i % 2) * CW, 116 + (i // 2) * CH))
    im.save(f'/workspace/prod-layouts-{cid}.png')
W = CW * 4; im = Image.new('RGB', (W, 70 + 46 + CH * len(by)), (255, 255, 255)); d = ImageDraw.Draw(im)
d.text((20, 12), '全部正式賽道 — 地圖先佈局提案（草稿，每列一國：台灣／日本／美國／德國）', font=bold(36), fill=(0, 0, 0)); im.paste(legend(W), (0, 70))
for r, (cid, ts) in enumerate(by.items()):
    for i, t in enumerate(ts): im.paste(cells[t['id']], (i * CW, 116 + r * CH))
im.save('/workspace/prod-layouts-all.png'); print('rendered')
