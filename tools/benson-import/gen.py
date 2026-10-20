# 匯入 Benson 的 20x18 精靈：鏡像成面向左、睡覺去掉 Z、依共同外框裁切，並自動量測五官位置推出配件錨點
import json
B=json.load(open('sprites.json'))
OLD_SIDE=['.......33.......','.......3........','.....33333......','....3111113.....','...311111113....','..31111111113...','..31131111113...','..311111111113..','.3222111111113..','..33311111111133','...311112221113.','...311122222113.','...31111111113..','....3111111113..','.....33333333...','......3....3....','.....33...33....']
OLD_FRONT=['.......33.......','.......3........','.....333333.....','...3311111133...','..311111111113..','.31111111111113.','.31113111131113.','.31111111111113.','3111112222111113','3111111221111113','3211111111111123','3221111111111223','.32111111111123.','..311111111113..','...3333333333...','.....3....3.....','....33....33....']
def mirror(rows): return [r[::-1] for r in rows]
def strip_z(rows):
    h=len(rows);w=len(rows[0]);seen={};comps=[]
    for y in range(h):
        for x in range(w):
            if rows[y][x]!='.' and (x,y) not in seen:
                st=[(x,y)];c=[];seen[(x,y)]=1
                while st:
                    a,b=st.pop();c.append((a,b))
                    for dx in(-1,0,1):
                        for dy in(-1,0,1):
                            p=(a+dx,b+dy)
                            if 0<=p[0]<w and 0<=p[1]<h and rows[p[1]][p[0]]!='.' and p not in seen: seen[p]=1;st.append(p)
                comps.append(c)
    keep=max(comps,key=len); g=[['.']*w for _ in range(h)]
    for x,y in keep: g[y][x]=rows[y][x]
    removed=sum(len(c) for c in comps)-len(keep)
    return [''.join(r) for r in g],removed
def bbox(frames):
    xs=[];ys=[]
    for f in frames:
        for y,r in enumerate(f):
            for x,c in enumerate(r):
                if c!='.': xs.append(x);ys.append(y)
    return min(xs),min(ys),max(xs),max(ys)
def crop(f,b): x0,y0,x1,y1=b; return [r[x0:x1+1] for r in f[y0:y1+1]]
def feats(rows,front):
    h=len(rows);w=len(rows[0])
    width=[sum(c!='.' for c in r) for r in rows]; mx=max(width)
    body=[y for y in range(h) if width[y]>=0.45*mx]
    top=body[0]; bot=body[-1]
    span=[x for x,c in enumerate(rows[top]) if c!='.']; tcx=(span[0]+span[-1])/2
    inner=lambda x,y: all(0<=x+dx<w and 0<=y+dy<h and rows[y+dy][x+dx]!='.' for dx,dy in((1,0),(-1,0),(0,1),(0,-1)))
    eyes=[(x,y) for y in range(top,top+int((bot-top)*0.6)+1) for x in range(w) if rows[y][x]=='3' and inner(x,y)]
    if front:
        cx=w/2; L=[p for p in eyes if p[0]<cx]; R=[p for p in eyes if p[0]>=cx]
        if L and R: ex=(sum(p[0] for p in L)/len(L)+sum(p[0] for p in R)/len(R))/2; ey=min(min(p[1] for p in L),min(p[1] for p in R))
        else: ex,ey=tcx,top+3
    else:
        if eyes: e=min(eyes); ex=min(p[0] for p in eyes); ey=min(p[1] for p in eyes if p[0]<=ex+1)
        else: ex,ey=span[0]+1,top+3
    xs=[x for y in body for x,c in enumerate(rows[y]) if c!='.']
    left=min(xs); right=max(xs); bcx=(left+right)/2; bcy=(top+bot)/2
    last=max(y for y in range(h) if width[y]>0)
    feet=[x for x,c in enumerate(rows[last]) if c!='.']; fcx=(feet[0]+feet[-1])/2
    return dict(top=top,tcx=tcx,ex=ex,ey=ey,bot=bot,left=left,right=right,bcx=bcx,bcy=bcy,last=last,fcx=fcx)
FO=feats(OLD_SIDE,False); FF=feats(OLD_FRONT,True)
print('old side',FO); print('old front',FF)
R=round
def anchors(f,o,front):
    head=[R(f['tcx']-o['tcx']),f['top']-o['top']]
    eye=[R(f['ex']-o['ex']),R(f['ey']-o['ey'])]
    body=[R(f['bcx']-o['bcx']),R(f['bcy']-o['bcy'])]
    feet=[R(f['fcx']-o['fcx']),f['last']-o['last']]
    neck=[eye[0],R((eye[1]+body[1])/2)]
    if front: back=hand=body
    else: back=[f['right']-o['right'],body[1]]; hand=[f['left']-o['left'],body[1]]
    return dict(head=head,eye=eye,neck=neck,back=back,hand=hand,feet=feet,body=body)
OUT={'sprites':{},'anchors':{},'hair':{},'feetRows':{},'coat':{},'report':{}}
for sp in ['chicken','duck','penguin','dino']:
    s=B[sp]; side=mirror(s['side']); w1=mirror(s['walk1']); w2=mirror(s['walk2'])
    Z=[(17,1),(18,1),(17,2),(18,2),(15,3),(16,3),(17,3),(16,4),(15,5),(16,5),(17,5)]
    g=[list(r) for r in s['sleep']]; zr=0
    for x,y in Z:
        if g[y][x]!='.': g[y][x]='.'; zr+=1
    sl=mirror([''.join(r) for r in g])
    b=bbox([side,w1,w2,sl]); fb=bbox([s['front']])
    fr={'side':crop(side,b),'walk1':crop(w1,b),'walk2':crop(w2,b),'sleep':crop(sl,b),'front':crop(s['front'],fb)}
    OUT['sprites'][sp]=fr
    a={};hair={};feetR={};coat={}
    for view,rows,front in (('side',fr['side'],False),('sleep',fr['sleep'],False),('front',fr['front'],True)):
        f=feats(rows,front); o=FF if front else FO
        a[view]=anchors(f,o,front)
        hair[view]=f['top']-1   # 身體頂端以上 = 頭毛
        feetR[view]=f['bot']+1
        ya=R((f['ey']+f['bcy'])/2)+1; coat[view]=[ya,f['bot']-1,R(f['bcx']) if front else f['left']+3]
        OUT['report'][f'{sp}/{view}']=f
    OUT['anchors'][sp]=a; OUT['hair'][sp]=hair; OUT['feetRows'][sp]=feetR; OUT['coat'][sp]=coat
    OUT['report'][f'{sp}/zRemoved']=zr; OUT['report'][f'{sp}/bbox']=b
json.dump(OUT,open('import.json','w'),indent=1)
for sp in OUT['sprites']:
    print(sp,'bbox',OUT['report'][sp+'/bbox'],'z removed',OUT['report'][sp+'/zRemoved'])
    for v in OUT['anchors'][sp]: print('  ',v,OUT['anchors'][sp][v],'hair≤',OUT['hair'][sp][v],'feet≥',OUT['feetRows'][sp][v],'coat',OUT['coat'][sp][v])
