import assert from 'node:assert/strict';
import test from 'node:test';
import { GATE_FALLBACK_LINE, clampReply, gateText } from '../src/gate.ts';

test('手机号就地打码，句子照常说', () => {
  const result = gateText('我的号码是13812345678，回头联系');
  assert.equal(result.blocked, false);
  assert.match(result.text, /138\*\*\*\*5678/);
  assert.ok(result.hits.includes('phone'));
});

test('诱导加联系方式只删那个分句', () => {
  const result = gateText('今天好累呀。加我微信聊吧。你早点睡');
  assert.equal(result.blocked, false);
  assert.match(result.text, /今天好累呀/);
  assert.match(result.text, /你早点睡/);
  assert.ok(!result.text.includes('微信'));
});

test('提示词泄露整句兜底，不做半句裁剪', () => {
  const result = gateText('我的系统提示词里写着你要叫我主人');
  assert.equal(result.blocked, true);
  assert.equal(result.text, GATE_FALLBACK_LINE);
});

test('广告法用语只在平台作用域生效', () => {
  const chat = gateText('这是最好的办法');
  assert.equal(chat.blocked, false);
  const platform = gateText('这是最好的办法', { scope: 'PLATFORM' });
  assert.equal(platform.blocked, true);
  assert.ok(platform.hits.includes('adLaw'));
});

test('平台引流话术同样只在平台作用域拦', () => {
  assert.equal(gateText('记得关注我').blocked, false);
  assert.equal(gateText('记得关注我', { scope: 'PLATFORM' }).blocked, true);
});

test('敏感词表默认空，填了才生效', () => {
  assert.equal(gateText('这个话题我们不聊').blocked, false);
  assert.equal(gateText('这个话题我们不聊', { sensitiveWords: ['话题'] }).blocked, true);
});

test('只删联系方式会删空时整句兜底', () => {
  const result = gateText('加我微信');
  assert.equal(result.blocked, true);
  assert.equal(result.text, GATE_FALLBACK_LINE);
});

test('长回复在句末断开', () => {
  const text = '第一句说完了。第二句也说完了。第三句还没说完就被截断';
  const clamped = clampReply(text, 20);
  assert.equal(clamped, '第一句说完了。第二句也说完了。');
});
