import numpy as np, json
from PIL import Image
from scipy import ndimage as nd
IM=np.asarray(Image.open('/workspace/chick-baby-refs/benson-sprites/season-sheet.png').convert('RGBA')).astype(float); A=IM[...,:3]; AL=IM[...,3]
H,W,_=A.shape
fg=AL>128
lab,n=nd.label(nd.binary_closing(fg,np.ones((3,3))))
objs=nd.find_objects(lab)
out=[]
for i,s in enumerate(objs):
    h=s[0].stop-s[0].start; w=s[1].stop-s[1].start
    if h>60 and w>60 and s[0].start>60*1.5 and s[0].stop<630*1.5 and s[1].start>180*1.5: out.append((s[0].start,s[0].stop,s[1].start,s[1].stop,i+1))
out.sort(key=lambda b:(round(b[0]/150),b[2]))
for b in out: print(b, b[1]-b[0], b[3]-b[2])
json.dump(out,open('boxes.json','w'))
np.save('lab.npy',lab)
