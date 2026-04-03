import os, json, sqlite3
from collections import defaultdict
home=os.path.expanduser('~')
sessions_root=os.path.join(home,'.codex','sessions')
db_path=os.path.join(home,'.codex','state_5.sqlite')
meta={}
for root,dirs,files in os.walk(sessions_root):
    if '__backups__' in root.split(os.sep):
        continue
    for fn in files:
        if not fn.endswith('.jsonl'):
            continue
        p=os.path.join(root,fn)
        try:
            with open(p,'r',encoding='utf-8') as f:
                first=''
                for line in f:
                    if line.strip():
                        first=line
                        break
            if not first:
                continue
            o=json.loads(first)
            if o.get('type')!='session_meta':
                continue
            pl=o.get('payload') or {}
            sid=(pl.get('id') or '').lower()
            if sid:
                meta[sid]=(pl.get('cwd') or '')
        except Exception:
            pass

con=sqlite3.connect(db_path)
active=con.execute('select id,cwd from threads where archived=0').fetchall()
stats=defaultdict(lambda:[0,0,0])
for sid,dcwd in active:
    sid=str(sid).lower(); dcwd=dcwd or ''
    scwd=meta.get(sid,'')
    stats[dcwd][0]+=1
    if scwd==dcwd:
        stats[dcwd][1]+=1
    if scwd and scwd.lower()==dcwd.lower():
        stats[dcwd][2]+=1
print('db_cwd\tdb_count\texact_match\tci_match')
for dcwd,(total,exact,ci) in sorted(stats.items(), key=lambda kv: kv[1][0], reverse=True):
    print(f'{dcwd}\t{total}\t{exact}\t{ci}')
