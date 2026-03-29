'use strict';

const SUPPORTED_LOCALES = ['en', 'zh-CN'];

const dictionaries = {
  en: {
    locales: {
      en: 'English',
      'zh-CN': '简体中文'
    },
    errors: {
      requestBodyJson: 'Request body must be valid JSON.',
      sessionFilePathRequired: 'Session file path is required.',
      pathOutsideSessionsDir: 'Path is outside the sessions directory: {path}',
      sessionFileNotFound: 'Session file not found: {path}',
      providerNameRequired: 'Provider name is required.',
      providerNameInvalid: 'Provider name may only contain letters, numbers, dot, underscore, or dash.',
      fullLibraryRefused: 'Refusing to target every session without an explicit filter. Use --all or select files first.',
      backupDirRequired: 'Backup directory or backup id is required.',
      targetProviderRequired: 'targetProvider is required.',
      backupIdentifierRequired: 'backupDir or backupId is required.',
      sessionNotFound: 'Session not found or session_meta could not be parsed.',
      sessionFileEmpty: 'Session file is empty.',
      firstLineInvalidJson: 'First line is not valid JSON.',
      firstLineNotSessionMeta: 'First line is not a session_meta record.',
      backupManifestMissing: 'Backup manifest not found: {path}',
      missingQueryPath: 'Missing required query parameter: path'
    },
    doctor: {
      invalidMeta: 'The first JSONL line is missing or cannot be parsed as session_meta.',
      missingProvider: 'The session_meta payload does not contain model_provider.',
      missingWorkspace: 'The session cannot provide a usable workspace path, so CodexManager may hide it.',
      duplicateId: 'Duplicate session id detected. First seen at {path}.',
      missingThread: 'The session file exists, but no SQLite threads row was found.',
      providerMismatch: 'The session file provider does not match the SQLite thread provider.',
      missingSessionIndex: 'The session file exists, but no session_index entry was found.'
    },
    cli: {
      help: {
        title: 'Codex Session Migrator',
        usage: 'Usage:',
        usageValue: '  codex-migrate <command> [options]',
        commands: 'Commands:',
        commonFlags: 'Common flags:',
        examples: 'Examples:',
        commandServe: '  serve      Start the local web app',
        commandList: '  list       List sessions',
        commandStats: '  stats      Show provider and storage overview',
        commandDoctor: '  doctor     Check for invalid or suspicious session files',
        commandBackups: '  backups    List backup snapshots',
        commandMigrate: '  migrate    Re-tag sessions to a new provider',
        commandRepair: '  repair     Rebuild missing SQLite / session_index entries',
        commandRestore: '  restore    Restore sessions from a backup snapshot',
        flagSessionsDir: '  --sessions-dir <path>   Override the Codex sessions directory',
        flagJson: '  --json                  Print JSON output when supported',
        flagAll: '  --all                   Allow full-library migration when no filters are set',
        flagLang: '  --lang <locale>         Choose CLI language (en or zh-CN)',
        exampleServe: '  codex-migrate serve --open',
        exampleList: '  codex-migrate list --provider openai --limit 20',
        exampleMigrate: '  codex-migrate migrate --provider openai --target crs --dry-run',
        exampleRepair: '  codex-migrate repair',
        exampleRestore: '  codex-migrate restore --backup 20260328180102-migration-ab12cd --yes'
      },
      labels: {
        sessionsDirectory: 'Sessions directory',
        language: 'Language',
        totalMatching: 'Total matching',
        sessions: 'Sessions',
        providers: 'Providers',
        backups: 'Backups',
        diskUsage: 'Disk usage',
        latestSession: 'Latest session',
        healthy: 'Healthy',
        invalidMetaFiles: 'Invalid meta files',
        missingProvider: 'Missing provider',
        missingWorkspace: 'Missing workspace',
        duplicateIds: 'Duplicate ids',
        missingThreads: 'Missing SQLite threads',
        providerMismatches: 'Provider mismatches',
        missingSessionIndex: 'Missing session_index',
        range: 'Range',
        noBackups: 'No backups found.',
        selectedSessions: 'Selected sessions',
        actionable: 'Actionable',
        skipped: 'Skipped',
        targetProvider: 'Target provider',
        migrated: 'Migrated',
        failed: 'Failed',
        backup: 'Backup',
        restored: 'Restored',
        preRestoreBackup: 'Pre-restore backup',
        scanned: 'Scanned',
        insertedThreads: 'Inserted threads',
        updatedIndexes: 'Updated thread rows',
        addedSessionIndex: 'Added session_index entries',
        sessionIndexEntriesWritten: 'session_index entries written',
        sessionIndexBackup: 'session_index backup'
      },
      status: {
        listening: 'Codex Session Migrator listening on {url}',
        cancelled: 'Cancelled.',
        previewReady: 'Preview ready'
      },
      confirm: {
        migrate: 'Migrate {count} sessions to "{provider}"?',
        restore: 'Restore sessions from "{backup}"?'
      },
      errors: {
        targetRequired: '--target is required for migrate.',
        backupRequired: '--backup is required for restore.'
      },
      table: {
        noSessions: 'No sessions matched the current filters.',
        unknown: 'unknown',
        plan: '[plan]',
        skip: '[skip]',
        done: '[done]',
        fail: '[fail]'
      },
      backupsLine: '{backupId} | {createdAt} | {entryCount} files | {label}'
    },
    web: {
      pageTitle: 'Codex Session Migrator',
      pageDescription: 'Inspect, migrate, back up, and restore Codex sessions across model providers.',
      common: {
        loading: 'Loading...',
        unknown: 'Unknown',
        none: 'None',
        close: 'Close',
        copy: 'Copy',
        latest: 'Latest',
        earlier: 'Earlier',
        expand: 'Expand',
        collapse: 'Collapse',
        morePrompts: '+{count} more',
        backup: 'Backup',
        preRestoreBackup: 'Pre-restore backup',
        noPreview: 'No preview available',
        allProviders: 'All providers ({count})',
        providerCount: '{name} ({count})',
        explicitSelection: 'Explicit file selection',
        currentFilters: 'Current filters',
        filesCount: '{count} files',
        scannedRange: '{start} → {end}'
      },
      hero: {
        eyebrow: 'Codex Session Migrator',
        title: 'Move Codex history across providers without breaking your archive.',
        text: 'A local-first migration console for Codex Desktop session stores. Inspect providers, batch-retag sessions, create backup snapshots, and restore safely from a manifest-backed history.',
        sessionsDir: 'Sessions Directory',
        latestSession: 'Latest Session',
        language: 'Language',
        actions: {
          refresh: 'Refresh',
          selectPage: 'Select Page',
          clear: 'Clear'
        }
      },
      overview: {
        eyebrow: 'Overview',
        title: 'Current footprint',
        sessions: 'Sessions',
        providers: 'Providers',
        backups: 'Backups',
        diskUsage: 'Disk Usage'
      },
      selection: {
        eyebrow: 'Selection',
        title: 'Filter and queue a migration',
        provider: 'Provider',
        search: 'Search',
        searchPlaceholder: 'Search by path, provider, cwd, or first prompt',
        pageSize: 'Page Size',
        apply: 'Apply',
        reset: 'Reset',
        targetProvider: 'Target Provider',
        targetPlaceholder: 'crs / openai / fizzlycode / custom-provider',
        targetHint: 'Tip: existing provider names appear as suggestions.',
        preview: 'Preview',
        run: 'Run Migration',
        selectionMode: 'Selection mode',
        selectedFiles: 'Selected files',
        matchingTotal: 'Matching total'
      },
      sessions: {
        eyebrow: 'Sessions',
        title: 'Provider-tagged history',
        previous: 'Previous',
        next: 'Next',
        pageStatus: 'Page {page} / {totalPages}',
        selectPageAria: 'Select all rows on page',
        openDetailsAria: 'Open details for session {id}',
        table: {
          provider: 'Provider',
          when: 'When',
          path: 'Relative Path',
          workspace: 'Workspace',
          promptPreview: 'Prompt Preview'
        },
        empty: 'No sessions matched the current filters.'
      },
      detail: {
        eyebrow: 'Inspector',
        title: 'Session details',
        emptyTitle: 'Pick a session',
        emptyText: 'Click any row to inspect metadata before you migrate or restore.',
        loading: 'Loading session details...',
        sections: {
          metadata: 'Metadata'
        },
        fields: {
          id: 'Session ID',
          provider: 'Provider',
          when: 'When',
          path: 'Path',
          workspace: 'Workspace',
          cliVersion: 'CLI version',
          originator: 'Originator',
          size: 'File size',
          preview: 'Prompt preview',
          recentPrompts: 'Recent prompts'
        },
        recentPromptsHint: 'Newest useful user prompts first.',
        metadataHint: 'Path stays here so the main table can stay readable.',
        promptCount: '{count} prompts'
      },
      backups: {
        eyebrow: 'Backups',
        title: 'Rollback points',
        empty: 'No backup snapshots yet. The first migration will create one automatically.',
        restore: 'Restore',
        createdAt: 'Created at',
        sourceProvider: 'Source provider',
        targetProvider: 'Target provider',
        reason: 'Reason',
        path: 'Backup path'
      },
      doctor: {
        eyebrow: 'Doctor',
        title: 'Storage health',
        health: 'Health',
        invalidMeta: 'Invalid meta',
        missingProvider: 'Missing provider',
        workspaceReady: 'Workspace-ready',
        missingWorkspace: 'Missing workspace',
        duplicateIds: 'Duplicate ids',
        missingThreads: 'Missing SQLite threads',
        providerMismatches: 'Provider mismatches',
        missingSessionIndex: 'Missing session_index',
        scannedFiles: 'Scanned files',
        repair: 'Repair indexes',
        range: 'Range',
        calloutTitle: 'Repair recommended',
        calloutTitleHealthy: 'Indexes look healthy',
        calloutMissingSessionIndex: '{count} sessions are missing session_index entries. CodexManager may hide them until repair completes.',
        calloutMissingThreads: '{count} sessions are missing SQLite thread rows. Repair will rebuild them from the live JSONL files.',
        calloutProviderMismatch: '{count} sessions have provider mismatches between JSONL and SQLite. Repair will resync them.',
        calloutHealthy: 'SQLite threads and session_index coverage look aligned for the current library.',
        healthy: 'Healthy',
        needsAttention: 'Needs attention',
        empty: 'No structural issues detected in the scanned session set.'
      },
      preview: {
        title: 'Migration preview',
        selected: 'Selected',
        actionable: 'Actionable',
        skipped: 'Already on target',
        backupNote: 'A backup snapshot is created automatically before any real migration.',
        skippedSuffix: '(skip)'
      },
      busy: {
        loadingData: 'Refreshing sessions, backups, and health checks...',
        previewing: 'Preparing a migration preview...',
        migrating: 'Running the migration and writing a safety backup...',
        restoring: 'Restoring files from the selected backup...',
        repairing: 'Repairing SQLite threads and session_index entries...'
      },
      messages: {
        targetRequired: 'Target provider is required.',
        scopeRequiredPreview: 'Select files or add a provider/search filter before previewing a migration.',
        scopeRequiredRun: 'Select files or add a provider/search filter before running a migration.',
        copiedValue: '{field} copied.',
        copyFailed: 'Could not copy that value.',
        previewReady: 'Preview ready for {count} sessions.',
        migrationFinished: 'Migration finished. {migrated} migrated, {skipped} skipped, {failed} failed.{backupSuffix}',
        restoreFinished: 'Restore finished. {restored} restored, {failed} failed.{backupSuffix}',
        repairFinished: 'Repair finished. {insertedThreads} threads inserted, {updatedThreads} rows updated, {addedSessionIndexEntries} session_index entries added, {failed} failed.',
        migrationConfirm: 'Run migration for {scope} to "{target}"?',
        restoreConfirm: 'Restore sessions from backup "{backup}"?',
        repairConfirm: 'Repair missing SQLite and session_index records for the current session library?',
        sessionLoadFailed: 'Could not load the selected session.',
        genericFailed: 'Something went wrong. Please try again.'
      }
    }
  },
  'zh-CN': {
    locales: {
      en: 'English',
      'zh-CN': '简体中文'
    },
    errors: {
      requestBodyJson: '请求体必须是合法的 JSON。',
      sessionFilePathRequired: '必须提供会话文件路径。',
      pathOutsideSessionsDir: '路径不在 sessions 目录内：{path}',
      sessionFileNotFound: '未找到会话文件：{path}',
      providerNameRequired: '必须提供 provider 名称。',
      providerNameInvalid: 'provider 名称只能包含字母、数字、点号、下划线或短横线。',
      fullLibraryRefused: '拒绝在没有明确筛选条件的情况下操作整个会话库。请使用 --all 或先选择文件。',
      backupDirRequired: '必须提供备份目录或备份 ID。',
      targetProviderRequired: '必须提供 targetProvider。',
      backupIdentifierRequired: '必须提供 backupDir 或 backupId。',
      sessionNotFound: '未找到会话，或无法解析其中的 session_meta。',
      sessionFileEmpty: '会话文件为空。',
      firstLineInvalidJson: '第一行不是合法 JSON。',
      firstLineNotSessionMeta: '第一行不是 session_meta 记录。',
      backupManifestMissing: '未找到备份清单：{path}',
      missingQueryPath: '缺少必需的查询参数：path'
    },
    doctor: {
      invalidMeta: '第一条 JSONL 记录缺失，或无法解析为 session_meta。',
      missingProvider: 'session_meta 负载中缺少 model_provider。',
      missingWorkspace: '该会话无法提供可用的工作区路径，因此 CodexManager 可能不会显示它。',
      duplicateId: '检测到重复的 session id，首次出现于 {path}。',
      missingThread: '会话文件存在，但 SQLite 的 threads 表中缺少对应记录。',
      providerMismatch: '会话文件中的 provider 与 SQLite threads 中的 provider 不一致。',
      missingSessionIndex: '会话文件存在，但 session_index 中缺少对应条目。'
    },
    cli: {
      help: {
        title: 'Codex Session Migrator',
        usage: '用法：',
        usageValue: '  codex-migrate <command> [options]',
        commands: '命令：',
        commonFlags: '通用参数：',
        examples: '示例：',
        commandServe: '  serve      启动本地 Web 界面',
        commandList: '  list       列出会话',
        commandStats: '  stats      查看 provider 与存储概览',
        commandDoctor: '  doctor     检查无效或可疑的会话文件',
        commandBackups: '  backups    列出备份快照',
        commandMigrate: '  migrate    将会话重新标记到新的 provider',
        commandRepair: '  repair     重建缺失的 SQLite / session_index 索引',
        commandRestore: '  restore    从备份快照恢复会话',
        flagSessionsDir: '  --sessions-dir <path>   指定 Codex sessions 目录',
        flagJson: '  --json                  以 JSON 输出（支持时）',
        flagAll: '  --all                   在无筛选时允许操作整个会话库',
        flagLang: '  --lang <locale>         选择 CLI 语言（en 或 zh-CN）',
        exampleServe: '  codex-migrate serve --open',
        exampleList: '  codex-migrate list --provider openai --limit 20',
        exampleMigrate: '  codex-migrate migrate --provider openai --target crs --dry-run',
        exampleRepair: '  codex-migrate repair',
        exampleRestore: '  codex-migrate restore --backup 20260328180102-migration-ab12cd --yes'
      },
      labels: {
        sessionsDirectory: '会话目录',
        language: '语言',
        totalMatching: '匹配总数',
        sessions: '会话数',
        providers: 'Provider 数',
        backups: '备份数',
        diskUsage: '磁盘占用',
        latestSession: '最新会话',
        healthy: '健康状态',
        invalidMetaFiles: '无效 meta 文件',
        missingProvider: '缺少 provider',
        missingWorkspace: '缺少工作区',
        duplicateIds: '重复 ID',
        missingThreads: '缺少 SQLite 线程索引',
        providerMismatches: 'Provider 不一致',
        missingSessionIndex: '缺少 session_index',
        range: '时间范围',
        noBackups: '尚未发现备份。',
        selectedSessions: '选中的会话',
        actionable: '可执行项',
        skipped: '跳过项',
        targetProvider: '目标 Provider',
        migrated: '已迁移',
        failed: '失败',
        backup: '备份',
        restored: '已恢复',
        preRestoreBackup: '恢复前安全备份',
        scanned: '扫描数量',
        insertedThreads: '新增线程记录',
        updatedIndexes: '更新线程记录',
        addedSessionIndex: '新增 session_index 条目',
        sessionIndexEntriesWritten: '写入的 session_index 条目',
        sessionIndexBackup: 'session_index 备份'
      },
      status: {
        listening: 'Codex Session Migrator 已启动：{url}',
        cancelled: '已取消。',
        previewReady: '预览已生成'
      },
      confirm: {
        migrate: '确认将 {count} 个会话迁移到 “{provider}” 吗？',
        restore: '确认从 “{backup}” 恢复会话吗？'
      },
      errors: {
        targetRequired: '执行 migrate 时必须提供 --target。',
        backupRequired: '执行 restore 时必须提供 --backup。'
      },
      table: {
        noSessions: '当前筛选条件下没有匹配的会话。',
        unknown: '未知',
        plan: '[计划]',
        skip: '[跳过]',
        done: '[完成]',
        fail: '[失败]'
      },
      backupsLine: '{backupId} | {createdAt} | {entryCount} 个文件 | {label}'
    },
    web: {
      pageTitle: 'Codex Session Migrator',
      pageDescription: '查看、迁移、备份并恢复不同 model provider 下的 Codex 会话。',
      common: {
        loading: '加载中...',
        unknown: '未知',
        none: '无',
        close: '关闭',
        copy: '复制',
        latest: '最新',
        earlier: '更早',
        expand: '展开',
        collapse: '收起',
        morePrompts: '还有 {count} 条',
        backup: '备份',
        preRestoreBackup: '恢复前安全备份',
        noPreview: '暂无预览',
        allProviders: '全部 Provider（{count}）',
        providerCount: '{name}（{count}）',
        explicitSelection: '显式文件选择',
        currentFilters: '当前筛选条件',
        filesCount: '{count} 个文件',
        scannedRange: '{start} → {end}'
      },
      hero: {
        eyebrow: 'Codex Session Migrator',
        title: '在不同 provider 之间迁移 Codex 历史，不打乱你的归档。',
        text: '这是一个本地优先的 Codex Desktop 会话迁移控制台。你可以查看 provider 分布、批量重写会话标签、生成备份快照，并基于清单安全恢复历史记录。',
        sessionsDir: '会话目录',
        latestSession: '最新会话',
        language: '语言',
        actions: {
          refresh: '刷新',
          selectPage: '选择本页',
          clear: '清空选择'
        }
      },
      overview: {
        eyebrow: '概览',
        title: '当前占用情况',
        sessions: '会话数',
        providers: 'Provider 数',
        backups: '备份数',
        diskUsage: '磁盘占用'
      },
      selection: {
        eyebrow: '选择',
        title: '筛选并排队迁移',
        provider: 'Provider',
        search: '搜索',
        searchPlaceholder: '按路径、provider、cwd 或首条提示词搜索',
        pageSize: '每页数量',
        apply: '应用',
        reset: '重置',
        targetProvider: '目标 Provider',
        targetPlaceholder: 'crs / openai / fizzlycode / custom-provider',
        targetHint: '提示：现有 provider 名称会出现在建议列表中。',
        preview: '预览',
        run: '执行迁移',
        selectionMode: '选择模式',
        selectedFiles: '已选文件',
        matchingTotal: '匹配总数'
      },
      sessions: {
        eyebrow: '会话',
        title: '按 Provider 标记的历史',
        previous: '上一页',
        next: '下一页',
        pageStatus: '第 {page} / {totalPages} 页',
        selectPageAria: '选择本页全部行',
        openDetailsAria: '打开会话 {id} 的详情',
        table: {
          provider: 'Provider',
          when: '时间',
          path: '相对路径',
          workspace: '工作目录',
          promptPreview: '提示词预览'
        },
        empty: '当前筛选条件下没有匹配的会话。'
      },
      detail: {
        eyebrow: '检查器',
        title: '会话详情',
        emptyTitle: '请选择一个会话',
        emptyText: '点击任意一行，即可在迁移或恢复前检查完整元数据。',
        loading: '正在加载会话详情...',
        sections: {
          metadata: '元数据'
        },
        fields: {
          id: '会话 ID',
          provider: 'Provider',
          when: '时间',
          path: '路径',
          workspace: '工作目录',
          cliVersion: 'CLI 版本',
          originator: '来源',
          size: '文件大小',
          preview: '提示词预览',
          recentPrompts: '最近的提示词'
        },
        recentPromptsHint: '按时间倒序，仅保留真正有用的用户提示。',
        metadataHint: '路径只保留在这里，这样主表会更干净。',
        promptCount: '{count} 条提示词'
      },
      backups: {
        eyebrow: '备份',
        title: '可回滚时间点',
        empty: '暂时还没有备份快照。首次执行迁移时会自动创建。',
        restore: '恢复',
        createdAt: '创建时间',
        sourceProvider: '来源 Provider',
        targetProvider: '目标 Provider',
        reason: '原因',
        path: '备份路径'
      },
      doctor: {
        eyebrow: 'Doctor',
        title: '存储健康度',
        health: '健康状态',
        invalidMeta: '无效 Meta',
        missingProvider: '缺少 Provider',
        workspaceReady: '具备工作区路径',
        missingWorkspace: '缺少工作区',
        duplicateIds: '重复 ID',
        missingThreads: '缺少 SQLite 线程索引',
        providerMismatches: 'Provider 不一致',
        missingSessionIndex: '缺少 session_index',
        scannedFiles: '扫描文件数',
        repair: '修复索引',
        range: '时间范围',
        calloutTitle: '建议立即修复',
        calloutTitleHealthy: '索引状态正常',
        calloutMissingSessionIndex: '有 {count} 个会话缺少 session_index 条目。CodexManager 可能会直接把它们隐藏，直到修复完成。',
        calloutMissingThreads: '有 {count} 个会话缺少 SQLite threads 记录。修复会根据现有 JSONL 重建这些记录。',
        calloutProviderMismatch: '有 {count} 个会话的 JSONL provider 与 SQLite provider 不一致。修复会重新同步。',
        calloutHealthy: '当前会话库的 SQLite threads 和 session_index 覆盖情况看起来是一致的。',
        healthy: '健康',
        needsAttention: '需要关注',
        empty: '扫描到的会话集合中没有发现结构性问题。'
      },
      preview: {
        title: '迁移预览',
        selected: '已选',
        actionable: '可执行',
        skipped: '已在目标上',
        backupNote: '执行真实迁移前，系统会自动创建备份快照。',
        skippedSuffix: '（跳过）'
      },
      busy: {
        loadingData: '正在刷新会话、备份和健康检查...',
        previewing: '正在准备迁移预览...',
        migrating: '正在执行迁移并写入安全备份...',
        restoring: '正在从所选备份恢复文件...',
        repairing: '正在修复 SQLite threads 和 session_index 索引...'
      },
      messages: {
        targetRequired: '必须填写目标 Provider。',
        scopeRequiredPreview: '预览迁移前，请先选择文件，或添加 provider / 搜索筛选条件。',
        scopeRequiredRun: '执行迁移前，请先选择文件，或添加 provider / 搜索筛选条件。',
        copiedValue: '已复制{field}。',
        copyFailed: '复制失败，请重试。',
        previewReady: '已为 {count} 个会话生成预览。',
        migrationFinished: '迁移完成：{migrated} 个已迁移，{skipped} 个已跳过，{failed} 个失败。{backupSuffix}',
        restoreFinished: '恢复完成：{restored} 个已恢复，{failed} 个失败。{backupSuffix}',
        repairFinished: '修复完成：新增 {insertedThreads} 条线程记录，更新 {updatedThreads} 条线程记录，新增 {addedSessionIndexEntries} 条 session_index，失败 {failed} 条。',
        migrationConfirm: '确认将 {scope} 迁移到 “{target}” 吗？',
        restoreConfirm: '确认从备份 “{backup}” 恢复会话吗？',
        repairConfirm: '确认修复当前会话库缺失的 SQLite 与 session_index 索引吗？',
        sessionLoadFailed: '无法加载所选会话。',
        genericFailed: '发生了一点问题，请重试。'
      }
    }
  }
};

function getByPath(object, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current && current[key] !== undefined ? current[key] : undefined), object);
}

function interpolate(template, values = {}) {
  return String(template).replace(/\{([^}]+)\}/g, (match, key) => {
    return values[key] === undefined || values[key] === null ? match : String(values[key]);
  });
}

function normalizeLocale(input) {
  const value = String(input || '').trim();
  if (!value) {
    return 'en';
  }

  const lowered = value.toLowerCase();
  if (lowered.startsWith('zh')) {
    return 'zh-CN';
  }
  if (lowered.startsWith('en')) {
    return 'en';
  }

  return SUPPORTED_LOCALES.includes(value) ? value : 'en';
}

function parseAcceptLanguage(headerValue) {
  if (!headerValue) {
    return '';
  }

  return String(headerValue)
    .split(',')
    .map((token) => token.trim().split(';')[0])
    .find(Boolean) || '';
}

function resolveLocale(...candidates) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (Array.isArray(candidate)) {
      const nested = resolveLocale(...candidate);
      if (nested) {
        return nested;
      }
      continue;
    }

    const locale = normalizeLocale(candidate);
    if (locale) {
      return locale;
    }
  }

  return 'en';
}

function translate(locale, key, values) {
  const safeLocale = normalizeLocale(locale);
  const template = getByPath(dictionaries[safeLocale], key) ?? getByPath(dictionaries.en, key) ?? key;
  return typeof template === 'string' ? interpolate(template, values) : template;
}

function createTranslator(locale) {
  const safeLocale = normalizeLocale(locale);

  return {
    locale: safeLocale,
    t(key, values) {
      return translate(safeLocale, key, values);
    }
  };
}

function getClientMessages(locale) {
  const safeLocale = normalizeLocale(locale);
  return JSON.parse(JSON.stringify(dictionaries[safeLocale].web));
}

function getLocaleOptions(locale) {
  const safeLocale = normalizeLocale(locale);
  return SUPPORTED_LOCALES.map((code) => ({
    code,
    label: translate(safeLocale, `locales.${code}`)
  }));
}

module.exports = {
  SUPPORTED_LOCALES,
  createTranslator,
  getClientMessages,
  getLocaleOptions,
  normalizeLocale,
  parseAcceptLanguage,
  resolveLocale,
  translate
};
