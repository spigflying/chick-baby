EYE2={'chicken': 8, 'duck': 10, 'penguin': 10, 'dino': 10}
import json
d=json.load(open('/workspace/scaled/sprites_only.json'))
def W(r): xs=[i for i,c in enumerate(r) if c!='.']; return (xs[0],xs[-1]) if xs else None
def interior3(rows):
    H=len(rows); out=[]
    for y in range(1,H-1):
        for x in range(1,len(rows[y])-1):
            if rows[y][x]=='3' and all(rows[y+dy][x+dx] not in '.3' for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]): out.append((x,y))
            elif rows[y][x]=='3' and rows[y-1][x] in '23' and rows[y][x-1] not in '.3' and rows[y][x+1] not in '.3' and rows[y+1][x] not in '.3': out.append((x,y))
    return out
MAN={'chicken': {'side': ((4, 7), 2, 1, 14), 'front': ((4, 7), 1, 0, 15), 'sleep': (None, 5, -1, 99)}, 'duck': {'side': ((5, 6), 1, 0, 15), 'front': ((4, 7), 1, 0, 16), 'sleep': (None, 6, -1, 99)}, 'penguin': {'side': ((6, 6), 0, -1, 16), 'front': ((4, 6), 0, -1, 16), 'sleep': ((3, 13), 5, -1, 99)}, 'dino': {'side': ((6, 6), 1, 0, 18), 'front': ((4, 7), 1, 0, 18), 'sleep': (None, 9, -1, 99)}}
def derive(rows,view,ref=None,sp=None):
    H=len(rows); ws=[W(r) for r in rows]
    eye,top,hair,ff=MAN[sp][view]
    if view=='sleep': top=next(y for y,r in enumerate(rows) if r.count('.')<=len(r)-5)
    if eye is None: eye=(ref['eye'][0], top+ref['eye'][1]-ref['top'])
    bb=(ff-1) if ff<99 else H-2
    mid=[w for w in ws[top:bb+1] if w]; bl=min(w[0] for w in mid); br=max(w[1] for w in mid)
    bcx=(bl+br)/2; fw=ws[H-1]; fcx=(fw[0]+fw[1])/2; hw=ws[top]; hcx=(hw[0]+hw[1])/2
    ex,ey=eye[0]-5,eye[1]-6
    if view=='front': ex=round((eye[0]+EYE2[sp])/2-7.5)
    body=[round(bcx-7.5),bb-14]
    neck=[ex if view!='front' else round(hcx-7.5), round(ey+(body[1]-ey)*0.45)]
    a=dict(head=[round(hcx-7),top-2],eye=[ex,ey],neck=neck,back=[body[0],body[1]-1],hand=[body[0],body[1]-1],
           feet=[round(fcx-7.5),H-1-16],body=body,hair=hair,feetFrom=ff)
    ya=9+neck[1]; yb=(ff-2) if ff<99 else bb-1
    l=W(rows[ya])[0]
    fx=round(hcx) if view=='front' else l+3
    return a,[ya,yb,fx],dict(eye=eye,top=top)
A={};COAT={}
for sp,f in d.items():
    A[sp]={};COAT[sp]={}
    a,c,ref=derive(f['side'],'side',None,sp); A[sp]['side']=a;COAT[sp]['side']=c
    a,c,_=derive(f['sleep'],'sleep',ref,sp); A[sp]['sleep']=a;COAT[sp]['sleep']=c
    a,c,_=derive(f['front'],'front',None,sp); A[sp]['front']=a;COAT[sp]['front']=c
    for v in A[sp]: print(sp,v,A[sp][v],COAT[sp][v])
A['duck']['side']['neck']=[0,-1]; A['duck']['sleep']['neck']=[0,3]  # 鴨子脖子比身體高
L=["// 由 /workspace/final/anchors2.py 產生：Benson 最終角色表（final-sheet.png，1536x1024，每格 4.5px）逐格取樣",
   "// side/walk/sleep 已轉成面向左；left/right/back 為原表視角原樣保存（未鏡像）。色碼 0 最亮…3 最暗，'.' 透明。",
   "// 錨點是相對於「舊版雞」配件座標的位移。",
   "export type View = 'side' | 'sleep' | 'front';",
   "export const BENSON: Record<string, { side: string[]; walk1: string[]; walk2: string[]; sleep: string[]; front: string[]; left: string[]; right: string[]; back: string[] }> = {"]
for sp,fr in d.items():
    L.append(f"  {sp}: {{")
    for k in ['side','walk1','walk2','sleep','front','left','right','back']: L.append(f"    {k}: {json.dumps(fr[k])},")
    L.append("  },")
L.append("};")
L.append("export const VIEW_ANCHORS: Record<string, Record<View, { head: [number, number]; eye: [number, number]; neck: [number, number]; back: [number, number]; hand: [number, number]; feet: [number, number]; body: [number, number]; hair: number; feetFrom: number }>> = "+json.dumps(A)+";")
L.append("/** 外套：[第一列, 最後一列, 前襟 x]（依新身形量的）。 */")
L.append("export const COAT: Record<string, Record<View, [number, number, number]>> = "+json.dumps(COAT)+";")
open('/workspace/chick-baby/apps/web/src/species-sprites.ts','w').write('\n'.join(L)+'\n')
