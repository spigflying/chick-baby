import json, numpy as np
from scipy import ndimage as nd
BASE=json.load(open('/workspace/season/season.json'))
SP=['chicken','duck','penguin','dino']; PO=['side','front','walk1','walk2','sleep']
def arr(rows): return np.array([[-1 if c=='.' else int(c) for c in r] for r in rows])
RES={}; REP={}; TONEMAP={}
for item in ['cape','wings']:
    cells=json.load(open(f'{item}_raw.json'))['cells']
    import itertools
    MAPS=[m for m in itertools.product(range(4),repeat=5) if list(m)==sorted(m) and m[-1]==3 and len(set(m))>=3]
    def remap(rows,m): return [''.join('.' if ch=='.' else str(m[int(ch)]) for ch in r) for r in rows]
    SPMAP={}
    for si,sp in enumerate(SP):
        bestm=None
        for m in MAPS:
            tot=0
            for k in (0,1):
                c=cells[si*5+k]; C=arr(remap(c['rows'],m)); B=arr(BASE[sp][PO[k]]); bh,bw=B.shape; ch,cw=C.shape; bb=1
                for dy in range(-3,max(1,bh-ch)+4):
                    for dx in range(-8,max(1,bw-cw)+9):
                        ys0,ys1=max(0,dy),min(bh,dy+ch); xs0,xs1=max(0,dx),min(bw,dx+cw)
                        if ys1<=ys0 or xs1<=xs0: continue
                        b=B[ys0:ys1,xs0:xs1]; cc=C[ys0-dy:ys1-dy,xs0-dx:xs1-dx]; mm=b>=0
                        if mm.sum()<(B>=0).sum()*0.8: continue
                        bb=min(bb,(cc[mm]!=b[mm]).mean())
                tot+=bb
            if bestm is None or tot<bestm[0]: bestm=(tot,m)
        SPMAP[sp]=bestm[1]; print(item,sp,'tone map',bestm[1],round(bestm[0]/2,3))
    if item=='cape': SPMAP={'chicken':(0,0,0,2,3),'duck':(0,0,0,2,3),'penguin':(0,0,1,2,3),'dino':(0,0,1,2,3)}  # 披風固定是暗綠 2
    TONEMAP[item]=SPMAP
    for c,i in zip(cells,range(len(cells))): c['rows']=remap(c['rows'],SPMAP[SP[i//5]])
    for i,c in enumerate(cells):
        sp=SP[i//5]; po=PO[i%5]; B=arr(BASE[sp][po]); bh,bw=B.shape
        best=None
        for mir in (False,True):
            C=arr([r[::-1] for r in c['rows']] if mir else c['rows']); ch,cw=C.shape
            for dy in range(-ch,bh+1):
                for dx in range(-cw,bw+1):
                    # 重疊區
                    ys0,ys1=max(0,dy),min(bh,dy+ch); xs0,xs1=max(0,dx),min(bw,dx+cw)
                    if ys1-ys0<bh*0.6 or xs1-xs0<bw*0.4: continue
                    b=B[ys0:ys1,xs0:xs1]; cc=C[ys0-dy:ys1-dy,xs0-dx:xs1-dx]
                    m=b>=0; n=m.sum()
                    if n< (B>=0).sum()*0.8: continue
                    s=(cc[m]!=b[m]).mean()
                    if best is None or s<best[0]: best=(s,mir,dx,dy)
        s,mir,dx,dy=best
        C=arr([r[::-1] for r in c['rows']] if mir else c['rows']); ch,cw=C.shape
        # 放到共同畫布（含邊界）
        PADX=12; PADY=12
        Hc=max(bh,dy+ch)-min(0,dy)+2*PADY; Wc=max(bw,dx+cw)-min(0,dx)+2*PADX
        ox0=-min(0,dx)+PADX; oy0=-min(0,dy)+PADY
        BB=np.full((Hc,Wc),-1); BB[oy0:oy0+bh,ox0:ox0+bw]=B
        CC=np.full((Hc,Wc),-1); CC[oy0+dy:oy0+dy+ch,ox0+dx:ox0+dx+cw]=C
        bm=BB>=0; cm=CC>=0
        out=cm & ~nd.binary_dilation(bm,np.ones((3,3)))
        same=np.zeros_like(bm)
        for e,a_ in [(0,0),(1,0),(-1,0),(0,1),(0,-1)]: same|= (np.roll(np.roll(BB,e,0),a_,1)==CC)
        cand=cm & bm & ~same
        band=cm & ~bm & ~out
        seed=out.copy()
        if item=='cape' and sp!='penguin': seed|= cm & (CC==2) & (BB!=2) & bm
        if item=='cape' and sp=='penguin' and po in ('front','sleep'): seed|= cand  # 企鵝身體也是暗綠，只能靠和底圖的差異
        L,n=nd.label(seed|cand|band,np.ones((3,3)))
        keep=set(np.unique(L[seed]))-{0}
        acc=np.isin(L,list(keep)) & (seed|cand|band)
        L2,n2=nd.label(acc,np.ones((3,3))); sz=np.bincount(L2.ravel()); acc&=sz[L2]>=5
        pts=[(int(x-ox0),int(y-oy0),int(CC[y,x]),'front' if bm[y,x] else 'back') for y,x in zip(*np.nonzero(acc))]
        RES.setdefault(sp,{}).setdefault(po,{})[item]=dict(back=[[int(p[0]),int(p[1]),int(p[2])] for p in pts if p[3]=='back'],front=[[int(p[0]),int(p[1]),int(p[2])] for p in pts if p[3]=="front"])
        REP[f"{item}/{sp}/{po}"]=dict(align=round(100*float(s),1),mirror=bool(mir),off=(int(dx),int(dy)),px=len(pts))
        print(item,sp,po,REP[f'{item}/{sp}/{po}'])
json.dump(dict(art=RES,rep=REP,tonemap={k:{a:list(b) for a,b in v.items()} for k,v in TONEMAP.items()}),open('art.json','w'))
