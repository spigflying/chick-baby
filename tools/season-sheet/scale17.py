# 把 season-sheet 精靈等比縮小（雞側面 24 → 17px 高，四隻同一個比例），一起換算配件錨點、外套範圍、披風／翅膀像素。
# 用法：python3 tools/season-sheet/scale17.py <cur.json> <repo>
#   cur.json = { BENSON, VIEW_ANCHORS, COAT, POSE_ART }（目前 apps/web 的資料，用 vitest 匯出）
# 縮圖沿用 tools/final-sheet/scale.py：8x 超取樣、多數色、1px 外框、眼睛用手標座標補點。
# 披風／翅膀：原尺寸「底圖＋配件」合成後整張縮小，再和縮小後的底圖相減（底圖透明處 → back，其餘 → front）。
import json, sys
import numpy as np
cur = json.load(open(sys.argv[1])); REPO = sys.argv[2]
B = cur['BENSON']; POSE = cur['POSE_ART']
SS = 8; PAD = 24  # PAD × S = 17 整數格，加邊後格線不會偏
# 原尺寸的手標特徵（tools/season-sheet/anchors.py）：(眼睛 x,y), 頭頂列, 頭毛到第幾列（-1 無）, 腳從第幾列
MAN = {'chicken': {'side': ((7, 9), 3, 2, 22), 'front': ((5, 9), 3, 2, 21), 'sleep': (None, 9, -1, 99)}, 'duck': {'side': ((9, 8), 2, 1, 23), 'front': ((5, 8), 2, 1, 23), 'sleep': (None, 9, -1, 99)}, 'penguin': {'side': ((9, 7), 0, -1, 20), 'front': ((6, 6), 0, -1, 19), 'sleep': (None, 7, -1, 99)}, 'dino': {'side': ((10, 7), 2, 1, 21), 'front': ((5, 8), 2, 1, 22), 'sleep': (None, 10, -1, 99)}}
EYE2 = {'chicken': 12, 'duck': 12, 'penguin': 13, 'dino': 12}  # 正面第二隻眼睛的 x

def arr(rows): return np.array([[(-1 if c == '.' else int(c)) for c in r] for r in rows])
def oh(rows): a = arr(rows); ys = np.where((a >= 0).any(1))[0]; return ys[-1] - ys[0] + 1
S = 17 / oh(B['chicken']['side'])
def pad(a): out = np.full((a.shape[0] + 2 * PAD, a.shape[1] + 2 * PAD), -1); out[PAD:PAD + a.shape[0], PAD:PAD + a.shape[1]] = a; return out

def down(a, eyeset):
    """a：已加邊的原尺寸陣列；eyeset：原尺寸（未加邊）的眼睛座標。回傳縮小後的陣列（含邊）。"""
    H, W = a.shape; h, w = int(np.ceil(H * S)), int(np.ceil(W * S))
    up = np.repeat(np.repeat(a, SS, 0), SS, 1); out = np.full((h, w), -1)
    for j in range(h):
        for i in range(w):
            y0, y1 = int(j / S * SS), int((j + 1) / S * SS); x0, x1 = int(i / S * SS), int((i + 1) / S * SS)
            blk = up[y0:y1, x0:x1]
            if blk.size == 0: continue
            op = blk[blk >= 0]
            if op.size < blk.size * 0.5: continue
            body = op[op < 3]
            out[j, i] = np.bincount(body, minlength=3).argmax() if body.size > op.size * 0.35 else 3
    m = out >= 0
    N4 = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    for _ in range(2):  # 補洞、去單點突起
        for j in range(h):
            for i in range(w):
                n = sum(m[j + dy, i + dx] if 0 <= j + dy < h and 0 <= i + dx < w else 0 for dx, dy in N4)
                if not m[j, i] and n >= 3: m[j, i] = True; out[j, i] = 3
                elif m[j, i] and n <= 1 and out[j, i] != 3: m[j, i] = False; out[j, i] = -1
    for j in range(h):  # 1px 連續外框
        for i in range(w):
            if m[j, i] and any(not (0 <= j + dy < h and 0 <= i + dx < w and m[j + dy, i + dx]) for dx, dy in N4): out[j, i] = 3
    for j in range(1, h - 1):  # 外框太厚：內側的 3 若兩邊以上也是 3 → 改成鄰近的身體色
        for i in range(1, w - 1):
            if out[j, i] == 3 and all(m[j + dy, i + dx] for dx, dy in N4):
                nb = [out[j + dy, i + dx] for dx, dy in N4]
                if sum(v == 3 for v in nb) >= 2:
                    vals = [v for v in nb if 0 <= v < 3]; out[j, i] = max(set(vals), key=vals.count) if vals else 2
    for (ex, ey) in eyeset:  # 眼睛：清楚的暗點，左右與上方不要是暗色
        x, y = int((ex + PAD) * S + 0.5 * S), int((ey + PAD) * S + 0.5 * S)
        if 0 < y < h - 1 and 0 < x < w - 1 and m[y, x]:
            out[y, x] = 3
            for dx, dy in [(1, 0), (-1, 0), (0, -1)]:
                yy, xx = y + dy, x + dx
                if out[yy, xx] == 3 and all(m[yy + a, xx + b] for a, b in N4): out[yy, xx] = 0
    return out
def rows_of(a): return [''.join('.' if v < 0 else str(v) for v in r) for r in a]
def bbox(arrs):
    m = np.zeros_like(arrs[0], bool)
    for a in arrs: m |= a >= 0
    ys = np.where(m.any(1))[0]; xs = np.where(m.any(0))[0]; return ys[0], ys[-1], xs[0], xs[-1]
def eyes_for(sp, view): e = MAN[sp][view][0]; return [] if e is None else ([(e[0], e[1] + 0.5)] + ([(EYE2[sp], e[1] + 0.5)] if view == 'front' else []))
sc = lambda v: int((v + PAD) * S + 0.5 * S)  # 原尺寸座標 → 縮小後（含邊）

OUT, FEAT, OFF = {}, {}, {}
for sp, f in B.items():
    grp = ['side', 'walk1', 'walk2', 'sleep']
    small = {v: down(pad(arr(f[v])), eyes_for(sp, 'side') if v != 'sleep' else []) for v in grp}
    small['front'] = down(pad(arr(f['front'])), eyes_for(sp, 'front'))
    y0, y1, x0, x1 = bbox([small[v] for v in grp]); fy0, fy1, fx0, fx1 = bbox([small['front']])
    o = {v: rows_of(small[v][y0:y1 + 1, x0:x1 + 1]) for v in grp}; o['front'] = rows_of(small['front'][fy0:fy1 + 1, fx0:fx1 + 1])
    o.update(left=o['side'], right=[r[::-1] for r in o['side']], back=o['front'])
    OUT[sp] = o; OFF[sp] = {'side': (int(x0), int(y0)), 'sleep': (int(x0), int(y0)), 'front': (int(fx0), int(fy0))}
    FEAT[sp] = {}
    for v in ['side', 'sleep', 'front']:
        eye, top, hair, ff = MAN[sp][v]; ox, oy = OFF[sp][v]
        top2 = int((top + PAD) * S) - oy
        FEAT[sp][v] = (None if eye is None else (sc(eye[0]) - ox, sc(eye[1] + 0.5) - oy), top2, (top2 - 1 if hair >= 0 else -1), 99 if ff == 99 else int(round((ff + PAD) * S)) - oy)
    FEAT[sp]['eye2'] = sc(EYE2[sp]) - OFF[sp]['front'][0]

# ---- 錨點與外套（tools/season-sheet/anchors.py 的 derive，套在縮小後的圖上）----
def Wr(r): xs = [i for i, c in enumerate(r) if c != '.']; return (xs[0], xs[-1]) if xs else None
def derive(rows, view, sp, ref=None):
    H = len(rows); ws = [Wr(r) for r in rows]
    eye, top, hair, ff = FEAT[sp][view]
    if view == 'sleep': top = next(y for y, r in enumerate(rows) if r.count('.') <= len(r) - 4)
    if eye is None: eye = (ref['eye'][0], top + ref['eye'][1] - ref['top'])
    bb = (ff - 1) if ff < 99 else H - 2
    mid = [w for w in ws[top:bb + 1] if w]; bl = min(w[0] for w in mid); br = max(w[1] for w in mid)
    bcx = (bl + br) / 2; fw = ws[H - 1]; fcx = (fw[0] + fw[1]) / 2; hw = ws[top]; hcx = (hw[0] + hw[1]) / 2
    ex, ey = eye[0] - 5, eye[1] - 6
    if view == 'front': ex = round((eye[0] + FEAT[sp]['eye2']) / 2 - 7.5)
    body = [round(bcx - 7.5), bb - 14]
    neck = [ex if view != 'front' else round(hcx - 7.5), round(ey + (body[1] - ey) * 0.45)]
    a = dict(head=[round(hcx - 7), top - 2], eye=[ex, ey], neck=neck, back=[body[0], body[1] - 1], hand=[body[0], body[1] - 1],
             feet=[round(fcx - 7.5), H - 1 - 16], body=body, hair=hair, feetFrom=ff)
    ya = max(0, 9 + neck[1]); yb = (ff - 2) if ff < 99 else bb - 1
    l = Wr(rows[min(ya, H - 1)])[0]
    fx = round(hcx) if view == 'front' else l + 2
    return a, [ya, yb, fx], dict(eye=eye, top=top)
A, COAT = {}, {}
for sp, o in OUT.items():
    A[sp], COAT[sp] = {}, {}
    a, c, ref = derive(o['side'], 'side', sp); A[sp]['side'] = a; COAT[sp]['side'] = c
    a, c, _ = derive(o['sleep'], 'sleep', sp, ref); A[sp]['sleep'] = a; COAT[sp]['sleep'] = c
    a, c, _ = derive(o['front'], 'front', sp); A[sp]['front'] = a; COAT[sp]['front'] = c
A['duck']['side']['neck'][1] = min(A['duck']['side']['neck'][1], A['duck']['side']['body'][1] - 1)

# ---- 披風／翅膀 ----
POSE_SRC = {'side': 'side', 'walk1': 'walk1', 'walk2': 'walk2', 'sleep': 'sleep', 'front': 'front'}
P2 = {}
for sp, poses in POSE.items():
    P2[sp] = {}
    for pose, items in poses.items():
        base = arr(B[sp][POSE_SRC[pose]]); view = 'front' if pose == 'front' else 'sleep' if pose == 'sleep' else 'side'
        ey = eyes_for(sp, 'front' if pose == 'front' else 'side') if pose != 'sleep' else []
        small_base = down(pad(base), ey); ox, oy = OFF[sp][view]
        P2[sp][pose] = {}
        for item, cells in items.items():
            comp = pad(base.copy())
            for x, y, c in cells['back']:  # back 畫在身體後面：只在底圖透明處看得到
                if comp[y + PAD, x + PAD] < 0: comp[y + PAD, x + PAD] = c
            for x, y, c in cells['front']: comp[y + PAD, x + PAD] = c
            sm = down(comp, ey)
            back, front = [], []
            for j, i in zip(*np.where(sm != small_base)):
                if sm[j, i] < 0: continue  # 縮小後配件蓋掉的外框邊：不處理
                (back if small_base[j, i] < 0 else front).append([int(i - ox), int(j - oy), int(sm[j, i])])
            P2[sp][pose][item] = {'back': back, 'front': front}

# ---- 寫檔 ----
L = ["// 由 tools/season-sheet/scale17.py 產生：season-sheet 精靈等比縮小（雞側面 24 → 17px 高，四隻同一個比例 ×" + f"{S:.3f}" + "）。",
     "// side/walk/sleep 面向左；left/right/back 暫用 side/side 鏡像/front。色碼 0 最亮…3 最暗，'.' 透明。",
     "// 錨點是相對於「舊版雞」配件座標的位移。",
     "export type View = 'side' | 'sleep' | 'front';",
     "export const BENSON: Record<string, { side: string[]; walk1: string[]; walk2: string[]; sleep: string[]; front: string[]; left: string[]; right: string[]; back: string[] }> = {"]
for sp, fr in OUT.items():
    L.append(f"  {sp}: {{")
    for k in ['side', 'walk1', 'walk2', 'sleep', 'front', 'left', 'right', 'back']: L.append(f"    {k}: {json.dumps(fr[k])},")
    L.append("  },")
L.append("};")
L.append("export const VIEW_ANCHORS: Record<string, Record<View, { head: [number, number]; eye: [number, number]; neck: [number, number]; back: [number, number]; hand: [number, number]; feet: [number, number]; body: [number, number]; hair: number; feetFrom: number }>> = " + json.dumps(A) + ";")
L.append("/** 外套：[第一列, 最後一列, 前襟 x]（依新身形量的）。 */")
L.append("export const COAT: Record<string, Record<View, [number, number, number]>> = " + json.dumps(COAT) + ";")
open(f'{REPO}/apps/web/src/species-sprites.ts', 'w').write('\n'.join(L) + '\n')
pa = open(f'{REPO}/apps/web/src/pose-art.ts').read().split('\n')
head = [l for l in pa if l.startswith('//') or l.startswith('export type')]
head[0] = "// 由 tools/cape-wings/diff.py 產生，再由 tools/season-sheet/scale17.py 和底圖一起等比縮小：Benson 的 cape-sheet／wings-sheet 配件像素。"
open(f'{REPO}/apps/web/src/pose-art.ts', 'w').write('\n'.join(head) + '\nexport const POSE_ART: Record<string, Record<Pose, Record<string, { back: PoseCell[]; front: PoseCell[] }>>> = ' + json.dumps(P2, separators=(',', ':')) + ';\n')
for sp in OUT: print(sp, {k: f"{len(OUT[sp][k][0])}x{len(OUT[sp][k])}" for k in ['side', 'sleep', 'front']}, 'feat', FEAT[sp], 'coat', COAT[sp])
