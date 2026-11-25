/**
 * 模型调用的唯一出口。
 *
 * 与手机端同一条纪律：任何功能要跟模型说话，都必须经过这里；场景提示词由 persona.ts 拼，
 * 这里只负责「发出去、把流拼回一段文本、失败回结构化原因」。
 * @module dsh-elysia/src/chat
 */
import { BlockAssembler, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm';

/** 一处「服务商 + 模型」。 */
export interface ModelRef {
  provider: string;
  model: string;
}

/** 历史消息（本插件自己存的形态，不引宿主类型）。 */
export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 生成成功。 */
export interface ReplyOk {
  ok: true;
  text: string;
}

/** 生成失败：`message` 可直接给用户看。 */
export interface ReplyFail {
  ok: false;
  message: string;
}

export type Reply = ReplyOk | ReplyFail;

/** 调用身份：缺 sessionId 时部分服务商会直接回 400。 */
const CALL_SESSION_ID = 'dsh-elysia';

/** 默认读超时：一次闲聊不该拖过 30 秒。 */
export const REPLY_TIMEOUT_MS = 30_000;

/** 宿主当前的对话模型；取不到回 undefined。 */
export function currentModel(ctx: unknown): ModelRef | undefined {
  try {
    const service = (ctx as { agentDefaultModel?: { currentSelection(): ModelRef } }).agentDefaultModel;
    const selection = service?.currentSelection();
    if (!selection || !selection.provider || !selection.model) return undefined;
    return { provider: selection.provider, model: selection.model };
  } catch {
    return undefined;
  }
}

/** 生成输入。 */
export interface GenerateInput {
  system: string;
  history: readonly ChatHistoryMessage[];
  userText: string;
  /** 配置里指定的模型；空则跟随当前对话。 */
  preferred?: ModelRef;
  timeoutMs?: number;
}

/**
 * 生成一句回复。
 *
 * 失败不抛：调用方拿 `ok:false` 决定文案与退避。流式块用 `BlockAssembler` 拼，
 * 只取 text 块——推理块不进气泡。
 */
export async function generateReply(ctx: unknown, input: GenerateInput): Promise<Reply> {
  const model = input.preferred ?? currentModel(ctx);
  if (!model) return { ok: false, message: '当前对话还没有配置模型，先选一个模型再聊吧。' };
  const llm = (ctx as { llm?: { stream(options: unknown): AsyncIterable<unknown> } }).llm;
  if (!llm || typeof llm.stream !== 'function') return { ok: false, message: '宿主没有提供 llm 服务。' };

  const historyMessages = input.history.map((message) =>
    message.role === 'user'
      ? createUserMessage({ content: [{ type: 'text', text: message.content }], source: { kind: 'user' } })
      : createAssistantMessage({ content: [{ type: 'text', text: message.content }], source: { provider: model.provider, model: model.model } }),
  );

  const assembler = new BlockAssembler();
  try {
    const options = {
      provider: model.provider,
      model: model.model,
      sessionId: CALL_SESSION_ID,
      messages: [...historyMessages, createUserMessage({ content: [{ type: 'text', text: input.userText }], source: { kind: 'user' } })],
      system: input.system,
      temperature: 1,
      signal: AbortSignal.timeout(input.timeoutMs ?? REPLY_TIMEOUT_MS),
    };
    for await (const chunk of llm.stream(options)) {
      assembler.push(chunk as Parameters<BlockAssembler['push']>[0]);
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  const text = assembler
    .blocks()
    .filter((block) => block.type === 'text')
    .map((block) => ('text' in block ? (block as { text: string }).text : ''))
    .join('')
    .trim();
  if (!text) return { ok: false, message: '模型这次没有说出话来。' };
  return { ok: true, text };
}
