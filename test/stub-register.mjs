/**
 * 冒烟入口：注册解析钩子。用法：
 *   node --experimental-strip-types --import ./test/stub-register.mjs --test test/smoke.test.ts
 */
import { register } from 'node:module';

register('./stub-loader.mjs', import.meta.url);
