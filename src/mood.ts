/**
 * 心情引擎（纯函数）：一个底子 + 七根情绪。
 *
 * 移植自手机端 `MoodEngine`，保留四条硬规则：
 *  1. 底子走得很慢：模型给的 moodDelta 除以 3 才落盘，否则一次吐槽就能打穿；
 *  2. 会自己平复：底子半衰期 12 小时、七维 1.5 小时；
 *  3. 判得没底的不算：confidence 低于 `MOOD_MIN_CONFIDENCE` 只记账不注入；
 *  4. 一次变化只说一次、每天有额度（额度由调用方按 `MOOD_DAILY_INJECT_MAX` 控制）。
 * @module dsh-elysia/src/mood
 */
import { EMOTION_DIMS, EMOTION_IDS } from './emotion.ts';

/** 基线：不开心也不难过。 */
export const MOOD_BASELINE = 70;
/** 底子每次只吃三分之一的判定值。 */
export const MOOD_STEP_DIVISOR = 3;
export const MOOD_HALF_LIFE_HOURS = 12;
export const DIM_HALF_LIFE_HOURS = 1.5;
export const MOOD_DAILY_INJECT_MAX = 6;
export const MOOD_MIN_CONFIDENCE = 60;
/** 低于这个变化量不写时间线，避免每次呼吸都记一笔。 */
export const MOOD_NOTE_THRESHOLD = 3;

const HOUR_MS = 3_600_000;

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

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** 新建一份基线心情。 */
export function createMood(nowMs: number): MoodState {
  return {
    mood: MOOD_BASELINE,
    dims: emptyDims(),
    updatedAt: nowMs,
    lastDecayAt: nowMs,
    injectedToday: 0,
    injectedDate: dateKey(nowMs),
  };
}

/** 七维全 0。 */
export function emptyDims(): MoodDims {
  const dims: MoodDims = {};
  for (const item of EMOTION_DIMS) dims[item.id] = 0;
  return dims;
}

/** 自然日 key（宿主本地时区）。 */
export function dateKey(nowMs: number): string {
  const date = new Date(nowMs);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return date.getFullYear() + '-' + month + '-' + day;
}

/** 指数回落：`2^(-elapsed/halfLife)`。 */
export function decayFactor(elapsedMs: number, halfLifeHours: number): number {
  if (elapsedMs <= 0) return 1;
  return Math.pow(2, -elapsedMs / (halfLifeHours * HOUR_MS));
}

/**
 * 让心情自己平复。
 *
 * 只按 `lastDecayAt` 算一次增量：反复调用是幂等的（第二次之后 elapsed 为 0），
 * 这样「每次读都衰减」和「定时衰减」两种调用方式结果一致。
 */
export function decayMood(state: MoodState, nowMs: number): MoodState {
  const elapsed = nowMs - state.lastDecayAt;
  if (elapsed < 60_000) return state;
  const moodFactor = decayFactor(elapsed, MOOD_HALF_LIFE_HOURS);
  const dimFactor = decayFactor(elapsed, DIM_HALF_LIFE_HOURS);
  const dims: MoodDims = {};
  for (const id of EMOTION_IDS) dims[id] = (state.dims[id] ?? 0) * dimFactor;
  return {
    ...state,
    mood: MOOD_BASELINE + (state.mood - MOOD_BASELINE) * moodFactor,
    dims,
    lastDecayAt: nowMs,
  };
}

/**
 * 落一次模型判定。
 *
 * `moodDelta` 先除以 `MOOD_STEP_DIVISOR` 再落底子；各维直接叠加但每维限 ±10。
 * `significant` 的判据与手机端一致：|Δmood| ≥ 3 或任一维 ≥ 5。
 */
export function applyDelta(state: MoodState, delta: MoodDelta, nowMs: number): MoodApplyResult {
  const moodStep = clamp(delta.moodDelta, -10, 10) / MOOD_STEP_DIVISOR;
  const dims: MoodDims = { ...state.dims };
  let maxDimStep = 0;
  for (const id of EMOTION_IDS) {
    const step = clamp(delta.dims[id] ?? 0, -10, 10);
    if (Math.abs(step) > Math.abs(maxDimStep)) maxDimStep = step;
    dims[id] = clamp((dims[id] ?? 0) + step, -20, 20);
  }
  const significant = Math.abs(moodStep) >= MOOD_NOTE_THRESHOLD || Math.abs(maxDimStep) >= 5;
  return {
    state: {
      ...state,
      mood: clamp(state.mood + moodStep, 0, 100),
      dims,
      updatedAt: nowMs,
    },
    significant,
  };
}

/** 底子 → 一句中文基调（与手机端同一组阈值）。 */
export function moodLabel(mood: number): string {
  if (mood >= 80) return '欢喜';
  if (mood >= 62) return '开心';
  if (mood >= 42) return '一般';
  if (mood >= 25) return '有点心疼';
  return '难过';
}

/** 当前最强烈的情绪维（全为负或全为 0 时回 undefined）。 */
export function dominantEmotion(state: MoodState): string | undefined {
  let best: string | undefined;
  let bestValue = 0;
  for (const id of EMOTION_IDS) {
    const value = state.dims[id] ?? 0;
    if (value > bestValue) {
      bestValue = value;
      best = id;
    }
  }
  return best;
}

/** 今天还能不能再说一句心情。跨天自动清零。 */
export function takeInjectSlot(state: MoodState, nowMs: number): { state: MoodState; allowed: boolean } {
  const today = dateKey(nowMs);
  const injectedToday = state.injectedDate === today ? state.injectedToday : 0;
  const allowed = injectedToday < MOOD_DAILY_INJECT_MAX;
  return {
    state: { ...state, injectedDate: today, injectedToday: allowed ? injectedToday + 1 : injectedToday },
    allowed,
  };
}

/**
 * 解析模型回的心情 JSON。
 *
 * 容忍 ```json 围栏与前缀说明；字段缺失按 0 处理。解析失败回 undefined——
 * 宁可这轮不动心情，也不要按半个 JSON 乱调。
 */
export function parseMoodDelta(raw: string): MoodDelta | undefined {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const record = parsed as Record<string, unknown>;
  const dimsSource = (record.dims ?? {}) as Record<string, unknown>;
  const dims: MoodDims = emptyDims();
  for (const id of EMOTION_IDS) {
    const value = dimsSource[id];
    if (typeof value === 'number' && Number.isFinite(value)) dims[id] = clamp(value, -10, 10);
  }
  const moodDelta = typeof record.moodDelta === 'number' && Number.isFinite(record.moodDelta) ? clamp(record.moodDelta, -10, 10) : 0;
  const confidence = typeof record.confidence === 'number' ? clamp(record.confidence, 0, 100) : 70;
  const reason = typeof record.reason === 'string' ? record.reason.trim().slice(0, 60) : undefined;
  return { moodDelta, dims, confidence, ...(reason ? { reason } : {}) };
}

/** 写进提示词的一行心情：只给基调与最强的那一维，不给分数。 */
export function moodPromptLine(state: MoodState): string {
  const label = moodLabel(state.mood);
  const dominant = dominantEmotion(state);
  const dimLabel = dominant ? EMOTION_DIMS.find((item) => item.id === dominant)?.label : undefined;
  const intensity = dominant ? Math.round(state.dims[dominant] ?? 0) : 0;
  if (!dimLabel || intensity <= 0) return '此刻的心情：' + label + '。';
  const strength = intensity >= 8 ? '很明显' : intensity >= 4 ? '有一点' : '很轻';
  return '此刻的心情：' + label + '，其中' + dimLabel + '的情绪' + strength + '。';
}
