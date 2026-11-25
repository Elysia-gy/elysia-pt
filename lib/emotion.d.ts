/**
 * 情绪标签的唯一解析与解析兜底。
 *
 * 与手机端 `EmotionTagParser` 同一套约定：**只在末尾窗口剥白名单标签**，
 * 正文里正常的方括号不能被一刀切删；解析失败一律兜 undefined，不猜。
 * @module dsh-elysia/src/emotion
 */
/** 七维情绪：id 是磁盘与提示词的唯一取值，label 只用于展示。 */
export declare const EMOTION_DIMS: readonly [{
    readonly id: "happy";
    readonly label: "开心";
}, {
    readonly id: "calm";
    readonly label: "踏实";
}, {
    readonly id: "sweet";
    readonly label: "甜蜜";
}, {
    readonly id: "heartache";
    readonly label: "心疼";
}, {
    readonly id: "worry";
    readonly label: "担心";
}, {
    readonly id: "sad";
    readonly label: "难过";
}, {
    readonly id: "jealous";
    readonly label: "吃醋";
}];
/** 白名单：只认这七个 id，大小写不敏感。 */
export declare const EMOTION_IDS: readonly string[];
/** 一条回复的解析结果；emotion 缺省表示模型没吐标签或标签不在白名单。 */
export interface EmotionParse {
    text: string;
    emotion?: string;
}
/**
 * 剥掉末尾的情绪标签。
 *
 * 只匹配「末尾 + 白名单」这一种形态：正文中间的 `[emotion:happy]` 属于用户内容，
 * 不做处理（宁可多留，不要把主人写的东西吃掉）。
 */
export declare function parseEmotionTag(raw: string): EmotionParse;
/** 展示名：未知 id 回 undefined，不把英文 id 直接抛给用户。 */
export declare function emotionLabel(id: string | undefined): string | undefined;
