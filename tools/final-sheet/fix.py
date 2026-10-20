import json
D=json.load(open('scaled.json'))
FIX={
 'chicken':{'side':[(3,7,'0'),(4,6,'3'),(4,7,'3'),(0,8,'3'),(1,8,'2')],'walk1':[(4,6,'3'),(4,7,'3')],'walk2':[(5,6,'3'),(5,7,'3'),(0,8,'3'),(1,8,'2')],
            'front':[(4,6,'3'),(8,6,'3'),(6,9,'2'),(7,9,'2')]},
 'duck':{'side':[(5,5,'3')],'walk1':[(5,5,'3'),(5,6,'3')],'walk2':[(5,5,'3'),(5,6,'3')],
         'front':[(14,10,'.'),(14,11,'.'),(13,11,'3'),(1,13,'3')]},
 'penguin':{'side':[(6,5,'3')],'walk2':[(4,6,'3'),(4,7,'0')]},
 'dino':{'side':[(6,5,'3')],'walk1':[(6,5,'3'),(6,6,'3')],'walk2':[(6,5,'3'),(6,6,'3')]},
}
for sp,vs in FIX.items():
    for v,ed in vs.items():
        r=[list(x) for x in D['sprites'][sp][v]]
        for x,y,c in ed: r[y][x]=c
        D['sprites'][sp][v]=[''.join(x) for x in r]
E={'chicken':((4,7),8),'duck':((5,6),None),'penguin':((6,6),None),'dino':((6,6),None)}
EF={'chicken':((4,7),8),'duck':((4,7),10),'penguin':((4,6),10),'dino':((4,7),10)}
for sp in D['feat']:
    D['feat'][sp]['side']['eye']=E[sp][0]; D['feat'][sp]['front']['eye']=EF[sp][0]; D['feat'][sp]['front']['eye2']=EF[sp][1]
# 確認只用 4 色
assert all(set(''.join(f))<=set('.0123') for s in D['sprites'].values() for f in s.values())
json.dump(D,open('scaled_fixed.json','w')); print('ok')
