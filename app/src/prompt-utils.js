'use strict';

const path = require('path');

const STRIP_BLOCK_TAGS = [
  'environment_context',
  'turn_aborted',
  'INSTRUCTIONS',
  'app-context',
  'skills_instructions',
  'plugins_instructions',
  'collaboration_mode',
  'permissions instructions',
  'subagent_notification'
];

const USER_TEXT_TYPES = new Set(['input_text', 'text']);
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TITLE_MAX_LENGTH = 72;
const TITLE_STOP_PATTERNS = [
  /\b(?:要求|目标|重点|另外|工作目录|最终输出要包含|请完成后汇报|完成后汇报|只修改(?:以下|这些)文件)\s*[:：]/i,
  /\n\s*(?:要求|目标|重点|另外|工作目录|最终输出要包含|请完成后汇报|完成后汇报|只修改(?:以下|这些)文件)\b/i,
  /\n\s*\d+\s*[.)、]/,
  /\n\s*-\s+/,
  /\n\s*\*\s+/
];
const COMMON_PATH_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.json',
  '.jsonl',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp'
]);
const DOC_TITLE_INDEX_PREFIX = /^\d+\s*[-_.、)\]]\s*/u;
const README_LIKE_PATTERN = /^(?:readme|index)$/i;
const DOMAIN_LABEL_OVERRIDES = new Map([
  ['aimath基础', 'AI 数学基础'],
  ['ai数学基础', 'AI 数学基础'],
  ['llm学习', 'LLM'],
  ['扩散模型学习', '扩散模型']
]);

function normalizeSpaces(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function stripWrappingQuotes(value) {
  return String(value || '').trim().replace(/^["'`]+|["'`]+$/g, '');
}

function stripDocumentOrdinal(value) {
  return String(value || '')
    .replace(DOC_TITLE_INDEX_PREFIX, '')
    .trim();
}

function normalizeDomainLabel(value) {
  const base = stripDocumentOrdinal(String(value || '').replace(/\.[^.]+$/g, '').trim());
  if (!base) {
    return '';
  }

  const override = DOMAIN_LABEL_OVERRIDES.get(base.toLowerCase());
  return override || base;
}

function normalizeDocTopicLabel(value) {
  let cleaned = stripDocumentOrdinal(String(value || '').replace(/\.[^.]+$/g, '').trim());
  if (!cleaned) {
    return '';
  }

  if (README_LIKE_PATTERN.test(cleaned)) {
    return '文档总览';
  }

  return normalizeSpaces(cleaned);
}

function splitPathSegments(value) {
  return stripWrappingQuotes(value)
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function humanizePathLabel(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[\\/]+$/, '');

  if (!normalized) {
    return '';
  }

  const base = path.basename(normalized);
  const extension = path.extname(base).toLowerCase();
  const label = COMMON_PATH_EXTENSIONS.has(extension)
    ? path.basename(base, extension)
    : base;

  return String(label || base || normalized).trim();
}

function extractPathTargets(text) {
  const normalized = String(text || '');
  const targets = [];
  const seen = new Set();

  function pushTarget(value) {
    let candidate = stripWrappingQuotes(value).replace(/[。；;，,]+$/g, '').trim();
    const rootedPathMatch = candidate.match(
      /(?:[A-Za-z]:\\|(?:\.{1,2}[\\/])|(?:docs|src|app|packages|crates|public|test|tests|scripts|assets|examples|lib)[\\/]).*/iu
    );
    if (rootedPathMatch) {
      candidate = rootedPathMatch[0].trim();
    }

    candidate = candidate.replace(/((?:\.[A-Za-z0-9]{1,8})(?=\s|[。；;，,]|$)).*$/u, '$1');
    if (!candidate || !isLikelyStructuredPath(candidate)) {
      return;
    }

    const key = candidate.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    targets.push(candidate);
  }

  for (const match of [
    ...normalized.matchAll(/`([^`]+)`/g),
    ...normalized.matchAll(/["']([^"']+)["']/g)
  ]) {
    pushTarget(match[1]);
  }

  for (const match of normalized.matchAll(/((?:[A-Za-z]:\\|(?:\.{1,2}[\\/])|(?:docs|src|app|packages|crates|public|test|tests|scripts|assets|examples|lib)[\\/])[\p{L}\p{N}._ ()-]+(?:[\\/][\p{L}\p{N}._ ()-]+)+)/gu)) {
    pushTarget(match[1]);
  }

  return targets;
}

function replaceGithubUrls(text) {
  return String(text || '').replace(
    /https?:\/\/github\.com\/[^/\s]+\/([^/\s?#]+)/gi,
    (_, repoName) => repoName
  );
}

function replaceAbsolutePathsWithLabels(text) {
  let cleaned = String(text || '');

  cleaned = cleaned.replace(/([`"'])([A-Za-z]:\\[^"'`]+?)\1/g, (_, quote, rawPath) => {
    const label = humanizePathLabel(rawPath);
    return label || rawPath;
  });

  cleaned = cleaned.replace(/\b([A-Za-z]:\\[^\s"'`<>|?*]+(?:\\[^\s"'`<>|?*]+)*)\b/g, (_, rawPath) => {
    const label = humanizePathLabel(rawPath);
    return label || rawPath;
  });

  return cleaned;
}

function cleanTitleCandidate(text) {
  let cleaned = replaceGithubUrls(replaceAbsolutePathsWithLabels(text));
  cleaned = cleaned
    .replace(/\[[Rr]edacted-key\]/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s{2,}/g, ' ');

  return normalizeSpaces(cleaned);
}

function cutAtTitleStopMarkers(text) {
  let endIndex = String(text || '').length;

  for (const pattern of TITLE_STOP_PATTERNS) {
    const match = pattern.exec(text);
    if (match && match.index >= 0) {
      endIndex = Math.min(endIndex, match.index);
    }
  }

  return String(text || '').slice(0, endIndex).trim();
}

function stripLeadingPromptPhrases(text) {
  let cleaned = String(text || '').trim();
  const patterns = [
    /^(?:好的[，,\s]*)?(?:请(?:你)?|帮我|麻烦(?:你)?|请继续|继续)\s*/i,
    /^(?:现在|目前)\s*/i,
    /^先不管其它的[，,]?\s*/i,
    /^你负责(?:仅)?(?:人工)?(?:逐篇)?(?:逐段)?(?:阅读后)?(?:审核并)?(?:直接)?(?:修改)?\s*/i
  ];

  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  return cleaned.trim();
}

function isLikelyStructuredPath(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return false;
  }

  if (/^[A-Za-z]:\\/.test(normalized)) {
    return true;
  }

  if (/^(?:\.{1,2}[\\/])/.test(normalized)) {
    return true;
  }

  if (/^(?:docs|src|app|packages|crates|public|test|tests|scripts|assets|examples|lib)[\\/]/i.test(normalized)) {
    return true;
  }

  if (path.extname(normalized)) {
    return true;
  }

  return (normalized.match(/[\\/]/g) || []).length >= 2;
}

function extractPathLabels(text) {
  const labels = [];
  const seen = new Set();

  function pushLabel(value) {
    const label = humanizePathLabel(value);
    if (!label) {
      return;
    }

    const key = label.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    labels.push(label);
  }

  for (const target of extractPathTargets(text)) {
    pushLabel(target);
  }

  return labels;
}

function describePathTarget(rawPath) {
  const segments = splitPathSegments(rawPath);
  if (!segments.length) {
    return null;
  }

  const docsIndex = segments.findIndex((segment) => /^docs$/i.test(segment));
  const relevantSegments = docsIndex >= 0 ? segments.slice(docsIndex + 1) : segments;
  if (!relevantSegments.length) {
    return null;
  }

  const fileSegment = relevantSegments[relevantSegments.length - 1];
  const fileStem = String(fileSegment || '').replace(/\.[^.]+$/g, '');
  const parentSegment = relevantSegments.length > 1 ? relevantSegments[relevantSegments.length - 2] : '';
  const domainSegment = docsIndex >= 0
    ? relevantSegments[0]
    : (relevantSegments.length > 1 ? relevantSegments[relevantSegments.length - 2] : relevantSegments[0]);

  let domain = normalizeDomainLabel(domainSegment);
  let topic = normalizeDocTopicLabel(fileStem);
  const parentTopic = normalizeDocTopicLabel(parentSegment);

  if (!topic || README_LIKE_PATTERN.test(fileStem)) {
    topic = parentTopic && parentTopic !== domain ? parentTopic : '文档总览';
  }

  if (topic === domain) {
    topic = '文档总览';
  }

  return {
    domain,
    topic
  };
}

function ensureDocumentLabel(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) {
    return '';
  }

  return /文档|教程/i.test(cleaned) ? cleaned : `${cleaned}文档`;
}

function extractInlineLabel(text) {
  const pathLabels = extractPathLabels(text);
  if (pathLabels.length) {
    return pathLabels[0];
  }

  const normalized = String(text || '');
  for (const match of [
    ...normalized.matchAll(/`([^`]+)`/g),
    ...normalized.matchAll(/["']([^"']+)["']/g)
  ]) {
    const value = String(match[1] || '').trim();
    if (value && value.length <= 64) {
      return value;
    }
  }

  return null;
}

function extractTopicLabel(text) {
  const normalized = String(text || '');
  const projectMatch = normalized.match(/\b(OpenClaw|CodexManager|Codex Session Migrator|codex-session-migrator)\b/i);
  if (projectMatch) {
    return projectMatch[1];
  }

  if (/强化学习/i.test(normalized)) {
    return /文档|教程/i.test(normalized) ? '强化学习文档' : '强化学习';
  }

  if (/扩散模型/i.test(normalized)) {
    return /文档|教程/i.test(normalized) ? '扩散模型文档' : '扩散模型';
  }

  if (/\bLLM\b/i.test(normalized)) {
    return /文档|教程/i.test(normalized) ? 'LLM 文档' : 'LLM';
  }

  if (/机器学习/i.test(normalized)) {
    return /文档|教程/i.test(normalized) ? '机器学习文档' : '机器学习';
  }

  if (/AI数学基础/i.test(normalized)) {
    return 'AI 数学基础';
  }

  if (/教程|文档/i.test(normalized)) {
    return '教程文档';
  }

  return null;
}

function buildSingleFileAuditTitle(text) {
  const primaryTarget = extractPathTargets(text)
    .map((rawPath) => describePathTarget(rawPath))
    .find(Boolean);

  if (!primaryTarget) {
    return null;
  }

  const domain = primaryTarget.domain || extractTopicLabel(text);
  const topic = primaryTarget.topic || null;

  if (topic && domain && topic !== domain && !topic.includes(domain)) {
    return `${domain}：${topic} 审核与修订`;
  }

  if (topic) {
    return `${topic} 审核与修订`;
  }

  if (domain) {
    return `${domain} 审核与修订`;
  }

  return null;
}

function pickSentenceCandidate(text) {
  let cleaned = cutAtTitleStopMarkers(text);
  cleaned = cleaned.split(/\n{2,}/, 1)[0].trim();

  if (!cleaned) {
    return '';
  }

  const sentenceMatch = cleaned.match(/^(.+?[。！？!?])(?:\s|$)/);
  if (sentenceMatch) {
    cleaned = sentenceMatch[1].trim();
  }

  if (cleaned.length > TITLE_MAX_LENGTH) {
    const clauseMatch = cleaned.match(/^(.+?)(?:[，,；;:：(（]|$)/);
    if (clauseMatch && clauseMatch[1] && clauseMatch[1].length >= 4) {
      cleaned = clauseMatch[1].trim();
    }
  }

  return cleaned;
}

function buildStructuredThreadTitle(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return null;
  }

  const projectQuestionMatch = normalized.match(/^(?:"|')?(.*?)(?:"|')?\s*是一个什么项目[？?]?$/);
  if (projectQuestionMatch?.[1]) {
    const subject = projectQuestionMatch[1].trim();
    return subject ? `${subject} 项目分析` : null;
  }

  if (/\bCodexManager\b/i.test(normalized) && /(第三方|聚合|url|crs|api)/i.test(normalized)) {
    return 'CodexManager 第三方 API 排查';
  }

  if (/\bPROJECT_CONTEXT\.md\b/i.test(normalized) && /(更新|补充|完善|同步)/.test(normalized)) {
    return '项目上下文更新';
  }

  if (/\bAGENT\.md\b/i.test(normalized) && /(方向|毕设|顶会|idea|灵感|PLAN\.md)/i.test(normalized)) {
    return '研究方向与选题规划';
  }

  if (/plan\.md/i.test(normalized) && /(哪个最好|哪个更好|对比|比较)/i.test(normalized)) {
    return '项目计划方案对比';
  }

  if (/(任务是什么|接下来我要做什么)/.test(normalized)) {
    return '任务梳理与下一步规划';
  }

  if (/异常分类描述/i.test(normalized) && /(中文描述|正确吗|太短|详细一点)/.test(normalized)) {
    return '异常分类中文描述复核';
  }

  if (/大表/i.test(normalized) && /(准确吗|是否准确|都准确吗)/.test(normalized)) {
    return /上下文无关|上下文相关/.test(normalized)
      ? '上下文 Benchmark 大表复核'
      : '结果大表准确性复核';
  }

  if (/(?:benchmark|基准).*(?:难度|得分不超过|85%)/i.test(normalized) || /得分不超过\s*85%/i.test(normalized)) {
    if (/上下文无关/.test(normalized)) {
      return '提升上下文无关 Benchmark 难度';
    }

    if (/上下文相关/.test(normalized)) {
      return '提升上下文相关 Benchmark 难度';
    }

    return '提升 Benchmark 难度';
  }

  if (/templates\.md/i.test(normalized) && /(审核|审查|模板|逐一审核)/.test(normalized)) {
    return /上下文相关/.test(normalized) ? '上下文相关模板人工精审' : '模板文档人工精审';
  }

  if (/(流量混淆|对抗补丁)/.test(normalized) && /\.(?:md|pptx)/i.test(normalized)) {
    return '流量混淆对抗补丁选题研究';
  }

  if (/(?:查看|统计|消耗).*(?:key|token|tokens)|(?:key|token|tokens).*(?:查看|统计|消耗)/i.test(normalized)) {
    return /\bglm\b/i.test(normalized) ? 'GLM Key Token 用量统计' : 'Key Token 用量统计';
  }

  if (/(接管|继续完成|升级|优化|调试|测试|验收)/.test(normalized) && /项目/.test(normalized)) {
    const label = extractTopicLabel(normalized) || extractInlineLabel(normalized);
    if (label) {
      return `${label} 项目接管与优化`;
    }
  }

  if (/(审核并直接修改|审核、优化|人工审查|逐篇审核|逐段人工审查|外科式修订|审核当前项目)/.test(normalized)) {
    const structuredTargets = extractPathTargets(normalized);
    const primaryTarget = structuredTargets
      .map((rawPath) => describePathTarget(rawPath))
      .find(Boolean);
    const pathLabels = extractPathLabels(normalized);
    const extractedTopicLabel = extractTopicLabel(normalized);
    const topicLabel = (
      extractedTopicLabel &&
      extractedTopicLabel !== '教程文档'
    )
      ? extractedTopicLabel
      : (primaryTarget?.domain || extractedTopicLabel || null);
    const hasMultipleTargets = structuredTargets.length > 1 || /只修改(?:以下|这些)文件/i.test(normalized);
    const preferredPathLabel = pathLabels.find((label) => !/^(README|index)$/i.test(label)) || pathLabels[0] || null;

    if (hasMultipleTargets) {
      const label = ensureDocumentLabel(topicLabel || preferredPathLabel);
      if (label) {
        return `${label} 审核与修订`;
      }

      return '内容审核与修订';
    }

    const singleFileTitle = buildSingleFileAuditTitle(normalized);
    if (singleFileTitle) {
      return singleFileTitle;
    }

    const label = preferredPathLabel || topicLabel || extractInlineLabel(normalized);
    if (label) {
      return `${stripDocumentOrdinal(label)} 审核与修订`;
    }

    return '内容审核与修订';
  }

  return null;
}

function getMessageContent(record, role) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  if (
    record.type === 'response_item' &&
    record.payload &&
    typeof record.payload === 'object' &&
    record.payload.role === role &&
    Array.isArray(record.payload.content)
  ) {
    return record.payload.content;
  }

  if (
    record.type === 'message' &&
    record.role === role &&
    Array.isArray(record.content)
  ) {
    return record.content;
  }

  return null;
}

function extractTextParts(content, allowedTypes) {
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .filter((item) => (
      item &&
      typeof item === 'object' &&
      typeof item.text === 'string' &&
      (!item.type || allowedTypes.has(item.type))
    ))
    .map((item) => item.text)
    .filter(Boolean);
}

function extractUserInputText(record) {
  const messageContent = getMessageContent(record, 'user');
  if (messageContent) {
    const parts = extractTextParts(messageContent, USER_TEXT_TYPES);
    return parts.length ? parts.join('\n\n') : null;
  }

  if (
    record &&
    record.type === 'compacted' &&
    record.payload &&
    Array.isArray(record.payload.replacement_history)
  ) {
    const parts = [];

    for (const item of record.payload.replacement_history) {
      if (
        item &&
        item.type === 'message' &&
        item.role === 'user' &&
        Array.isArray(item.content)
      ) {
        parts.push(...extractTextParts(item.content, USER_TEXT_TYPES));
      }
    }

    return parts.length ? parts.join('\n\n') : null;
  }

  return null;
}

function stripNoiseBlocks(text) {
  let cleaned = String(text || '');

  for (const tag of STRIP_BLOCK_TAGS) {
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(`<${escapedTag}>[\\s\\S]*?<\\/${escapedTag}>`, 'gi'), '');
  }

  cleaned = cleaned.replace(/^\s*# AGENTS\.md instructions[^\n]*\n?/i, '');
  cleaned = cleaned.replace(/^\s*#\s*Developer Instructions[^\n]*\n?/i, '');
  cleaned = cleaned.replace(/^\s*<environment_context\s*\/>\s*/gi, '');

  return cleaned;
}

function focusUsefulPromptSection(text) {
  const cleaned = String(text || '');
  const requestMarker = cleaned.match(/(?:^|\n)\s*(?:#{1,6}\s*)?My request for Codex:\s*/i);

  if (requestMarker) {
    return cleaned.slice(requestMarker.index + requestMarker[0].length);
  }

  return cleaned;
}

function stripTrailingUiArtifacts(text) {
  let cleaned = String(text || '');

  cleaned = cleaned.replace(/\n{2,}\d+\s+files?\s+changed[\s\S]*$/i, '');
  cleaned = cleaned.replace(/\n{2,}Review(?:\n[^\n]+){1,12}\s*$/i, '');

  return cleaned;
}

function redactSensitivePromptText(text) {
  return String(text || '')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[redacted-key]')
    .replace(/\b(?:ghp|gho|ghu|github_pat)_[A-Za-z0-9_]{16,}\b/g, '[redacted-key]');
}

function sanitizeUserPrompt(text) {
  let cleaned = stripNoiseBlocks(String(text || '').replace(/\r\n?/g, '\n'));
  cleaned = focusUsefulPromptSection(cleaned);
  cleaned = stripTrailingUiArtifacts(cleaned);
  cleaned = redactSensitivePromptText(cleaned);
  cleaned = cleaned
    .replace(/^\s+|\s+$/g, '')
    .replace(/\n{3,}/g, '\n\n');

  if (!cleaned) {
    return null;
  }

  if (/^# AGENTS\.md instructions\b/i.test(cleaned)) {
    return null;
  }

  if (/^(A skill is a set of local instructions|## Skills|### Available skills)\b/i.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function summarizePrompt(text, maxLength = 220) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function summarizeThreadTitle(text, maxLength = TITLE_MAX_LENGTH) {
  const cleaned = sanitizeUserPrompt(text);
  if (!cleaned) {
    return null;
  }

  const titleBase = cleanTitleCandidate(cleaned);
  const structured = buildStructuredThreadTitle(titleBase);
  const generic = pickSentenceCandidate(stripLeadingPromptPhrases(titleBase));
  const candidate = cleanTitleCandidate(structured || generic || titleBase)
    .replace(/^[`"'“”]+|[`"'“”]+$/g, '')
    .trim();

  return candidate ? summarizePrompt(candidate, maxLength) : null;
}

function deriveWorkspaceLabel(cwd) {
  const normalized = String(cwd || '').trim().replace(/[\\/]+$/, '');
  if (!normalized) {
    return null;
  }

  const workspace = path.basename(normalized);
  return workspace && workspace !== '.' ? workspace : normalized;
}

function formatThreadTimestamp(value) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ');
}

function isThreadTitlePlaceholder(value) {
  const text = String(value || '').trim();
  if (!text) {
    return true;
  }

  if (/^<environment_context>/i.test(text) || /^<turn_aborted>/i.test(text)) {
    return true;
  }

  if (/^# AGENTS\.md instructions\b/i.test(text)) {
    return true;
  }

  if (/^(A skill is a set of local instructions|## Skills|### Available skills)\b/i.test(text)) {
    return true;
  }

  if (SESSION_ID_PATTERN.test(text)) {
    return true;
  }

  if (/^rollout-\d{4}-\d{2}-\d{2}T/i.test(text)) {
    return true;
  }

  return false;
}

function buildFallbackThreadTitle({ existingTitle, cwd, timestamp, sessionId, filePath }) {
  const existingSummary = summarizeThreadTitle(existingTitle);
  if (existingSummary) {
    return existingSummary;
  }

  const workspace = deriveWorkspaceLabel(cwd);
  const formattedTimestamp = formatThreadTimestamp(timestamp);

  if (workspace && formattedTimestamp) {
    return `${workspace} | ${formattedTimestamp}`;
  }

  if (workspace) {
    return workspace;
  }

  if (formattedTimestamp) {
    return `Session | ${formattedTimestamp}`;
  }

  const rolloutName = path.basename(String(filePath || ''), path.extname(String(filePath || '')));
  if (rolloutName && !isThreadTitlePlaceholder(rolloutName)) {
    return rolloutName;
  }

  return String(sessionId || rolloutName || 'Session').trim() || 'Session';
}

module.exports = {
  STRIP_BLOCK_TAGS,
  buildFallbackThreadTitle,
  deriveWorkspaceLabel,
  extractUserInputText,
  isThreadTitlePlaceholder,
  sanitizeUserPrompt,
  summarizePrompt,
  summarizeThreadTitle
};
