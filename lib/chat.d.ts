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
/** 默认读超时：一次闲聊不该拖过 30 秒。 */
export declare const REPLY_TIMEOUT_MS = 30000;
/** 宿主当前的对话模型；取不到回 undefined。 */
export declare function currentModel(ctx: unknown): ModelRef | undefined;
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
export declare function generateReply(ctx: unknown, input: GenerateInput): Promise<Reply>;
