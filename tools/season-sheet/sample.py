import numpy as np, json
exec(open('grid.py').read().split('R={}')[0])
G=json.load(open('grid.json'))
NAMES=[(sp,v) for sp in ['chicken','duck','penguin','dino'] for v in ['side','front','walk1','walk2','sleep']]
OUT={}
for idx,(sp,v) in enumerate(NAMES):
    g=G[str(idx)]; y0,y1,x0,x1=g['box']; img=IM[y0-8:y1+8,x0-8:x1+8]; Q=q(img); H,W=Q.shape
    px,py,ox,oy=g['px'],g['py'],g['ox'],g['oy']
    nx=int((W-ox)/px); ny=int((H-oy)/py); rows=[]
    for j in range(ny):
        r=''
        for i in range(nx):
            cx=ox+(i+0.5)*px; cy=oy+(j+0.5)*py
            blk=Q[int(cy)-1:int(cy)+2,int(cx)-1:int(cx)+2].ravel()
            vals,cnt=np.unique(blk,return_counts=True); k=vals[cnt.argmax()]
            r+='.' if k<0 else str(k)
        rows.append(r)
    from scipy import ndimage as nd
    m=np.array([[ch!='.' for ch in r] for r in rows]); lab,n=nd.label(m,np.ones((3,3)))
    if n>1:
        keep=np.bincount(lab.ravel())[1:].argmax()+1; dropped=int((m&(lab!=keep)).sum())
        rows=[''.join(ch if lab[j,i]==keep else '.' for i,ch in enumerate(r)) for j,r in enumerate(rows)]
        if dropped: print('  去掉',sp,v,dropped,'px（zz／雜點）')
    # 裁邊
    ys=[j for j,r in enumerate(rows) if r.strip('.')]; xs=[i for i in range(nx) if any(r[i]!='.' for r in rows)]
    rows=[r[xs[0]:xs[-1]+1] for r in rows[ys[0]:ys[-1]+1]]
    OUT[f'{sp}/{v}']=dict(rows=rows,idx=idx,kx=xs[0],ky=ys[0])
    print(sp,v,len(rows[0]),'x',len(rows))
json.dump(OUT,open('ext.json','w'))
