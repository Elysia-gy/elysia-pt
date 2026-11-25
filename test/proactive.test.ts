import assert from 'node:assert/strict';
import test from 'node:test';
import { inQuietHours, reasonText, shouldSpeak, type ProactiveInput } from '../src/proactive.ts';

/** 本地时间某天某点，避免用 UTC 字符串造成时区漂移。 */
function at(hour: number, minute = 0): number {
  return new Date(2026, 10, 24, hour, minute, 0, 0).getTime();
}

function baseInput(overrides: Partial<ProactiveInput> = {}): ProactiveInput {
  return {
    enabled: true,
    nowMs: at(15),
    lastUserAtMs: at(9),
    spokenToday: 0,
    quietStartHour: 23,
    quietEndHour: 8,
    minGapMin: 45,
    dailyMax: 4,
    chance: 0.55,
    randomValue: 0.3,
    ...overrides,
  };
}

test('安静时段跨零点：凌晨 2 点算安静，下午 3 点不算', () => {
  assert.equal(inQuietHours(at(2), 23, 8), true);
  assert.equal(inQuietHours(at(15), 23, 8), false);
  assert.equal(inQuietHours(at(23), 23, 8), true);
});

test('开关关掉时任何条件都不开口', () => {
  assert.equal(shouldSpeak(baseInput({ enabled: false })).reason, 'disabled');
});

test('安静时段内不开口', () => {
  assert.equal(shouldSpeak(baseInput({ nowMs: at(3) })).reason, 'quiet');
});

test('刚聊完不开口', () => {
  const nowMs = at(15);
  assert.equal(shouldSpeak(baseInput({ nowMs, lastUserAtMs: nowMs - 10 * 60_000 })).reason, 'no-gap');
});

test('每天条数到上限就不再说', () => {
  assert.equal(shouldSpeak(baseInput({ spokenToday: 4 })).reason, 'daily-max');
});

test('抽签没中就不说，中了才说', () => {
  assert.equal(shouldSpeak(baseInput({ randomValue: 0.9 })).reason, 'chance');
  assert.equal(shouldSpeak(baseInput({ randomValue: 0.1 })).ok, true);
});

test('五道闸门全过才 ok，且理由可读', () => {
  const decision = shouldSpeak(baseInput());
  assert.equal(decision.ok, true);
  assert.equal(decision.reason, 'ok');
  assert.equal(reasonText('daily-max'), '今天已经说够啦');
});
