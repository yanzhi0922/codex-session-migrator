const fs=require('fs');
const {DatabaseSync}=require('node:sqlite');
const gsPath='C:/Users/Yanzh/.codex/.codex-global-state.json';
const bakPath='C:/Users/Yanzh/.codex/.codex-global-state.json.pre-root-expand-'+new Date().toISOString().replace(/[:.]/g,'-')+'.bak';
const dbPath='C:/Users/Yanzh/.codex/state_5.sqlite';
const gs=JSON.parse(fs.readFileSync(gsPath,'utf8'));
const db=new DatabaseSync(dbPath,{readonly:true});
const dbCwds=db.prepare('SELECT DISTINCT cwd FROM threads WHERE archived=0 ORDER BY updated_at DESC').all().map(r=>r.cwd).filter(Boolean);
const fields=['electron-saved-workspace-roots','project-order'];
for(const f of fields){ if(!Array.isArray(gs[f])) gs[f]=[]; }
const addTo=(arr,items)=>{ const set=new Set(arr); for(const x of items){ if(!set.has(x)){ arr.push(x); set.add(x);} } };
for(const f of fields) addTo(gs[f],dbCwds);
// Keep active workspace roots valid; do not force-switch current active root.
if(!Array.isArray(gs['active-workspace-roots'])) gs['active-workspace-roots']=[];
fs.copyFileSync(gsPath,bakPath);
fs.writeFileSync(gsPath,JSON.stringify(gs,null,2),'utf8');
const roots=new Set([...(gs['electron-saved-workspace-roots']||[]),...(gs['project-order']||[]),...(gs['active-workspace-roots']||[])]);
const missing=dbCwds.filter(c=>!roots.has(c));
console.log(JSON.stringify({backup:bakPath,dbDistinctCwd:dbCwds.length,electronRoots:gs['electron-saved-workspace-roots'].length,projectOrder:gs['project-order'].length,activeRoots:gs['active-workspace-roots'].length,missingAfterWrite:missing.length,missingList:missing},null,2));
