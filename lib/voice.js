/**
 * 朗读：把回复读出来（手机端 TTS 的桌面等价物）。
 *
 * 走 Windows 自带的 SAPI，不引入音频依赖、不联网：一句话一个短进程，
 * 说完自己退。失败一律吞掉——读不出来不该影响对话本身。
 * @module dsh-elysia/src/voice
 */
import { spawn } from 'node:child_process';
/** 一次朗读最多念多少字；太长会被系统语音拖成念稿。 */
const SPEAK_MAX = 200;
/** PowerShell 单引号字符串转义：内部的 `'` 要写成 `''`。 */
function psLiteral(text) {
    return "'" + text.replace(/'/g, "''") + "'";
}
/**
 * 读一句话。
 *
 * @param text - 要念的内容（会去掉换行、截断）。
 * @param rate - 语速 -10~10，0 为正常。
 * @param onError - 失败回调（拿不到可用语音引擎时给宿主记一条）。
 */
export function speak(text, rate, onError) {
    if (process.platform !== 'win32')
        return;
    const clean = text.replace(/[\r\n]+/g, ' ').trim().slice(0, SPEAK_MAX);
    if (clean === '')
        return;
    const safeRate = Math.max(-10, Math.min(10, Math.round(rate)));
    const script = 'Add-Type -AssemblyName System.Speech; ' +
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
        '$s.Rate = ' + safeRate + '; ' +
        '$s.Speak(' + psLiteral(clean) + ');';
    try {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            windowsHide: true,
            stdio: 'ignore',
            detached: false,
        });
        child.on('error', (error) => onError?.(error.message));
    }
    catch (error) {
        onError?.(error instanceof Error ? error.message : String(error));
    }
}
