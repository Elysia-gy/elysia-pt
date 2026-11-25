/**
 * 提醒：手机端「日程提醒」在桌面端的等价物。
 *
 * 只做一件小而确定的事：把「21:30 喝水」「30m 起来走走」这种一行输入解析成绝对时间。
 * 到点由宿主定时器统一判定（见 index.ts），这里保持纯函数，方便单测。
 * @module dsh-elysia/src/reminder
 */

/** 一条提醒。 */
export interface Reminder {
  id: string;
  /** 到点时间戳（ms）。 */
  at: number;
  /** 提醒内容。 */
  text: string;
}

/** 解析结果：成功给出绝对时间，失败给一句能直接展示的话。 */
export type ParsedReminder = { ok: true; at: number; text: string } | { ok: false; message: string };

/** 提醒内容上限，免得一条消息塞满收件箱。 */
const TEXT_MAX = 120;

/** 纯时间写法 `21:30`。 */
const CLOCK = /^(\d{1,2}):(\d{2})$/;

/** 相对分钟写法 `30m` / `30min` / `30分钟`。 */
const MINUTES = /^(\d{1,4})\s*(?:m|min|mins|minute|minutes|分钟)$/i;

/** 相对小时写法 `2h` / `2小时`。 */
const HOURS = /^(\d{1,3})\s*(?:h|hr|hour|hours|小时)$/i;

/** 用法提示，命令与页面共用。 */
export const REMIND_HINT = '用法：/elysia-remind 21:30 喝水（也支持 30m / 2h）';

/**
 * 解析一行提醒输入。
 *
 * @param input - 形如 `21:30 喝水`、`30m 起来走走`、`2h 收衣服`。
 * @param nowMs - 当前时间，用来把「今天 21:30」补成绝对时间。
 * @returns 绝对时间 + 提醒内容，或一句失败原因。
 */
export function parseReminder(input: string, nowMs: number): ParsedReminder {
  const raw = input.trim();
  if (raw === '') return { ok: false, message: REMIND_HINT };

  const split = raw.search(/\s/);
  const token = split === -1 ? raw : raw.slice(0, split);
  const text = split === -1 ? '' : raw.slice(split).trim();
  if (text === '') return { ok: false, message: '要提醒什么？' + REMIND_HINT };
  if (text.length > TEXT_MAX) return { ok: false, message: '提醒内容最多 ' + TEXT_MAX + ' 字。' };

  const clock = CLOCK.exec(token);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    if (hour > 23 || minute > 59) return { ok: false, message: '时间不存在：' + token };
    const at = new Date(nowMs);
    at.setHours(hour, minute, 0, 0);
    let stamp = at.getTime();
    if (stamp <= nowMs) stamp += 24 * 60 * 60 * 1000;
    return { ok: true, at: stamp, text };
  }

  const minutes = MINUTES.exec(token);
  if (minutes) {
    const count = Number(minutes[1]);
    if (count <= 0 || count > 24 * 60) return { ok: false, message: '相对分钟要在 1–1440 之间。' };
    return { ok: true, at: nowMs + count * 60_000, text };
  }

  const hours = HOURS.exec(token);
  if (hours) {
    const count = Number(hours[1]);
    if (count <= 0 || count > 24) return { ok: false, message: '相对小时要在 1–24 之间。' };
    return { ok: true, at: nowMs + count * 60 * 60_000, text };
  }

  return { ok: false, message: '没看懂时间：' + token + '。' + REMIND_HINT };
}

/**
 * 到点的挑出来，没到点的留着。
 *
 * @param reminders - 现存提醒。
 * @param nowMs - 当前时间。
 * @returns `due` 该触发的（按时间升序）、`rest` 剩下的。
 */
export function takeDue(reminders: Reminder[], nowMs: number): { due: Reminder[]; rest: Reminder[] } {
  const due: Reminder[] = [];
  const rest: Reminder[] = [];
  for (const item of reminders) {
    if (item.at <= nowMs) due.push(item);
    else rest.push(item);
  }
  due.sort((a, b) => a.at - b.at);
  return { due, rest };
}

/** 人话时间：今天/明天 + 时分。 */
export function formatReminder(reminder: Reminder, nowMs: number): string {
  const date = new Date(reminder.at);
  const sameDay = new Date(nowMs).toDateString() === date.toDateString();
  const time = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  return (sameDay ? '今天 ' : '明天 ') + time + ' · ' + reminder.text;
}

/** 造一条提醒（id 只要进程内唯一）。 */
export function createReminder(input: { at: number; text: string }, nowMs: number): Reminder {
  return { id: String(nowMs) + '-' + Math.random().toString(36).slice(2, 8), at: input.at, text: input.text };
}
