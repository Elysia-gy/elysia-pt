import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addTurn,
  buildRecallBlock,
  consolidate,
  createMemory,
  extractFacts,
  mergeFacts,
  normalizeQuery,
  recall,
  slotIntent,
  tokenize,
  type MemoryState,
} from '../src/memory.ts';

test('中文按二元组切词，虚词被丢掉', () => {
  const terms = tokenize('深圳天气不错');
  assert.ok(terms.includes('深圳'));
  assert.ok(terms.includes('天气'));
  assert.ok(!tokenize('今天天气怎么样').includes('怎么'));
});

test('查询里的人称归一成「主人」', () => {
  assert.equal(normalizeQuery('你还记得我叫什么吗'), '你还记得主人叫什么吗');
});

test('问句能识别出槽位意图', () => {
  assert.equal(slotIntent('你还记得我叫什么吗'), 'name');
  assert.equal(slotIntent('我几岁了'), 'age');
  assert.equal(slotIntent('今天吃什么'), undefined);
});

test('身份事实常驻：「我叫什么」不必字面命中「主人叫小明」', () => {
  const base = createMemory();
  const withFacts = mergeFacts(
    base,
    [
      { id: 'f1', text: '主人叫小明', slot: 'name', value: '小明', at: 1 },
      { id: 'f2', text: '主人喜欢打篮球', slot: 'like', value: '打篮球', at: 1 },
    ],
    1,
  );
  const result = recall(withFacts, '你还记得我叫什么吗');
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0]?.text, '主人叫小明');
});

test('不相关的稀有事实不会被硬塞进召回', () => {
  const withFacts = mergeFacts(
    createMemory(),
    [{ id: 'f1', text: '主人喜欢打篮球', slot: 'like', value: '打篮球', at: 1 }],
    1,
  );
  const result = recall(withFacts, '帮我看看这段代码为什么报错');
  assert.equal(result.facts.length, 0);
});

test('独占槽只留最新一条', () => {
  const merged = mergeFacts(
    createMemory(),
    [
      { id: 'a', text: '主人叫小明', slot: 'name', value: '小明', at: 1 },
      { id: 'b', text: '主人叫小红', slot: 'name', value: '小红', at: 2 },
    ],
    2,
  );
  assert.equal(merged.facts.length, 1);
  assert.equal(merged.facts[0]?.text, '主人叫小红');
});

test('确定性规则能抓名字、年龄、喜好', () => {
  const now = 1_700_000_000_000;
  const facts = extractFacts('我叫小明，我今年21岁，我喜欢打篮球', now);
  const slots = facts.map((fact) => fact.slot);
  assert.ok(slots.includes('name'));
  assert.ok(slots.includes('age'));
  assert.ok(slots.includes('like'));
  assert.ok(facts.some((fact) => fact.text === '主人叫小明'));
});

test('工作记忆超过 12 条时折成情节，摘要跟着更新', () => {
  let memory: MemoryState = createMemory();
  for (let index = 0; index < 20; index++) {
    memory = addTurn(memory, index % 2 === 0 ? 'user' : 'assistant', '第' + index + '句话', index);
  }
  const folded = consolidate(memory, { turns: memory.turns, at: 1_000 });
  assert.equal(folded.turns.length, 12);
  assert.equal(folded.episodes.length, 1);
  assert.ok((folded.episodes[0]?.full ?? '').includes('第0句话'));
});

test('召回块按段拼，空召回回空串', () => {
  assert.equal(buildRecallBlock({ facts: [], episodes: [], summary: '' }), '');
  const block = buildRecallBlock({
    facts: [{ id: 'f', text: '主人叫小明', slot: 'name', value: '小明', at: 1 }],
    episodes: [{ id: 'e', sum: '聊过天气', full: '聊过天气', at: 1 }],
    summary: '他在做一个桌宠项目',
  });
  assert.match(block, /关于主人/);
  assert.match(block, /聊到过的事/);
  assert.match(block, /早先的印象/);
});
