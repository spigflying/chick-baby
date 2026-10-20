import numpy as np, json, sys
from PIL import Image
A=np.asarray(Image.open('/workspace/chick-baby-refs/benson-sprites/final-sheet.png').convert('RGB')).astype(float)
cells=json.load(open('cells.json')); C=np.array(json.load(open('palette.json')))
BGC=np.array([158,202,84.]); PALX=np.vstack([C,BGC])
quant=lambda img: ((img[...,None,:]-PALX)**2).sum(-1).argmin(-1)
PS=[float(x) for x in sys.argv[1].split(',')]
tot={p:0 for p in PS}; res={}
for k,c in cells.items():
    x0,y0,x1,y1=c['bbox']; pad=6
    a=A[y0-pad:y1+pad+1,x0-pad:x1+pad+1]; q=quant(a); h,w=q.shape
    m=np.load(f"mask_{k.replace('/','_')}.npy"); bx0,by0=c['box'][:2]
    for p in PS:
        best=None
        for ox in np.arange(0,p,0.25):
            for oy in np.arange(0,p,0.25):
                nx=int((w-ox)//p); ny=int((h-oy)//p)
                cx=(ox+(np.arange(nx)+0.5)*p).astype(int); cy=(oy+(np.arange(ny)+0.5)*p).astype(int)
                blk=q[np.ix_(cy,cx)]
                bx=np.clip(((np.arange(w)-ox)//p).astype(int),0,nx-1); by=np.clip(((np.arange(h)-oy)//p).astype(int),0,ny-1)
                e=(blk[np.ix_(by,bx)]!=q).mean()
                if best is None or e<best[0]: best=(e,ox,oy)
        tot[p]+=best[0]
        if p==PS[0]: res[k]=dict(err=best[0],p=p,ox=best[1]+x0-pad,oy=best[2]+y0-pad)
print({p:round(v/len(cells),4) for p,v in tot.items()})
json.dump(res,open('fit2.json','w'))
