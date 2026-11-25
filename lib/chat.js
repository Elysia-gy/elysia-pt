/**
 * 模型调用的唯一出口。
 *
 * 与手机端同一条纪律：任何功能要跟模型说话，都必须经过这里；场景提示词由 persona.ts 拼，
 * 这里只负责「发出去、把流拼回一段文本、失败回结构化原因」。
 * @module dsh-elysia/src/chat
 */
import { BlockAssembler, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
/** 调用身份：缺 sessionId 时部分服务商会直接回 400。 */
const CALL_SESSION_ID = 'dsh-elysia';
/** 默认读超时：一次闲聊不该拖过 30 秒。 */
export const REPLY_TIMEOUT_MS = 30_000;
/** 宿主当前的对话模型；取不到回 undefined。 */
export function currentModel(ctx) {
    try {
        const service = ctx.agentDefaultModel;
        const selection = service?.currentSelection();
        if (!selection || !selection.provider || !selection.model)
            return undefined;
        return { provider: selection.provider, model: selection.model };
    }
    catch {
        return undefined;
    }
}
/**
 * 生成一句回复。
 *
 * 失败不抛：调用方拿 `ok:false` 决定文案与退避。流式块用 `BlockAssembler` 拼，
 * 只取 text 块——推理块不进气泡。
 */
export async function generateReply(ctx, input) {
    const model = input.preferred ?? currentModel(ctx);
    if (!model)
        return { ok: false, message: '当前对话还没有配置模型，先选一个模型再聊吧。' };
    const llm = ctx.llm;
    if (!llm || typeof llm.stream !== 'function')
        return { ok: false, message: '宿主没有提供 llm 服务。' };
    const historyMessages = input.history.map((message) => message.role === 'user'
        ? createUserMessage({ content: [{ type: 'text', text: message.content }], source: { kind: 'user' } })
        : createAssistantMessage({ content: [{ type: 'text', text: message.content }], source: { provider: model.provider, model: model.model } }));
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
            assembler.push(chunk);
        }
    }
    catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    const text = assembler
        .blocks()
        .filter((block) => block.type === 'text')
        .map((block) => ('text' in block ? block.text : ''))
        .join('')
        .trim();
    if (!text)
        return { ok: false, message: '模型这次没有说出话来。' };
    return { ok: true, text };
}
