const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Yanzh/.codex/state_5.sqlite', { readonly: true });
const summary = {
  all: db.prepare('SELECT COUNT(*) c FROM threads').get().c,
  active: db.prepare('SELECT COUNT(*) c FROM threads WHERE archived=0').get().c,
  recentAll: db.prepare("SELECT COUNT(*) c FROM threads WHERE datetime(updated_at,'unixepoch') >= datetime('now','-7 days')").get().c,
  recentActive: db.prepare("SELECT COUNT(*) c FROM threads WHERE archived=0 AND datetime(updated_at,'unixepoch') >= datetime('now','-7 days')").get().c,
  recentArchived: db.prepare("SELECT COUNT(*) c FROM threads WHERE archived=1 AND datetime(updated_at,'unixepoch') >= datetime('now','-7 days')").get().c,
};
const sample = db.prepare("SELECT id, archived, cwd, datetime(updated_at,'unixepoch') AS updated_at FROM threads WHERE datetime(updated_at,'unixepoch') >= datetime('now','-7 days') ORDER BY updated_at DESC LIMIT 25").all();
console.log(JSON.stringify({ summary, sample }, null, 2));
