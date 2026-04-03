import os, json, sqlite3, re
from collections import Counter

home=os.path.expanduser('~')
sessions_root=os.path.join(home,'.codex','sessions')
db_path=os.path.join(home,'.codex','state_5.sqlite')
id_re=re.compile(r'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.jsonl$',re.I)

session_cwd_by_id={}
file_count=0
for root,dirs,files in os.walk(sessions_root):
    if '__backups__' in root.split(os.sep):
        continue
    for fn in files:
        if not fn.endswith('.jsonl'):
            continue
        m=id_re.search(fn)
        if not m:
            continue
        sid=m.group(1).lower()
        p=os.path.join(root,fn)
        file_count += 1
        cwd=''
        try:
            with open(p,'r',encoding='utf-8') as f:
                for line in f:
                    line=line.strip()
                    if not line:
                        continue
                    try:
                        o=json.loads(line)
                    except Exception:
                        break
                    if o.get('type')=='session_meta':
                        cwd=(o.get('payload') or {}).get('cwd') or ''
                    break
        except Exception:
            pass
        session_cwd_by_id[sid]=cwd

conn=sqlite3.connect(db_path)
rows=conn.execute('select id,cwd,archived from threads').fetchall()
active=[r for r in rows if r[2]==0]

active_db_counter=Counter((r[1] or '') for r in active)
session_counter=Counter()
missing_session_file=0
mismatch=[]

for sid,db_cwd,_ in active:
    sid=str(sid).lower()
    scwd=session_cwd_by_id.get(sid,None)
    if scwd is None:
        missing_session_file += 1
        continue
    session_counter[scwd]+=1
    if (scwd or '') != (db_cwd or ''):
        mismatch.append((sid,db_cwd or '',scwd or ''))

mismatch_by_db=Counter(m[1] for m in mismatch)
mismatch_by_session=Counter(m[2] for m in mismatch)

print('files_scanned',file_count)
print('session_ids',len(session_cwd_by_id))
print('db_rows',len(rows))
print('db_active',len(active))
print('active_missing_session_file',missing_session_file)
print('active_cwd_mismatch_count',len(mismatch))
print('--- TOP DB ACTIVE CWD ---')
for cwd,n in active_db_counter.most_common(20):
    print(f'{n}\t{cwd}')
print('--- TOP SESSION_META CWD FOR ACTIVE IDS ---')
for cwd,n in session_counter.most_common(20):
    print(f'{n}\t{cwd}')
print('--- TOP DB CWD IN MISMATCH ---')
for cwd,n in mismatch_by_db.most_common(20):
    print(f'{n}\t{cwd}')
print('--- TOP SESSION CWD IN MISMATCH ---')
for cwd,n in mismatch_by_session.most_common(20):
    print(f'{n}\t{cwd}')
print('--- SAMPLE MISMATCH (first 50) ---')
for sid,db_cwd,scwd in mismatch[:50]:
    print(sid,'||DB||',db_cwd,'||SESSION||',scwd)
