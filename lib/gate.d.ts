/**
 * 出站内容门禁（纯函数）：回复进主人眼睛之前，六层各自处置。
 *
 * 移植自手机端 `ContentGate`，分层处置而不是一股脑替换整句：
 *  - phone：11 位手机号就地打码，句子照常说；
 *  - contact：诱导加联系方式的那个分句删掉，其余照常说；
 *  - promptLeak：提示词泄露整句兜底（半句也是泄露）；
 *  - sensitive：敏感词整句兜底，词表默认空——宁可漏，别误伤正常聊天；
 *  - adLaw / spam：只在 `PLATFORM` 作用域生效（那是运营账号的合规要求，
 *    在主人自己的屏幕上说「这是最好的办法」谈不上广告）。
 * @module dsh-elysia/src/gate
 */
export type GateScope = 'CHAT' | 'PLATFORM';
/** 整句被拦下时换上的那句话。 */
export declare const GATE_FALLBACK_LINE = "\u5514\u2026\u8FD9\u53E5\u8BDD\u6211\u8FD8\u662F\u85CF\u5728\u5FC3\u91CC\u597D\u4E86\u3002";
/** 门禁结果：hits 记录命中的层，便于日志排查。 */
export interface GateResult {
    text: string;
    blocked: boolean;
    hits: string[];
}
/** 敏感词表默认空：填了才生效，填的词整句兜底。 */
export declare const DEFAULT_SENSITIVE_WORDS: readonly string[];
/** 主入口：过一遍六层。 */
export declare function gateText(text: string, options?: {
    scope?: GateScope;
    sensitiveWords?: readonly string[];
}): GateResult;
/** 长回复裁剪：按最大字数收，尽量在句末断开。 */
export declare function clampReply(text: string, maxChars: number): string;
