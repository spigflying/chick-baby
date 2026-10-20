import numpy as np, json, sys
from PIL import Image, ImageDraw, ImageFont
E=json.load(open(sys.argv[1] if len(sys.argv)>1 else 'ext.json')); G=json.load(open('grid.json'))
PAL=[(0x9b,0xbc,0x0f),(0x8b,0xac,0x0f),(0x30,0x62,0x30),(0x0f,0x38,0x0f)]
src=Image.open('/workspace/chick-baby-refs/benson-sprites/season-sheet.png').convert('RGBA')
IM=np.asarray(src).astype(float)
exec(open('grid.py').read().split('R={}')[0])
PALf=np.array(PAL,float)
qq=q
DPAL=[(0x9b,0xbc,0x0f),(0x8b,0xac,0x0f),(0x30,0x62,0x30),(0x0f,0x38,0x0f)]
F=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',20)
Z=8; cw=2*30*Z+60; ch=27*Z+50
can=Image.new('RGB',(5*cw+20,4*ch+20),'white'); dr=ImageDraw.Draw(can); REP={}
for k,e in E.items():
    g=G[str(e['idx'])]; y0,y1,x0,x1=g['box']; ox=x0-8+g['ox']+e['kx']*g['px']; oy=y0-8+g['oy']+e['ky']*g['py']
    rows=e['rows']; h=len(rows); w=len(rows[0])
    # 差異：把取樣結果放大回原圖格子，和原圖量化結果逐像素比
    X0,Y0,X1,Y1=int(ox),int(oy),int(ox+w*g['px']),int(oy+h*g['py'])
    Q=qq(IM[Y0:Y1,X0:X1]); mm=0; tot=0
    for yy in range(Q.shape[0]):
        for xx in range(Q.shape[1]):
            i=int((xx+X0-ox)/g['px']); j=int((yy+Y0-oy)/g['py'])
            if 0<=i<w and 0<=j<h:
                c=rows[j][i]; c=-1 if c=='.' else int(c)
                if c==-1 and Q[yy,xx]==-1: continue
                tot+=1; mm+= c!=Q[yy,xx]
    REP[k]=round(100*mm/max(tot,1),1)
    r,c=e['idx']//5,e['idx']%5; X=10+c*cw; Y=10+r*ch
    crop=src.crop((X0,Y0,X1,Y1)); bg=Image.new('RGBA',crop.size,'white'); bg.alpha_composite(crop)
    bg=bg.convert('RGB').resize((w*Z,h*Z),Image.NEAREST); can.paste(bg,(X,Y+30))
    im=Image.new('RGB',(w*Z,h*Z),'#ffffff'); d=ImageDraw.Draw(im)
    for j,rr in enumerate(rows):
        for i,ch_ in enumerate(rr):
            if ch_!='.': d.rectangle([i*Z,j*Z,(i+1)*Z-1,(j+1)*Z-1],fill=DPAL[int(ch_)])
    can.paste(im,(X+w*Z+20,Y+30))
    dr.text((X,Y+4),f'{k} {w}x{h} 差異 {REP[k]}%',font=F,fill='black')
can.save(sys.argv[2] if len(sys.argv)>2 else '/workspace/season-compare.png'); print(REP)
