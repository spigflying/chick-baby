import numpy as np, json, sys
from PIL import Image, ImageDraw, ImageFont
A=np.asarray(Image.open('/workspace/chick-baby-refs/benson-sprites/final-sheet.png').convert('RGB')).astype(float)
src=Image.open('/workspace/chick-baby-refs/benson-sprites/final-sheet.png').convert('RGB')
cells=json.load(open('cells.json')); ex=json.load(open(sys.argv[1] if len(sys.argv)>1 else 'ext.json'))
C=np.array(json.load(open('palette.json')))
GAME=[tuple(int(v) for v in c) for c in C]
P=4.5; Z=3
FS=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',14)
ZH={'chicken':'小雞','duck':'鴨','penguin':'企鵝','dino':'恐龍'}; VZ={'left':'左側面','front':'正面','right':'右側面','back':'背面','walk1':'走路1','walk2':'走路2','sleep':'睡覺'}
CW=int(26*P*Z)+30; CH=int(27*P*Z)+30
cols=list(VZ); rowsN=list(ZH)
img=Image.new('RGB',(len(cols)*(CW*2+16)+20,len(rowsN)*(CH+30)+50),'#f4f7e8'); dr=ImageDraw.Draw(img)
dr.text((10,10),'左＝原圖裁切（放大 3×）　右＝抽出的精靈（同比例，遊戲四色）；右下數字＝抽出格重建 vs 原圖的平均色差',font=FS,fill='#0f380f')
err={}
for ri,sp in enumerate(rowsN):
  for ci,v in enumerate(cols):
    k=f'{sp}/{v}'; c=cells[k]; e=ex[k]; x0,y0,x1,y1=c['box']
    gx0=e['ox']+e['kx0']*P; gy0=e['oy']+e['ky0']*P
    W=e['w']*P; H=e['h']*P
    crop=src.crop((int(gx0)-4,int(gy0)-4,int(gx0+W)+4,int(gy0+H)+4)); crop=crop.resize((crop.width*Z,crop.height*Z),Image.NEAREST)
    X=10+ci*(CW*2+16); Y=40+ri*(CH+30)
    img.paste(crop,(X,Y))
    s=Image.new('RGB',crop.size,'#c4d68a'); d2=ImageDraw.Draw(s)
    tot=0;n=0
    for j,r in enumerate(e['rows']):
        for i,ch in enumerate(r):
            if ch=='.': continue
            bx=(4+i*P)*Z; by=(4+j*P)*Z
            d2.rectangle([bx,by,bx+P*Z-1,by+P*Z-1],fill=GAME[int(ch)])
            cx=int(gx0+(i+0.5)*P); cy=int(gy0+(j+0.5)*P)
            tot+=np.sqrt(((A[cy-1:cy+2,cx-1:cx+2].reshape(-1,3).mean(0)-C[int(ch)])**2).sum()); n+=1
    err[k]=round(tot/max(1,n),1)
    img.paste(s,(X+crop.width+6,Y))
    dr.text((X,Y+crop.height+2),f"{ZH[sp]} {VZ[v]} {e['w']}×{e['h']}",font=FS,fill='#0f380f')
    dr.text((X+crop.width+6,Y+crop.height+2),f"色差 {err[k]}",font=FS,fill='#306230')
img.save(sys.argv[2] if len(sys.argv)>2 else '/workspace/final/cmp.png'); print(err)
