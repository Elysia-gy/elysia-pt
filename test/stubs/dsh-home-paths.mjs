/**
 * 冒烟用的最小桩：只为在没有 DSH 依赖的机器上验证装配是否正确。
 * 真实行为以宿主实现为准，这里只保证「接口存在、能返回」。
 */
export function resolveDshHome() {
  return process.env.DSH_HOME || 'C:/tmp/dsh-home';
}
