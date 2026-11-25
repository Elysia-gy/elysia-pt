/**
 * 亲密度与每日任务：搬手机端 `CompanionManager` 里的公式与档位。
 *
 * 桌面端没有「领奖」按钮，进度达标就当场发爱心；其余数值（累计爱心、
 * 等级、等第、距离下一级）和手机端同一套算法。
 * @module dsh-elysia/src/companion
 */
/** 每日任务：摸摸 10 次 → 5 心；陪伴 300 秒 → 6 心。 */
export declare const TOUCH_GOAL = 10;
export declare const STAY_GOAL = 300;
export declare const TOUCH_REWARD = 5;
export declare const STAY_REWARD = 6;
/** 亲密度存档。 */
export interface CompanionState {
    /** 累计爱心（只增不减）。 */
    hearts: number;
    /** 累计被摸摸次数（不随跨天清零）。 */
    touchTotal: number;
    /** 当日摸摸计数与所属日期。 */
    touchDate: string;
    touchToday: number;
    /** 当日陪伴秒数与所属日期。 */
    stayDate: string;
    staySeconds: number;
    /** 当日已发的奖励位：bit0 摸摸、bit1 陪伴。 */
    claimedMask: number;
}
/** 空存档。 */
export declare function createCompanion(nowMs?: number): CompanionState;
/** 到 `level` 级所需的累计爱心（手机端抛物线公式：20*l + 2*l²，l=level-1）。 */
export declare function cumHearts(level: number): number;
/** 累计爱心 → 等级（1..100）。 */
export declare function levelFromHearts(total: number): number;
/** 等级 → 等第名。 */
export declare function tierOf(level: number): string;
/** 面板要显示的等级信息。 */
export interface LevelInfo {
    level: number;
    tier: string;
    hearts: number;
    /** 距下一级还差多少爱心。 */
    toNext: number;
    /** 下一级的累计门槛。 */
    nextAt: number;
}
/** 读等级信息。 */
export declare function levelInfo(companion: CompanionState): LevelInfo;
/** 跨天清零当日计数与领奖位。 */
export declare function rollDay(companion: CompanionState, nowMs: number): CompanionState;
/** 摸摸一次：更新计数，够 10 次且当天没领过就发 5 心。 */
export declare function touchCompanion(companion: CompanionState, nowMs: number): {
    state: CompanionState;
    gained: number;
};
/** 陪伴若干秒：够 300 秒且当天没领过就发 6 心。 */
export declare function stayCompanion(companion: CompanionState, seconds: number, nowMs: number): {
    state: CompanionState;
    gained: number;
};
