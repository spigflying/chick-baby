# Generates the pixel egg-device favicon (transparent background). Colors match drawShell().
from PIL import Image
W,H,EW,EH=32,32,24,32; OX=(W-EW)//2
cols=['#ff5c8a','#ffd23f','#3ec6ff','#7ee07e','#b48cff','#ff9f43']
px={}
for y in range(EH):
  for x in range(EW):
    nx=(x+.5-EW/2)/(EW/2); ny=(y+.5-EH*.54)/(EH*.46)
    e=nx*nx/(1+ny*0.08)**2+ny*ny if ny<0 else nx*nx+ny*ny
    if e>1: continue
    if e>0.80: c='#1a1030'
    elif e>0.66: c='#ff3d7f'
    else:
      d=((x>>1)+(y>>1))%2==0 and x%2==0 and y%2==0
      c=cols[((x>>1)*3+(y>>1))%6] if d else '#fff4d6'
    px[(x+OX,y)]=c
def rect(x0,y0,w,h,c):
  for y in range(y0,y0+h):
    for x in range(x0,x0+w): px[(x,y)]=c
rect(10,13,12,10,'#555555'); rect(11,14,10,8,'#0f380f'); rect(12,15,8,6,'#9bbc0f')
for (x,y,c) in [(15,16,'#306230'),(16,16,'#306230'),(14,17,'#306230'),(15,17,'#0f380f'),(16,17,'#306230'),(17,17,'#8bac0f'),(14,18,'#306230'),(15,18,'#306230'),(16,18,'#306230'),(17,18,'#306230'),(15,19,'#8bac0f'),(16,19,'#8bac0f'),(12,20,'#8bac0f'),(13,20,'#8bac0f'),(18,20,'#8bac0f'),(19,20,'#8bac0f')]: px[(x,y)]=c
for (x,y) in [(10,7),(11,7),(9,8),(9,9)]: px[(x,y)]='#ffffff'
rows=[]
for (x,y),c in sorted(px.items(),key=lambda k:(k[0][1],k[0][0])): rows.append(f'<rect x="{x}" y="{y}" width="1" height="1" fill="{c}"/>')
svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges">'+''.join(rows)+'</svg>\n'
im=Image.new('RGBA',(W,H),(0,0,0,0))
for (x,y),c in px.items(): im.putpixel((x,y),tuple(int(c[i:i+2],16) for i in (1,3,5))+(255,))
import sys,os
for d in ['.','apps/web/public']:
  os.makedirs(d,exist_ok=True)
  open(f'{d}/favicon.svg','w').write(svg)
  im.save(f'{d}/favicon-32.png')
  a=Image.new('RGBA',(180,180),(0,0,0,0)); a.paste(im.resize((160,160),Image.NEAREST),(10,10),im.resize((160,160),Image.NEAREST)); a.save(f'{d}/apple-touch-icon.png')
big=im.resize((512,512),Image.NEAREST); bg=Image.new('RGBA',(512,512))
for y in range(0,512,32):
  for x in range(0,512,32): bg.paste((204,204,204,255) if (x+y)//32%2 else (255,255,255,255),(x,y,x+32,y+32))
bg.alpha_composite(big); bg.save('/workspace/favicon-preview.png'); big.save('/workspace/favicon-preview-transparent.png')
