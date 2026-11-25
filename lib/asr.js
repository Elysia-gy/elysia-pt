/**
 * 离线语音识别：调 Windows 自带的 System.Speech 听一句。
 *
 * 不联网、不装模型，用的是系统里已安装的识别器（中文桌面一般有 zh-CN）。
 * 每次点麦克风起一个 powershell 进程，说完自动断句返回文字；没声音就超时返回。
 * @module dsh-elysia/src/asr
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/** 一次听写的识别脚本：静音 5 秒放弃，整段最多 15 秒。 */
const SCRIPT = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
try {
  $culture = [System.Globalization.CultureInfo]::GetCultureInfo("zh-CN")
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)
} catch {
  try { $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine } catch { "ERR: " + $_.Exception.Message; exit 0 }
}
try {
  $engine.SetInputToDefaultAudioDevice()
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(5)
  $engine.BabbleTimeout = [TimeSpan]::FromSeconds(4)
  $engine.EndSilenceTimeout = [TimeSpan]::FromSeconds(1.2)
  $engine.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromSeconds(1.5)
  $result = $engine.Recognize([TimeSpan]::FromSeconds(15))
  if ($null -eq $result) { "NO_SPEECH" } else { $result.Text }
} catch {
  "ERR: " + $_.Exception.Message
} finally {
  try { $engine.Dispose() } catch { }
}
`;
/** 脚本落盘一次即可，每次调用复用。 */
let scriptPath = null;
function ensureScript() {
    if (scriptPath !== null)
        return scriptPath;
    const path = join(tmpdir(), 'dsh-elysia-asr.ps1');
    writeFileSync(path, SCRIPT, 'utf8');
    scriptPath = path;
    return path;
}
/**
 * 听一句中文，返回识别文字。
 *
 * @param timeoutMs - 进程级兜底超时；正常 5 秒没声音就自己退出。
 */
export function listenSpeech(timeoutMs = 25_000) {
    if (process.platform !== 'win32') {
        return Promise.resolve({ ok: false, message: '语音输入只支持 Windows 桌面端。' });
    }
    let file;
    try {
        file = ensureScript();
    }
    catch (error) {
        return Promise.resolve({ ok: false, message: '写识别脚本失败：' + (error instanceof Error ? error.message : String(error)) });
    }
    return new Promise((resolve) => {
        let settled = false;
        const done = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        let child;
        try {
            child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        }
        catch (error) {
            resolve({ ok: false, message: '启动语音识别失败：' + (error instanceof Error ? error.message : String(error)) });
            return;
        }
        let out = '';
        let err = '';
        child.stdout?.on('data', (chunk) => {
            out += chunk.toString('utf8');
        });
        child.stderr?.on('data', (chunk) => {
            err += chunk.toString('utf8');
        });
        child.on('error', (error) => {
            done({ ok: false, message: '启动语音识别失败：' + error.message });
        });
        child.on('close', () => {
            const text = out.trim();
            if (text === 'NO_SPEECH' || text === '') {
                done({ ok: false, message: err.trim() !== '' ? '没听清，再说一次？' : '没听到声音，再说一次？' });
                return;
            }
            if (text.startsWith('ERR:')) {
                done({ ok: false, message: text.replace(/^ERR:\s*/, '') });
                return;
            }
            done({ ok: true, text });
        });
        const timer = setTimeout(() => {
            try {
                child.kill();
            }
            catch {
                // 进程可能已经没了。
            }
            done({ ok: false, message: '等太久没听到声音，再试一次？' });
        }, timeoutMs);
    });
}
