/**
 * dsh-llm 的最小桩：消息构造 + 文本块拼装 + 可注入的流。
 * 只覆盖本插件用到的四个导出，行为与真实实现同构（流块 → text 块）。
 */
export function createUserMessage(input) {
  return { role: 'user', ...input };
}

export function createAssistantMessage(input) {
  return { role: 'assistant', ...input };
}

export class BlockAssembler {
  #text = '';

  push(chunk) {
    if (chunk && chunk.type === 'text' && typeof chunk.text === 'string') this.#text += chunk.text;
  }

  blocks() {
    return [{ type: 'text', text: this.#text }];
  }
}
