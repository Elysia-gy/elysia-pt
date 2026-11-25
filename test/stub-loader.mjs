/**
 * ESM 解析钩子：把 `@deepseek-ai/<name>` 指到 test/stubs/<name>.mjs。
 *
 * 目的只有一个——在没装 DSH 的机器上也能跑装配冒烟，不必把假包塞进 node_modules。
 */
const STUB_PREFIX = '@deepseek-ai/';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(STUB_PREFIX)) {
    const name = specifier.slice(STUB_PREFIX.length);
    return { url: new URL('./stubs/' + name + '.mjs', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
