import json, numpy as np
d=json.load(open('/workspace/final/final2.json'))
S=17/26; SS=8
exec(open('/workspace/final/anchors3.py').read().split('A={};COAT={}')[0].split("d=json.load")[0])  # W
MANB={
 'chicken':{'side':((5,10),4,3,22),'front':((6,11),3,2,23),'sleep':(None,9,-1,99)},
 'duck':{'side':((8,9),3,2,23),'front':((7,10),3,2,24),'sleep':(None,10,-1,99)},
 'penguin':{'side':((9,9),1,-1,24),'front':((5,8),1,-1,24),'sleep':((5,19),8,-1,99)},
 'dino':{'side':((10,9),3,2,27),'front':((7,10),3,2,27),'sleep':(None,14,-1,99)},
}
EYE2={'chicken':13,'duck':14,'penguin':13,'dino':15}
def arr(rows): return np.array([[(-1 if c=='.' else int(c)) for c in r] for r in rows])
def eyes(a):
    H,Wd=a.shape; pts=[]
    for y in range(1,H-1):
        for x in range(1,Wd-1):
            if a[y,x]==3 and a[y-1,x]!=-1 and a[y+1,x]!=-1 and a[y,x-1] not in (-1,3) and a[y,x+1] not in (-1,3): pts.append((x,y))
    # 合併相鄰
    cl=[]
    for p in pts:
        for c in cl:
            if any(abs(p[0]-q[0])<=1 and abs(p[1]-q[1])<=1 for q in c): c.append(p); break
        else: cl.append([p])
    return [c for c in cl if len(c)<=4]
def down(rows, eyeset, edge_keep=True):
    a=arr(rows); H,Wd=a.shape; h,w=int(np.ceil(H*S)),int(np.ceil(Wd*S))
    up=np.repeat(np.repeat(a,SS,0),SS,1)
    out=np.full((h,w),-1)
    for j in range(h):
        for i in range(w):
            y0,y1=int(j/S*SS),int((j+1)/S*SS); x0,x1=int(i/S*SS),int((i+1)/S*SS)
            blk=up[y0:y1,x0:x1]
            if blk.size==0: continue
            op=blk[blk>=0]
            if op.size < blk.size*0.5: continue
            body=op[op<3]
            out[j,i]=np.bincount(body,minlength=3).argmax() if body.size>op.size*0.35 else 3
    m=out>=0
    # 補洞、去單點突起
    for _ in range(2):
        for j in range(h):
            for i in range(w):
                n=sum(m[j+dy,i+dx] if 0<=j+dy<h and 0<=i+dx<w else 0 for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)])
                if not m[j,i] and n>=3: m[j,i]=True; out[j,i]=3
                elif m[j,i] and n<=1 and out[j,i]!=3: m[j,i]=False; out[j,i]=-1
    # 1px 連續外框：所有碰到透明（含 8 鄰）的像素 → 3；內部的 3 若不是眼睛／特徵就淡化
    for j in range(h):
        for i in range(w):
            if not m[j,i]: continue
            edge=any(not (0<=j+dy<h and 0<=i+dx<w and m[j+dy,i+dx]) for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)])
            if edge:
                y0,y1=int(j/S*SS),int((j+1)/S*SS); x0,x1=int(i/S*SS),int((i+1)/S*SS); blk=up[y0:y1,x0:x1]; op=blk[blk>=0]
                if (op==3).mean()>=0.12 or not edge_keep: out[j,i]=3
    # 外框太厚：內側的 3 若四周都是 3 或外框且不在眼睛上 → 改成中間色
    inner=[(j,i) for j in range(1,h-1) for i in range(1,w-1) if out[j,i]==3 and all(m[j+dy,i+dx] for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)])]
    for j,i in inner:
        nb=[out[j+dy,i+dx] for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]]
        if sum(v==3 for v in nb)>=2:
            vals=[v for v in nb if 0<=v<3]; out[j,i]=max(set(vals),key=vals.count) if vals else 2
    for _ in range(2):
        for j in range(1,h-1):
            for i in range(1,w-1):
                if not m[j,i] or out[j,i]==3: continue
                nb=[out[j+dy,i+dx] for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]]
                body=[v for v in nb if 0<=v<3]
                if len(body)>=3 and out[j,i] not in body: out[j,i]=max(set(body),key=body.count)
    # 眼睛：清楚的暗點，周圍不是暗色
    for (ex,ey) in eyeset:
        x,y=int(ex*S+0.5*S),int(ey*S+0.5*S)
        if 0<y<h-1 and 0<x<w-1 and m[y,x]:
            out[y,x]=3
            for dx,dy in [(1,0),(-1,0),(0,-1)]:
                if out[y+dy,x+dx]==3 and all(m[y+dy+a,x+dx+b] for a,b in [(1,0),(-1,0),(0,1),(0,-1)] if 0<=y+dy+a<h and 0<=x+dx+b<w): out[y+dy,x+dx]=0 if dy==0 else out[y+dy,x+dx]
    return [''.join('.' if v<0 else str(v) for v in r) for r in out]
def trim(frames):
    H=len(frames[0]); Wd=len(frames[0][0])
    rows=[y for y in range(H) if any(f[y].strip('.') for f in frames)]; cols=[x for x in range(Wd) if any(f[y][x]!='.' for f in frames for y in range(H))]
    y0,y1,x0,x1=rows[0],rows[-1],cols[0],cols[-1]
    return [[r[x0:x1+1] for r in f[y0:y1+1]] for f in frames],(x0,y0)
OUT={};FEAT={}
for sp,f in d.items():
    o={}
    grp=['side','walk1','walk2','sleep']
    sm=[]
    for v in grp:
        a=arr(f[v]); ey=[(np.mean([p[0] for p in c]),np.mean([p[1] for p in c])) for c in eyes(a)]
        Wd=a.shape[1]; H=a.shape[0]
        ey=sorted([p for p in ey if p[1]<H*0.55 and p[0]<Wd*0.5],key=lambda p:p[1])[:1]
        if v=='side':
            e=MANB[sp]['side'][0]; ey=[(e[0],e[1]+0.5)]
        sm.append(down(f[v],ey[:2] if v!='sleep' else []))
    sm,(ox,oy)=trim(sm); o.update(dict(zip(grp,sm)))
    e=MANB[sp]['front'][0]
    fr,(fox,foy)=trim([down(f['front'],[(e[0],e[1]+0.5),(EYE2[sp],e[1]+0.5)])]); o['front']=fr[0]
    for v in ['left','right','back']:
        a=arr(f[v]); ey=[(np.mean([p[0] for p in c]),np.mean([p[1] for p in c])) for c in eyes(a)] if v!='back' else []
        o[v]=trim([down(f[v],ey[:2])])[0][0]
    OUT[sp]=o
    sc=lambda x,off: int(x*S+0.5*S)-off
    FEAT[sp]={}
    for v,(xo,yo) in [('side',(ox,oy)),('sleep',(ox,oy)),('front',(fox,foy))]:
        eye,top,hair,ff=MANB[sp][v]
        FEAT[sp][v]=dict(eye=None if eye is None else (sc(eye[0],xo),sc(eye[1]+0.5,yo)), eye2=None if v!='front' else sc(EYE2[sp],xo),
                         top=int(top*S)-yo, hair=(int(top*S)-yo-1) if hair>=0 else -1, ff=99 if ff==99 else int(round(ff*S))-yo)
    print(sp,{k:(len(v[0]),len(v)) for k,v in o.items()},FEAT[sp])
json.dump(dict(sprites=OUT,feat=FEAT),open('scaled.json','w'))
