import os, sqlite3
from collections import Counter
home=os.path.expanduser('~')
db=os.path.join(home,'.codex','state_5.sqlite')
con=sqlite3.connect(db)
rows=con.execute('select id,cwd,rollout_path,archived from threads where archived=0').fetchall()
missing=[]
for sid,cwd,rp,arch in rows:
    p=rp or ''
    if p and not os.path.isabs(p):
        p=os.path.join(home,'.codex',p)
    ok=bool(p) and os.path.exists(p)
    if not ok:
        missing.append((sid,cwd,rp,p))

by_cwd=Counter(cwd for _,cwd,_,_ in missing)
print('active_total',len(rows))
print('missing_rollout_path_total',len(missing))
print('--- missing rollout by cwd ---')
for cwd,n in by_cwd.most_common(30):
    print(f'{n}\t{cwd}')
print('--- sample missing rollout ---')
for sid,cwd,rp,p in missing[:80]:
    print(str(sid).lower(),'||',cwd,'||rp||',rp,'||resolved||',p)
