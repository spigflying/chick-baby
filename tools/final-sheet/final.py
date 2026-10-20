import json
ex=json.load(open('ext3.json'))
def clean(rows):
    g=[list(r) for r in rows]; h=len(g); w=len(g[0]); fixed=0
    for _ in range(2):
        for y in range(h):
            for x in range(w):
                c=g[y][x]
                if c not in '01': continue
                nb=[g[y+dy][x+dx] for dx,dy in((1,0),(-1,0),(0,1),(0,-1)) if 0<=x+dx<w and 0<=y+dy<h]
                if len(nb)==4 and len(set(nb))==1 and nb[0]!=c and nb[0] in '01': g[y][x]=nb[0]; fixed+=1
    return [''.join(r) for r in g],fixed
def mirror(r): return [x[::-1] for x in r]
def colcenter(rows):
    xs=[x for r in rows[-4:] for x,c in enumerate(r) if c!='.']; return (min(xs)+max(xs))/2
OUT={};REP={}
for sp in ['chicken','duck','penguin','dino']:
    v={}
    for k in ['left','front','right','back','walk1','walk2','sleep']:
        r,f=clean(ex[f'{sp}/{k}']['rows']); v[k]=r; REP[f'{sp}/{k}']=f
    # 遊戲面向左：右側面本身就面向左；走路、睡覺在原圖面向右 → 鏡像
    side=v['right']; w1=mirror(v['walk1']); w2=mirror(v['walk2']); sl=mirror(v['sleep'])
    frames={'side':side,'walk1':w1,'walk2':w2,'sleep':sl}
    W=max(len(f[0]) for f in frames.values()); H=max(len(f) for f in frames.values())
    ref=colcenter(side)+ (W-len(side[0]))/2
    padded={}
    for k,f in frames.items():
        # 底部對齊；水平依腳部中心對齊側面
        shift=round(ref-(colcenter(f)+(W-len(f[0]))/2)) if k!='sleep' else 0
        left=(W-len(f[0]))//2+shift; left=max(0,min(W-len(f[0]),left))
        g=['.'*W]*(H-len(f))+['.'*left+r+'.'*(W-len(f[0])-left) for r in f]
        padded[k]=g
    OUT[sp]=dict(**padded,front=v['front'],left=v['left'],right=v['right'],back=v['back'])
json.dump(OUT,open('final.json','w'),indent=1); print(REP)
for sp in OUT:
    print(sp,{k:(len(v[0]),len(v)) for k,v in OUT[sp].items()})
