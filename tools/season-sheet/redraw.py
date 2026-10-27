# Benson 重畫的遊戲尺寸像素圖（雞、鴨、企鵝；恐龍不動）換進 apps/web。
# 用法：python3 tools/season-sheet/redraw.py <repo>
# 輸入：tools/season-sheet/redraw-game-grids.json（species-ref v2 的遊戲尺寸格子，比較表「遊戲尺寸」那一欄）。
# 1. 方向：每格和目前遊戲裡的同一格比對，鏡像比較像就鏡像 → side/walk/sleep 一律面向左。
# 2. side/walk1/walk2/sleep 放到同一張畫布（腳底對齊最底列；走路格水平位置對齊側面）。
# 3. 錨點／外套：用 scale17.py 的 derive，特徵（眼睛、頭頂、頭毛、腳）是手標的 FEAT。
# 4. 披風／翅膀（POSE_ART）：舊像素依「舊底圖 → 新底圖」最佳對位平移；back 只留新底圖透明處，
#    front 只留新底圖有畫的地方或原本就在身體外面的像素。
# 恐龍的 BENSON / VIEW_ANCHORS / COAT / POSE_ART 原封不動（測試用雜湊鎖住）。
import json, re, sys
REPO = sys.argv[1]; R = REPO + '/apps/web/src/'
NEW = json.load(open(REPO + '/tools/season-sheet/redraw-game-grids.json'))
SPS = ['chicken', 'duck', 'penguin']
txt = open(R + 'species-sprites.ts').read(); pa_txt = open(R + 'pose-art.ts').read()
B = {}; sp = None
for l in txt.split('\n'):
    m = re.match(r'  (\w+): \{$', l)
    if m: sp = m.group(1); B[sp] = {}
    m = re.match(r'    (\w+): (\[.*\]),?$', l)
    if m and sp: B[sp][m.group(1)] = json.loads(m.group(2))
VA = json.loads(re.search(r'VIEW_ANCHORS[^=]*= (\{.*\});', txt).group(1))
CO = json.loads(re.search(r'COAT[^=]*= (\{.*\});', txt).group(1))
PA = json.loads(re.search(r'POSE_ART[^=]*= (\{.*\});', pa_txt, re.S).group(1))

def score(a, b, dx, dy):
    s = 0
    for j, r in enumerate(a):
        for i, c in enumerate(r):
            if c == '.': continue
            jj, ii = j + dy, i + dx
            if 0 <= jj < len(b) and 0 <= ii < len(b[0]) and b[jj][ii] != '.': s += 2 if b[jj][ii] == c else 1
            else: s -= 1
    return s
def best(a, b): dy = len(b) - len(a); return max((score(a, b, dx, dy), dx) for dx in range(-len(a[0]), len(b[0]) + 1))
mir = lambda f: [r[::-1] for r in f]
NB = {}
for sp in SPS:
    fr = {}
    for f in ['side', 'walk1', 'walk2', 'sleep', 'front']:
        n = NEW[f'{sp}/{f}']
        if f != 'front' and best(mir(n), B[sp][f])[0] > best(n, B[sp][f])[0]: n = mir(n)
        fr[f] = n
    g = ['side', 'walk1', 'walk2', 'sleep']
    W = max(len(fr[f][0]) for f in g); H = max(len(fr[f]) for f in g)
    def put(a, dx):
        c = [['.'] * W for _ in range(H)]; dy = H - len(a)
        for j, r in enumerate(a):
            for i, ch in enumerate(r):
                if ch != '.': c[j + dy][i + dx] = ch
        return [''.join(r) for r in c]
    side = put(fr['side'], (W - len(fr['side'][0])) // 2); out = {'side': side}
    for f in ['walk1', 'walk2']:
        a = fr[f]; dy = H - len(a)
        out[f] = put(a, max((score(a, side, dx, dy), -abs(dx - (W - len(a[0])) // 2), dx) for dx in range(0, W - len(a[0]) + 1))[2])
    out['sleep'] = put(fr['sleep'], (W - len(fr['sleep'][0])) // 2); out['front'] = fr['front']
    out.update(left=out['side'], right=mir(out['side']), back=out['front'])
    NB[sp] = out

# 手標特徵：(眼睛 x,y), 頭頂列, 頭毛到第幾列（-1 無）, 腳從第幾列；eye2 = 正面第二隻眼睛 x
FEAT = {'chicken': {'side': ((6, 6), 2, 1, 15), 'front': ((4, 6), 2, 1, 16), 'sleep': (None, 0, -1, 99), 'eye2': 8},
        'duck': {'side': ((7, 5), 1, 0, 16), 'front': ((3, 5), 1, 0, 15), 'sleep': (None, 0, -1, 99), 'eye2': 9},
        'penguin': {'side': ((6, 5), 0, -1, 15), 'front': ((4, 5), 0, -1, 15), 'sleep': (None, 0, -1, 99), 'eye2': 9}}
src = open(REPO + '/tools/season-sheet/scale17.py').read()
exec(src[src.index('def Wr(r)'):src.index('A, COAT = {}, {}')])
for sp, o in NB.items():
    a, c, ref = derive(o['side'], 'side', sp); VA[sp]['side'] = a; CO[sp]['side'] = c
    a, c, _ = derive(o['sleep'], 'sleep', sp, ref); VA[sp]['sleep'] = a; CO[sp]['sleep'] = c
    a, c, _ = derive(o['front'], 'front', sp); VA[sp]['front'] = a; CO[sp]['front'] = c
VA['duck']['side']['neck'][1] = min(VA['duck']['side']['neck'][1], VA['duck']['side']['body'][1] - 1)

def best2(a, b):  # 舊底圖 a 放到新底圖 b 上的最佳 (dx, dy)
    return max((score(a, b, dx, dy), -abs(dx) - abs(dy), dx, dy) for dx in range(-6, 7) for dy in range(-6, 7))[2:]
SHIFT = {}
for sp in SPS:
    SHIFT[sp] = {}
    for pose, items in PA[sp].items():
        o, n = B[sp][pose], NB[sp][pose]; dx, dy = best2(o, n); SHIFT[sp][pose] = (dx, dy)
        op = lambda x, y: 0 <= y < len(o) and 0 <= x < len(o[0]) and o[y][x] != '.'
        np_ = lambda x, y: 0 <= y < len(n) and 0 <= x < len(n[0]) and n[y][x] != '.'
        for item, cells in items.items():
            back = [[x + dx, y + dy, c] for x, y, c in cells['back'] if not np_(x + dx, y + dy)]
            front = [[x + dx, y + dy, c] for x, y, c in cells['front'] if np_(x + dx, y + dy) or not op(x, y)]
            items[item] = {'back': back, 'front': front}

L = txt.split('\n'); out = []; sp = None
for l in L:
    m = re.match(r'  (\w+): \{$', l)
    if m: sp = m.group(1)
    m2 = re.match(r'    (\w+): (\[.*\])(,?)$', l)
    if m2 and sp in NB: l = f"    {m2.group(1)}: {json.dumps(NB[sp][m2.group(1)])}{m2.group(3)}"
    if l.startswith('export const VIEW_ANCHORS'): l = l[:l.index('= ') + 2] + json.dumps(VA) + ';'
    if l.startswith('export const COAT'): l = l[:l.index('= ') + 2] + json.dumps(CO) + ';'
    out.append(l)
out[0] = out[0] + '；雞、鴨、企鵝再由 tools/season-sheet/redraw.py 換成 Benson 重畫的遊戲尺寸圖（恐龍不變）。'
open(R + 'species-sprites.ts', 'w').write('\n'.join(out))
i = pa_txt.index('= {', pa_txt.index('export const POSE_ART')) + 2
open(R + 'pose-art.ts', 'w').write(pa_txt[:i] + json.dumps(PA, separators=(',', ':')) + ';\n')
print('shift', SHIFT)
for sp in SPS: print(sp, {k: f"{len(NB[sp][k][0])}x{len(NB[sp][k])}" for k in ['side', 'sleep', 'front']}, VA[sp], CO[sp])
