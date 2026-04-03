import os, json, sqlite3
from collections import Counter

home=os.path.expanduser('~')
sessions_root=os.path.join(home,'.codex','sessions')
db_path=os.path.join(home,'.codex','state_5.sqlite')
index_path=os.path.join(home,'.codex','session_index.jsonl')

# sessions meta by id
sessions_meta={}
files_scanned=0
for root,dirs,files in os.walk(sessions_root):
    if '__backups__' in root.split(os.sep):
        continue
    for fn in files:
        if not fn.endswith('.jsonl'):
            continue
        p=os.path.join(root,fn)
        files_scanned += 1
        try:
            with open(p,'r',encoding='utf-8') as f:
                first_non_empty=''
                for line in f:
                    if line.strip():
                        first_non_empty=line
                        break
            if not first_non_empty:
                continue
            o=json.loads(first_non_empty)
            if o.get('type')!='session_meta':
                continue
            payload=o.get('payload') or {}
            sid=(payload.get('id') or '').lower()
            if not sid:
                continue
            sessions_meta[sid]={
                'cwd': payload.get('cwd') or '',
                'title': payload.get('title') or '',
                'path': p,
            }
        except Exception:
            pass

# db rows
con=sqlite3.connect(db_path)
rows=con.execute('select id,cwd,archived,updated_at from threads').fetchall()
active=[r for r in rows if r[2]==0]
active_ids=[str(r[0]).lower() for r in active]
active_id_set=set(active_ids)

# session_index ids
index_ids=[]
index_bad=0
try:
    with open(index_path,'r',encoding='utf-8') as f:
        for line in f:
            line=line.strip()
            if not line:
                continue
            try:
                o=json.loads(line)
            except Exception:
                index_bad += 1
                continue
            sid=(o.get('id') or '').lower()
            if sid:
                index_ids.append(sid)
except FileNotFoundError:
    pass
index_set=set(index_ids)

# comparisons
missing_session_meta=[r for r in active if str(r[0]).lower() not in sessions_meta]
missing_in_index=[r for r in active if str(r[0]).lower() not in index_set]

cwd_mismatch=[]
for sid,cwd,arch,upd in active:
    sid=str(sid).lower()
    sm=sessions_meta.get(sid)
    if not sm:
        continue
    scwd=sm['cwd'] or ''
    dcwd=cwd or ''
    if scwd!=dcwd:
        cwd_mismatch.append((sid,dcwd,scwd))

# cwd counters
db_c=Counter((r[1] or '') for r in active)
sess_c=Counter((v['cwd'] or '') for k,v in sessions_meta.items() if k in active_id_set)

print('files_scanned',files_scanned)
print('sessions_meta_ids',len(sessions_meta))
print('db_rows',len(rows))
print('db_active',len(active))
print('index_lines_ids',len(index_ids))
print('index_unique_ids',len(index_set))
print('index_bad_lines',index_bad)
print('active_missing_session_meta',len(missing_session_meta))
print('active_missing_in_session_index',len(missing_in_index))
print('active_cwd_mismatch_db_vs_session_meta',len(cwd_mismatch))

print('--- TOP DB ACTIVE CWD ---')
for cwd,n in db_c.most_common(20):
    print(f'{n}\t{cwd}')

print('--- TOP SESSION_META CWD (ACTIVE IDS) ---')
for cwd,n in sess_c.most_common(20):
    print(f'{n}\t{cwd}')

print('--- MISSING IN SESSION_INDEX BY CWD (TOP 20) ---')
mi=Counter((r[1] or '') for r in missing_in_index)
for cwd,n in mi.most_common(20):
    print(f'{n}\t{cwd}')

print('--- SAMPLE active missing in index (first 60) ---')
for r in missing_in_index[:60]:
    print(str(r[0]).lower(),'||',r[1] or '')

print('--- SAMPLE CWD mismatch (first 60) ---')
for sid,dcwd,scwd in cwd_mismatch[:60]:
    print(sid,'||DB||',dcwd,'||SESSION||',scwd)
