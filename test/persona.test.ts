import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PERSONA, buildSystemPrompt, timeLine } from '../src/persona.ts';

test('没有人设时用内置的爱莉希雅，提示词永不为空', () => {
  const prompt = buildSystemPrompt({ persona: '   ', scene: 'chat', nowMs: 1_700_000_000_000 });
  assert.match(prompt, /爱莉希雅/);
  assert.equal(DEFAULT_PERSONA.startsWith('# 角色'), true);
});

test('自定义人设顶掉内置，但场景后缀仍在', () => {
  const prompt = buildSystemPrompt({ persona: '你是一只安静的猫。', scene: 'chat', nowMs: 1_700_000_000_000 });
  assert.match(prompt, /安静的猫/);
  assert.ok(!prompt.includes('十三英桀'));
  assert.match(prompt, /\[emotion:开心\]/);
});

test('三个场景的后缀互不相同：主动开口不带情绪标签指令', () => {
  const chat = buildSystemPrompt({ scene: 'chat', nowMs: 1_700_000_000_000 });
  const proactive = buildSystemPrompt({ scene: 'proactive', nowMs: 1_700_000_000_000 });
  const thought = buildSystemPrompt({ scene: 'thought', nowMs: 1_700_000_000_000 });
  assert.match(chat, /这次是对话/);
  assert.match(proactive, /这次是主动开口/);
  assert.ok(!proactive.includes('[emotion:开心]'));
  assert.match(thought, /这次是独处/);
});

test('记忆段只在给了内容时出现', () => {
  const without = buildSystemPrompt({ scene: 'chat', nowMs: 1_700_000_000_000 });
  assert.ok(!without.includes('关于主人'));
  const withMemory = buildSystemPrompt({
    scene: 'chat',
    nowMs: 1_700_000_000_000,
    recallBlock: '【关于主人】主人叫小明',
  });
  assert.match(withMemory, /【关于主人】主人叫小明/);
});

test('心情行进提示词', () => {
  const prompt = buildSystemPrompt({ scene: 'chat', nowMs: 1_700_000_000_000, moodLine: '此刻的心情：开心。' });
  assert.match(prompt, /此刻的心情：开心/);
});

test('时间行包含日期与时段', () => {
  const line = timeLine(new Date(2026, 10, 24, 15, 30).getTime());
  assert.match(line, /2026年11月24日/);
  assert.match(line, /下午/);
});
