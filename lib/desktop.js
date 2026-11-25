/**
 * 桌面独立窗口的生命周期：由宿主拉起 `assets/desktop/ElysiaDesktopPet.exe`。
 *
 * 为什么不是 BrowserWindow：插件宿主拿不到 Electron 模块（实测 `require('electron')` 失败），
 * 所以用 Windows 自带的 .NET WPF 透明置顶窗，零额外运行时、不下载 Electron。
 * 子进程随插件卸载一起结束；异常退出后 `active()` 自动回到 false，窗口内浮层会重新出现。
 * @module dsh-elysia/src/desktop
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
/** exe 路径：`lib/` 的上一级 assets/desktop。 */
const EXE_PATH = fileURLToPath(new URL('../assets/desktop/ElysiaDesktopPet.exe', import.meta.url));
/**
 * 造一个桌面窗口控制器。
 *
 * @param log - 宿主日志回调。
 * @returns 控制器；同一时间最多一个子进程。
 */
export function createDesktopPet(log) {
    let child = null;
    const clear = () => {
        child = null;
    };
    const start = (port, dshExe) => {
        if (child !== null)
            return true;
        if (port <= 0) {
            log('[dsh-elysia] 桌面版启动失败：本机接口还没就绪');
            return false;
        }
        if (!existsSync(EXE_PATH)) {
            log('[dsh-elysia] 桌面版启动失败：找不到 ' + EXE_PATH);
            return false;
        }
        try {
            const args = ['--api', 'http://127.0.0.1:' + String(port)];
            if (dshExe !== '')
                args.push('--dsh', dshExe);
            const proc = spawn(EXE_PATH, args, { stdio: 'ignore', windowsHide: true });
            child = proc;
            proc.on('exit', clear);
            proc.on('error', (error) => {
                log('[dsh-elysia] 桌面版进程错误：' + error.message);
                clear();
            });
            log('[dsh-elysia] 桌面版已启动');
            return true;
        }
        catch (error) {
            log('[dsh-elysia] 桌面版启动异常：' + (error instanceof Error ? error.message : String(error)));
            clear();
            return false;
        }
    };
    const stop = () => {
        const proc = child;
        child = null;
        if (proc === null)
            return;
        try {
            proc.kill();
        }
        catch {
            // 已经退出就算了。
        }
    };
    return {
        active: () => child !== null,
        start,
        stop,
        dispose: stop,
    };
}
