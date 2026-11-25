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
export type ParsedReminder = {
    ok: true;
    at: number;
    text: string;
} | {
    ok: false;
    message: string;
};
/** 用法提示，命令与页面共用。 */
export declare const REMIND_HINT = "\u7528\u6CD5\uFF1A/elysia-remind 21:30 \u559D\u6C34\uFF08\u4E5F\u652F\u6301 30m / 2h\uFF09";
/**
 * 解析一行提醒输入。
 *
 * @param input - 形如 `21:30 喝水`、`30m 起来走走`、`2h 收衣服`。
 * @param nowMs - 当前时间，用来把「今天 21:30」补成绝对时间。
 * @returns 绝对时间 + 提醒内容，或一句失败原因。
 */
export declare function parseReminder(input: string, nowMs: number): ParsedReminder;
/**
 * 到点的挑出来，没到点的留着。
 *
 * @param reminders - 现存提醒。
 * @param nowMs - 当前时间。
 * @returns `due` 该触发的（按时间升序）、`rest` 剩下的。
 */
export declare function takeDue(reminders: Reminder[], nowMs: number): {
    due: Reminder[];
    rest: Reminder[];
};
/** 人话时间：今天/明天 + 时分。 */
export declare function formatReminder(reminder: Reminder, nowMs: number): string;
/** 造一条提醒（id 只要进程内唯一）。 */
export declare function createReminder(input: {
    at: number;
    text: string;
}, nowMs: number): Reminder;
