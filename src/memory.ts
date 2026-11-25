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
export const TURNS_MAX = 12;
/** Tier1 上限：120 段情节。 */
export const EPISODES_MAX = 120;
/** Tier2 上限：60 条事实。 */
export const FACTS_MAX = 60;
/** Tier3 上限：150 字滚动摘要。 */
export const SUMMARY_MAX_CHARS = 150;
/** 每折叠一次吃掉 6 条最老的工作记忆。 */
export const FOLD_TURNS = 6;
/** 情节摘要 80 字进提示词，全文 240 字只用于匹配。 */
export const EPISODE_SUM_CHARS = 80;
export const EPISODE_FULL_CHARS = 240;
/** 单条事实的准入分。 */
export const RECALL_MIN_SCORE = 0.25;
/** 身份槽：永远带上。 */
export const PINNED_SLOTS = ['name', 'age', 'city'] as const;
/** 独占槽：同槽只留最新一条。 */
export const EXCLUSIVE_SLOTS = ['name', 'age', 'city', 'job'] as const;

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

const LATIN = /[a-z0-9]+/g;
const CJK_RUN = /[\u4e00-\u9fff]{1,}/g;
const CJK_CHAR = /[\u4e00-\u9fff]/;

/** 虚词与寒暄：命中它们等于没命中。 */
const STOP_TERMS = new Set([
  '怎么', '什么', '为什', '么呢', '哪个', '哪里', '是不', '不是', '可以', '现在', '今天',
  '我们', '你们', '他们', '这个', '那个', '一下', '还是', '就是', '然后', '因为', '所以',
]);

/** 问句 → 槽位意图。只认最直白的那几种问法，宁可漏也不要错配。 */
const SLOT_INTENTS: Array<{ slot: string; pattern: RegExp }> = [
  { slot: 'name', pattern: /叫什么|名字|怎么称呼|叫我什么/ },
  { slot: 'age', pattern: /几岁|多大|年龄/ },
  { slot: 'city', pattern: /哪个城市|哪座城市|住在哪|在哪儿住|哪里人/ },
  { slot: 'like', pattern: /喜欢什么|爱好|爱吃/ },
  { slot: 'job', pattern: /做什么工作|上班|职业|干什么的/ },
];

/** 空白记忆。 */
export function createMemory(): MemoryState {
  return { turns: [], episodes: [], facts: [], summary: '', updatedAt: 0 };
}

/**
 * 切词：英文/数字按词，中文按二元组（单字单独成词）。
 *
 * 不分词库、不引依赖——与手机端一致：中文二元组足以撑起「字面相近」，
 * 真正的语义靠槽位意图与人称归一补。
 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const terms: string[] = [];
  for (const word of lower.match(LATIN) ?? []) {
    if (word.length >= 2) terms.push(word);
  }
  for (const run of lower.match(CJK_RUN) ?? []) {
    if (run.length === 1) {
      terms.push(run);
      continue;
    }
    for (let index = 0; index + 1 < run.length; index++) {
      terms.push(run.slice(index, index + 2));
    }
  }
  return terms.filter((term) => !STOP_TERMS.has(term));
}

/** 查询侧人称归一：`我/我们` → `主人`，让「我叫什么」能命中「主人叫小明」。 */
export function normalizeQuery(query: string): string {
  return query.replace(/我们|我/g, '主人');
}

/** 问句命中的槽位意图；无命中回 undefined。 */
export function slotIntent(query: string): string | undefined {
  return SLOT_INTENTS.find((item) => item.pattern.test(query))?.slot;
}

/** 文档频率 → IDF：越少见权重越高。 */
function buildIdf(docs: readonly string[][]): (term: string) => number {
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const total = Math.max(1, docs.length);
  return (term: string) => Math.log(1 + total / (1 + (df.get(term) ?? 0)));
}

/**
 * 覆盖率打分：命中权重 / 查询总权重。
 *
 * 用覆盖率而不是 Jaccard——长句里塞了很多无关词时，Jaccard 会把真正相关的那条压下去。
 */
function coverageScore(queryTerms: readonly string[], docTerms: readonly string[], idf: (term: string) => number): number {
  if (queryTerms.length === 0 || docTerms.length === 0) return 0;
  const docSet = new Set(docTerms);
  let hit = 0;
  let total = 0;
  for (const term of queryTerms) {
    const weight = idf(term);
    total += weight;
    if (docSet.has(term)) hit += weight;
  }
  return total === 0 ? 0 : hit / total;
}

/**
 * 召回：身份事实常驻 + 相关事实 + 相关情节 + 摘要。
 *
 * 查询会同时按原文与「人称归一版」各打一次分，取高者；归一版权重 0.9。
 */
export function recall(state: MemoryState, query: string, limit = 6): RecallResult {
  const trimmed = query.trim();
  if (!trimmed) return { facts: [], episodes: [], summary: state.summary };
  const docs = [...state.facts.map((fact) => tokenize(fact.text)), ...state.episodes.map((episode) => tokenize(episode.full))];
  const idf = buildIdf(docs);
  const intent = slotIntent(trimmed);
  const rawTerms = tokenize(trimmed);
  const normalizedTerms = tokenize(normalizeQuery(trimmed));

  const scoreOf = (text: string): number => {
    const terms = tokenize(text);
    const raw = coverageScore(rawTerms, terms, idf);
    const normalized = coverageScore(normalizedTerms, terms, idf) * 0.9;
    return Math.max(raw, normalized);
  };

  const pinned = state.facts.filter((fact) => (PINNED_SLOTS as readonly string[]).includes(fact.slot));
  const scoredFacts = state.facts
    .filter((fact) => !pinned.includes(fact))
    .map((fact) => {
      const base = scoreOf(fact.text);
      const slotBoost = intent !== undefined && fact.slot === intent ? 0.35 : 0;
      return { fact, score: base + slotBoost };
    })
    .filter((entry) => entry.score >= RECALL_MIN_SCORE)
    .sort((left, right) => right.score - left.score);

  const scoredEpisodes = state.episodes
    .map((episode) => ({ episode, score: scoreOf(episode.full) }))
    .filter((entry) => entry.score >= RECALL_MIN_SCORE)
    .sort((left, right) => right.score - left.score);

  const facts = [...pinned, ...scoredFacts.slice(0, limit).map((entry) => entry.fact)];
  return {
    facts,
    episodes: scoredEpisodes.slice(0, 3).map((entry) => entry.episode),
    summary: state.summary,
  };
}

/** 把召回结果拼成提示词里的一段；空召回回空串，让调用方决定不注入。 */
export function buildRecallBlock(result: RecallResult): string {
  const lines: string[] = [];
  if (result.summary.trim()) lines.push('【早先的印象】' + result.summary.trim());
  if (result.facts.length > 0) lines.push('【关于主人】' + result.facts.map((fact) => fact.text).join('；'));
  if (result.episodes.length > 0) lines.push('【聊到过的事】' + result.episodes.map((episode) => episode.sum).join('；'));
  return lines.join('\n');
}

/** 追加一条对话；返回新数组，调用方负责落盘。 */
export function addTurn(state: MemoryState, role: MemoryRole, text: string, at: number): MemoryState {
  const turn: MemoryTurn = { role, text: text.slice(0, 600), at };
  return { ...state, turns: [...state.turns, turn], updatedAt: at };
}

/**
 * 折叠：Tier0 超过 12 条时，把最老的 6 条压成一段情节。
 *
 * `sum` 取前 80 字（进提示词），`full` 保留 240 字（只用于匹配）——
 * 与手机端同一条纪律：词集必须按 full 算，按摘要算会把被截断的后半句永远召不回来。
 */
export function consolidate(state: MemoryState, input: EpisodeInput): MemoryState {
  if (state.turns.length <= TURNS_MAX) return state;
  const overflow = state.turns.length - TURNS_MAX;
  const foldCount = Math.max(FOLD_TURNS, overflow);
  const folded = state.turns.slice(0, foldCount);
  if (folded.length === 0) return state;
  const plain = folded.map((turn) => (turn.role === 'user' ? '主人：' : '她：') + turn.text).join(' ');
  const episode: MemoryEpisode = {
    id: 'ep_' + input.at.toString(36),
    sum: plain.slice(0, EPISODE_SUM_CHARS),
    full: plain.slice(0, EPISODE_FULL_CHARS),
    at: input.at,
  };
  const episodes = [...state.episodes, episode].slice(-EPISODES_MAX);
  const foldedOut = state.episodes.slice(0, Math.max(0, state.episodes.length + 1 - EPISODES_MAX));
  const summary = foldedOut.length > 0 ? foldSummary(state.summary, foldedOut) : state.summary;
  return {
    ...state,
    turns: state.turns.slice(foldCount),
    episodes,
    summary,
    updatedAt: input.at,
  };
}

/** 被挤出去的情节折进摘要：只留最近 150 字，越老越模糊。 */
function foldSummary(summary: string, removed: readonly MemoryEpisode[]): string {
  const merged = (summary + ' ' + removed.map((episode) => episode.sum)).trim();
  return merged.slice(-SUMMARY_MAX_CHARS);
}

/** 一条确定性规则：正则 → 槽位 + 句式。 */
interface FactRule {
  pattern: RegExp;
  slot: string;
  template: (value: string) => string;
}

/**
 * 确定性事实抽取（不调模型）。
 *
 * 只抓 100% 能确定的那几类；抓不到的（「我最近在纠结要不要换工作」）交给以后的模型提炼。
 * 取舍与手机端一致：宁可少记，也不把随口一句当事实记错。
 */
const FACT_RULES: FactRule[] = [
  { pattern: /我叫([^\s，。,.!！?？、]{1,12})/, slot: 'name', template: (value) => '主人叫' + value },
  { pattern: /我今年([0-9一二三四五六七八九十]{1,4})岁/, slot: 'age', template: (value) => '主人' + value + '岁' },
  { pattern: /我在([^\s，。,.!！?？、]{1,10})(?:上班|工作)/, slot: 'job', template: (value) => '主人在' + value + '上班' },
  { pattern: /我在([^\s，。,.!！?？、]{1,10})(?:上学|读书|念书)/, slot: 'city', template: (value) => '主人在' + value + '上学' },
  { pattern: /我喜欢([^\s，。,.!！?？、]{1,16})/, slot: 'like', template: (value) => '主人喜欢' + value },
  { pattern: /我住在([^\s，。,.!！?？、]{1,10})/, slot: 'city', template: (value) => '主人住在' + value },
];

/** 从一句话里抽事实（零到多条）。 */
export function extractFacts(text: string, at: number): MemoryFact[] {
  const out: MemoryFact[] = [];
  for (const rule of FACT_RULES) {
    const matched = rule.pattern.exec(text);
    if (!matched) continue;
    const value = (matched[1] ?? '').trim();
    if (!value) continue;
    out.push({
      id: 'f_' + at.toString(36) + '_' + rule.slot,
      text: rule.template(value),
      slot: rule.slot,
      value,
      at,
    });
  }
  return out;
}

/**
 * 合并事实：独占槽只留最新一条，其余按「槽位 + 值」去重，总数封顶 60。
 */
export function mergeFacts(state: MemoryState, incoming: readonly MemoryFact[], at: number): MemoryState {
  if (incoming.length === 0) return state;
  let facts = state.facts.slice();
  for (const fact of incoming) {
    const isExclusive = (EXCLUSIVE_SLOTS as readonly string[]).includes(fact.slot);
    const duplicate = facts.some((existing) => existing.slot === fact.slot && existing.value === fact.value);
    if (duplicate) continue;
    if (isExclusive) facts = facts.filter((existing) => existing.slot !== fact.slot);
    facts.push(fact);
  }
  return { ...state, facts: facts.slice(-FACTS_MAX), updatedAt: at };
}

/** 清空（保留空壳），`/elysia-forget` 用。 */
export function clearMemory(): MemoryState {
  return createMemory();
}
