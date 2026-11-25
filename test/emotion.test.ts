import assert from 'node:assert/strict';
import test from 'node:test';
import { EMOTION_IDS, emotionLabel, parseEmotionTag } from '../src/emotion.ts';

test('末尾的合法标签被剥离', () => {
  const parsed = parseEmotionTag('今天的风好舒服呀 ♪ [emotion:happy]');
  assert.equal(parsed.text, '今天的风好舒服呀 ♪');
  assert.equal(parsed.emotion, 'happy');
});

test('中文括号与全角冒号同样认', () => {
  const parsed = parseEmotionTag('唔…才没有很开心呢【情绪：sweet】');
  assert.equal(parsed.text, '唔…才没有很开心呢');
  assert.equal(parsed.emotion, 'sweet');
});

test('白名单以外的标签不剥离，也不猜', () => {
  const raw = '好呀 [emotion:smug]';
  const parsed = parseEmotionTag(raw);
  assert.equal(parsed.text, raw);
  assert.equal(parsed.emotion, undefined);
});

test('正文中间的标签不属于情绪标签', () => {
  const parsed = parseEmotionTag('[emotion:happy] 这句话在最前面');
  assert.equal(parsed.text, '[emotion:happy] 这句话在最前面');
  assert.equal(parsed.emotion, undefined);
});

test('七个 id 与中文展示名一一对上', () => {
  assert.equal(EMOTION_IDS.length, 7);
  assert.equal(emotionLabel('jealous'), '吃醋');
  assert.equal(emotionLabel('unknown'), undefined);
});
