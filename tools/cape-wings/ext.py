import numpy as np, json, sys
from PIL import Image
from scipy import ndimage as nd
name=sys.argv[1]; P0=float(sys.argv[2])
IM=np.asarray(Image.open(f'/workspace/chick-baby-refs/benson-sprites/{name}-sheet.png').convert('RGBA')).astype(float)
fg=IM[...,3]>128
lab,n=nd.label(nd.binary_closing(fg,np.ones((3,3))))
bx=[s for s in nd.find_objects(lab) if (s[0].stop-s[0].start)>50 and (s[1].stop-s[1].start)>50]
bx=sorted(bx,key=lambda s:(round(s[0].start/150),s[1].start))
# 5 色階 k-means
px=IM[fg][:,:3]; rng=np.random.default_rng(0); s=px[rng.choice(len(px),80000)]
c=np.array([[215,222,110],[180,196,64],[130,155,40],[55,90,32],[8,38,6]],float)
for _ in range(40):
    k=((s[:,None]-c[None])**2).sum(-1).argmin(1); c=np.array([s[k==i].mean(0) if (k==i).any() else c[i] for i in range(5)])
print('tones',c.round().tolist())
MAPI=np.array(json.loads(sys.argv[3]) if len(sys.argv)>3 else [0,0,1,2,3])
def q(img):
    d=((img[...,:3][:,:,None,:]-c[None,None])**2).sum(-1); k=MAPI[d.argmin(-1)]; k[img[...,3]<128]=-1; return k
def score(Q,px,py,ox,oy):
    H,W=Q.shape; xs=np.arange(W); ys=np.arange(H)
    bxx=np.floor((xs-ox)/px).astype(int); byy=np.floor((ys-oy)/py).astype(int)
    cx=(ox+(bxx+0.5)*px).astype(int).clip(0,W-1); cy=(oy+(byy+0.5)*py).astype(int).clip(0,H-1)
    return (Q[cy][:,cx]!=Q).mean()
OUT=[]
for i,sl in enumerate(bx):
    y0,y1,x0,x1=sl[0].start,sl[0].stop,sl[1].start,sl[1].stop
    img=IM[y0-10:y1+10,x0-10:x1+10]; Q=q(img)
    ps=[P0]
    b=min((score(Q,p,p,o,0),p,o) for p in ps for o in np.arange(0,p,0.33)); _,px_,ox=b
    b=min((score(Q,px_,p,ox,o),p,o) for p in ps for o in np.arange(0,p,0.33)); err,py_,oy=b
    H,W=Q.shape; nx=int((W-ox)/px_); ny=int((H-oy)/py_); rows=[]
    for j in range(ny):
        r=''
        for ii in range(nx):
            cx=ox+(ii+0.5)*px_; cy=oy+(j+0.5)*py_
            blk=Q[int(cy)-1:int(cy)+2,int(cx)-1:int(cx)+2].ravel(); v,cn=np.unique(blk,return_counts=True); kk=v[cn.argmax()]
            r+='.' if kk<0 else str(kk)
        rows.append(r)
    m=np.array([[ch!='.' for ch in r] for r in rows]); L,nn=nd.label(m,np.ones((3,3)))
    if nn>1:
        keep=np.bincount(L.ravel())[1:].argmax()+1; rows=[''.join(ch if L[j,ii]==keep else '.' for ii,ch in enumerate(r)) for j,r in enumerate(rows)]
    ys=[j for j,r in enumerate(rows) if r.strip('.')]; xs=[ii for ii in range(nx) if any(r[ii]!='.' for r in rows)]
    rows=[r[xs[0]:xs[-1]+1] for r in rows[ys[0]:ys[-1]+1]]
    OUT.append(dict(rows=rows,px=px_,py=py_,err=err,box=[y0,y1,x0,x1],org=[x0-10+ox+xs[0]*px_, y0-10+oy+ys[0]*py_]))
    print(i,'p=%.2f/%.2f err=%.3f size %dx%d'%(px_,py_,err,len(rows[0]),len(rows)))
json.dump(dict(cells=OUT,tones=c.tolist()),open(sys.argv[4] if len(sys.argv)>4 else f'{name}.json','w'))
