/**
 * 亲密度公式与每日任务的纯逻辑测试。
 * @module dsh-elysia/test/companion.test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCompanion,
  cumHearts,
  levelFromHearts,
  levelInfo,
  stayCompanion,
  tierOf,
  touchCompanion,
} from '../src/companion.ts';

const DAY1 = new Date(2026, 10, 24, 10, 0, 0, 0).getTime();
const DAY2 = new Date(2026, 10, 25, 10, 0, 0, 0).getTime();

test('等级门槛与档位和手机端同一套公式', () => {
  assert.equal(cumHearts(1), 0);
  assert.equal(cumHearts(2), 22);
  assert.equal(cumHearts(10), 342);
  assert.equal(levelFromHearts(0), 1);
  assert.equal(levelFromHearts(22), 2);
  assert.equal(levelFromHearts(21), 1);
  assert.equal(tierOf(1), '陌生人');
  assert.equal(tierOf(10), '陌生人');
  assert.equal(tierOf(11), '熟人');
  assert.equal(tierOf(100), '唯一');
});

test('摸摸满 10 次发 5 心，当天只发一次', () => {
  let state = createCompanion(DAY1);
  let gained = 0;
  for (let i = 0; i < 10; i += 1) {
    const result = touchCompanion(state, DAY1);
    state = result.state;
    gained += result.gained;
  }
  assert.equal(gained, 5);
  assert.equal(state.hearts, 5);
  assert.equal(state.touchToday, 10);
  assert.equal(state.touchTotal, 10);

  const extra = touchCompanion(state, DAY1);
  assert.equal(extra.gained, 0);
  assert.equal(extra.state.touchToday, 11);
});

test('陪伴满 300 秒发 6 心，当天只发一次', () => {
  let state = createCompanion(DAY1);
  let gained = 0;
  for (let i = 0; i < 10; i += 1) {
    const result = stayCompanion(state, 30, DAY1);
    state = result.state;
    gained += result.gained;
  }
  assert.equal(gained, 6);
  assert.equal(state.hearts, 6);
  const extra = stayCompanion(state, 30, DAY1);
  assert.equal(extra.gained, 0);
});

test('跨天清零进度，奖励可以再领一次', () => {
  let state = createCompanion(DAY1);
  for (let i = 0; i < 10; i += 1) state = touchCompanion(state, DAY1).state;
  const nextDay = touchCompanion(state, DAY2);
  assert.equal(nextDay.state.touchToday, 1);
  assert.equal(nextDay.state.hearts, 5);

  let state2 = nextDay.state;
  for (let i = 0; i < 9; i += 1) state2 = touchCompanion(state2, DAY2).state;
  assert.equal(state2.touchToday, 10);
  assert.equal(state2.hearts, 10);
  const extra = touchCompanion(state2, DAY2);
  assert.equal(extra.gained, 0);
});

test('等级信息给出距下一级的差额', () => {
  const info = levelInfo({ ...createCompanion(DAY1), hearts: 22 });
  assert.equal(info.level, 2);
  assert.equal(info.tier, '陌生人');
  assert.equal(info.nextAt, cumHearts(3));
  assert.equal(info.toNext, cumHearts(3) - 22);
});
