import json; exec(open('anchors.py').read())
d=json.load(open('import.json'))
L=["// 由 /workspace/benson/emit.py 產生：Benson 提供的 20x18 精靈（側面／走路／睡覺已鏡像成面向左、睡覺去掉 Z、裁掉透明邊）",
   "// 色碼：0 最亮、1 亮、2 暗、3 最暗；'.' 透明。錨點是相對於「舊版雞」配件座標的位移。",
   "export type View = 'side' | 'sleep' | 'front';",
   "export const BENSON: Record<string, { side: string[]; walk1: string[]; walk2: string[]; sleep: string[]; front: string[] }> = {"]
for sp,fr in d['sprites'].items():
    L.append(f"  {sp}: {{")
    for k in ['side','walk1','walk2','sleep','front']: L.append(f"    {k}: {json.dumps(fr[k])},")
    L.append("  },")
L.append("};")
L.append("export const VIEW_ANCHORS: Record<string, Record<View, { head: [number, number]; eye: [number, number]; neck: [number, number]; back: [number, number]; hand: [number, number]; feet: [number, number]; body: [number, number]; hair: number; feetFrom: number }>> = "+json.dumps(A)+";")
L.append("/** 外套：[第一列, 最後一列, 前襟 x]（依新身形量的）。 */")
L.append("export const COAT: Record<string, Record<View, [number, number, number]>> = "+json.dumps(COAT)+";")
open('/workspace/chick-baby/apps/web/src/species-sprites.ts','w').write('\n'.join(L)+'\n')
print('ok')
