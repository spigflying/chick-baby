import json
from PIL import Image, ImageDraw, ImageFont
e=json.load(open('/workspace/final/ext4.json')); big=json.load(open('/workspace/final/final2.json')); sm=json.load(open('scaled_fixed.json'))['sprites']
C=[tuple(int(v) for v in c) for c in json.load(open('/workspace/final/palette.json'))]
src=Image.open('/workspace/chick-baby-refs/benson-sprites/final-sheet.png').convert('RGB')
F=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',22)
def spr(rows,z):
    im=Image.new('RGB',(len(rows[0])*z,len(rows)*z),'#e8eccc'); d=ImageDraw.Draw(im)
    for j,r in enumerate(rows):
        for i,c in enumerate(r):
            if c!='.': d.rectangle([i*z,j*z,(i+1)*z-1,(j+1)*z-1],fill=C[int(c)])
    return im
# 遊戲方向：side/walk/sleep 已轉面向左；原表 cell 對應
CELL={'side':'right','walk1':'walk1','walk2':'walk2','sleep':'sleep','front':'front','left':'left','right':'right','back':'back'}
V=['side','walk1','walk2','sleep','front','left','right','back']
ZH={'chicken':'小雞','duck':'鴨','penguin':'企鵝','dino':'恐龍'}
cw=3*(32*4)+40; ch=32*5+40
can=Image.new('RGB',(len(V)*cw+120,4*ch+40),'white'); dr=ImageDraw.Draw(can)
for c,v in enumerate(V): dr.text((120+c*cw,5),f'{v}：原表 | 大取樣 | 縮小(8x)',font=F,fill='black')
for r,sp in enumerate(ZH):
    dr.text((10,40+r*ch+60),ZH[sp],font=F,fill='black')
    for c,v in enumerate(V):
        x=e[f'{sp}/{CELL[v]}']; P=4.5; gx=x['ox']+x['kx0']*P; gy=x['oy']+x['ky0']*P
        crop=src.crop((int(gx),int(gy),int(gx+x['w']*P),int(gy+x['h']*P)))
        flip = v in ('walk1','walk2','sleep') or (sp=='penguin' and v=='side')
        if flip: crop=crop.transpose(Image.FLIP_LEFT_RIGHT)
        crop=crop.resize((int(crop.width*128/crop.height*0.9),int(128*0.9)),Image.NEAREST)
        X=120+c*cw; Y=40+r*ch
        can.paste(crop,(X,Y)); can.paste(spr(big[sp][v],4),(X+130,Y)); can.paste(spr(sm[sp][v],8),(X+260,Y))
can.save('/workspace/scaled-sprites-compare.png'); print(can.size)
