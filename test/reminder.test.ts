/**
 * 提醒解析的纯逻辑测试：时间写法、跨天、到点挑拣。
 * @module dsh-elysia/test/reminder.test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReminder, formatReminder, parseReminder, takeDue, type Reminder } from '../src/reminder.ts';

const NOON = new Date(2026, 10, 24, 12, 0, 0, 0).getTime();

test('解析 HH:MM：今天晚于现在就用今天', () => {
  const result = parseReminder('21:30 喝水', NOON);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const date = new Date(result.at);
  assert.equal(date.getHours(), 21);
  assert.equal(date.getMinutes(), 30);
  assert.equal(date.getDate(), 24);
  assert.equal(result.text, '喝水');
});

test('解析 HH:MM：早于现在顺延到明天', () => {
  const result = parseReminder('09:00 出门', NOON);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(new Date(result.at).getDate(), 25);
});

test('相对分钟与小时', () => {
  const minutes = parseReminder('30m 起来走走', NOON);
  assert.equal(minutes.ok, true);
  if (minutes.ok) assert.equal(minutes.at, NOON + 30 * 60_000);

  const hours = parseReminder('2h 收衣服', NOON);
  assert.equal(hours.ok, true);
  if (hours.ok) assert.equal(hours.at, NOON + 2 * 60 * 60_000);
});

test('非法输入给可展示的原因', () => {
  assert.equal(parseReminder('', NOON).ok, false);
  assert.equal(parseReminder('25:00 睡觉', NOON).ok, false);
  assert.equal(parseReminder('随便写点', NOON).ok, false);
  assert.equal(parseReminder('30m', NOON).ok, false);
});

test('到点挑拣按时间升序，剩下的保留', () => {
  const list: Reminder[] = [
    { id: 'a', at: NOON + 60_000, text: '晚一点' },
    { id: 'b', at: NOON, text: '现在' },
    { id: 'c', at: NOON - 60_000, text: '早一点' },
  ];
  const result = takeDue(list, NOON);
  assert.deepEqual(result.due.map((item) => item.id), ['c', 'b']);
  assert.deepEqual(result.rest.map((item) => item.id), ['a']);
});

test('格式化与建条', () => {
  const reminder = createReminder({ at: NOON + 30 * 60_000, text: '喝水' }, NOON);
  assert.match(reminder.id, /^\d+-[a-z0-9]+$/);
  assert.equal(formatReminder(reminder, NOON), '今天 12:30 · 喝水');
});
