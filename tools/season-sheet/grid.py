import numpy as np, json
from PIL import Image
IM=np.asarray(Image.open('/workspace/chick-baby-refs/benson-sprites/season-sheet.png').convert('RGBA')).astype(float)
PAL=np.array([[0x9b,0xbc,0x0f],[0x8b,0xac,0x0f],[0x30,0x62,0x30],[0x0f,0x38,0x0f]],float)  # 0 最亮…3 最暗
B=json.load(open('boxes.json'))
SRC=np.array([[215,221,114],[178,194,62],[126,152,35],[50,84,31],[5,35,3]],float); MAPI=np.array([0,0,1,2,3])
def q(img):  # 原圖 5 個色階（含反鋸齒亮點）→ 遊戲 4 色；-1 透明
    a=img[...,3]; rgb=img[...,:3]
    d=((rgb[:,:,None,:]-SRC[None,None])**2).sum(-1); k=MAPI[d.argmin(-1)]; k[a<128]=-1; return k
def score(Q,px,py,ox,oy):
    H,W=Q.shape; xs=np.arange(W); ys=np.arange(H)
    bx=np.floor((xs-ox)/px).astype(int); by=np.floor((ys-oy)/py).astype(int)
    cx=(ox+(bx+0.5)*px).astype(int).clip(0,W-1); cy=(oy+(by+0.5)*py).astype(int).clip(0,H-1)
    S=Q[cy][:,cx]; return (S!=Q).mean()
R={}
for idx,(y0,y1,x0,x1,_) in enumerate(B):
    img=IM[y0-8:y1+8,x0-8:x1+8]; Q=q(img)
    best=None
    for p in np.arange(7.0,8.01,0.05):
        for o in np.arange(0,p,0.25):
            sx=score(Q,p,p,o,0)  # x 方向（y 用細格近似）
            if best is None or sx<best[0]: best=(sx,p,o)
    _,px,ox=best; best=None
    for p in np.arange(7.0,8.01,0.05):
        for o in np.arange(0,p,0.25):
            s=score(Q,px,p,ox,o)
            if best is None or s<best[0]: best=(s,p,o)
    s,py,oy=best
    R[idx]=dict(box=[y0,y1,x0,x1],px=px,py=py,ox=ox,oy=oy,err=s)
    print(idx,(y0,x0),'p=%.2f/%.2f err=%.3f'%(px,py,s))
json.dump(R,open('grid.json','w'))
