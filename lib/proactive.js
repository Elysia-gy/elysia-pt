/**
 * 主动开口的五道闸门（纯函数）。
 *
 * 缺了「她主动说话」这一半，再好的回复也还是助手；但机械地每 45 分钟一条比不说更假，
 * 所以五道闸门全过才算：
 *  1. 开关开着；
 *  2. 不在安静时段（默认 23:00–08:00）；
 *  3. 距主人上次说话已经超过最小间隔（刚聊完不许再来一句）；
 *  4. 今天还没到条数上限；
 *  5. 概率抽中了（默认 55%）。
 * @module dsh-elysia/src/proactive
 */
/**
 * 安静时段判定。
 *
 * 支持跨零点（23 → 8）：起点大于等于终点时按两段并集算，不要写成 `hour >= start && hour < end`
 * ——那会在跨零点时永远为假。
 */
export function inQuietHours(nowMs, startHour, endHour) {
    const hour = new Date(nowMs).getHours();
    if (startHour === endHour)
        return false;
    if (startHour < endHour)
        return hour >= startHour && hour < endHour;
    return hour >= startHour || hour < endHour;
}
/** 五道闸门依次判定，第一个不过的原因即结论。 */
export function shouldSpeak(input) {
    if (!input.enabled)
        return { ok: false, reason: 'disabled' };
    if (inQuietHours(input.nowMs, input.quietStartHour, input.quietEndHour))
        return { ok: false, reason: 'quiet' };
    const gapMs = input.nowMs - input.lastUserAtMs;
    if (input.lastUserAtMs > 0 && gapMs < input.minGapMin * 60_000)
        return { ok: false, reason: 'no-gap' };
    if (input.spokenToday >= input.dailyMax)
        return { ok: false, reason: 'daily-max' };
    if (input.randomValue >= input.chance)
        return { ok: false, reason: 'chance' };
    return { ok: true, reason: 'ok' };
}
/** 给日志/命令看的中文理由。 */
export function reasonText(reason) {
    switch (reason) {
        case 'disabled':
            return '主动开口已关闭';
        case 'quiet':
            return '正处于安静时段';
        case 'no-gap':
            return '刚聊过，再等一会儿';
        case 'daily-max':
            return '今天已经说够啦';
        case 'chance':
            return '这次抽签没中';
        default:
            return '可以开口';
    }
}
