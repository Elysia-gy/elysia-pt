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

/** 判定不通过的原因；`ok` 表示可以开口。 */
export type ProactiveReason = 'ok' | 'disabled' | 'quiet' | 'no-gap' | 'daily-max' | 'chance';

/** 闸门输入。 */
export interface ProactiveInput {
  enabled: boolean;
  nowMs: number;
  /** 主人最后一次说话的时间；0 表示不知道（视为很久以前）。 */
  lastUserAtMs: number;
  /** 今天已经主动说了几次。 */
  spokenToday: number;
  /** 安静时段起（含），0–23。 */
  quietStartHour: number;
  /** 安静时段止（不含），0–24。 */
  quietEndHour: number;
  /** 最小间隔（分钟）。 */
  minGapMin: number;
  /** 每日上限。 */
  dailyMax: number;
  /** 抽中的概率，0–1。 */
  chance: number;
  /** 这次抽签的值，0–1；由调用方给，便于测试与留痕。 */
  randomValue: number;
}

/** 闸门结果。 */
export interface ProactiveDecision {
  ok: boolean;
  reason: ProactiveReason;
}

/**
 * 安静时段判定。
 *
 * 支持跨零点（23 → 8）：起点大于等于终点时按两段并集算，不要写成 `hour >= start && hour < end`
 * ——那会在跨零点时永远为假。
 */
export function inQuietHours(nowMs: number, startHour: number, endHour: number): boolean {
  const hour = new Date(nowMs).getHours();
  if (startHour === endHour) return false;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

/** 五道闸门依次判定，第一个不过的原因即结论。 */
export function shouldSpeak(input: ProactiveInput): ProactiveDecision {
  if (!input.enabled) return { ok: false, reason: 'disabled' };
  if (inQuietHours(input.nowMs, input.quietStartHour, input.quietEndHour)) return { ok: false, reason: 'quiet' };
  const gapMs = input.nowMs - input.lastUserAtMs;
  if (input.lastUserAtMs > 0 && gapMs < input.minGapMin * 60_000) return { ok: false, reason: 'no-gap' };
  if (input.spokenToday >= input.dailyMax) return { ok: false, reason: 'daily-max' };
  if (input.randomValue >= input.chance) return { ok: false, reason: 'chance' };
  return { ok: true, reason: 'ok' };
}

/** 给日志/命令看的中文理由。 */
export function reasonText(reason: ProactiveReason): string {
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
