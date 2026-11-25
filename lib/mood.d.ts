/** 基线：不开心也不难过。 */
export declare const MOOD_BASELINE = 70;
/** 底子每次只吃三分之一的判定值。 */
export declare const MOOD_STEP_DIVISOR = 3;
export declare const MOOD_HALF_LIFE_HOURS = 12;
export declare const DIM_HALF_LIFE_HOURS = 1.5;
export declare const MOOD_DAILY_INJECT_MAX = 6;
export declare const MOOD_MIN_CONFIDENCE = 60;
/** 低于这个变化量不写时间线，避免每次呼吸都记一笔。 */
export declare const MOOD_NOTE_THRESHOLD = 3;
/** 七维取值，缺省视为 0。 */
export type MoodDims = Record<string, number>;
/** 一条心情存档。 */
export interface MoodState {
    /** 0–100 的底子。 */
    mood: number;
    /** 七维，可为负。 */
    dims: MoodDims;
    /** 最后更新时间（ms）。 */
    updatedAt: number;
    /** 最后衰减时间（ms），衰减只按它算，避免每次读都衰减一次。 */
    lastDecayAt: number;
    /** 今天已经注入过几次（自然日由调用方在跨天时清零）。 */
    injectedToday: number;
    /** 最后一次注入的自然日（yyyy-mm-dd），用于跨天清零。 */
    injectedDate: string;
}
/** 模型判定结果（`parseMoodDelta` 的产物）。 */
export interface MoodDelta {
    moodDelta: number;
    dims: MoodDims;
    confidence: number;
    reason?: string;
}
/** 一次判定落地后的结果。 */
export interface MoodApplyResult {
    state: MoodState;
    /** 这次变化够不够大到值得说一句。 */
    significant: boolean;
}
/** 新建一份基线心情。 */
export declare function createMood(nowMs: number): MoodState;
/** 七维全 0。 */
export declare function emptyDims(): MoodDims;
/** 自然日 key（宿主本地时区）。 */
export declare function dateKey(nowMs: number): string;
/** 指数回落：`2^(-elapsed/halfLife)`。 */
export declare function decayFactor(elapsedMs: number, halfLifeHours: number): number;
/**
 * 让心情自己平复。
 *
 * 只按 `lastDecayAt` 算一次增量：反复调用是幂等的（第二次之后 elapsed 为 0），
 * 这样「每次读都衰减」和「定时衰减」两种调用方式结果一致。
 */
export declare function decayMood(state: MoodState, nowMs: number): MoodState;
/**
 * 落一次模型判定。
 *
 * `moodDelta` 先除以 `MOOD_STEP_DIVISOR` 再落底子；各维直接叠加但每维限 ±10。
 * `significant` 的判据与手机端一致：|Δmood| ≥ 3 或任一维 ≥ 5。
 */
export declare function applyDelta(state: MoodState, delta: MoodDelta, nowMs: number): MoodApplyResult;
/** 底子 → 一句中文基调（与手机端同一组阈值）。 */
export declare function moodLabel(mood: number): string;
/** 当前最强烈的情绪维（全为负或全为 0 时回 undefined）。 */
export declare function dominantEmotion(state: MoodState): string | undefined;
/** 今天还能不能再说一句心情。跨天自动清零。 */
export declare function takeInjectSlot(state: MoodState, nowMs: number): {
    state: MoodState;
    allowed: boolean;
};
/**
 * 解析模型回的心情 JSON。
 *
 * 容忍 ```json 围栏与前缀说明；字段缺失按 0 处理。解析失败回 undefined——
 * 宁可这轮不动心情，也不要按半个 JSON 乱调。
 */
export declare function parseMoodDelta(raw: string): MoodDelta | undefined;
/** 写进提示词的一行心情：只给基调与最强的那一维，不给分数。 */
export declare function moodPromptLine(state: MoodState): string;
