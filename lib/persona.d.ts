/**
 * 人设与提示词装配。
 *
 * 三层拼装，顺序固定：人设正文 → 当下（时间/心情）→ 记忆附加段 → 场景后缀。
 * 记忆只走附加段、绝不写进人设正文：人设是用户可编辑可重置的，
 * 混进去一次「恢复默认」就把记忆一起抹了。
 * @module dsh-elysia/src/persona
 */
/** 官方人设正文（与手机端 GM 提示词同一份口径，改成桌面陪伴的说法）。 */
export declare const DEFAULT_PERSONA: string;
/** 场景：同一份人设，三种出口。 */
export type PersonaScene = 'chat' | 'proactive' | 'thought';
/** 时间感：决定该问早饭还是该催睡觉。 */
export declare function timeLine(nowMs: number): string;
/** 装配输入。 */
export interface PersonaInput {
    /** 用户自定义人设；空则用 `DEFAULT_PERSONA`。 */
    persona?: string;
    scene: PersonaScene;
    nowMs: number;
    /** `moodPromptLine()` 的产物。 */
    moodLine?: string;
    /** `buildRecallBlock()` 的产物；空则整段不出现。 */
    recallBlock?: string;
}
/**
 * 拼出 system。
 *
 * 任何一段为空都不留空行——提示词里的空洞比缺内容更容易让模型跑偏。
 */
export declare function buildSystemPrompt(input: PersonaInput): string;
