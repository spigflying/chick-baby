import json
E=json.load(open('ext.json'))
exec(open('/workspace/final/final.py').read().split('OUT={};REP={}')[0].split('d=json')[0]) if False else None
def clean(rows):
    r=[list(x) for x in rows]; H=len(r); W=len(r[0]); n=0
    for y in range(1,H-1):
        for x in range(1,W-1):
            nb=[r[y-1][x],r[y+1][x],r[y][x-1],r[y][x+1]]
            if len(set(nb))==1 and nb[0]!=r[y][x] and nb[0]!='.' and r[y][x]!='.' and r[y][x]!='3': r[y][x]=nb[0]; n+=1
    return [''.join(x) for x in r],n
MIR={'chicken':['sleep'],'duck':['side','sleep'],'penguin':['side','walk1','walk2','sleep'],'dino':['side','walk1','walk2','sleep']}
OUT={};FIX={}
for sp in ['chicken','duck','penguin','dino']:
    fr={}
    for v in ['side','front','walk1','walk2','sleep']:
        rows,n=clean(E[f'{sp}/{v}']['rows']); FIX[f'{sp}/{v}']=n
        if v in MIR[sp]: rows=[r[::-1] for r in rows]
        fr[v]=rows
    g=['side','walk1','walk2','sleep']; W=max(len(fr[v][0]) for v in g); H=max(len(fr[v]) for v in g)
    def bc(rows):
        b=[i for i,c in enumerate(rows[-1]) if c!='.']; return (b[0]+b[-1])/2
    c0=bc(fr['side']); ref=W/2
    for v in g:
        r=fr[v]; w=len(r[0]); sx=int(round(ref-bc(r)+ (0 if v!='sleep' else 0)))
        sx=max(0,min(W-w,int(round((W-w)/2)) if v=='sleep' else sx))
        fr[v]=['.'*W]*(H-len(r))+['.'*sx+x+'.'*(W-w-sx) for x in r]
    OUT[sp]=fr; print(sp,{v:(len(fr[v][0]),len(fr[v])) for v in fr})
print('fix',FIX)
json.dump(OUT,open('season.json','w'))
for sp in OUT:
  for v in ['side','front','walk1','sleep']:
    r=OUT[sp][v]; print(sp,v,'   '+''.join(str(i%10) for i in range(len(r[0]))))
    for y,l in enumerate(r): print('%2d '%y+l)
