const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const sessionsRoot = 'C:/Users/Yanzh/.codex/sessions';
const dbPath = 'C:/Users/Yanzh/.codex/state_5.sqlite';

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(p, out);
    } else if (ent.isFile() && p.endsWith('.jsonl')) {
      out.push(p);
    }
  }
  return out;
}

function normalizeCwd(s) {
  if (!s) return '';
  return String(s).replace(/^\\\\\\?\\/, '');
}

const files = walk(sessionsRoot);
const sessionMap = new Map();
for (const f of files) {
  let first = '';
  try {
    first = fs.readFileSync(f, 'utf8').split(/\r?\n/).find(Boolean) || '';
  } catch {
    continue;
  }
  if (!first) continue;

  let o;
  try {
    o = JSON.parse(first);
  } catch {
    continue;
  }
  if (o.type !== 'session_meta' || !o.payload || !o.payload.id) continue;

  const id = o.payload.id;
  const cwd = normalizeCwd(o.payload.cwd);
  const ts = o.payload.timestamp || o.timestamp || '';
  const prev = sessionMap.get(id);
  if (!prev || (ts && prev.ts && ts > prev.ts) || (!prev.ts && ts)) {
    sessionMap.set(id, { id, cwd, file: f, ts });
  }
}

const db = new DatabaseSync(dbPath, { readonly: true });
const dbRows = db.prepare('SELECT id,cwd,archived FROM threads').all();
const dbById = new Map(dbRows.map((r) => [r.id, { id: r.id, cwd: normalizeCwd(r.cwd), archived: r.archived }]));

const missingInDb = [];
const cwdMismatch = [];
for (const [id, s] of sessionMap) {
  const d = dbById.get(id);
  if (!d) {
    missingInDb.push(s);
  } else if (s.cwd && d.cwd && s.cwd !== d.cwd) {
    cwdMismatch.push({ id, sessionCwd: s.cwd, dbCwd: d.cwd });
  }
}

const missingSessionFile = [];
for (const r of dbRows) {
  if (!sessionMap.has(r.id)) missingSessionFile.push({ id: r.id, cwd: normalizeCwd(r.cwd), archived: r.archived });
}

function byCwd(arr, key) {
  const m = new Map();
  for (const x of arr) {
    const c = x[key] || '';
    m.set(c, (m.get(c) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const result = {
  sessionFiles: files.length,
  uniqueSessionIds: sessionMap.size,
  dbThreads: dbRows.length,
  missingInDbCount: missingInDb.length,
  cwdMismatchCount: cwdMismatch.length,
  missingSessionFileCount: missingSessionFile.length,
  topMissingInDbByCwd: byCwd(missingInDb, 'cwd').slice(0, 30),
  sampleMissingInDb: missingInDb.slice(0, 30),
  sampleCwdMismatch: cwdMismatch.slice(0, 30),
  topMissingSessionFileByCwd: byCwd(missingSessionFile, 'cwd').slice(0, 30),
};

console.log(JSON.stringify(result, null, 2));
