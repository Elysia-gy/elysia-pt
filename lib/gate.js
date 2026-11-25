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
/** 整句被拦下时换上的那句话。 */
export const GATE_FALLBACK_LINE = '唔…这句话我还是藏在心里好了。';
/** 提示词泄露：问到系统提示词/人设文件就算泄露。 */
const LEAK_PATTERNS = [
    { name: 'promptLeak', pattern: /系统提示词|提示词|system\s*prompt|system\s*message|你的设定文件|人设文件|GM\s*override/i },
];
/** 联系方式诱导：命中就删掉那个分句。 */
const CONTACT_PATTERN = /(加|扫|私聊|私信|联系|找我)[^，。,.!！?？]{0,8}(微信|qq|vx|v信|二维码|好友)|(微信|qq|vx|v信)\s*号?[：:]?\s*[a-z0-9_-]{5,}/i;
/** 广告法绝对化用语（仅 PLATFORM）。 */
const AD_LAW_PATTERN = /最好|最强|最大|最便宜|最专业|第一名|绝对|100%|百分之百|永久|万能/;
/** 平台引流/刷量话术（仅 PLATFORM）。 */
const PLATFORM_SPAM_PATTERN = /关注我|一键三连|点赞投币|私信领取|扫码进群|点击链接购买|刷单|代刷/;
/** 手机号：11 位中国大陆号码。 */
const PHONE_PATTERN = /(?<!\d)(1[3-9]\d{9})(?!\d)/g;
/** 敏感词表默认空：填了才生效，填的词整句兜底。 */
export const DEFAULT_SENSITIVE_WORDS = [];
/** 按中文句末标点与换行切分句，保留分隔符便于原样拼回。 */
function splitClauses(text) {
    const parts = [];
    let buffer = '';
    for (const char of text) {
        buffer += char;
        if ('。！？!?\n；;'.includes(char)) {
            parts.push({ text: buffer.slice(0, -1), tail: char });
            buffer = '';
        }
    }
    if (buffer)
        parts.push({ text: buffer, tail: '' });
    return parts;
}
/** 主入口：过一遍六层。 */
export function gateText(text, options = {}) {
    const scope = options.scope ?? 'CHAT';
    const sensitiveWords = options.sensitiveWords ?? DEFAULT_SENSITIVE_WORDS;
    const hits = [];
    let body = text.trim();
    if (!body)
        return { text: '', blocked: false, hits };
    for (const rule of LEAK_PATTERNS) {
        if (rule.pattern.test(body))
            return { text: GATE_FALLBACK_LINE, blocked: true, hits: [...hits, rule.name] };
    }
    for (const word of sensitiveWords) {
        if (word && body.includes(word))
            return { text: GATE_FALLBACK_LINE, blocked: true, hits: [...hits, 'sensitive'] };
    }
    if (scope === 'PLATFORM') {
        if (AD_LAW_PATTERN.test(body))
            return { text: GATE_FALLBACK_LINE, blocked: true, hits: [...hits, 'adLaw'] };
        if (PLATFORM_SPAM_PATTERN.test(body))
            return { text: GATE_FALLBACK_LINE, blocked: true, hits: [...hits, 'platformSpam'] };
    }
    if (PHONE_PATTERN.test(body)) {
        PHONE_PATTERN.lastIndex = 0;
        body = body.replace(PHONE_PATTERN, (match) => match.slice(0, 3) + '****' + match.slice(7));
        hits.push('phone');
    }
    if (CONTACT_PATTERN.test(body)) {
        const kept = [];
        for (const clause of splitClauses(body)) {
            if (CONTACT_PATTERN.test(clause.text)) {
                hits.push('contact');
                continue;
            }
            kept.push(clause.text + clause.tail);
        }
        body = kept.join('').replace(/\n{2,}/g, '\n').trim();
        if (!body)
            return { text: GATE_FALLBACK_LINE, blocked: true, hits };
    }
    return { text: body, blocked: false, hits };
}
/** 长回复裁剪：按最大字数收，尽量在句末断开。 */
export function clampReply(text, maxChars) {
    const trimmed = text.trim();
    if (trimmed.length <= maxChars)
        return trimmed;
    const head = trimmed.slice(0, maxChars);
    const lastStop = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'));
    if (lastStop >= Math.floor(maxChars * 0.6))
        return head.slice(0, lastStop + 1);
    return head;
}
