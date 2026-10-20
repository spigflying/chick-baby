import numpy as np, json
A=np.asarray(__import__('PIL.Image',fromlist=['x']).open('/workspace/chick-baby-refs/benson-sprites/final-sheet.png').convert('RGB')).astype(float)
cells=json.load(open('cells.json')); C=np.array(json.load(open('palette.json'))); fit=json.load(open('fit2.json'))
BGC=np.array([158,202,84.]); PALX=np.vstack([C,BGC])
out={}
for k,c in cells.items():
    f=fit[k]; p=f['p']; X0,Y0=c['box'][:2]; m=np.load(f"mask_{k.replace('/','_')}.npy")
    x0,y0,x1,y1=c['bbox']
    kx0=int(np.floor((x0-f['ox'])/p))-1; kx1=int(np.ceil((x1-f['ox'])/p))+1
    ky0=int(np.floor((y0-f['oy'])/p))-1; ky1=int(np.ceil((y1-f['oy'])/p))+1
    rows=[]
    for ky in range(ky0,ky1):
        r=''
        for kx in range(kx0,kx1):
            cx=f['ox']+(kx+0.5)*p; cy=f['oy']+(ky+0.5)*p; ix,iy=int(cx),int(cy)
            mx,my=ix-X0,iy-Y0
            inside=0<=my<m.shape[0] and 0<=mx<m.shape[1] and m[max(0,my-1):my+2,max(0,mx-1):mx+2].mean()>=0.5
            if not inside: r+='.'; continue
            col=np.median(A[iy-1:iy+2,ix-1:ix+2].reshape(-1,3),0)
            r+=str(((C-col)**2).sum(1).argmin())
        rows.append(r)
    ys=[i for i,r in enumerate(rows) if r.strip('.')]; xs=[j for r in rows for j,ch in enumerate(r) if ch!='.']
    rows=[r[min(xs):max(xs)+1] for r in rows[ys[0]:ys[-1]+1]]
    out[k]=dict(rows=rows,ox=f['ox'],oy=f['oy'],kx0=kx0+min(xs),ky0=ky0+ys[0],w=len(rows[0]),h=len(rows),p=p)
    print(k,out[k]['w'],'x',out[k]['h'])
json.dump(out,open('ext3.json','w'))
