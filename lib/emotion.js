/**
 * 情绪标签的唯一解析与解析兜底。
 *
 * 与手机端 `EmotionTagParser` 同一套约定：**只在末尾窗口剥白名单标签**，
 * 正文里正常的方括号不能被一刀切删；解析失败一律兜 undefined，不猜。
 * @module dsh-elysia/src/emotion
 */
/** 七维情绪：id 是磁盘与提示词的唯一取值，label 只用于展示。 */
export const EMOTION_DIMS = [
    { id: 'happy', label: '开心' },
    { id: 'calm', label: '踏实' },
    { id: 'sweet', label: '甜蜜' },
    { id: 'heartache', label: '心疼' },
    { id: 'worry', label: '担心' },
    { id: 'sad', label: '难过' },
    { id: 'jealous', label: '吃醋' },
];
/** 白名单：只认这七个 id，大小写不敏感。 */
export const EMOTION_IDS = EMOTION_DIMS.map((item) => item.id);
const TAG_PATTERN = /\s*[\[【(（]\s*(?:emotion|情绪)\s*[:：]\s*([A-Za-z]{2,12})\s*[\]】)）]\s*$/i;
/**
 * 剥掉末尾的情绪标签。
 *
 * 只匹配「末尾 + 白名单」这一种形态：正文中间的 `[emotion:happy]` 属于用户内容，
 * 不做处理（宁可多留，不要把主人写的东西吃掉）。
 */
export function parseEmotionTag(raw) {
    const text = raw.trim();
    const matched = TAG_PATTERN.exec(text);
    if (!matched)
        return { text };
    const id = (matched[1] ?? '').toLowerCase();
    if (!EMOTION_IDS.includes(id))
        return { text };
    return { text: text.slice(0, matched.index).trim(), emotion: id };
}
/** 展示名：未知 id 回 undefined，不把英文 id 直接抛给用户。 */
export function emotionLabel(id) {
    if (!id)
        return undefined;
    const hit = EMOTION_DIMS.find((item) => item.id === id);
    return hit?.label;
}
