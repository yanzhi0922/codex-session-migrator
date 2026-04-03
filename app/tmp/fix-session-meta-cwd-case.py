import os, json, sqlite3, shutil, datetime

home=os.path.expanduser('~')
sessions_root=os.path.join(home,'.codex','sessions')
db_path=os.path.join(home,'.codex','state_5.sqlite')
ts=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
backup_root=os.path.join(home,'.codex',f'sessions-cwd-case-backup-{ts}')

con=sqlite3.connect(db_path)
# use all rows to keep consistency for archived too
id_to_cwd={str(i).lower(): (c or '') for i,c in con.execute('select id,cwd from threads')}

modified=[]
scanned=0
for root,dirs,files in os.walk(sessions_root):
    if '__backups__' in root.split(os.sep):
        continue
    for fn in files:
        if not fn.endswith('.jsonl'):
            continue
        p=os.path.join(root,fn)
        scanned += 1
        try:
            with open(p,'r',encoding='utf-8') as f:
                lines=f.read().splitlines()
            if not lines:
                continue
            first_idx=None
            first_obj=None
            for idx,line in enumerate(lines):
                if not line.strip():
                    continue
                first_idx=idx
                try:
                    first_obj=json.loads(line)
                except Exception:
                    first_idx=None
                break
            if first_idx is None or not isinstance(first_obj,dict):
                continue
            if first_obj.get('type')!='session_meta':
                continue
            payload=first_obj.get('payload') or {}
            sid=str(payload.get('id') or '').lower()
            if not sid:
                continue
            db_cwd=id_to_cwd.get(sid)
            if db_cwd is None:
                continue
            old_cwd=payload.get('cwd') or ''
            if old_cwd==db_cwd:
                continue
            # only normalize case-equivalent values to avoid risky remap
            if old_cwd and old_cwd.lower()!=db_cwd.lower():
                continue

            # backup original file once
            rel=os.path.relpath(p,sessions_root)
            bp=os.path.join(backup_root,rel)
            os.makedirs(os.path.dirname(bp),exist_ok=True)
            shutil.copy2(p,bp)

            payload['cwd']=db_cwd
            first_obj['payload']=payload
            lines[first_idx]=json.dumps(first_obj,ensure_ascii=False,separators=(',',':'))
            with open(p,'w',encoding='utf-8',newline='\n') as f:
                f.write('\n'.join(lines)+('\n' if lines else ''))
            modified.append((p,old_cwd,db_cwd,sid))
        except Exception:
            pass

print('scanned',scanned)
print('modified',len(modified))
print('backup_root',backup_root)
print('sample')
for r in modified[:40]:
    print(r[0],'||',r[1],'->',r[2],'||',r[3])
