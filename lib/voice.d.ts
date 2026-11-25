/**
 * 朗读：把回复读出来（手机端 TTS 的桌面等价物）。
 *
 * 走 Windows 自带的 SAPI，不引入音频依赖、不联网：一句话一个短进程，
 * 说完自己退。失败一律吞掉——读不出来不该影响对话本身。
 * @module dsh-elysia/src/voice
 */
/**
 * 读一句话。
 *
 * @param text - 要念的内容（会去掉换行、截断）。
 * @param rate - 语速 -10~10，0 为正常。
 * @param onError - 失败回调（拿不到可用语音引擎时给宿主记一条）。
 */
export declare function speak(text: string, rate: number, onError?: (message: string) => void): void;
