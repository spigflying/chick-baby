import json
from PIL import Image, ImageDraw, ImageFont
G=json.load(open('game.json')); R=json.load(open('art.json'))['rep']
PAL=[(0x9b,0xbc,0x0f),(0x8b,0xac,0x0f),(0x30,0x62,0x30),(0x0f,0x38,0x0f)]
F=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',18)
SP=['chicken','duck','penguin','dino']; PO=['side','front','walk1','walk2','sleep']; Z=6
CW=2*36*Z+30; CH=32*Z+40
can=Image.new('RGB',(5*CW+20,8*CH+20),'white'); d=ImageDraw.Draw(can)
for ii,item in enumerate(['cape','wings']):
    cells=json.load(open(f'{item}.json'))['cells']; sheet=Image.open(f'/workspace/chick-baby-refs/benson-sprites/{item}-sheet.png').convert('RGBA')
    for si,sp in enumerate(SP):
        for pi,po in enumerate(PO):
            c=cells[si*5+pi]; y0,y1,x0,x1=c['box']; X=10+pi*CW; Y=10+(ii*4+si)*CH
            cr=sheet.crop((x0,y0,x1,y1)); bg=Image.new('RGBA',cr.size,'white'); bg.alpha_composite(cr)
            if R[f'{item}/{sp}/{po}']['mirror']: bg=bg.transpose(Image.FLIP_LEFT_RIGHT)
            h=len(c['rows'])*Z; bg=bg.convert('RGB').resize((int(bg.width*h/bg.height),h),Image.NEAREST); can.paste(bg,(X,Y+24))
            rows=G[f'{sp}/{item}'][po]; im=Image.new('RGB',(len(rows[0])*Z,len(rows)*Z),'white'); dd=ImageDraw.Draw(im)
            for j,r in enumerate(rows):
                for i,ch in enumerate(r):
                    if ch not in '. ': dd.rectangle([i*Z,j*Z,(i+1)*Z-1,(j+1)*Z-1],fill=PAL[int(ch)])
            can.paste(im,(X+bg.width+16,Y+24))
            d.text((X,Y+2),f'{item} {sp} {po}  對齊差 {R[f"{item}/{sp}/{po}"]["align"]}%  配件 {R[f"{item}/{sp}/{po}"]["px"]}px',font=F,fill='black')
can.save('/workspace/cape-wings-compare.png'); print(can.size)
