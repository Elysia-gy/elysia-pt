/** 桌面窗口控制器。 */
export interface DesktopPetHandle {
    /** 子进程是否还活着。 */
    active(): boolean;
    /** 拉起桌面窗口；端口没就绪或 exe 缺失时返回 false。 */
    start(port: number, dshExe: string): boolean;
    /** 结束桌面窗口。 */
    stop(): void;
    /** 插件卸载时调用。 */
    dispose(): void;
}
/**
 * 造一个桌面窗口控制器。
 *
 * @param log - 宿主日志回调。
 * @returns 控制器；同一时间最多一个子进程。
 */
export declare function createDesktopPet(log: (message: string) => void): DesktopPetHandle;
