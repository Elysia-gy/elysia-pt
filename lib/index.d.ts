import { Config, type ElysiaPluginConfig } from './config.ts';
/** 插件名（Cordis 插件 id）。 */
export declare const name = "elysia";
/** 需要的宿主服务：当前模型、LLM、斜杠命令（界面走本机回环接口，不经网关）。 */
export declare const inject: string[];
/**
 * 装配入口。
 *
 * @param ctx - 宿主上下文（只用到 effect / commands / llm / agentDefaultModel / logger）。
 * @param config - 见 `config.ts`；默认值已由 schema 填好。
 */
export declare function apply(ctx: unknown, config: ElysiaPluginConfig): void;
export { Config };
