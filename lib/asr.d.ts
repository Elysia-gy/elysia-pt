/** 听一次的结果。 */
export type ListenResult = {
    ok: true;
    text: string;
} | {
    ok: false;
    message: string;
};
/**
 * 听一句中文，返回识别文字。
 *
 * @param timeoutMs - 进程级兜底超时；正常 5 秒没声音就自己退出。
 */
export declare function listenSpeech(timeoutMs?: number): Promise<ListenResult>;
