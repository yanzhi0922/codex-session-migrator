'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { buildSafeUpdates, repairSessionIndexes } = require('../src/session-indexes');

function escapeSqliteLiteral(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function createThreadsDb(dbPath) {
  execFileSync('sqlite3', [dbPath, `
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT,
      updated_at INTEGER,
      title TEXT,
      first_user_message TEXT,
      model_provider TEXT
    );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function writeJsonl(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

function readThreadRow(dbPath, sessionId) {
  const output = execFileSync('sqlite3', ['-json', dbPath, `
    SELECT id, title, first_user_message
    FROM threads
    WHERE id = '${escapeSqliteLiteral(sessionId)}';
  `], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();

  return JSON.parse(output)[0];
}

function readThreadVisibilityRow(dbPath, sessionId) {
  const output = execFileSync('sqlite3', ['-json', dbPath, `
    SELECT id, title, first_user_message, source, model_provider, archived, archived_at
    FROM threads
    WHERE id = '${escapeSqliteLiteral(sessionId)}';
  `], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();

  return JSON.parse(output)[0];
}

function readThreadEventFlag(dbPath, sessionId) {
  const output = execFileSync('sqlite3', ['-json', dbPath, `
    SELECT id, has_user_event
    FROM threads
    WHERE id = '${escapeSqliteLiteral(sessionId)}';
  `], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();

  return JSON.parse(output)[0];
}

function readThreadUpdatedAt(dbPath, sessionId) {
  const output = execFileSync('sqlite3', ['-json', dbPath, `
    SELECT id, updated_at
    FROM threads
    WHERE id = '${escapeSqliteLiteral(sessionId)}';
  `], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();

  return JSON.parse(output)[0];
}

function createTempCodexRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-migrator-'));
}

test('repair rewrites noisy placeholder titles to the first useful prompt', () => {
  const codexRoot = createTempCodexRoot();
  const sessionsDir = path.join(codexRoot, 'sessions');
  const dbPath = path.join(codexRoot, 'state_1.sqlite');
  const sessionId = '019dffff-1111-7222-8333-abcdefabcdef';
  const rolloutPath = path.join(sessionsDir, '2026', '03', '30', `rollout-2026-03-30T10-00-00-${sessionId}.jsonl`);
  const noisyTitle = '<environment_context>\n  <cwd>C:\\Users\\Yanzh\\Desktop</cwd>\n  <shell>powershell</shell>\n</environment_context>';
  const usefulPrompt = '请修复迁移后的线程标题显示问题，避免出现 environment_context 噪声。';

  createThreadsDb(dbPath);
  writeJsonl(rolloutPath, [
    {
      timestamp: '2026-03-30T10:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: sessionId,
        timestamp: '2026-03-30T10:00:00.000Z',
        cwd: 'C:\\Users\\Yanzh\\Desktop',
        source: 'codex',
        model_provider: 'openai'
      }
    },
    {
      timestamp: '2026-03-30T10:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: noisyTitle }]
      }
    },
    {
      timestamp: '2026-03-30T10:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: usefulPrompt }]
      }
    }
  ]);
  fs.writeFileSync(
    path.join(codexRoot, 'session_index.jsonl'),
    `${JSON.stringify({
      id: sessionId,
      thread_name: noisyTitle,
      updated_at: '2026-03-30T10:00:02.000Z'
    })}\n`,
    'utf8'
  );
  execFileSync('sqlite3', [dbPath, `
    INSERT INTO threads (id, rollout_path, updated_at, title, first_user_message, model_provider)
    VALUES (
      '${escapeSqliteLiteral(sessionId)}',
      '${escapeSqliteLiteral(rolloutPath)}',
      0,
      '${escapeSqliteLiteral(noisyTitle)}',
      '${escapeSqliteLiteral(noisyTitle)}',
      'openai'
    );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const result = repairSessionIndexes(sessionsDir, {
    repairSessionIndex: true,
    rewriteSessionIndex: true
  });

  const row = readThreadRow(dbPath, sessionId);
  const sessionIndexEntries = fs.readFileSync(path.join(codexRoot, 'session_index.jsonl'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(result.failed, 0);
  assert.equal(row.title, '修复迁移后的线程标题显示问题，避免出现 environment_context 噪声。');
  assert.equal(row.first_user_message, usefulPrompt);
  assert.equal(sessionIndexEntries[0].thread_name, '修复迁移后的线程标题显示问题，避免出现 environment_context 噪声。');
});

test('repair falls back to workspace-based titles when the session only contains environment context', () => {
  const codexRoot = createTempCodexRoot();
  const sessionsDir = path.join(codexRoot, 'sessions');
  const dbPath = path.join(codexRoot, 'state_1.sqlite');
  const sessionId = '019b193c-0ec5-7c73-8a91-a5b9115d2dac';
  const rolloutPath = path.join(sessionsDir, '2025', '12', '14', `rollout-2025-12-14T03-42-04-${sessionId}.jsonl`);
  const noisyTitle = '<environment_context>\n  <cwd>c:\\Users\\Yanzh\\Desktop\\benchmark_iot</cwd>\n  <approval_policy>on-request</approval_policy>\n  <sandbox_mode>read-only</sandbox_mode>\n  <network_access>restricted</network_access>\n  <shell>powershell</shell>\n</environment_context>';
  const expectedTitle = 'benchmark_iot | 2025-12-13 19:42';

  createThreadsDb(dbPath);
  writeJsonl(rolloutPath, [
    {
      timestamp: '2025-12-13T19:42:05.298Z',
      type: 'session_meta',
      payload: {
        id: sessionId,
        timestamp: '2025-12-13T19:42:04.997Z',
        cwd: 'c:\\Users\\Yanzh\\Desktop\\benchmark_iot',
        source: 'vscode',
        model_provider: 'openai'
      }
    },
    {
      timestamp: '2025-12-13T19:42:05.298Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: noisyTitle }]
      }
    }
  ]);
  fs.writeFileSync(
    path.join(codexRoot, 'session_index.jsonl'),
    `${JSON.stringify({
      id: sessionId,
      thread_name: noisyTitle,
      updated_at: '2025-12-13T19:42:05.000Z'
    })}\n`,
    'utf8'
  );
  execFileSync('sqlite3', [dbPath, `
    INSERT INTO threads (id, rollout_path, updated_at, title, first_user_message, model_provider)
    VALUES (
      '${escapeSqliteLiteral(sessionId)}',
      '${escapeSqliteLiteral(rolloutPath)}',
      0,
      '${escapeSqliteLiteral(noisyTitle)}',
      '${escapeSqliteLiteral(noisyTitle)}',
      'openai'
    );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  repairSessionIndexes(sessionsDir, {
    repairSessionIndex: true,
    rewriteSessionIndex: true
  });

  const row = readThreadRow(dbPath, sessionId);
  const sessionIndexEntry = JSON.parse(fs.readFileSync(path.join(codexRoot, 'session_index.jsonl'), 'utf8').trim());

  assert.equal(row.title, expectedTitle);
  assert.equal(row.first_user_message, expectedTitle);
  assert.equal(sessionIndexEntry.thread_name, expectedTitle);
});

test('buildSafeUpdates normalizes raw thread titles to the summarized title', () => {
  const currentTitle = '<environment_context>\n  <cwd>C:\\Users\\Yanzh\\Desktop</cwd>\n</environment_context>\n\n请修复迁移后的线程标题显示问题，避免出现 environment_context 噪声。';
  const nextTitle = '请修复迁移后的线程标题显示问题，避免出现 environment_context 噪声。';

  const updates = buildSafeUpdates(
    {
      title: currentTitle,
      first_user_message: currentTitle
    },
    {
      title: nextTitle,
      first_user_message: nextTitle
    }
  );

  assert.deepEqual(updates, {
    title: nextTitle,
    first_user_message: nextTitle
  });
});

test('buildSafeUpdates upgrades legacy raw prompt titles to concise generated titles', () => {
  const currentTitle = '"C:\\Users\\Yanzh\\Desktop\\codex-session-migrator"是一个什么项目？';
  const nextTitle = 'codex-session-migrator 项目分析';

  const updates = buildSafeUpdates(
    {
      title: currentTitle
    },
    {
      title: nextTitle
    }
  );

  assert.deepEqual(updates, {
    title: nextTitle
  });
});

test('buildSafeUpdates upgrades older generated audit titles using first_user_message as the source of truth', () => {
  const currentTitle = '目标网络不是理论保证 审核与修订';
  const nextTitle = '强化学习文档 审核与修订';
  const firstUserMessage = '你负责人工逐篇审核并直接修改以下强化学习进阶文档，禁止自动化批量改写；逐文阅读，做外科式修订。重点：DQN 稳定性边界、经验回放/目标网络不是理论保证。只修改这些文件：\n1) docs/强化学习/03-函数近似与深度学习/02-DQN详解.md\n2) docs/强化学习/03-函数近似与深度学习/03-DQN改进算法.md';

  const updates = buildSafeUpdates(
    {
      title: currentTitle,
      first_user_message: firstUserMessage
    },
    {
      title: nextTitle
    }
  );

  assert.deepEqual(updates, {
    title: nextTitle
  });
});

test('buildSafeUpdates upgrades older single-file audit titles from numbered filenames to topic titles', () => {
  const currentTitle = '25-核心理论 审核与修订';
  const nextTitle = '机器学习：核心理论 审核与修订';
  const firstUserMessage = '你负责仅审核并直接修改 `docs/机器学习/25-核心理论.md`。要求：1）逐段人工审查；2）重点检查 ERM、泛化误差、偏差方差、VC 维、PAC、正则化、核方法、统计学习理论等数学表述。';

  const updates = buildSafeUpdates(
    {
      title: currentTitle,
      first_user_message: firstUserMessage
    },
    {
      title: nextTitle
    }
  );

  assert.deepEqual(updates, {
    title: nextTitle
  });
});

test('buildSafeUpdates refreshes source and archived flags when visibility metadata changes', () => {
  const updates = buildSafeUpdates(
    {
      source: 'unknown',
      archived: 0,
      archived_at: null
    },
    {
      source: 'vscode',
      archived: 1,
      archived_at: 1743328800
    }
  );

  assert.deepEqual(updates, {
    source: 'vscode',
    archived: 1,
    archived_at: 1743328800
  });
});

test('repair backfills has_user_event from rollout user records', () => {
  const codexRoot = createTempCodexRoot();
  const sessionsDir = path.join(codexRoot, 'sessions');
  const dbPath = path.join(codexRoot, 'state_1.sqlite');
  const sessionId = '019e0000-0000-7000-8000-user-event0001';
  const rolloutPath = path.join(sessionsDir, '2026', '03', '31', `rollout-2026-03-31T11-11-11-${sessionId}.jsonl`);

  execFileSync('sqlite3', [dbPath, `
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT,
      updated_at INTEGER,
      title TEXT,
      first_user_message TEXT,
      model_provider TEXT,
      source TEXT,
      archived INTEGER,
      archived_at INTEGER,
      has_user_event INTEGER
    );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  writeJsonl(rolloutPath, [
    {
      timestamp: '2026-03-31T11:11:11.000Z',
      type: 'session_meta',
      payload: {
        id: sessionId,
        timestamp: '2026-03-31T11:11:11.000Z',
        cwd: 'C:\\Users\\Yanzh\\Desktop\\traffic morphing',
        source: 'vscode',
        model_provider: 'codexmanager'
      }
    },
    {
      timestamp: '2026-03-31T11:11:12.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '请修复 has_user_event 错误回填问题。' }]
      }
    }
  ]);

  execFileSync('sqlite3', [dbPath, `
    INSERT INTO threads (
      id,
      rollout_path,
      updated_at,
      title,
      first_user_message,
      model_provider,
      source,
      archived,
      archived_at,
      has_user_event
    )
    VALUES (
      '${escapeSqliteLiteral(sessionId)}',
      '${escapeSqliteLiteral(rolloutPath)}',
      0,
      '请修复 has_user_event 错误回填问题。',
      '请修复 has_user_event 错误回填问题。',
      'codexmanager',
      'vscode',
      0,
      NULL,
      0
    );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const result = repairSessionIndexes(sessionsDir, {
    repairSessionIndex: true,
    rewriteSessionIndex: true
  });
  const row = readThreadEventFlag(dbPath, sessionId);

  assert.equal(result.failed, 0);
  assert.equal(row.has_user_event, 1);
});

test('repair prefers rollout timestamps over file mtime when deriving updated_at', () => {
  const codexRoot = createTempCodexRoot();
  const sessionsDir = path.join(codexRoot, 'sessions');
  const dbPath = path.join(codexRoot, 'state_1.sqlite');
  const sessionId = '019e0000-0000-7000-8000-updatedat00001';
  const rolloutPath = path.join(sessionsDir, '2026', '03', '31', `rollout-2026-03-31T11-11-11-${sessionId}.jsonl`);
  const expectedUpdatedAt = Math.floor(Date.parse('2026-03-31T11:11:12.000Z') / 1000);

  createThreadsDb(dbPath);
  writeJsonl(rolloutPath, [
    {
      timestamp: '2026-03-31T11:11:11.000Z',
      type: 'session_meta',
      payload: {
        id: sessionId,
        timestamp: '2026-03-31T11:11:11.000Z',
        cwd: 'C:\\Users\\Yanzh\\Desktop\\traffic morphing',
        source: 'vscode',
        model_provider: 'codexmanager'
      }
    },
    {
      timestamp: '2026-03-31T11:11:12.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '测试 updated_at 修复。' }]
      }
    }
  ]);

  // Simulate previously rewritten rollout files that have a much newer mtime.
  const inflatedMtime = Math.floor(Date.parse('2026-04-01T20:03:14.000Z') / 1000);
  fs.utimesSync(rolloutPath, inflatedMtime, inflatedMtime);

  execFileSync('sqlite3', [dbPath, `
    INSERT INTO threads (id, rollout_path, updated_at, title, first_user_message, model_provider)
    VALUES (
      '${escapeSqliteLiteral(sessionId)}',
      '${escapeSqliteLiteral(rolloutPath)}',
      ${inflatedMtime},
      '测试 updated_at 修复。',
      '测试 updated_at 修复。',
      'codexmanager'
    );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const result = repairSessionIndexes(sessionsDir, {
    repairSessionIndex: true,
    rewriteSessionIndex: true
  });
  const row = readThreadUpdatedAt(dbPath, sessionId);

  assert.equal(result.failed, 0);
  assert.equal(row.updated_at, expectedUpdatedAt);
});

test('repair on archived_sessions preserves existing active session_index entries when rewriting', () => {
  const codexRoot = createTempCodexRoot();
  const sessionsDir = path.join(codexRoot, 'sessions');
  const archivedDir = path.join(codexRoot, 'archived_sessions');
  const dbPath = path.join(codexRoot, 'state_1.sqlite');
  const activeId = '019dffff-0000-7000-8000-activeactive';
  const archivedId = '019dffff-0000-7000-8000-archivedarch';
  const activeRolloutPath = path.join(sessionsDir, '2026', '03', '30', `rollout-2026-03-30T10-00-00-${activeId}.jsonl`);
  const archivedRolloutPath = path.join(archivedDir, `rollout-2026-03-30T09-00-00-${archivedId}.jsonl`);

  createThreadsDb(dbPath);
  writeJsonl(activeRolloutPath, [
    {
      timestamp: '2026-03-30T10:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: activeId,
        timestamp: '2026-03-30T10:00:00.000Z',
        cwd: 'C:\\Users\\Yanzh\\Desktop\\active-project',
        source: 'codex',
        model_provider: 'openai'
      }
    },
    {
      timestamp: '2026-03-30T10:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '请修复 active 会话标题。' }]
      }
    }
  ]);
  writeJsonl(archivedRolloutPath, [
    {
      timestamp: '2026-03-30T09:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: archivedId,
        timestamp: '2026-03-30T09:00:00.000Z',
        cwd: 'C:\\Users\\Yanzh\\Desktop\\archived-project',
        source: 'codex',
        model_provider: 'openai'
      }
    },
    {
      timestamp: '2026-03-30T09:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '这个项目的几个plan.md你觉得哪个最好？' }]
      }
    }
  ]);
  fs.writeFileSync(
    path.join(codexRoot, 'session_index.jsonl'),
    [
      JSON.stringify({
        id: activeId,
        thread_name: '请修复 active 会话标题。',
        updated_at: '2026-03-30T10:00:01.000Z'
      }),
      JSON.stringify({
        id: archivedId,
        thread_name: '这个项目的几个plan.md你觉得哪个最好？',
        updated_at: '2026-03-30T09:00:01.000Z'
      })
    ].join('\n') + '\n',
    'utf8'
  );
  execFileSync('sqlite3', [dbPath, `
    INSERT INTO threads (id, rollout_path, updated_at, title, first_user_message, model_provider)
    VALUES
      (
        '${escapeSqliteLiteral(activeId)}',
        '${escapeSqliteLiteral(activeRolloutPath)}',
        0,
        '请修复 active 会话标题。',
        '请修复 active 会话标题。',
        'openai'
      ),
      (
        '${escapeSqliteLiteral(archivedId)}',
        '${escapeSqliteLiteral(archivedRolloutPath)}',
        0,
        '这个项目的几个plan.md你觉得哪个最好？',
        '这个项目的几个plan.md你觉得哪个最好？',
        'openai'
      );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  repairSessionIndexes(archivedDir, {
    repairSessionIndex: true,
    rewriteSessionIndex: true
  });

  const entries = fs.readFileSync(path.join(codexRoot, 'session_index.jsonl'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.id).sort(),
    [activeId, archivedId].sort()
  );
  assert.equal(
    entries.find((entry) => entry.id === archivedId).thread_name,
    '项目计划方案对比'
  );
});

test('repair from the active sessions root also reconciles archived_sessions rows', () => {
  const codexRoot = createTempCodexRoot();
  const sessionsDir = path.join(codexRoot, 'sessions');
  const archivedDir = path.join(codexRoot, 'archived_sessions');
  const dbPath = path.join(codexRoot, 'state_1.sqlite');
  const activeId = '019e0000-0000-7000-8000-active000001';
  const archivedId = '019e0000-0000-7000-8000-archiv00001';
  const activeRolloutPath = path.join(sessionsDir, '2026', '03', '30', `rollout-2026-03-30T10-00-00-${activeId}.jsonl`);
  const archivedRolloutPath = path.join(archivedDir, `rollout-2026-03-30T09-00-00-${archivedId}.jsonl`);

  execFileSync('sqlite3', [dbPath, `
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT,
      updated_at INTEGER,
      title TEXT,
      first_user_message TEXT,
      model_provider TEXT,
      source TEXT,
      archived INTEGER,
      archived_at INTEGER
    );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  writeJsonl(activeRolloutPath, [
    {
      timestamp: '2026-03-30T10:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: activeId,
        timestamp: '2026-03-30T10:00:00.000Z',
        cwd: 'C:\\Users\\Yanzh\\Desktop\\active-project',
        source: 'vscode',
        model_provider: 'codexmanager'
      }
    },
    {
      timestamp: '2026-03-30T10:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '修复 active 会话。' }]
      }
    }
  ]);
  writeJsonl(archivedRolloutPath, [
    {
      timestamp: '2026-03-30T09:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: archivedId,
        timestamp: '2026-03-30T09:00:00.000Z',
        cwd: 'C:\\Users\\Yanzh\\Desktop\\archived-project',
        source: 'vscode',
        model_provider: 'codexmanager'
      }
    },
    {
      timestamp: '2026-03-30T09:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '这个项目的几个plan.md你觉得哪个最好？' }]
      }
    }
  ]);

  execFileSync('sqlite3', [dbPath, `
    INSERT INTO threads (id, rollout_path, updated_at, title, first_user_message, model_provider, source, archived, archived_at)
    VALUES
      (
        '${escapeSqliteLiteral(activeId)}',
        '${escapeSqliteLiteral(activeRolloutPath)}',
        0,
        '修复 active 会话。',
        '修复 active 会话。',
        'codexmanager',
        'vscode',
        0,
        NULL
      ),
      (
        '${escapeSqliteLiteral(archivedId)}',
        '${escapeSqliteLiteral(archivedRolloutPath)}',
        0,
        '这个项目的几个plan.md你觉得哪个最好？',
        '这个项目的几个plan.md你觉得哪个最好？',
        'codexmanager',
        'vscode',
        0,
        NULL
      );
  `], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const result = repairSessionIndexes(sessionsDir, {
    repairSessionIndex: true,
    rewriteSessionIndex: true,
    includeArchivedSessions: true
  });

  const archivedRow = readThreadVisibilityRow(dbPath, archivedId);

  assert.equal(result.failed, 0);
  assert.equal(result.scanned, 2);
  assert.equal(archivedRow.archived, 1);
  assert.ok(Number(archivedRow.archived_at) > 0);
  assert.equal(archivedRow.title, '项目计划方案对比');
});
