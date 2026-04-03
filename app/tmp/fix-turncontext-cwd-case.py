import os, json, sqlite3, shutil, datetime

home=os.path.expanduser('~')
sessions_root=os.path.join(home,'.codex','sessions')
db_path=os.path.join(home,'.codex','state_5.sqlite')
ts=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
backup_root=os.path.join(home,'.codex',f'sessions-turncontext-cwd-backup-{ts}')

con=sqlite3.connect(db_path)
id_to_cwd={str(i).lower(): (c or '') for i,c in con.execute('select id,cwd from threads')}

files_scanned=0
files_modified=0
line_updates=0
sample=[]

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
                lines=f.read().splitlines()
            if not lines:
                continue

            # resolve session id from first non-empty session_meta line
            sid=''
            first_non_empty_idx=None
            for idx,line in enumerate(lines):
                if not line.strip():
                    continue
                first_non_empty_idx=idx
                try:
                    o=json.loads(line)
                except Exception:
                    o=None
                if isinstance(o,dict) and o.get('type')=='session_meta' and isinstance(o.get('payload'),dict):
                    sid=str(o['payload'].get('id') or '').lower()
                break
            if not sid:
                continue
            db_cwd=id_to_cwd.get(sid)
            if not db_cwd:
                continue

            changed=False
            local_updates=0
            for i,line in enumerate(lines):
                if not line.strip():
                    continue
                try:
                    o=json.loads(line)
                except Exception:
                    continue
                if not isinstance(o,dict):
                    continue
                typ=o.get('type')
                if typ not in ('session_meta','turn_context'):
                    continue
                payload=o.get('payload')
                if not isinstance(payload,dict):
                    continue
                old=payload.get('cwd')
                if not isinstance(old,str) or not old:
                    continue
                if old==db_cwd:
                    continue
                if old.lower()!=db_cwd.lower():
                    continue
                payload['cwd']=db_cwd
                o['payload']=payload
                lines[i]=json.dumps(o,ensure_ascii=False,separators=(',',':'))
                changed=True
                local_updates += 1

            if changed:
                rel=os.path.relpath(p,sessions_root)
                bp=os.path.join(backup_root,rel)
                os.makedirs(os.path.dirname(bp),exist_ok=True)
                shutil.copy2(p,bp)
                with open(p,'w',encoding='utf-8',newline='\n') as f:
                    f.write('\n'.join(lines)+('\n' if lines else ''))
                files_modified += 1
                line_updates += local_updates
                if len(sample) < 40:
                    sample.append((p,local_updates,sid,db_cwd))
        except Exception:
            pass

print('files_scanned',files_scanned)
print('files_modified',files_modified)
print('line_updates',line_updates)
print('backup_root',backup_root)
print('sample')
for row in sample:
    print(row[0],'||updates',row[1],'||id',row[2],'||cwd',row[3])
