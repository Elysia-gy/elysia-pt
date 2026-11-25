/**
 * 插件配置：一份 schema 同时是类型、默认值与校验。
 *
 * `apply` 内不再兜底任何默认值——默认值只能写在这里，
 * 否则「配置里改过、代码里又兜一层」迟早对不上。
 * @module dsh-elysia/src/config
 */
import z from '@deepseek-ai/schemastery';

/** 运行时配置。 */
export const Config = z.object({
  /** 总开关；关掉后不注册任何命令与定时器。 */
  enabled: z.boolean().default(true),
  /** 自定义人设；空则用内置的爱莉希雅。 */
  persona: z.string().default(''),
  /** 单独指定的服务商；与 modelName 一起留空 = 跟随当前对话。 */
  modelProvider: z.string().default(''),
  modelName: z.string().default(''),
  /** 一条回复最多多少字（门禁裁剪用）。 */
  maxReplyChars: z.number().default(120),
  /** 是否把长期记忆注入提示词。 */
  memoryEnabled: z.boolean().default(true),
  /** 是否更新心情。关掉后心情永远停在基线。 */
  moodEnabled: z.boolean().default(true),
  /** 是否允许她主动开口。 */
  proactiveEnabled: z.boolean().default(true),
  /** 安静时段起（含）。 */
  quietStartHour: z.number().default(23),
  /** 安静时段止（不含）。 */
  quietEndHour: z.number().default(8),
  /** 距主人上次说话至少多少分钟才允许主动开口。 */
  proactiveMinGapMin: z.number().default(45),
  /** 每天最多主动开口几次。 */
  proactiveDailyMax: z.number().default(4),
  /** 抽签概率 0–1；55% 是手机端调出来的手感，别轻易拉满。 */
  proactiveChance: z.number().default(0.55),
  /** 定时器粒度（分钟）；主动开口的闸门每拍判一次。 */
  tickMinutes: z.number().default(1),
  /** 是否把回复朗读出来（用 Windows 自带语音，不联网）。 */
  voiceEnabled: z.boolean().default(false),
  /** 朗读语速，-10~10，0 为正常。 */
  voiceRate: z.number().default(0),
  /** 桌宠音效（点她、翅膀、走路、拖拽）；默认开，嫌吵可关。 */
  soundEnabled: z.boolean().default(true),
  /** 是否把桌宠搬到 DSH 窗口外（独立透明置顶小窗）；开着时窗口内浮层自动让位。 */
  desktopPet: z.boolean().default(true),
  /** 额外敏感词；命中整句兜底。默认空，宁可漏也别误伤。 */
  sensitiveWords: z.array(z.string()).default([]),
});

/** 配置类型：由 schema 的输出类型推导，不手写第二份。 */
export type ElysiaPluginConfig = ReturnType<typeof Config>;
