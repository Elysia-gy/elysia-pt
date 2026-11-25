/** 候选端口：宿主按顺序占用第一个能用的，客户端按同一顺序探测。 */
export declare const API_PORTS: number[];
/** 宿主交给路由的动作。 */
export interface LocalApiDeps {
    status(): unknown;
    chat(text: string): Promise<{
        ok: true;
        text: string;
    } | {
        ok: false;
        message: string;
    }>;
    say(): Promise<{
        ok: true;
        text: string;
    } | {
        ok: false;
        message: string;
    }>;
    forget(): void;
    /** 摸摸一次（亲密度任务）。 */
    touch(): unknown;
    /** 陪伴若干秒（亲密度任务）。 */
    stay(seconds: number): unknown;
    /** 听一句语音并返回识别文字。 */
    listen(): Promise<{
        ok: true;
        text: string;
    } | {
        ok: false;
        message: string;
    }>;
    /** 用系统语音念一句（桌面端聊天回复的朗读）。 */
    speak(text: string): void;
    /** 某一类台词文本（桌面独立窗口用）。 */
    lines(category: string): string[];
    /** 拉起桌面独立窗口；返回是否成功。 */
    desktopStart(): boolean;
    /** 关闭桌面独立窗口。 */
    desktopStop(): void;
    /** 桌面独立窗口是否在跑。 */
    desktopActive(): boolean;
}
/** 起服务后的句柄。 */
export interface LocalApiHandle {
    /** 实际占用端口；起不来时为 0。 */
    port: number;
    dispose(): void;
}
/**
 * 起本机接口：从 7823 起找第一个能绑的端口。
 *
 * @param deps - 四个动作。
 * @param onError - 起不来 / 运行期出错时的回调。
 * @param onReady - 监听成功后的回调（桌面独立窗口要用实际端口）。
 * @returns 句柄；全占满时返回 `{port:0, dispose(){}}`。
 */
export declare function startLocalApi(deps: LocalApiDeps, onError?: (message: string) => void, onReady?: (port: number) => void): LocalApiHandle;
