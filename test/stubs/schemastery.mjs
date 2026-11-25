/**
 * schemastery 的最小桩：链式默认值 + object/array。
 * 只用于让 config.ts 能在无依赖环境里 import，不做任何校验。
 */
function chain() {
  const schema = { default: (value) => ({ defaultValue: value }) };
  return schema;
}

const z = {
  boolean: chain,
  string: chain,
  number: chain,
  array: () => chain(),
  object: (shape) => ({ shape }),
};

export default z;
