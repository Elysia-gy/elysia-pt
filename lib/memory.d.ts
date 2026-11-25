/**
 * 四层长期记忆（纯函数，零 IO）：Tier0 工作记忆 → Tier1 情节 → Tier2 事实 → Tier3 摘要。
 *
 * 移植自手机端 `MemoryStore`，召回保留那四处修补：
 *  1. **人称归一**：查询里的「我/我们」映射成「主人」，再造一份 0.9 权重的变体；
 *  2. **槽位意图**：问句带「几岁/叫什么/住哪」时同槽事实加权，不必字面命中；
 *  3. **IDF 加权 + 覆盖率**：常用词权重低、稀有词权重高，长句不被稀释；
 *  4. **身份常驻**：名字/年龄/城市永远带上，不参与阈值淘汰。
 * @module dsh-elysia/src/memory
 */
/** Tier0 上限：最近 12 条原始对话。 */
export declare const TURNS_MAX = 12;
/** Tier1 上限：120 段情节。 */
export declare const EPISODES_MAX = 120;
/** Tier2 上限：60 条事实。 */
export declare const FACTS_MAX = 60;
/** Tier3 上限：150 字滚动摘要。 */
export declare const SUMMARY_MAX_CHARS = 150;
/** 每折叠一次吃掉 6 条最老的工作记忆。 */
export declare const FOLD_TURNS = 6;
/** 情节摘要 80 字进提示词，全文 240 字只用于匹配。 */
export declare const EPISODE_SUM_CHARS = 80;
export declare const EPISODE_FULL_CHARS = 240;
/** 单条事实的准入分。 */
export declare const RECALL_MIN_SCORE = 0.25;
/** 身份槽：永远带上。 */
export declare const PINNED_SLOTS: readonly ["name", "age", "city"];
/** 独占槽：同槽只留最新一条。 */
export declare const EXCLUSIVE_SLOTS: readonly ["name", "age", "city", "job"];
export type MemoryRole = 'user' | 'assistant';
/** 一条原始对话。 */
export interface MemoryTurn {
    role: MemoryRole;
    text: string;
    at: number;
}
/** 一段情节：6 条原话折一条，`sum` 进提示词、`full` 只用于匹配。 */
export interface MemoryEpisode {
    id: string;
    sum: string;
    full: string;
    at: number;
}
/** 一条画像事实。 */
export interface MemoryFact {
    id: string;
    text: string;
    slot: string;
    value: string;
    at: number;
    /** 预留：命中次数，目前只写不读，与手机端同源。 */
    key?: string;
}
/** 整份记忆存档。 */
export interface MemoryState {
    turns: MemoryTurn[];
    episodes: MemoryEpisode[];
    facts: MemoryFact[];
    summary: string;
    updatedAt: number;
}
/** 一次召回的结果。 */
export interface RecallResult {
    facts: MemoryFact[];
    episodes: MemoryEpisode[];
    summary: string;
}
/** 一段情节的折叠输入。 */
export interface EpisodeInput {
    turns: readonly MemoryTurn[];
    at: number;
}
/** 空白记忆。 */
export declare function createMemory(): MemoryState;
/**
 * 切词：英文/数字按词，中文按二元组（单字单独成词）。
 *
 * 不分词库、不引依赖——与手机端一致：中文二元组足以撑起「字面相近」，
 * 真正的语义靠槽位意图与人称归一补。
 */
export declare function tokenize(text: string): string[];
/** 查询侧人称归一：`我/我们` → `主人`，让「我叫什么」能命中「主人叫小明」。 */
export declare function normalizeQuery(query: string): string;
/** 问句命中的槽位意图；无命中回 undefined。 */
export declare function slotIntent(query: string): string | undefined;
/**
 * 召回：身份事实常驻 + 相关事实 + 相关情节 + 摘要。
 *
 * 查询会同时按原文与「人称归一版」各打一次分，取高者；归一版权重 0.9。
 */
export declare function recall(state: MemoryState, query: string, limit?: number): RecallResult;
/** 把召回结果拼成提示词里的一段；空召回回空串，让调用方决定不注入。 */
export declare function buildRecallBlock(result: RecallResult): string;
/** 追加一条对话；返回新数组，调用方负责落盘。 */
export declare function addTurn(state: MemoryState, role: MemoryRole, text: string, at: number): MemoryState;
/**
 * 折叠：Tier0 超过 12 条时，把最老的 6 条压成一段情节。
 *
 * `sum` 取前 80 字（进提示词），`full` 保留 240 字（只用于匹配）——
 * 与手机端同一条纪律：词集必须按 full 算，按摘要算会把被截断的后半句永远召不回来。
 */
export declare function consolidate(state: MemoryState, input: EpisodeInput): MemoryState;
/** 从一句话里抽事实（零到多条）。 */
export declare function extractFacts(text: string, at: number): MemoryFact[];
/**
 * 合并事实：独占槽只留最新一条，其余按「槽位 + 值」去重，总数封顶 60。
 */
export declare function mergeFacts(state: MemoryState, incoming: readonly MemoryFact[], at: number): MemoryState;
/** 清空（保留空壳），`/elysia-forget` 用。 */
export declare function clearMemory(): MemoryState;
