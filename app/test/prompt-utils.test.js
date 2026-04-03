'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFallbackThreadTitle,
  extractUserInputText,
  sanitizeUserPrompt,
  summarizeThreadTitle
} = require('../src/prompt-utils');

test('extractUserInputText reads nested response_item user messages', () => {
  const text = extractUserInputText({
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: '<environment_context>\n  <cwd>C:\\Users\\Yanzh\\Desktop</cwd>\n</environment_context>' },
        { type: 'input_text', text: '请修复迁移后的线程标题显示问题。' }
      ]
    }
  });

  assert.match(text, /请修复迁移后的线程标题显示问题/);
});

test('extractUserInputText reads compacted replacement history user messages', () => {
  const text = extractUserInputText({
    type: 'compacted',
    payload: {
      replacement_history: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'ignored' }]
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '请继续修复。' }]
        }
      ]
    }
  });

  assert.equal(text, '请继续修复。');
});

test('sanitizeUserPrompt drops pure environment-only prompts', () => {
  const cleaned = sanitizeUserPrompt(
    '<environment_context>\n  <cwd>C:\\Users\\Yanzh\\Desktop</cwd>\n  <shell>powershell</shell>\n</environment_context>'
  );

  assert.equal(cleaned, null);
});

test('summarizeThreadTitle keeps only useful prompt content', () => {
  const title = summarizeThreadTitle(
    '<environment_context>\n  <cwd>C:\\Users\\Yanzh\\Desktop</cwd>\n</environment_context>\n\n请修复迁移后的线程标题显示问题。'
  );

  assert.equal(title, '修复迁移后的线程标题显示问题。');
});

test('summarizeThreadTitle rewrites raw project questions into natural titles', () => {
  const title = summarizeThreadTitle('"C:\\Users\\Yanzh\\Desktop\\codex-session-migrator"是一个什么项目？');

  assert.equal(title, 'codex-session-migrator 项目分析');
});

test('summarizeThreadTitle compresses single file audit prompts into domain-aware titles', () => {
  const title = summarizeThreadTitle(
    '你负责仅审核并直接修改 `docs/机器学习/25-核心理论.md`。要求：1）逐段人工审查；2）重点检查 ERM、泛化误差、偏差方差、VC 维、PAC、正则化、核方法、统计学习理论等数学表述。'
  );

  assert.equal(title, '机器学习：核心理论 审核与修订');
});

test('summarizeThreadTitle strips trailing audit action phrases after file paths', () => {
  const title = summarizeThreadTitle(
    '你负责仅审核并直接修改 `docs/深度学习/01-基础/06-正则化技术.md` 做最终一轮人工精审。要求：1）逐段人工审查；2）重点检查 L1/L2、Dropout、BN/LN、权重初始化、数据增强。'
  );

  assert.equal(title, '深度学习：正则化技术 审核与修订');
});

test('summarizeThreadTitle rewrites task-planning prompts with file lists into semantic titles', () => {
  const title = summarizeThreadTitle(
    '请你查看meeting3月19日.md、meeting_task_summary.md、unsee文件夹、dataset文件夹并分析研究我的任务是什么？然后再研究分析结合我的进展。接下来我要做什么？'
  );

  assert.equal(title, '任务梳理与下一步规划');
});

test('summarizeThreadTitle rewrites benchmark difficulty prompts into concise titles', () => {
  const title = summarizeThreadTitle(
    '现在上下文无关的benchmark测评gpt5，gpt5的准确率很高，我们需要增加我们benchmark的难度，使得gpt5在我们上下文无关的benchmark上得分不超过85%，开始前请你查看PROMPTS_FOR_NEW_CHATS_PART_A_HANDOFF.md。'
  );

  assert.equal(title, '提升上下文无关 Benchmark 难度');
});

test('summarizeThreadTitle rewrites exception description review prompts into semantic titles', () => {
  const title = summarizeThreadTitle(
    '汇报\\\\任务1\\\\final\\\\上下文无关_异常分类描述.md、汇报\\\\任务1\\\\final\\\\上下文相关_异常分类描述.md中异常的中文描述正确吗？我是要发给写论文的学长的，请你再详细一点。'
  );

  assert.equal(title, '异常分类中文描述复核');
});

test('summarizeThreadTitle rewrites plan comparison prompts into concise titles', () => {
  const title = summarizeThreadTitle('这个项目的几个plan.md你觉得哪个最好？');

  assert.equal(title, '项目计划方案对比');
});

test('summarizeThreadTitle compresses takeover prompts into project-focused titles', () => {
  const title = summarizeThreadTitle(
    '请接管我这套 OpenClaw 项目，继续完成所有剩余工作，目标是：先做全面的信息搜集、分析、研究、思考，再执行必要的升级、适配、调试、优化、测试和验收。'
  );

  assert.equal(title, 'OpenClaw 项目接管与优化');
});

test('summarizeThreadTitle prefers topic labels for multi-file audit prompts', () => {
  const title = summarizeThreadTitle(
    '你负责人工逐篇审核并直接修改以下强化学习基础与入口文档，禁止用自动化批量改写；要像认真学习者一样逐文阅读并做外科式修订。目标：提高数学/理论严谨性。只修改以下文件：\n1) docs/强化学习/README.md\n2) docs/强化学习/00-学习指南.md'
  );

  assert.equal(title, '强化学习文档 审核与修订');
});

test('buildFallbackThreadTitle uses workspace and timestamp when no useful prompt exists', () => {
  const title = buildFallbackThreadTitle({
    existingTitle: '<environment_context>\n  <cwd>C:\\Users\\Yanzh\\Desktop\\benchmark_iot</cwd>\n</environment_context>',
    cwd: 'C:\\Users\\Yanzh\\Desktop\\benchmark_iot',
    timestamp: '2025-12-13T19:42:04.997Z',
    sessionId: '019b193c-0ec5-7c73-8a91-a5b9115d2dac',
    filePath: 'C:\\Users\\Yanzh\\.codex\\sessions\\2025\\12\\14\\rollout-2025-12-14T03-42-04-019b193c-0ec5-7c73-8a91-a5b9115d2dac.jsonl'
  });

  assert.equal(title, 'benchmark_iot | 2025-12-13 19:42');
});
