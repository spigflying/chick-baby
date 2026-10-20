import numpy as np, json
from PIL import Image
from scipy import ndimage as ndi
im=Image.open('/workspace/chick-baby-refs/benson-sprites/final-sheet.png').convert('RGB'); A=np.asarray(im).astype(float)
S=1.5
COLX=[200,322,440,556,694,815,945]; LABY=[82,236,387,537]
COLS=['left','front','right','back','walk1','walk2','sleep']; ROWS=['chicken','duck','penguin','dino']
def cellbox(r,c):
    cx=COLX[c]*S; ly=LABY[r]*S
    return int(cx-60*S),int(ly+14*S),int(cx+60*S),int(ly+128*S)
BG=np.array([158,202,84.])
out={}
for r,sp in enumerate(ROWS):
  for c,v in enumerate(COLS):
    x0,y0,x1,y1=cellbox(r,c); a=A[y0:y1,x0:x1]
    bgl=np.abs(a-BG).max(2)<22
    lab,n=ndi.label(bgl); edge=set(np.unique(np.r_[lab[0],lab[-1],lab[:,0],lab[:,-1]]))-{0}
    outside=np.isin(lab,list(edge))
    fg=~outside
    lab2,n2=ndi.label(fg); sizes=ndi.sum(fg,lab2,range(1,n2+1))
    keep=lab2==(np.argmax(sizes)+1)
    keep=ndi.binary_fill_holes(keep)
    ys,xs=np.nonzero(keep)
    out[f'{sp}/{v}']=dict(box=[x0,y0,x1,y1],bbox=[int(xs.min()+x0),int(ys.min()+y0),int(xs.max()+x0),int(ys.max()+y0)],comps=int(n2),area=int(keep.sum()))
    np.save(f'mask_{sp}_{v}.npy',keep)
for k,v in out.items(): print(k,v['bbox'],'w',v['bbox'][2]-v['bbox'][0]+1,'h',v['bbox'][3]-v['bbox'][1]+1,'comps',v['comps'])
json.dump(out,open('cells.json','w'))
