/**
 * 亲密度与每日任务：搬手机端 `CompanionManager` 里的公式与档位。
 *
 * 桌面端没有「领奖」按钮，进度达标就当场发爱心；其余数值（累计爱心、
 * 等级、等第、距离下一级）和手机端同一套算法。
 * @module dsh-elysia/src/companion
 */
/** 每日任务：摸摸 10 次 → 5 心；陪伴 300 秒 → 6 心。 */
export const TOUCH_GOAL = 10;
export const STAY_GOAL = 300;
export const TOUCH_REWARD = 5;
export const STAY_REWARD = 6;
/** 好感度等第：每 10 级一档。 */
const TIER_NAMES = ['陌生人', '熟人', '亲近', '心动', '喜欢', '爱恋', '迷恋', '挚爱', '永恒', '唯一'];
/** 本地日期键（yyyy-mm-dd）。 */
function dayKey(nowMs) {
    const date = new Date(nowMs);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
}
/** 空存档。 */
export function createCompanion(nowMs = Date.now()) {
    return {
        hearts: 0,
        touchTotal: 0,
        touchDate: dayKey(nowMs),
        touchToday: 0,
        stayDate: dayKey(nowMs),
        staySeconds: 0,
        claimedMask: 0,
    };
}
/** 到 `level` 级所需的累计爱心（手机端抛物线公式：20*l + 2*l²，l=level-1）。 */
export function cumHearts(level) {
    const l = Math.min(99, Math.max(0, level - 1));
    return 20 * l + 2 * l * l;
}
/** 累计爱心 → 等级（1..100）。 */
export function levelFromHearts(total) {
    for (let level = 100; level >= 1; level -= 1) {
        if (total >= cumHearts(level))
            return level;
    }
    return 1;
}
/** 等级 → 等第名。 */
export function tierOf(level) {
    const index = Math.min(9, Math.max(0, Math.floor((level - 1) / 10)));
    return TIER_NAMES[index];
}
/** 读等级信息。 */
export function levelInfo(companion) {
    const level = levelFromHearts(companion.hearts);
    const nextAt = level < 100 ? cumHearts(level + 1) : cumHearts(100);
    return {
        level,
        tier: tierOf(level),
        hearts: companion.hearts,
        toNext: Math.max(0, nextAt - companion.hearts),
        nextAt,
    };
}
/** 跨天清零当日计数与领奖位。 */
export function rollDay(companion, nowMs) {
    const today = dayKey(nowMs);
    if (companion.touchDate === today && companion.stayDate === today)
        return companion;
    return {
        ...companion,
        touchDate: companion.touchDate === today ? companion.touchDate : today,
        touchToday: companion.touchDate === today ? companion.touchToday : 0,
        stayDate: companion.stayDate === today ? companion.stayDate : today,
        staySeconds: companion.stayDate === today ? companion.staySeconds : 0,
        claimedMask: companion.touchDate === today && companion.stayDate === today ? companion.claimedMask : 0,
    };
}
/** 摸摸一次：更新计数，够 10 次且当天没领过就发 5 心。 */
export function touchCompanion(companion, nowMs) {
    const rolled = rollDay(companion, nowMs);
    const touchToday = rolled.touchToday + 1;
    let gained = 0;
    let claimedMask = rolled.claimedMask;
    if (touchToday >= TOUCH_GOAL && (claimedMask & 1) === 0) {
        gained += TOUCH_REWARD;
        claimedMask |= 1;
    }
    return {
        state: {
            ...rolled,
            touchTotal: rolled.touchTotal + 1,
            touchToday,
            hearts: rolled.hearts + gained,
            claimedMask,
        },
        gained,
    };
}
/** 陪伴若干秒：够 300 秒且当天没领过就发 6 心。 */
export function stayCompanion(companion, seconds, nowMs) {
    const rolled = rollDay(companion, nowMs);
    const add = Math.max(0, Math.min(300, Math.round(seconds)));
    const staySeconds = rolled.staySeconds + add;
    let gained = 0;
    let claimedMask = rolled.claimedMask;
    if (staySeconds >= STAY_GOAL && (claimedMask & 2) === 0) {
        gained += STAY_REWARD;
        claimedMask |= 2;
    }
    return {
        state: { ...rolled, staySeconds, hearts: rolled.hearts + gained, claimedMask },
        gained,
    };
}
