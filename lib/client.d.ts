/**
 * 浏览器半边：桌上的爱莉希雅 + 设置页里的控制卡片。
 *
 * 两块东西共用一份通信方式：宿主自己起的本机回环接口（见 local-api.ts）。
 *  - 桌宠：挂在 `shell.overlay` 上，右下角常驻立绘，待机四帧循环 + 眨眼，
 *    单击让她说一句、双击开小输入框、拖动换位置、右上角可以收起；
 *  - 设置卡片：心情/记忆/主动次数 + 发送、让她说、刷新、清空记忆、重新召唤桌宠。
 *
 * 这是**普通副作用脚本**：没有顶层 import / export，react 由宿主注入的
 * `__ModuleLoader__` factory 的 `require` 取得——这是 DSH 客户端插件的加载契约。
 * @module dsh-elysia/src/client
 */
/** 宿主注入的模块加载器与浏览器全局（不依赖 DOM lib，全部显式声明）。 */
declare const window: {
    __ModuleLoader__: {
        load(info: {
            id: string;
            factory: (require: (name: string) => unknown) => unknown;
        }): void;
    };
    innerWidth: number;
    innerHeight: number;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
    dispatchEvent(event: unknown): boolean;
    [key: string]: unknown;
};
declare const document: {
    baseURI: string;
};
/** 渲染层有 DOM，但 tsconfig 只开了 ES2022：这里补最小音频声明。 */
interface AudioElementLike {
    loop: boolean;
    volume: number;
    preload: string;
    currentTime: number;
    play(): Promise<void> | void;
    pause(): void;
}
declare const Audio: {
    new (src?: string): AudioElementLike;
};
/** 卡片在设置页里的身份。 */
declare const SECTION_ID = "elysia";
/** 桌宠在浮层里的身份。 */
declare const PET_ID = "elysia-pet";
/** 立绘显示宽度（px）。 */
declare const PET_W = 190;
/** 立绘占位高度（px），拖拽夹取用。 */
declare const PET_H = 210;
/** 距屏幕边缘的默认留白。 */
declare const PET_MARGIN = 18;
/** 帧间隔（ms）：和 App 的 PNG 序列一致，150ms 一帧。 */
declare const FRAME_MS = 150;
/** 帧计时的心跳；拖拽序列是 100ms 一帧。 */
declare const FRAME_TICK = 50;
declare const DRAG_FRAME_MS = 100;
/** 点她之后多久回待机（App: postDelayed 2000）。 */
declare const CLICK_RESET_MS = 2000;
/** dance / action 演多久（App: 2500）。 */
declare const ACTION_MS = 2500;
/** 走到目标的总时长与步数（App: duration 3000 / steps 30）。 */
declare const WALK_MS = 3000;
declare const WALK_STEPS = 30;
/** 空闲碎碎念间隔（App 默认 15 秒，开场 5 秒后启动）。 */
declare const AUTO_SPEAK_MS = 15000;
/** 台词气泡的停留时长（App 的 BUBBLE_DEFAULT_MS 3500）。 */
declare const LINE_BUBBLE_MS = 3500;
/** 贴边探头停多久再走回中间（App 默认 10 秒）。 */
declare const PEEK_MS = 10000;
/** 判定贴边的距离。 */
declare const EDGE_PEEK = 14;
/** 待机浮动的幅度、速度与 tick（App: 30px / 0.08 / 50ms）。 */
declare const FLOAT_AMP = 30;
declare const FLOAT_SPEED = 0.08;
declare const FLOAT_TICK = 50;
/** 开屏登场：等待 → 从屏外滑进来，落地回 ide（毫秒）。默认动作只有 ide。 */
declare const INTRO_GAP_MS = 260;
declare const INTRO_SLIDE_MS = 900;
/** 开屏结束后的静默期：这段时间内不重播、不插别的招呼。 */
declare const INTRO_LOCK_MS = 6000;
/** 最近一次开屏的时间戳：组件重挂载（切页面）时不重播。 */
declare let introStamp: number;
/** 每个状态对应的帧序列（键名来自宿主 `/sprites`）。 */
declare const POSE_FRAMES: Record<string, string[]>;
/** 手机端 SpeechManager.defaultSpeeches：顺序即语音编号，head_1.wav 对应第 1 条。 */
declare const POSE_LINES: Record<string, string[]>;
/** 桌宠位置存档键。 */
declare const POS_KEY = "dsh-elysia.pet.pos";
/** 桌宠收起标记。 */
declare const HIDDEN_KEY = "dsh-elysia.pet.hidden";
/** 聊天回复朗读开关（界面侧偏好，宿主的 voiceEnabled 只影响命令行回复）。 */
declare const TTS_KEY = "dsh-elysia.tts";
/** 显示/收起变更事件（设置卡片与桌宠之间同步用）。 */
declare const PET_EVENT = "dsh-elysia:pet-visibility";
/** 注入的 react 子集（只取用到的几个）。 */
interface Runtime {
    h: (type: unknown, props?: Record<string, unknown> | null) => unknown;
    useState: <T>(init: T | (() => T)) => [T, (next: T | ((prev: T) => T)) => void];
    useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => void;
    useRef: <T>(init: T) => {
        current: T;
    };
}
/** 宿主 `/status` 的应答。 */
interface StatusPayload {
    ok?: boolean;
    mood?: number;
    moodLabel?: string;
    dominant?: string;
    facts?: number;
    episodes?: number;
    turns?: number;
    spokenToday?: number;
    inbox?: string[];
    reminders?: number;
    /** 音效 / 朗读总开关（宿主配置）。 */
    sound?: boolean;
    voice?: boolean;
    /** 桌面独立窗口是否在跑；在跑时窗口内浮层让位。 */
    desktopActive?: boolean;
    /** 亲密度与每日任务。 */
    companion?: {
        level: number;
        tier: string;
        hearts: number;
        toNext: number;
        touchToday: number;
        touchGoal: number;
        staySeconds: number;
        stayGoal: number;
    };
}
/** 二选一的位置。 */
interface Pos {
    x: number;
    y: number;
}
/**
 * 本机接口的候选端口：和宿主 `local-api.ts` 的 API_PORTS 一一对应。
 *
 * 桌面外壳不转发宿主注册的前缀路由（渲染层的 `/elysia-api/*` 一条都到不了宿主），
 * 所以宿主自己监听回环端口，界面直接跨域访问，应答带了 `Access-Control-Allow-Origin: *`。
 */
declare const API_PORTS: number[];
/** 探测结果缓存的键。 */
declare const BASE_KEY = "dsh-elysia.api.base";
/** 探测进行中的 Promise，避免每张立绘各探一遍。 */
declare let basePromise: Promise<string | null> | null;
/** 探测单个端口是不是爱莉希雅的本机接口。 */
declare function probePort(port: number): Promise<string | null>;
/**
 * 找宿主接口的基址（只探一次）。
 *
 * @returns 形如 `http://127.0.0.1:7823`；没起来返回 null。
 */
declare function apiBase(): Promise<string | null>;
/** 等一下再试（宿主可能还在起监听）。 */
declare function sleep(ms: number): Promise<void>;
/** 反复探基址，最多 `tries` 次；给开机阶段的界面用。 */
declare function apiBaseWithRetry(tries: number): Promise<string | null>;
/** 发一个请求；网络失败与业务失败都收敛成一句可展示的文案，成功时把原始 JSON 一并带回。 */
declare function callApi(path: string, init?: {
    method?: string;
    body?: unknown;
}): Promise<{
    ok: boolean;
    text: string;
    data: Record<string, unknown>;
}>;
/** 读引擎状态；给卡片和提示共用。 */
declare function fetchStatus(): Promise<StatusPayload | null>;
/** 按本机时间挑一句开场白（搬手机端 ClockManager 的时段问候）。 */
declare function greetingLine(): string;
/** 桌宠底部的小药丸按钮。 */
declare function petPillButton(active?: boolean): Record<string, string>;
/** 一行灰字提示。 */
declare function hintStyle(): Record<string, string>;
/** 统一按钮外观。 */
declare function buttonStyle(disabled: boolean): Record<string, string>;
/** 读桌宠位置；没存过就放右下角。 */
declare function readPos(): Pos;
/** 开屏起点：屏幕右外侧，纵向沿用存档位置。 */
declare function introStartPos(): Pos;
/** 写桌宠位置。 */
declare function savePos(pos: Pos): void;
/** 桌宠是否被收起。 */
declare function readHidden(): boolean;
/** 聊天朗读开关（默认关）。 */
declare function readTts(): boolean;
/** 重设收起标记并广播，让两侧同步。 */
declare function setPetHidden(hidden: boolean): void;
/**
 * 造桌宠组件：立绘 + 气泡 + 小输入框，拖动和单击都在这里。
 *
 * @param rt - 注入的 react 能力。
 * @returns `shell.overlay` 插槽用的组件。
 */
declare function makePet(rt: Runtime, Section: () => unknown): () => unknown;
/**
 * 造设置区块组件。
 *
 * @param rt - 注入的 react 能力。
 * @returns 无入参的组件函数（插槽按它渲染卡片）。
 */
declare function makeSection(rt: Runtime): () => unknown;
/**
 * 造 DSH 客户端 factory（`__ModuleLoader__` 的入参）。
 *
 * 契约（对照 dsh-onebot-qq / dsh-mnemon 两个能正常装载的插件）：
 * - `load` 的 `id` 必须是**包名** `dsh-elysia`，写别的值宿主认不出这个条目；
 * - factory 返回一个 cordis 客户端插件：导出 `inject`（要等哪些服务）和
 *   `apply(ctx)`，apply 负责把两块 UI 挂上插槽，并返回 disposer。
 */
declare function makeFactory(): (require: (name: string) => unknown) => unknown;
