/**
 * dsh-elysia 宿主插件入口：把爱莉希雅的四件事装进 DSH。
 *
 * 注册了什么：
 *  - 六个斜杠命令：/elysia（对话）、/elysia-mood、/elysia-memory、/elysia-say、
 *    /elysia-inbox、/elysia-forget；
 *  - 一个每分钟的闸门定时器（主动开口），随插件卸载自动清理；
 *  - 一份 JSON 存档（记忆 + 心情 + 主动计数 + 收件箱），落在 `<dshHome>/dsh-elysia/state.json`。
 * 不做什么：不注册 UI、不碰 DSH 的会话记录、不发起任何网络请求（除了宿主提供的 llm）。
 * @module dsh-elysia/src/index
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { listenSpeech } from './asr.ts';
import { Config, type ElysiaPluginConfig } from './config.ts';
import { generateReply, type ChatHistoryMessage, type ModelRef, type Reply } from './chat.ts';
import {
  createCompanion,
  levelInfo,
  rollDay,
  stayCompanion,
  STAY_GOAL,
  TOUCH_GOAL,
  touchCompanion,
  type CompanionState,
} from './companion.ts';
import { parseEmotionTag } from './emotion.ts';
import { clampReply, gateText } from './gate.ts';
import { startLocalApi } from './local-api.ts';
import { createDesktopPet } from './desktop.ts';
import { SPEECHES } from './speeches.ts';
import {
  addTurn,
  buildRecallBlock,
  consolidate,
  createMemory,
  extractFacts,
  mergeFacts,
  recall,
  type MemoryState,
} from './memory.ts';
import { applyDelta, createMood, dateKey, decayMood, dominantEmotion, moodLabel, moodPromptLine, type MoodState } from './mood.ts';
import { buildSystemPrompt } from './persona.ts';
import { reasonText, shouldSpeak } from './proactive.ts';
import { createReminder, formatReminder, parseReminder, takeDue, type Reminder } from './reminder.ts';
import { createJsonStore } from './store.ts';
import { speak } from './voice.ts';

/** 插件名（Cordis 插件 id）。 */
export const name = 'elysia';

/** 需要的宿主服务：当前模型、LLM、斜杠命令（界面走本机回环接口，不经网关）。 */
export const inject = ['agentDefaultModel', 'llm', 'commands'];

/** 主动消息收件箱上限：攒太多没意义，只留最近的。 */
const INBOX_MAX = 20;
/** 单条用户输入上限，超过直接拒绝（别把一整篇文档塞进一次闲聊）。 */
const USER_TEXT_MAX = 2000;
/** 存档版本。 */
const STATE_VERSION = 3;

/** 落在磁盘上的全部状态。 */
interface ElysiaState {
  memory: MemoryState;
  mood: MoodState;
  /** 亲密度与每日任务（v3 新增）。 */
  companion: CompanionState;
  /** 主人最后一次说话的时间；0 = 不知道。 */
  lastUserAt: number;
  /** 主动开口的日记账日期（yyyy-mm-dd）。 */
  spokenDate: string;
  /** 当天已经主动说了几次。 */
  spokenToday: number;
  /** 主动消息收件箱（核心版没有 UI，由 /elysia-inbox 取）。 */
  inbox: string[];
  /** 还没到点的提醒。 */
  reminders: Reminder[];
}

/** 命令返回值（DSH 斜杠命令契约）。 */
type CommandResult = { kind: 'success'; text: string } | { kind: 'error'; text: string };

/** 注册一条命令。 */
interface CommandSpec {
  name: string;
  description: string;
  input?: { hint: string };
  handler: (input: { rawInput: string }) => CommandResult | Promise<CommandResult>;
}

/** 宿主日志：有 logger 就用，没有就落 console（宁可啰嗦，也不要静默失败）。 */function logLine(ctx: unknown, level: 'info' | 'warn', line: string): void {
  const logger = (ctx as { logger?: Record<string, unknown> }).logger;
  const method = logger?.[level];
  if (typeof method === 'function') {
    (method as (message: string) => void).call(logger, line);
    return;
  }
  if (level === 'warn') console.warn(line);
  else console.info(line);
}

/** 空状态。 */
function createState(): ElysiaState {
  return {
    memory: createMemory(),
    mood: createMood(Date.now()),
    companion: createCompanion(),
    lastUserAt: 0,
    spokenDate: '',
    spokenToday: 0,
    inbox: [],
    reminders: [],
  };
}

/** 读配置里指定的模型；两半都填了才算。 */
function preferredModel(config: ElysiaPluginConfig): ModelRef | undefined {
  const provider = config.modelProvider.trim();
  const model = config.modelName.trim();
  return provider && model ? { provider, model } : undefined;
}

/** 今天的主动计数（跨天自动清零）。 */
function spokenTodayOf(state: ElysiaState, nowMs: number): number {
  return state.spokenDate === dateKey(nowMs) ? state.spokenToday : 0;
}

/**
 * 装配入口。
 *
 * @param ctx - 宿主上下文（只用到 effect / commands / llm / agentDefaultModel / logger）。
 * @param config - 见 `config.ts`；默认值已由 schema 填好。
 */
export function apply(ctx: unknown, config: ElysiaPluginConfig): void {
  if (!config.enabled) return;
  const host = ctx as {
    effect(setup: () => (() => void) | void, label: string): void;
    commands?: { register(spec: CommandSpec): () => void };
    setInterval?(handler: () => void, ms: number): (() => void) | unknown;
    get?(name: string): unknown;
  };

  const statePath = join(resolveDshHome(), 'dsh-elysia', 'state.json');
  const store = createJsonStore<ElysiaState>({
    file: statePath,
    version: STATE_VERSION,
    create: createState,
    // v1 → v2 加了提醒，v2 → v3 加了亲密度；旧字段原样留下，不清记忆。
    migrate: (raw) => {
      const old = raw as Partial<ElysiaState> | null;
      if (!old || typeof old !== 'object') return undefined;
      return {
        ...createState(),
        ...old,
        reminders: Array.isArray(old.reminders) ? old.reminders : [],
        companion: old.companion && typeof old.companion === 'object' ? { ...createCompanion(), ...old.companion } : createCompanion(),
      };
    },
  });

  /** 读 + 顺手把心情按时间衰减一次、把每日任务跨天清零（都幂等）。 */
  function load(): ElysiaState {
    const state = store.read();
    const rolled: ElysiaState = { ...state, companion: rollDay(state.companion, Date.now()) };
    if (!config.moodEnabled) return rolled;
    return { ...rolled, mood: decayMood(rolled.mood, Date.now()) };
  }

  // 首次装载就把空壳落盘：既是「插件确实挂上了」的证据，也避免第一次对话时目录还不存在。
  if (!existsSync(statePath)) {
    try {
      store.write(createState());
    } catch (error) {
      logLine(ctx, 'warn', '[dsh-elysia] 初始化存档失败：' + (error instanceof Error ? error.message : String(error)));
    }
  }

  function save(state: ElysiaState): void {
    try {
      store.write(state);
    } catch (error) {
      logLine(ctx, 'warn', '[dsh-elysia] 存档写入失败：' + (error instanceof Error ? error.message : String(error)));
    }
  }

  /** 按配置朗读一句；失败只记一条日志，不影响回复。 */
  function speakReply(text: string): void {
    if (!config.voiceEnabled) return;
    speak(text, config.voiceRate, (message) => logLine(ctx, 'warn', '[dsh-elysia] 朗读失败：' + message));
  }

  /** 记忆 → 提示词里的历史消息（最近 12 条）。 */  function historyOf(memory: MemoryState): ChatHistoryMessage[] {
    return memory.turns.slice(-12).map((turn) => ({ role: turn.role, content: turn.text }));
  }

  /**
   * 一次对话：召回 → 调模型 → 过门禁 → 落记忆与心情。
   *
   * 心情走「情绪标签轻量驱动」：标签是模型自己给的，比再发一次判定请求便宜得多。
   * 完整版（单独一次 judge 调用）留给以后有开关再加。
   */
  async function chatOnce(state: ElysiaState, userText: string): Promise<{ reply: Reply; state: ElysiaState }> {
    const nowMs = Date.now();
    const recallResult = config.memoryEnabled ? recall(state.memory, userText) : { facts: [], episodes: [], summary: '' };
    const system = buildSystemPrompt({
      persona: config.persona,
      scene: 'chat',
      nowMs,
      ...(config.moodEnabled ? { moodLine: moodPromptLine(state.mood) } : {}),
      ...(config.memoryEnabled ? { recallBlock: buildRecallBlock(recallResult) } : {}),
    });
    const preferred = preferredModel(config);
    const result = await generateReply(ctx, {
      system,
      history: historyOf(state.memory),
      userText,
      ...(preferred ? { preferred } : {}),
    });
    if (!result.ok) return { reply: result, state: { ...state, lastUserAt: nowMs } };

    const parsed = parseEmotionTag(result.text);
    const gated = gateText(parsed.text, { scope: 'CHAT', sensitiveWords: config.sensitiveWords });
    const text = clampReply(gated.text, config.maxReplyChars);

    let mood = state.mood;
    if (config.moodEnabled && gated.blocked === false) {
      const dims = parsed.emotion ? { [parsed.emotion]: 4 } : {};
      const outcome = applyDelta(mood, { moodDelta: parsed.emotion ? 2 : 0, dims, confidence: 80 }, nowMs);
      mood = outcome.state;
    }

    let memory = addTurn(state.memory, 'user', userText, nowMs);
    memory = addTurn(memory, 'assistant', text, nowMs);
    memory = mergeFacts(memory, extractFacts(userText, nowMs), nowMs);
    memory = consolidate(memory, { turns: memory.turns, at: nowMs });

    return {
      reply: { ok: true, text },
      state: { ...state, memory, mood, lastUserAt: nowMs },
    };
  }

  /** 主动开口一次：闸门 → 调模型 → 过门禁 → 进收件箱。 */
  async function proactiveOnce(state: ElysiaState): Promise<{ state: ElysiaState; said?: string; reason: string }> {
    const nowMs = Date.now();
    const decision = shouldSpeak({
      enabled: config.proactiveEnabled,
      nowMs,
      lastUserAtMs: state.lastUserAt,
      spokenToday: spokenTodayOf(state, nowMs),
      quietStartHour: config.quietStartHour,
      quietEndHour: config.quietEndHour,
      minGapMin: config.proactiveMinGapMin,
      dailyMax: config.proactiveDailyMax,
      chance: config.proactiveChance,
      randomValue: Math.random(),
    });
    if (!decision.ok) return { state, reason: reasonText(decision.reason) };

    const lastUser = [...state.memory.turns].reverse().find((turn) => turn.role === 'user');
    const recallResult = config.memoryEnabled
      ? recall(state.memory, lastUser ? lastUser.text : '主人 上次聊到哪')
      : { facts: [], episodes: [], summary: '' };
    const system = buildSystemPrompt({
      persona: config.persona,
      scene: 'proactive',
      nowMs,
      ...(config.moodEnabled ? { moodLine: moodPromptLine(state.mood) } : {}),
      ...(config.memoryEnabled ? { recallBlock: buildRecallBlock(recallResult) } : {}),
    });
    const preferred = preferredModel(config);
    const result = await generateReply(ctx, {
      system,
      history: historyOf(state.memory),
      userText: '（他没有发消息。现在是你想主动找他说句话。）',
      ...(preferred ? { preferred } : {}),
    });
    if (!result.ok) return { state, reason: '生成失败：' + result.message };

    const parsed = parseEmotionTag(result.text);
    const gated = gateText(parsed.text, { scope: 'CHAT', sensitiveWords: config.sensitiveWords });
    const text = clampReply(gated.text, config.maxReplyChars);
    const inbox = [...state.inbox, text].slice(-INBOX_MAX);
    const next: ElysiaState = {
      ...state,
      inbox,
      spokenDate: dateKey(nowMs),
      spokenToday: spokenTodayOf(state, nowMs) + 1,
      memory: addTurn(state.memory, 'assistant', text, nowMs),
    };
    logLine(ctx, 'info', '[dsh-elysia] 主动开口：' + text);
    return { state: next, said: text, reason: reasonText('ok') };
  }

  /**
   * 一次对话的门面：命令与设置页按钮共用同一段逻辑，免得两边各写一份。
   */
  async function runChat(text: string): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
    const current = load();
    const result = await chatOnce(current, text);
    save(result.state);
    if (result.reply.ok) speakReply(result.reply.text);
    return result.reply.ok ? { ok: true, text: result.reply.text } : { ok: false, message: result.reply.message };
  }

  /** 手动让她主动开口（绕开间隔与抽签，仍守安静时段）。 */
  async function runSay(): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
    const current = load();
    const result = await proactiveOnce({ ...current, lastUserAt: 0 });
    save(result.state);
    if (result.said) speakReply(result.said);
    return result.said ? { ok: true, text: result.said } : { ok: false, message: '她这会儿没开口：' + result.reason };
  }

  /** 注册命令；没有 commands 服务时只告警，不让插件起不来。 */
  function register(spec: CommandSpec): void {
    if (!host.commands || typeof host.commands.register !== 'function') {
      logLine(ctx, 'warn', '[dsh-elysia] 宿主没有 commands 服务，/' + spec.name + ' 未注册');
      return;
    }
    host.effect(() => host.commands!.register(spec), 'dsh-elysia.commands.' + spec.name);
  }

  register({
    name: 'elysia',
    description: '和爱莉希雅说一句话（带长期记忆与心情）',
    input: { hint: '[消息]' },
    handler: async ({ rawInput }) => {
      const text = rawInput.trim();
      if (!text) return { kind: 'error', text: '说点什么吧，她在听。' };
      if (text.length > USER_TEXT_MAX) return { kind: 'error', text: '消息过长（限 ' + USER_TEXT_MAX + ' 字）' };
      const result = await runChat(text);
      return result.ok ? { kind: 'success', text: result.text } : { kind: 'error', text: '她这次没说出话来：' + result.message };
    },
  });

  register({
    name: 'elysia-mood',
    description: '看爱莉希雅此刻的心情',
    handler: () => {
      const current = load();
      const dominant = dominantEmotion(current.mood);
      const info = levelInfo(current.companion);
      const line = '心情：' + moodLabel(current.mood.mood) + '（' + Math.round(current.mood.mood) + '/100）' +
        (dominant ? '；最强烈的是' + dominant : '') +
        '；今天已主动开口 ' + spokenTodayOf(current, Date.now()) + ' 次。\n' +
        '亲密度：Lv.' + info.level + ' ' + info.tier + '（爱心 ' + info.hearts + '，距下一级还差 ' + info.toNext + '）；' +
        '今日摸摸 ' + current.companion.touchToday + '/' + TOUCH_GOAL + '，陪伴 ' +
        Math.floor(current.companion.staySeconds / 60) + '/' + Math.floor(STAY_GOAL / 60) + ' 分钟。';
      save(current);
      return { kind: 'success', text: line };
    },
  });

  register({
    name: 'elysia-memory',
    description: '查她记住了什么：留空看总量，填关键词看召回',
    input: { hint: '[关键词]（留空 = 总览）' },
    handler: ({ rawInput }) => {
      const current = load();
      const query = rawInput.trim();
      if (!query) {
        return {
          kind: 'success',
          text: '记忆：' + current.memory.facts.length + ' 条画像、' + current.memory.episodes.length +
            ' 段情节、' + current.memory.turns.length + ' 条近期对话' +
            (current.memory.summary ? '；摘要：' + current.memory.summary : ''),
        };
      }
      const result = recall(current.memory, query, 6);
      const lines = buildRecallBlock(result);
      return { kind: 'success', text: lines === '' ? '这条没想起来什么。' : lines };
    },
  });

  register({
    name: 'elysia-say',
    description: '现在就让她主动说一句（不受概率与间隔限制，仍守安静时段）',
    handler: async () => {
      const result = await runSay();
      return result.ok ? { kind: 'success', text: result.text } : { kind: 'error', text: result.message };
    },
  });

  register({
    name: 'elysia-inbox',
    description: '看她主动说过的最近几句话',
    handler: () => {
      const current = load();
      save(current);
      if (current.inbox.length === 0) return { kind: 'success', text: '她还没主动说过话。' };
      return { kind: 'success', text: current.inbox.map((line, index) => index + 1 + '. ' + line).join('\n') };
    },
  });

  register({
    name: 'elysia-remind',
    description: '设一条提醒：21:30 喝水 / 30m 起来走走 / 2h 收衣服',
    input: { hint: '时间 内容' },
    handler: ({ rawInput }) => {
      const nowMs = Date.now();
      const parsed = parseReminder(rawInput, nowMs);
      if (!parsed.ok) return { kind: 'error', text: parsed.message };
      const current = load();
      const reminder = createReminder({ at: parsed.at, text: parsed.text }, nowMs);
      save({ ...current, reminders: [...current.reminders, reminder].slice(-50) });
      return { kind: 'success', text: '记住了：' + formatReminder(reminder, nowMs) };
    },
  });

  register({
    name: 'elysia-reminders',
    description: '看还没到点的提醒',
    handler: () => {
      const current = load();
      save(current);
      if (current.reminders.length === 0) return { kind: 'success', text: '没有待触发的提醒。' };
      const sorted = [...current.reminders].sort((a, b) => a.at - b.at);
      return {
        kind: 'success',
        text: sorted.map((item, index) => index + 1 + '. ' + formatReminder(item, Date.now())).join('\n'),
      };
    },
  });

  register({
    name: 'elysia-forget',
    description: '清空她的长期记忆（需要再输入 confirm 确认）',
    input: { hint: 'confirm' },
    handler: ({ rawInput }) => {
      if (rawInput.trim() !== 'confirm') return { kind: 'error', text: '这会清空全部记忆；确认请输 /elysia-forget confirm' };
      const current = load();
      save({ ...current, memory: createMemory(), lastUserAt: 0 });
      return { kind: 'success', text: '记忆已经清空了。' };
    },
  });

  // 界面通道：宿主自己起一个只绑 127.0.0.1 的小服务，桌面外壳的协议层挡不住它。
  // 设置页与桌宠都打这里；命令行走 commands，两条路径共用同一段业务。
  // 单测里关掉（`DSH_ELYSIA_DISABLE_LOCAL_API=1`），免得跑测试时占住 7823。
  if (process.env['DSH_ELYSIA_DISABLE_LOCAL_API'] !== '1')
    host.effect(
    () => {
      let apiPort = 0;
      const desktopPet = createDesktopPet((message) => logLine(ctx, 'info', message));
      const handle = startLocalApi(
        {
          status: () => {
            const current = load();
            const dominant = dominantEmotion(current.mood);
            const info = levelInfo(current.companion);
            return {
              mood: current.mood.mood,
              moodLabel: moodLabel(current.mood.mood),
              ...(dominant ? { dominant } : {}),
              facts: current.memory.facts.length,
              episodes: current.memory.episodes.length,
              turns: current.memory.turns.length,
              spokenToday: spokenTodayOf(current, Date.now()),
              inbox: current.inbox.slice(-3),
              reminders: current.reminders.length,
              sound: config.soundEnabled,
              voice: config.voiceEnabled,
              desktopActive: desktopPet.active(),
              companion: {
                level: info.level,
                tier: info.tier,
                hearts: info.hearts,
                toNext: info.toNext,
                touchToday: current.companion.touchToday,
                touchGoal: TOUCH_GOAL,
                staySeconds: current.companion.staySeconds,
                stayGoal: STAY_GOAL,
              },
            };
          },
          chat: runChat,
          say: runSay,
          touch: () => {
            const current = load();
            const result = touchCompanion(current.companion, Date.now());
            save({ ...current, companion: result.state });
            const info = levelInfo(result.state);
            return { ok: true, gained: result.gained, level: info.level, tier: info.tier, hearts: info.hearts, toNext: info.toNext };
          },
          stay: (seconds: number) => {
            const current = load();
            const result = stayCompanion(current.companion, seconds, Date.now());
            save({ ...current, companion: result.state });
            const info = levelInfo(result.state);
            return { ok: true, gained: result.gained, level: info.level, hearts: info.hearts };
          },
          listen: () => listenSpeech(),
          speak: (text: string) => {
            speak(text, config.voiceRate, (message) => logLine(ctx, 'warn', '[dsh-elysia] 朗读失败：' + message));
          },
          forget: () => {
            const current = load();
            save({ ...current, memory: createMemory(), lastUserAt: 0 });
          },
          lines: (category: string) => SPEECHES[category] ?? [],
          desktopStart: () => desktopPet.start(apiPort, process.execPath),
          desktopStop: () => desktopPet.stop(),
          desktopActive: () => desktopPet.active(),
        },
        (message) => logLine(ctx, 'warn', '[dsh-elysia] 本机接口：' + message),
        (port) => {
          apiPort = port;
          // 端口真正监听成功后才拉桌面版；startLocalApi 返回时 handle.port 可能还是 0。
          if (config.desktopPet !== false) desktopPet.start(apiPort, process.execPath);
        },
      );
      apiPort = handle.port;
      logLine(ctx, 'info', '[dsh-elysia] 本机接口已启动');
      return () => {
        handle.dispose();
        desktopPet.dispose();
      };
    },
    'dsh-elysia.local-api()',
  );

  // 主动开口的闸门：每分钟判一次。定时器随插件卸载一起清掉，不留孤儿。
  if (host.setInterval) {
    const tickMs = Math.max(1, config.tickMinutes) * 60_000;
    host.effect(() => {
      const handle = host.setInterval!(() => {
        const tickState = load();
        // 先结清到点的提醒：直接进收件箱，桌宠下一次轮询就会冒泡。
        const dueResult = takeDue(tickState.reminders, Date.now());
        let base = tickState;
        if (dueResult.due.length > 0) {
          const lines = dueResult.due.map((item) => '⏰ ' + item.text);
          base = {
            ...tickState,
            reminders: dueResult.rest,
            inbox: [...tickState.inbox, ...lines].slice(-INBOX_MAX),
          };
          save(base);
          for (const line of lines) speakReply(line);
          logLine(ctx, 'info', '[dsh-elysia] 提醒已触发：' + lines.join('；'));
        }
        void proactiveOnce(base)
          .then((result) => {
            if (result.said) save(result.state);
          })
          .catch((error: unknown) => {
            logLine(ctx, 'warn', '[dsh-elysia] 主动开口异常：' + (error instanceof Error ? error.message : String(error)));
          });
      }, tickMs);
      return () => {
        if (typeof handle === 'function') (handle as () => void)();
      };
    }, 'dsh-elysia.proactive()');
  } else {
    logLine(ctx, 'warn', '[dsh-elysia] 宿主没有 setInterval，主动开口不会自动运行（/elysia-say 仍可用）');
  }

  logLine(ctx, 'info', '[dsh-elysia] 已装载，存档：' + statePath);
}

// name / inject / apply 已就地导出；Config 从 config.ts 转出，凑齐 Loader 要的四件套。
export { Config };
