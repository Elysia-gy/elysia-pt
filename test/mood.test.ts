import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MOOD_BASELINE,
  applyDelta,
  createMood,
  dateKey,
  decayMood,
  dominantEmotion,
  moodLabel,
  moodPromptLine,
  parseMoodDelta,
  takeInjectSlot,
} from '../src/mood.ts';

const HOUR = 3_600_000;

test('新心情从基线 70 开始，七维全 0', () => {
  const mood = createMood(1_000);
  assert.equal(mood.mood, MOOD_BASELINE);
  assert.deepEqual(Object.values(mood.dims), [0, 0, 0, 0, 0, 0, 0]);
});

test('moodDelta 除以 3 才落到基子上', () => {
  const mood = createMood(1_000);
  const outcome = applyDelta(mood, { moodDelta: 9, dims: { happy: 6 }, confidence: 90 }, 1_000);
  assert.equal(outcome.state.mood, MOOD_BASELINE + 3);
  assert.equal(outcome.state.dims.happy, 6);
  assert.equal(outcome.significant, true);
});

test('小变化不算 significant，也不该记一笔', () => {
  const mood = createMood(1_000);
  const outcome = applyDelta(mood, { moodDelta: 3, dims: { calm: 1 }, confidence: 70 }, 1_000);
  assert.equal(outcome.significant, false);
});

test('底子被夹在 0–100', () => {
  const mood = { ...createMood(0), mood: 99 };
  const outcome = applyDelta(mood, { moodDelta: 10, dims: {}, confidence: 80 }, 0);
  assert.equal(outcome.state.mood, 100);
});

test('12 小时后底子向基线回落一半', () => {
  const mood = { ...createMood(0), mood: 100, lastDecayAt: 0 };
  const decayed = decayMood(mood, 12 * HOUR);
  assert.equal(Math.round(decayed.mood), 85);
});

test('衰减是幂等的：同一时刻再调一次不变', () => {
  const mood = { ...createMood(0), mood: 90, lastDecayAt: 0 };
  const once = decayMood(mood, 6 * HOUR);
  const twice = decayMood(once, 6 * HOUR);
  assert.equal(once.mood, twice.mood);
});

test('每天注入额度满了就不再说，跨天自动清零', () => {
  const nowMs = Date.now();
  const mood = { ...createMood(nowMs), injectedDate: dateKey(nowMs), injectedToday: 6 };
  const same = takeInjectSlot(mood, nowMs);
  assert.equal(same.allowed, false);
  const nextDay = takeInjectSlot(mood, nowMs + 26 * HOUR);
  assert.equal(nextDay.allowed, true);
});

test('解析模型 JSON 时容忍围栏与缺字段', () => {
  const parsed = parseMoodDelta('```json\n{"moodDelta": 6, "dims": {"happy": 4}, "confidence": 80, "reason": "被夸了"}\n```');
  assert.ok(parsed);
  assert.equal(parsed.moodDelta, 6);
  assert.equal(parsed.dims.happy, 4);
  assert.equal(parsed.reason, '被夸了');
  assert.equal(parseMoodDelta('不是 JSON'), undefined);
});

test('基调与提示词行按阈值走', () => {
  assert.equal(moodLabel(85), '欢喜');
  assert.equal(moodLabel(50), '一般');
  assert.equal(moodLabel(10), '难过');
  const mood = { ...createMood(0), dims: { sweet: 9 } };
  assert.equal(dominantEmotion(mood), 'sweet');
  assert.match(moodPromptLine(mood), /甜蜜/);
});
