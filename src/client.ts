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
    load(info: { id: string; factory: (require: (name: string) => unknown) => unknown }): void;
  };
  innerWidth: number;
  innerHeight: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  dispatchEvent(event: unknown): boolean;
  [key: string]: unknown;
};

declare const document: { baseURI: string };

/** 渲染层有 DOM，但 tsconfig 只开了 ES2022：这里补最小音频声明。 */
interface AudioElementLike {
  loop: boolean;
  volume: number;
  preload: string;
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
}
declare const Audio: { new (src?: string): AudioElementLike };

/** 卡片在设置页里的身份。 */
const SECTION_ID = 'elysia';
/** 桌宠在浮层里的身份。 */
const PET_ID = 'elysia-pet';
/** 立绘显示宽度（px）。 */
const PET_W = 190;
/** 立绘占位高度（px），拖拽夹取用。 */
const PET_H = 210;
/** 距屏幕边缘的默认留白。 */
const PET_MARGIN = 18;
/** 帧间隔（ms）：和 App 的 PNG 序列一致，150ms 一帧。 */
const FRAME_MS = 150;
/** 帧计时的心跳；拖拽序列是 100ms 一帧。 */
const FRAME_TICK = 50;
const DRAG_FRAME_MS = 100;
/** 点她之后多久回待机（App: postDelayed 2000）。 */
const CLICK_RESET_MS = 2000;
/** dance / action 演多久（App: 2500）。 */
const ACTION_MS = 2500;
/** 走到目标的总时长与步数（App: duration 3000 / steps 30）。 */
const WALK_MS = 3000;
const WALK_STEPS = 30;
/** 空闲碎碎念间隔（App 默认 15 秒，开场 5 秒后启动）。 */
const AUTO_SPEAK_MS = 15_000;
/** 台词气泡的停留时长（App 的 BUBBLE_DEFAULT_MS 3500）。 */
const LINE_BUBBLE_MS = 3500;
/** 贴边探头停多久再走回中间（App 默认 10 秒）。 */
const PEEK_MS = 10_000;
/** 判定贴边的距离。 */
const EDGE_PEEK = 14;
/** 待机浮动的幅度、速度与 tick（App: 30px / 0.08 / 50ms）。 */
const FLOAT_AMP = 30;
const FLOAT_SPEED = 0.08;
const FLOAT_TICK = 50;

/** 开屏登场：等待 → 从屏外滑进来，落地回 ide（毫秒）。默认动作只有 ide。 */
const INTRO_GAP_MS = 260;
const INTRO_SLIDE_MS = 900;
/** 开屏结束后的静默期：这段时间内不重播、不插别的招呼。 */
const INTRO_LOCK_MS = 6000;

/** 最近一次开屏的时间戳：组件重挂载（切页面）时不重播。 */
let introStamp = 0;

/** 每个状态对应的帧序列（键名来自宿主 `/sprites`）。 */
const POSE_FRAMES: Record<string, string[]> = {
  // `ide` 用手机端的静态 PNG（抱爱心坐垫），不播帧序列，避免不同帧比例不一致导致忽大忽小。
  ide: ['ide'],
  blink: ['blink'],
  shy: ['shy'],
  wings: ['wings'],
  yawn: ['yawn'],
  happy: ['happy'],
  bye: ['bye'],
  peek_left: ['peek_left'],
  peek_right: ['peek_right'],
  dance: ['dance_1', 'dance_2', 'dance_3', 'dance_4'],
  action: ['action_1', 'action_2', 'action_3', 'action_4'],
  walk_left: ['walk_left_1', 'walk_left_2', 'walk_left_3', 'walk_left_4'],
  walk_right: ['walk_right_1', 'walk_right_2', 'walk_right_3', 'walk_right_4'],
  drag: ['drag_1', 'drag_2', 'drag_3', 'drag_4', 'drag_5'],
};

/** 手机端 SpeechManager.defaultSpeeches：顺序即语音编号，head_1.wav 对应第 1 条。 */
const POSE_LINES: Record<string, string[]> = {
  head: [
    '你在看我吗？♪', '嗯？怎么啦～♪', '我的头发好看吗？♪', '再摸摸我嘛～♪',
    '嘻嘻，被你发现了～♪', '盯～～～ 你在偷看我吧？', '我的眼睛可是会说话的哦～',
    '发梢有点乱呢，帮我理理？', '被你这样盯着，我都不好意思啦～',
    '我可是偶像级别的发型哦！', '想不想摸摸我的耳朵？嘿嘿～',
    '嗯哼？你好像很喜欢我的脸嘛～', '别看了，再看我就要亲你一下了！',
  ],
  heart: [
    '这是我最喜欢的礼物呢～', '嘿嘿，抱着它好安心～♪', '你送我的红心，我一直抱着哦～♪',
    '不要抢我的爱心啦～♪', '它软软的，和你一样～♪', '这颗心只属于你一个人哦～',
    '暖暖的，就像你手掌的温度～', '抱紧一点嘛，我又不会跑掉～',
    '我的心跳声，你听到了吗？', '这可是我最珍贵的宝物，送给你啦～',
    '它代表了我全部的喜欢哦！', '你说，这颗心会不会因为想你而融化呢？',
  ],
  wings: [
    '想和我一起飞吗？♪', '呼～翅膀扇起来啦～♪', '飞到你心里去哦～♪',
    '我的翅膀漂亮吗？♪', '带你去天上玩吧～♪', '展开翅膀，我就是最耀眼的妖精～♪',
    '要一起在云端漫步吗？', '风吹过翅膀的感觉，好舒服呀～',
    '我的翅膀可是会在月光下发光哦！', '飞到月亮上去摘星星给你好不好？',
    '抓紧我的手，我带你飞过彩虹～', '其实我的翅膀是棉花糖做的，你要尝尝吗？',
  ],
  body: [
    '嗯？这里也可以摸吗～♪', '你好温柔哦～♪', '嘻嘻，好痒～♪', '爱你哦～♪',
    '一直陪着你好不好？♪', '嘿嘿，那里好痒哦～', '你的手好温暖呀～',
    '被摸头的感觉最幸福了～', '我可是一只粘人的小妖精哦～',
    '再多摸摸我嘛，我喜欢你碰我～', '唔…好舒服，再揉揉这里嘛～',
    '你摸得我都不想动了……', '只有你能这样摸我哦，这是特权！',
  ],
  idle: [
    '你很久没理我了…♪', '好无聊呀…陪我说说话嘛～♪', '我都要睡着了…♪',
    '好安静啊……你还在吗？', '我都快无聊到数花瓣了～', '陪我玩嘛陪我玩嘛！',
    '困了……但是想等你一起睡～', '如果觉得无聊的话，就看看我吧～',
    '呼…好想打个滚儿～', '你有没有想我呀？', '我刚刚偷偷画了一个你，要看吗？',
  ],
  drag: [
    '哎呀，别拽我裙子啦！', '你要带我去哪里呀～', '哇～飞起来的感觉！',
    '轻一点嘛，人家会疼的～', '嘿嘿，你在偷偷拐走我吗？', '好高好高！再举高一点！',
    '你是不是想把我藏进口袋里？', '我好像一颗被拖着走的星星哦～',
  ],
  peek: [
    '嘘…我在偷偷看着你哦～', '嘿嘿，这样偷看你不会被发现吧？',
    '你认真的时候真好看～', '我在边缘观察你很久啦！',
    '要不要过来和我击个掌？', '探头！被抓到啦～', '这个角度看你，简直是艺术品～',
  ],
};

/** 桌宠位置存档键。 */
const POS_KEY = 'dsh-elysia.pet.pos';
/** 桌宠收起标记。 */
const HIDDEN_KEY = 'dsh-elysia.pet.hidden';
/** 聊天回复朗读开关（界面侧偏好，宿主的 voiceEnabled 只影响命令行回复）。 */
const TTS_KEY = 'dsh-elysia.tts';
/** 显示/收起变更事件（设置卡片与桌宠之间同步用）。 */
const PET_EVENT = 'dsh-elysia:pet-visibility';

/** 注入的 react 子集（只取用到的几个）。 */
interface Runtime {
  h: (type: unknown, props?: Record<string, unknown> | null) => unknown;
  useState: <T>(init: T | (() => T)) => [T, (next: T | ((prev: T) => T)) => void];
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => void;
  useRef: <T>(init: T) => { current: T };
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
const API_PORTS = [7823, 7824, 7825, 7826, 7827, 7828, 7829, 7830];

/** 探测结果缓存的键。 */
const BASE_KEY = 'dsh-elysia.api.base';

/** 探测进行中的 Promise，避免每张立绘各探一遍。 */
let basePromise: Promise<string | null> | null = null;

/** 探测单个端口是不是爱莉希雅的本机接口。 */
async function probePort(port: number): Promise<string | null> {
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/status', { cache: 'no-store' });
    const payload = (await response.json()) as { ok?: boolean; service?: string };
    if (payload && payload.ok === true && payload.service === 'dsh-elysia') return 'http://127.0.0.1:' + port;
  } catch {
    // 连不上就是没有，继续试下一个。
  }
  return null;
}

/**
 * 找宿主接口的基址（只探一次）。
 *
 * @returns 形如 `http://127.0.0.1:7823`；没起来返回 null。
 */
async function apiBase(): Promise<string | null> {
  if (basePromise !== null) {
    const existing = await basePromise;
    if (existing !== null) return existing;
    // 上次探空了（多半是插件比界面起得晚）：丢掉缓存，重探。
    basePromise = null;
  }
  basePromise = (async () => {
    try {
      const cached = localStorage.getItem(BASE_KEY);
      if (cached !== null && (await probePort(Number(cached.split(':').pop()))) !== null) return cached;
    } catch {
      // 存档不可用就全量探测。
    }
    for (const port of API_PORTS) {
      const base = await probePort(port);
      if (base !== null) {
        try {
          localStorage.setItem(BASE_KEY, base);
        } catch {
          // 记不住端口只是下次多探一遍。
        }
        return base;
      }
    }
    return null;
  })();
  const base = await basePromise;
  if (base === null) basePromise = null;
  return base;
}

/** 等一下再试（宿主可能还在起监听）。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 反复探基址，最多 `tries` 次；给开机阶段的界面用。 */
async function apiBaseWithRetry(tries: number): Promise<string | null> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const base = await apiBase();
    if (base !== null) return base;
    await sleep(900);
  }
  return null;
}

/** 发一个请求；网络失败与业务失败都收敛成一句可展示的文案，成功时把原始 JSON 一并带回。 */
async function callApi(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; text: string; data: Record<string, unknown> }> {
  const base = await apiBase();
  if (base === null) return { ok: false, text: '连不上桌面端宿主（本机接口没有起来，重开 DSH 试试）', data: {} };
  try {
    const response = await fetch(base + path, {
      method: init?.method ?? 'GET',
      cache: 'no-store',
      ...(init?.body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload || payload.ok !== true) {
      const message = payload && typeof payload.message === 'string' ? payload.message : '请求失败（' + response.status + '）';
      return { ok: false, text: message, data: {} };
    }
    return { ok: true, text: typeof payload.text === 'string' ? payload.text : '', data: payload };
  } catch (error) {
    return { ok: false, text: '连不上宿主：' + (error instanceof Error ? error.message : String(error)), data: {} };
  }
}

/** 读引擎状态；给卡片和提示共用。 */
async function fetchStatus(): Promise<StatusPayload | null> {
  const base = await apiBase();
  if (base === null) return null;
  try {
    const response = await fetch(base + '/status', { cache: 'no-store' });
    const payload = (await response.json()) as StatusPayload;
    return payload && payload.ok === true ? payload : null;
  } catch {
    return null;
  }
}

/** 按本机时间挑一句开场白（搬手机端 ClockManager 的时段问候）。 */
function greetingLine(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '这么晚还没睡呀…我陪你一会儿，别熬太狠～';
  if (hour < 11) return '早上好呀，今天也要元气满满～♪';
  if (hour < 14) return '中午好～记得吃饭哦～♪';
  if (hour < 18) return '下午好，累不累呀？要不要歇一会儿～';
  if (hour < 23) return '晚上好～今天辛苦啦～♪';
  return '夜深了，早点休息哦，我会守着你的～';
}

/** 桌宠底部的小药丸按钮。 */
function petPillButton(active = false): Record<string, string> {
  return {
    border: 'none',
    background: active ? 'rgba(255,168,214,0.24)' : 'transparent',
    color: '#f6eafb',
    padding: '3px 8px',
    borderRadius: '999px',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '11px',
    lineHeight: '1.4',
  };
}

/** 一行灰字提示。 */
function hintStyle(): Record<string, string> {
  return { fontSize: '12px', opacity: '0.72', lineHeight: '1.6' };
}

/** 统一按钮外观。 */
function buttonStyle(disabled: boolean): Record<string, string> {
  return {
    padding: '6px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(127,127,127,0.35)',
    background: 'rgba(127,127,127,0.10)',
    color: 'inherit',
    font: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? '0.55' : '1',
  };
}

/** 读桌宠位置；没存过就放右下角。 */
function readPos(): Pos {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return { x: parsed.x, y: parsed.y };
      }
    }
  } catch {
    // 存档坏了就当没存过。
  }
  const width = typeof window.innerWidth === 'number' ? window.innerWidth : 1280;
  const height = typeof window.innerHeight === 'number' ? window.innerHeight : 800;
  return { x: Math.max(12, width - PET_W - PET_MARGIN), y: Math.max(12, height - PET_H - 96) };
}

/** 开屏起点：屏幕右外侧，纵向沿用存档位置。 */
function introStartPos(): Pos {
  const width = typeof window.innerWidth === 'number' ? window.innerWidth : 1280;
  const base = readPos();
  return { x: width + 16, y: base.y };
}

/** 写桌宠位置。 */
function savePos(pos: Pos): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    // localStorage 不可用时只是记不住位置，不影响使用。
  }
}

/** 桌宠是否被收起。 */
function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** 聊天朗读开关（默认关）。 */
function readTts(): boolean {
  try {
    return localStorage.getItem(TTS_KEY) === '1';
  } catch {
    return false;
  }
}

/** 重设收起标记并广播，让两侧同步。 */
function setPetHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(HIDDEN_KEY, '1');
    else localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // 同上。
  }
  try {
    window.dispatchEvent(new Event(PET_EVENT));
  } catch {
    // 广播失败最多是另一侧慢一拍。
  }
}

/**
 * 造桌宠组件：立绘 + 气泡 + 小输入框，拖动和单击都在这里。
 *
 * @param rt - 注入的 react 能力。
 * @returns `shell.overlay` 插槽用的组件。
 */
function makePet(rt: Runtime, Section: () => unknown) {
  return function ElysiaPet() {
    /** 开屏是否正在演：启动/被召唤时从屏外滑进来，落地再回待机。 */
    const [introOn, setIntroOn] = rt.useState(() => Date.now() - introStamp > INTRO_LOCK_MS);
    const [pos, setPos] = rt.useState<Pos>(() => (Date.now() - introStamp > INTRO_LOCK_MS ? introStartPos() : readPos()));
    const posRef = rt.useRef<Pos>(pos);
    const [view, setView] = rt.useState<{ pose: string; frame: number }>({ pose: 'ide', frame: 0 });
    const poseRef = rt.useRef('ide');
    const frameRef = rt.useRef(0);
    const frameElapsedRef = rt.useRef(0);
    const [floatY, setFloatY] = rt.useState(0);
    const floatPhaseRef = rt.useRef(0);
    const [bubble, setBubble] = rt.useState('');
    const [chatOpen, setChatOpen] = rt.useState(false);
    const [settingsOpen, setSettingsOpen] = rt.useState(false);
    const [draft, setDraft] = rt.useState('');
    const [busy, setBusy] = rt.useState(false);
    const [hidden, setHidden] = rt.useState(() => readHidden());
    const [actionLabel, setActionLabel] = rt.useState('');
    const [listening, setListening] = rt.useState(false);
    const [ttsOn, setTtsOn] = rt.useState(() => readTts());
    const ttsRef = rt.useRef(ttsOn);
    const [status, setStatus] = rt.useState<StatusPayload | null>(null);
    const dragRef = rt.useRef<{ offsetX: number; offsetY: number; moved: boolean; rect: { left: number; top: number; width: number; height: number } } | null>(null);
    const draggingRef = rt.useRef(false);
    const autoPlayingRef = rt.useRef(false);
    const walkRef = rt.useRef<ReturnType<typeof setInterval> | null>(null);
    const timersRef = rt.useRef<Array<ReturnType<typeof setTimeout>>>([]);
    const seenRef = rt.useRef('');
    const [sources, setSources] = rt.useState<Record<string, string>>({});
    const audioRef = rt.useRef<Record<string, AudioElementLike>>({});
    const soundOnRef = rt.useRef(true);
    const voiceBankRef = rt.useRef<Record<string, Record<string, AudioElementLike>>>({});
    const voiceJobsRef = rt.useRef<Record<string, Promise<Record<string, AudioElementLike>> | undefined>>({});
    const currentVoiceRef = rt.useRef<AudioElementLike | null>(null);
    const bubbleTimerRef = rt.useRef<ReturnType<typeof setTimeout> | null>(null);
    /** 上一帧的收起状态：用来判断"被召唤回来"。 */
    const prevHiddenRef = rt.useRef(hidden);

    /** 播一条音效（手机端 SoundManager 的五条）；sound 关掉就静默。 */
    const playSound = (name: string, loop = false): void => {
      if (!soundOnRef.current) return;
      const audio = audioRef.current[name];
      if (!audio) return;
      try {
        audio.loop = loop;
        audio.currentTime = 0;
        const playing = audio.play();
        if (playing && typeof playing.catch === 'function') playing.catch(() => undefined);
      } catch {
        // 浏览器没给播放权限就算了，不能耽误动作。
      }
    };

    /** 停掉循环音效（拖拽音）。 */
    const stopSound = (name: string): void => {
      const audio = audioRef.current[name];
      if (!audio) return;
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // 同上。
      }
    };

    /** 播一个音频元素：从头开始、不循环；播不动就静默。 */
    const playAudioElement = (audio: AudioElementLike, loop = false): void => {
      try {
        audio.loop = loop;
        audio.currentTime = 0;
        const playing = audio.play();
        if (playing && typeof playing.catch === 'function') playing.catch(() => undefined);
      } catch {
        // 没给播放权限就算了。
      }
    };

    /** 按类目取回原始台词 WAV（照手机端 `assets/voices` 的编号）。 */
    const ensureVoices = (category: string): Promise<Record<string, AudioElementLike>> => {
      const loaded = voiceBankRef.current[category];
      if (loaded) return Promise.resolve(loaded);
      const running = voiceJobsRef.current[category];
      if (running) return running;
      const job = (async () => {
        const base = await apiBaseWithRetry(4);
        if (base === null) return {};
        try {
          const response = await fetch(base + '/voices?category=' + category, { cache: 'no-store' });
          const payload = (await response.json()) as { voices?: Record<string, string> };
          const voices = payload.voices ?? {};
          const next: Record<string, AudioElementLike> = {};
          for (const key of Object.keys(voices)) {
            const encoded = voices[key];
            if (typeof encoded !== 'string') continue;
            try {
              const audio = new Audio('data:audio/wav;base64,' + encoded);
              audio.preload = 'auto';
              audio.volume = 0.65;
              next[key] = audio;
            } catch {
              // 单条坏掉就少一条。
            }
          }
          if (Object.keys(next).length > 0) voiceBankRef.current[category] = next;
          return next;
        } catch {
          return {};
        }
      })();
      voiceJobsRef.current[category] = job;
      void job.then((map) => {
        if (Object.keys(map).length === 0) voiceJobsRef.current[category] = undefined;
      });
      return job;
    };

    /** 播原始台词语音：编号从 1 开始，和 SpeechManager 的顺序一一对应。 */
    const playVoiceLine = (category: string, index: number): void => {
      const start = (map: Record<string, AudioElementLike>): void => {
        const audio = map[category + '_' + String(index + 1)];
        if (!audio) return;
        if (currentVoiceRef.current && currentVoiceRef.current !== audio) {
          try {
            currentVoiceRef.current.pause();
            currentVoiceRef.current.currentTime = 0;
          } catch {
            // 上一句停不下来也不影响下一句。
          }
        }
        currentVoiceRef.current = audio;
        playAudioElement(audio);
      };
      const loaded = voiceBankRef.current[category];
      if (loaded) start(loaded);
      else void ensureVoices(category).then(start);
    };

    /** 显示一条气泡并定时收起（台词 3.5 秒，聊天更久）。 */
    const showBubbleFor = (text: string, ms = LINE_BUBBLE_MS): void => {
      if (bubbleTimerRef.current !== null) clearTimeout(bubbleTimerRef.current);
      setBubble(text);
      bubbleTimerRef.current = setTimeout(() => {
        setBubble('');
        bubbleTimerRef.current = null;
      }, ms);
    };

    /** 手动收起气泡（× 按钮）：连同计时器一起清。 */
    const hideBubble = (): void => {
      if (bubbleTimerRef.current !== null) {
        clearTimeout(bubbleTimerRef.current);
        bubbleTimerRef.current = null;
      }
      setBubble('');
    };

    /** 切状态：帧索引归零，和 App 的 startStateAnimation 一致。 */
    const enter = (name: string): void => {
      poseRef.current = name;
      frameRef.current = 0;
      frameElapsedRef.current = 0;
      setView({ pose: name, frame: 0 });
    };

    /** 延时执行；可选只在还停在该状态时生效（对应 App 里的 `if (currentState == ...)`）。 */
    const later = (ms: number, fn: () => void, onlyIf?: string): void => {
      const timer = setTimeout(() => {
        if (onlyIf === undefined || poseRef.current === onlyIf) fn();
      }, ms);
      timersRef.current.push(timer);
    };

    const clearPending = (): void => {
      for (const timer of timersRef.current) clearTimeout(timer);
      timersRef.current = [];
    };

    const stopWalk = (): void => {
      if (walkRef.current !== null) clearInterval(walkRef.current);
      walkRef.current = null;
    };

    /** 播一段过渡动作再回待机（对应 App 的 stopStateAnimation + setIdleAndFloat）。 */
    const playThenIdle = (name: string, ms: number): void => {
      enter(name);
      later(ms, () => {
        if (poseRef.current === name) enter('ide');
      }, name);
    };

    /** 拖到哪走到哪：30 步匀速，帧序列按方向切。 */
    const walkTo = (targetX: number, poseName: string, done?: () => void): void => {
      stopWalk();
      const startX = posRef.current.x;
      const deltaX = targetX - startX;
      if (deltaX === 0) {
        enter('ide');
        done?.();
        return;
      }
      const steps = WALK_STEPS;
      const stepMs = WALK_MS / steps;
      let step = 0;
      enter(poseName);
      walkRef.current = setInterval(() => {
        step += 1;
        const progress = Math.min(1, step / steps);
        const next: Pos = { x: Math.round(startX + deltaX * progress), y: posRef.current.y };
        posRef.current = next;
        setPos(next);
        if (progress >= 1) {
          stopWalk();
          savePos(next);
          enter('ide');
          done?.();
        }
      }, stepMs);
    };

    /** 随机动作：dance / action 演 2.5 秒回待机，walk 走到屏幕另一侧。 */
    const triggerAction = (): void => {
      if (draggingRef.current || autoPlayingRef.current) return;
      const kinds = ['dance', 'action', 'walk'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      autoPlayingRef.current = true;
      setActionLabel(kind);
      if (kind === 'walk') {
        playSound('walk');
        const width = typeof window.innerWidth === 'number' ? window.innerWidth : 1280;
        const targetX = posRef.current.x < width / 2 ? Math.max(0, width - PET_W) : 0;
        const direction = targetX > posRef.current.x ? 'walk_right' : 'walk_left';
        stopWalk();
        walkTo(targetX, direction, () => {
          autoPlayingRef.current = false;
          setActionLabel('');
        });
        return;
      }
      enter(kind);
      playSound('happy');
      later(ACTION_MS, () => {
        if (poseRef.current === kind) {
          enter('ide');
          autoPlayingRef.current = false;
          setActionLabel('');
        }
      }, kind);
    };

    /** 点哪算哪：和 App 的 handleClick 同一套区域判定。 */
    const touchZone = (xRatio: number, yRatio: number): { pose: string; category: string } => {
      if (xRatio >= 0.28 && xRatio <= 0.72 && yRatio >= 0.12 && yRatio <= 0.48) return { pose: 'blink', category: 'head' };
      if (xRatio >= 0.38 && xRatio <= 0.62 && yRatio >= 0.48 && yRatio <= 0.68) return { pose: 'shy', category: 'heart' };
      if (xRatio < 0.32 || xRatio > 0.68) {
        if (yRatio >= 0.30 && yRatio <= 0.72) return { pose: 'wings', category: 'wings' };
      }
      return { pose: 'blink', category: 'body' };
    };

    const pickLine = (category: string): { text: string; index: number } => {
      const pool = POSE_LINES[category] ?? POSE_LINES['body'] ?? [];
      const index = Math.floor(Math.random() * pool.length);
      return { text: pool[index] ?? '', index };
    };

    /** 靠边探头：贴左/右边缘时切 peek，十秒后走回中间（App 的 checkEdgePeek + startPeekTimer）。 */
    const checkEdgePeek = (): void => {
      if (draggingRef.current) return;
      const width = typeof window.innerWidth === 'number' ? window.innerWidth : 1280;
      const x = posRef.current.x;
      if (x <= EDGE_PEEK) {
        enter('peek_left');
        later(PEEK_MS, () => {
          if (poseRef.current === 'peek_left') walkTo(Math.max(0, Math.round((width - PET_W) / 2)), 'walk_right');
        }, 'peek_left');
        return;
      }
      if (x + PET_W >= width - EDGE_PEEK) {
        enter('peek_right');
        later(PEEK_MS, () => {
          if (poseRef.current === 'peek_right') walkTo(Math.max(0, Math.round((width - PET_W) / 2)), 'walk_left');
        }, 'peek_right');
      }
    };

    // 50ms 心跳累加：普通序列 150ms 一帧，拖拽序列按 App 的 100ms 一帧，只有待机无限循环。
    rt.useEffect(() => {
      if (hidden) return;
      const timer = setInterval(() => {
        const pose = poseRef.current;
        const frames = POSE_FRAMES[pose] ?? POSE_FRAMES.ide;
        if (frames.length <= 1) return;
        frameElapsedRef.current += FRAME_TICK;
        const step = pose === 'drag' ? DRAG_FRAME_MS : FRAME_MS;
        if (frameElapsedRef.current < step) return;
        frameElapsedRef.current = 0;
        frameRef.current = (frameRef.current + 1) % frames.length;
        setView({ pose, frame: frameRef.current });
      }, FRAME_TICK);
      return () => clearInterval(timer);
    }, [hidden]);

    // 待机浮动：50ms tick，±30px 正弦，拖拽时冻结（App 的 startFloating）。
    rt.useEffect(() => {
      if (hidden || view.pose !== 'ide') {
        setFloatY(0);
        return;
      }
      const timer = setInterval(() => {
        if (draggingRef.current) return;
        floatPhaseRef.current += FLOAT_SPEED;
        setFloatY(Math.round(FLOAT_AMP * Math.sin(floatPhaseRef.current)));
      }, FLOAT_TICK);
      return () => clearInterval(timer);
    }, [hidden, view.pose]);

    // 空闲碎碎念：App 是 5 秒后先来一句，之后每 15 秒一次；待机且没拖动/没聊天才开口。
    rt.useEffect(() => {
      if (hidden) return;
      let interval: ReturnType<typeof setInterval> | null = null;
      const speakIdle = (): void => {
        if (poseRef.current === 'ide' && !draggingRef.current && !chatOpen && !autoPlayingRef.current) {
          const picked = pickLine('idle');
          showBubbleFor(picked.text);
          playVoiceLine('idle', picked.index);
        }
      };
      const first = setTimeout(() => {
        speakIdle();
        interval = setInterval(speakIdle, AUTO_SPEAK_MS);
      }, 5000);
      return () => {
        clearTimeout(first);
        if (interval !== null) clearInterval(interval);
      };
    }, [hidden, chatOpen]);

    // 气泡的收起由 showBubbleFor 自己计时，这里不再统一清。

    // 立绘一次性从 `/sprites` 取回（base64 走 JSON 通道）：渲染层会把 `/xxx.png`
    // 这类图片路径当成静态资源拦下，走 JSON 最稳。
    rt.useEffect(() => {
      let closed = false;
      void (async () => {
        const base = await apiBaseWithRetry(10);
        if (base === null) return;
        try {
          const response = await fetch(base + '/sprites', { cache: 'no-store' });
          const payload = (await response.json()) as { sprites?: Record<string, string>; mimes?: Record<string, string> };
          const sprites = payload.sprites ?? {};
          const mimes = payload.mimes ?? {};
          const next: Record<string, string> = {};
          for (const key of Object.keys(sprites)) {
            const encoded = sprites[key];
            if (typeof encoded !== 'string') continue;
            const binary = atob(encoded);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            next[key] = URL.createObjectURL(new Blob([bytes], { type: mimes[key] === 'image/webp' ? 'image/webp' : 'image/png' }));
          }
          if (!closed) setSources(next);
        } catch {
          // 拉不到就显示占位。
        }
      })();
      return () => {
        closed = true;
      };
    }, []);

    // 音效一次性取回：五条 mp3 走 JSON 的 base64，转成 data URL 后交给 Audio 播。
    rt.useEffect(() => {
      let closed = false;
      void (async () => {
        const base = await apiBaseWithRetry(10);
        if (base === null) return;
        try {
          const response = await fetch(base + '/sounds', { cache: 'no-store' });
          const payload = (await response.json()) as { sounds?: Record<string, string> };
          const sounds = payload.sounds ?? {};
          const next: Record<string, AudioElementLike> = {};
          for (const key of Object.keys(sounds)) {
            const encoded = sounds[key];
            if (typeof encoded !== 'string') continue;
            try {
              const audio = new Audio('data:audio/mpeg;base64,' + encoded);
              audio.preload = 'auto';
              audio.volume = 0.45;
              next[key] = audio;
            } catch {
              // 单条坏掉就少一条音效。
            }
          }
          if (!closed) audioRef.current = next;
        } catch {
          // 拉不到就静默。
        }
      })();
      return () => {
        closed = true;
      };
    }, []);

    // 台词语音：七类按顺序后台预取，点她之前就备好；点开一次后常驻内存。
    rt.useEffect(() => {
      let closed = false;
      void (async () => {
        const base = await apiBaseWithRetry(8);
        if (base === null) return;
        for (const category of Object.keys(POSE_LINES)) {
          if (closed) return;
          await ensureVoices(category);
        }
      })();
      return () => {
        closed = true;
      };
    }, []);

    // 开屏登场：先停在屏外，260ms 后滑到存档位置；落地就回 ide，不自动展翅/不自动动作。
    rt.useEffect(() => {
      if (hidden || !introOn) return;
      const width = typeof window.innerWidth === 'number' ? window.innerWidth : 1280;
      const base = readPos();
      const target: Pos = {
        x: Math.min(Math.max(0, base.x), Math.max(0, width - PET_W)),
        y: base.y,
      };
      if (Date.now() - introStamp > 1000) introStamp = Date.now();
      autoPlayingRef.current = false;
      enter('ide');
      const timers: Array<ReturnType<typeof setTimeout>> = [];
      timers.push(setTimeout(() => {
        posRef.current = target;
        setPos(target);
      }, INTRO_GAP_MS));
      timers.push(setTimeout(() => {
        introStamp = Date.now();
        setIntroOn(false);
      }, INTRO_GAP_MS + INTRO_SLIDE_MS));
      return () => {
        for (const timer of timers) clearTimeout(timer);
        autoPlayingRef.current = false;
      };
    }, [hidden, introOn]);

    // 从收起变成召唤：把立绘挪到屏外再放一遍开屏，别直接"闪"出来。
    rt.useEffect(() => {
      const was = prevHiddenRef.current;
      prevHiddenRef.current = hidden;
      if (!was || hidden) return;
      const width = typeof window.innerWidth === 'number' ? window.innerWidth : 1280;
      const next: Pos = { x: width + 16, y: posRef.current.y };
      posRef.current = next;
      setPos(next);
      introStamp = 0;
      setIntroOn(true);
    }, [hidden]);

    // 第一次连上宿主时报个到；连不上就把原因留在气泡里，省得只剩一张裂图。
    rt.useEffect(() => {
      let closed = false;
      void (async () => {
        const base = await apiBaseWithRetry(6);
        const payload = base === null ? null : await fetchStatus();
        if (closed) return;
        if (payload !== null) {
          soundOnRef.current = payload.sound !== false;
          setStatus(payload);
          // 已经在桌面小窗里陪着了，窗口内这只就不再抢话。
          if (payload.desktopActive !== true && Date.now() - introStamp >= INTRO_LOCK_MS) {
            showBubbleFor(greetingLine(), 6000);
            playThenIdle('happy', 1500);
          }
        } else {
          showBubbleFor('连不上桌面端宿主：本机接口没响应', 8000);
        }
      })();
      return () => {
        closed = true;
      };
    }, []);

    // 收起/召唤由设置卡片广播过来。
    rt.useEffect(() => {
      const onChange = (): void => setHidden(readHidden());
      window.addEventListener(PET_EVENT, onChange);
      return () => window.removeEventListener(PET_EVENT, onChange);
    }, []);

    // 卸载时把动画、行走、延时一起收掉。
    rt.useEffect(() => () => {
      stopWalk();
      clearPending();
    }, []);

    // 每半分钟看一眼收件箱：新的主动开口、到点的提醒都会在这里冒泡。
    rt.useEffect(() => {
      if (hidden) return;
      let closed = false;
      const timer = setInterval(() => {
        void fetchStatus().then((payload) => {
          if (closed || payload === null) return;
          setStatus(payload);
          if (payload.desktopActive === true) return;
          const inbox = payload.inbox ?? [];
          const newest = inbox.length > 0 ? inbox[inbox.length - 1] : '';
          if (newest === '') return;
          if (seenRef.current === '') {
            seenRef.current = newest;
            return;
          }
          if (newest !== seenRef.current) {
            seenRef.current = newest;
            playThenIdle(newest.startsWith('⏰') ? 'blink' : 'happy', 2000);
            showBubbleFor(newest, 8000);
          }
        });
      }, 10_000);
      return () => {
        closed = true;
        clearInterval(timer);
      };
    }, [hidden]);

    // 陪伴计时：可见时每 30 秒报一次，攒够 5 分钟发一次爱心（App 的 onStayTick）。
    rt.useEffect(() => {
      if (hidden) return;
      const timer = setInterval(() => {
        void callApi('/stay', { method: 'POST', body: { seconds: 30 } }).then((result) => {
          const gained = typeof result.data.gained === 'number' ? result.data.gained : 0;
          if (gained > 0) showBubbleFor('陪你待了五分钟…给你 ' + gained + ' 颗小爱心～', 4000);
        });
      }, 30_000);
      return () => clearInterval(timer);
    }, [hidden]);

    /** 搬到 DSH 窗口外：独立透明置顶小窗；成功后这里让位。 */
    const goDesktop = async (): Promise<void> => {
      const result = await callApi('/desktop/start', { method: 'POST' });
      showBubbleFor(result.ok ? '搬到桌面啦，我去外面陪你～' : '桌面版没起来：' + result.text, 4000);
    };

    /** 让她主动说一句。 */
    const say = async (): Promise<void> => {
      if (busy) return;
      setBusy(true);
      playThenIdle('happy', 2000);
      const result = await callApi('/say', { method: 'POST' });
      showBubbleFor(result.ok ? result.text : '她这会儿没开口：' + result.text, 8000);
      if (result.ok) speakReplyText(result.text);
      if (!result.ok) playThenIdle('shy', 2000);
      setBusy(false);
    };

    /** 发一句话给她。 */
    const send = async (): Promise<void> => {
      const text = draft.trim();
      if (text === '' || busy) return;
      setBusy(true);
      enter('ide');
      const result = await callApi('/chat', { method: 'POST', body: { text } });
      if (result.ok) {
        setDraft('');
        playThenIdle('happy', 2000);
      } else {
        playThenIdle('shy', 2000);
      }
      showBubbleFor(result.ok ? result.text : '她这次没说出话来：' + result.text, 20_000);
      if (result.ok) speakReplyText(result.text);
      setBusy(false);
    };

    /** 聊天朗读开关：只影响聊天回复，桌宠台词始终播原音。 */
    const toggleTts = (): void => {
      const next = !ttsRef.current;
      ttsRef.current = next;
      setTtsOn(next);
      try {
        localStorage.setItem(TTS_KEY, next ? '1' : '0');
      } catch {
        // 记不住只是下次回到默认。
      }
      showBubbleFor(next ? '聊天回复会念出来～' : '好，安静地陪你。', 3000);
    };

    /** 让宿主用 SAPI 念一句聊天回复。 */
    const speakReplyText = (text: string): void => {
      if (!ttsRef.current || text.trim() === '') return;
      void callApi('/speak', { method: 'POST', body: { text: text.slice(0, 200) } });
    };

    /** 把桌宠送出去：宿主拉起独立透明置顶窗，窗口内浮层自动让位。 */
    const launchDesktop = async (): Promise<void> => {
      const result = await callApi('/desktop/start', { method: 'POST' });
      if (!result.ok) {
        showBubbleFor('桌面版没起来：' + result.text, 6000);
        return;
      }
      showBubbleFor('桌面版爱莉希雅已经出到 DSH 外面啦，窗口里的我先躲一下～', 5000);
      const payload = await fetchStatus();
      if (payload !== null) setStatus(payload);
    };

    /** 点麦克风：Windows 离线识别一句中文，结果先填进输入框再发。 */    const startListen = async (): Promise<void> => {
      if (listening) return;
      setListening(true);
      setChatOpen(true);
      showBubbleFor('在听…说完停一下就好～', 12_000);
      const result = await callApi('/listen', { method: 'POST' });
      setListening(false);
      if (result.ok) {
        setDraft(result.text);
        showBubbleFor('听到了：' + result.text, 4500);
      } else {
        showBubbleFor('语音没听成：' + result.text, 5000);
      }
    };

    /** 收起前先挥手，和 App 的 bye 帧一样。 */
    const hidePet = (): void => {
      enter('bye');
      later(900, () => {
        setPetHidden(true);
        setHidden(true);
      });
    };

    /** 指针按下：记偏移和比例框，准备拖动。 */
    const onPointerDown = (event: {
      clientX?: number;
      clientY?: number;
      pointerId?: number;
      button?: number;
      currentTarget?: { setPointerCapture?: (id: number) => void; getBoundingClientRect?: () => { left: number; top: number; width: number; height: number } };
    }): void => {
      // 右键只开设置，不进入拖拽，也不让抬手时误判成点击。
      if (event.button === 2) {
        dragRef.current = null;
        return;
      }
      const px = event.clientX ?? 0;
      const py = event.clientY ?? 0;
      const rect = event.currentTarget?.getBoundingClientRect?.() ?? { left: px, top: py, width: PET_W, height: PET_H };
      dragRef.current = { offsetX: px - posRef.current.x, offsetY: py - posRef.current.y, moved: false, rect };
      event.currentTarget?.setPointerCapture?.(event.pointerId ?? 0);
      draggingRef.current = false;
      autoPlayingRef.current = false;
      setActionLabel('');
      clearPending();
      stopWalk();
      setFloatY(0);
    };

    /** 拖动中：跟手移动，越过 5px 就切拖拽帧。 */
    const onPointerMove = (event: { clientX?: number; clientY?: number }): void => {
      const drag = dragRef.current;
      if (drag === null) return;
      const width = typeof window.innerWidth === 'number' ? window.innerWidth : 1280;
      const height = typeof window.innerHeight === 'number' ? window.innerHeight : 800;
      const next: Pos = {
        x: Math.min(Math.max(0, (event.clientX ?? 0) - drag.offsetX), Math.max(0, width - 60)),
        y: Math.min(Math.max(0, (event.clientY ?? 0) - drag.offsetY), Math.max(0, height - 60)),
      };
      if (Math.abs(next.x - posRef.current.x) > 5 || Math.abs(next.y - posRef.current.y) > 5) drag.moved = true;
      if (drag.moved && !draggingRef.current) {
        draggingRef.current = true;
        enter('drag');
        playSound('drag', true);
        const picked = pickLine('drag');
        showBubbleFor(picked.text);
        playVoiceLine('drag', picked.index);
        autoPlayingRef.current = false;
        setActionLabel('');
      }
      posRef.current = next;
      setPos(next);
    };

    /** 抬手：拖过就存档并判边缘探头，没拖过就按区域点她。 */
    const onPointerUp = (event: {
      clientX?: number;
      clientY?: number;
      pointerId?: number;
      currentTarget?: { releasePointerCapture?: (id: number) => void };
    }): void => {
      const drag = dragRef.current;
      dragRef.current = null;
      event.currentTarget?.releasePointerCapture?.(event.pointerId ?? 0);
      draggingRef.current = false;
      stopSound('drag');
      if (drag === null) return;
      if (drag.moved) {
        savePos(posRef.current);
        enter('ide');
        checkEdgePeek();
        return;
      }
      const x = event.clientX ?? 0;
      const y = event.clientY ?? 0;
      const xRatio = drag.rect.width > 0 ? (x - drag.rect.left) / drag.rect.width : 0.5;
      const yRatio = drag.rect.height > 0 ? (y - drag.rect.top) / drag.rect.height : 0.5;
      const zone = touchZone(xRatio, yRatio);
      const picked = pickLine(zone.category);
      enter(zone.pose);
      showBubbleFor(picked.text);
      playSound(zone.category === 'wings' ? 'wings' : 'click');
      // 台词语音直接用手机端 assets/voices 里的原音；摸摸计入亲密度任务。
      playVoiceLine(zone.category, picked.index);
      void callApi('/touch', { method: 'POST' }).then((result) => {
        const gained = typeof result.data.gained === 'number' ? result.data.gained : 0;
        if (gained > 0) {
          showBubbleFor(picked.text + '\n摸摸任务完成，爱心 +' + gained + '，现在是 Lv.' + String(result.data.level ?? '?'), 4000);
        }
      });
      later(CLICK_RESET_MS, () => {
        if (poseRef.current !== 'peek_left' && poseRef.current !== 'peek_right') enter('ide');
      }, zone.pose);
    };

    if (hidden || status?.desktopActive === true) return null;

    const frames = POSE_FRAMES[view.pose] ?? POSE_FRAMES.ide;
    const key = frames[view.frame % frames.length];
    const src = sources[key];

    return rt.h('div', {
      style: {
        position: 'fixed',
        left: pos.x + 'px',
        top: pos.y + 'px',
        width: PET_W + 'px',
        zIndex: 2147483000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        userSelect: 'none',
        pointerEvents: 'none',
        // 开屏时 left 走缓动滑入；平时关掉，拖动才能跟手。
        transition: introOn
          ? 'left ' + String(INTRO_SLIDE_MS) + 'ms cubic-bezier(0.22, 1, 0.36, 1), top ' + String(INTRO_SLIDE_MS) + 'ms cubic-bezier(0.22, 1, 0.36, 1)'
          : 'none',
      },
      children: [
        bubble === ''
          ? null
          : rt.h('div', {
              style: {
                position: 'absolute',
                bottom: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '300px',
                marginBottom: '12px',
                padding: '10px 26px 10px 13px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, rgba(48,34,60,0.97), rgba(19,18,27,0.97))',
                color: '#fdf0ff',
                fontSize: '12.5px',
                lineHeight: '1.65',
                whiteSpace: 'pre-wrap',
                border: '1px solid rgba(255,190,230,0.22)',
                boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
                pointerEvents: 'auto',
              },
              children: [
                rt.h('div', { style: { pointerEvents: 'auto' }, children: bubble }),
                rt.h('button', {
                  type: 'button',
                  style: {
                    position: 'absolute',
                    top: '3px',
                    right: '5px',
                    width: '18px',
                    height: '18px',
                    border: 'none',
                    background: 'transparent',
                    color: '#c9b6d6',
                    cursor: 'pointer',
                    fontSize: '13px',
                    lineHeight: '1',
                  },
                  onClick: () => hideBubble(),
                  children: '×',
                }),
                rt.h('div', {
                  style: {
                    position: 'absolute',
                    left: '50%',
                    bottom: '-6px',
                    marginLeft: '-6px',
                    width: '0',
                    height: '0',
                    borderLeft: '6px solid transparent',
                    borderRight: '6px solid transparent',
                    borderTop: '6px solid rgba(30,24,40,0.97)',
                  },
                }),
              ],
            }),
        src === undefined
          ? rt.h('div', {
              style: {
                width: PET_W + 'px',
                height: PET_H + 'px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '16px',
                border: '1px dashed rgba(127,127,127,0.4)',
                fontSize: '12px',
                opacity: '0.75',
                pointerEvents: 'auto',
              },
              children: '立绘加载中…',
            })
          : rt.h('img', {
              src,
              draggable: false,
              alt: '爱莉希雅',
              onPointerDown,
              onPointerMove,
              onPointerUp,
              onDoubleClick: () => setChatOpen(true),
              onContextMenu: (event: { preventDefault?: () => void; stopPropagation?: () => void }) => {
                event.preventDefault?.();
                event.stopPropagation?.();
                if (draggingRef.current) return;
                setSettingsOpen(true);
              },
              style: {
                width: PET_W + 'px',
                height: 'auto',
                transform: 'translateY(' + String(floatY) + 'px)',
                transition: 'transform 60ms linear',
                cursor: dragRef.current === null ? 'grab' : 'grabbing',
                pointerEvents: 'auto',
                filter: 'drop-shadow(0 10px 22px rgba(0,0,0,0.32))',
              },
            }),
        chatOpen
          ? rt.h('div', {
              style: {
                width: '258px',
                marginTop: '8px',
                padding: '9px',
                borderRadius: '15px',
                background: 'linear-gradient(160deg, rgba(36,29,46,0.97), rgba(17,16,24,0.97))',
                border: '1px solid rgba(255,190,230,0.20)',
                boxShadow: '0 12px 32px rgba(0,0,0,0.42)',
                pointerEvents: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '7px',
              },
              children: [
                rt.h('div', {
                  style: { display: 'flex', alignItems: 'center', gap: '6px' },
                  children: [
                    rt.h('input', {
                      type: 'text',
                      value: draft,
                      placeholder: '说点什么…（Enter 发送）',
                      style: {
                        flex: '1',
                        minWidth: '0',
                        padding: '7px 10px',
                        borderRadius: '10px',
                        border: '1px solid rgba(255,255,255,0.13)',
                        background: 'rgba(255,255,255,0.06)',
                        color: '#f7effa',
                        font: 'inherit',
                        fontSize: '12px',
                        outline: 'none',
                      },
                      onInput: (event: { target?: { value?: string } }) => setDraft(event?.target?.value ?? ''),
                      onKeyDown: (event: { key?: string }) => {
                        if (event?.key === 'Enter') void send();
                      },
                    }),
                    rt.h('button', {
                      type: 'button',
                      title: listening ? '正在听…' : '语音输入（Windows 离线识别）',
                      disabled: listening,
                      style: {
                        width: '30px',
                        height: '30px',
                        flex: '0 0 auto',
                        padding: '0',
                        borderRadius: '50%',
                        border: '1px solid rgba(255,190,230,0.35)',
                        background: listening ? 'rgba(255,120,190,0.38)' : 'rgba(255,255,255,0.07)',
                        color: '#fdf0ff',
                        cursor: listening ? 'wait' : 'pointer',
                        fontSize: '13px',
                        lineHeight: '28px',
                      },
                      onClick: () => void startListen(),
                      children: listening ? '…' : '🎤',
                    }),
                    rt.h('button', {
                      type: 'button',
                      disabled: busy,
                      style: {
                        flex: '0 0 auto',
                        padding: '7px 11px',
                        borderRadius: '10px',
                        border: 'none',
                        background: busy ? 'rgba(255,150,205,0.35)' : 'linear-gradient(135deg, rgba(255,150,205,0.92), rgba(196,120,255,0.88))',
                        color: '#241626',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        fontSize: '12px',
                        fontWeight: '600',
                      },
                      onClick: () => void send(),
                      children: '发送',
                    }),
                  ],
                }),
                rt.h('div', {
                  style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' },
                  children: [
                    rt.h('button', {
                      type: 'button',
                      style: {
                        border: 'none',
                        background: 'transparent',
                        color: ttsOn ? '#ffc6e6' : '#a99bb4',
                        cursor: 'pointer',
                        font: 'inherit',
                        fontSize: '10.5px',
                        padding: '0',
                      },
                      onClick: () => toggleTts(),
                      children: ttsOn ? '🔊 会念出来' : '🔈 只显示文字',
                    }),
                    rt.h('span', {
                      style: { fontSize: '10.5px', color: '#8f8499' },
                      children: listening ? '正在听…' : '🎤 离线识别',
                    }),
                  ],
                }),
              ],
            })
          : null,
        rt.h('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            marginTop: '6px',
            padding: '3px 6px',
            borderRadius: '999px',
            background: 'rgba(20,18,26,0.84)',
            border: '1px solid rgba(255,190,230,0.18)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.36)',
            pointerEvents: 'auto',
            fontSize: '11px',
            color: '#f2e6f8',
          },
          children: [
            status && status.companion
              ? rt.h('span', {
                  style: {
                    padding: '2px 7px',
                    borderRadius: '999px',
                    background: 'rgba(255,150,205,0.16)',
                    color: '#ffd3ea',
                    fontSize: '10.5px',
                  },
                  children: 'Lv.' + status.companion.level,
                })
              : null,
            rt.h('button', {
              type: 'button',
              style: petPillButton(chatOpen),
              onClick: () => setChatOpen(!chatOpen),
              children: chatOpen ? '收起' : '聊天',
            }),
            rt.h('button', {
              type: 'button',
              style: petPillButton(autoPlayingRef.current),
              onClick: () => triggerAction(),
              children: actionLabel === '' ? '动一下' : actionLabel,
            }),
            rt.h('button', {
              type: 'button',
              style: petPillButton(false),
              onClick: () => void launchDesktop(),
              children: '桌面',
            }),
            rt.h('button', {
              type: 'button',
              style: petPillButton(false),
              onClick: () => void goDesktop(),
              children: '桌面',
            }),
            rt.h('button', {
              type: 'button',
              style: petPillButton(false),
              onClick: () => hidePet(),
              children: '收起',
            }),
          ],
        }),
        settingsOpen
          ? rt.h('div', {
              style: {
                position: 'fixed',
                inset: '0',
                zIndex: 2147483001,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '18px',
                background: 'rgba(18,14,24,0.34)',
                backdropFilter: 'blur(2px)',
                pointerEvents: 'auto',
              },
              onClick: () => setSettingsOpen(false),
              children: [
                rt.h('div', {
                  style: {
                    width: 'min(430px, calc(100vw - 36px))',
                    maxHeight: '82vh',
                    overflowY: 'auto',
                    padding: '14px',
                    borderRadius: '18px',
                    background: 'linear-gradient(180deg, #fff9fd, #f4ecff)',
                    color: '#2d2335',
                    border: '1px solid rgba(196,120,255,0.28)',
                    boxShadow: '0 24px 70px rgba(20,12,30,0.42)',
                  },
                  onClick: (event: { stopPropagation?: () => void }) => event.stopPropagation?.(),
                  children: [
                    rt.h('div', {
                      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' },
                      children: [
                        rt.h('strong', { style: { fontSize: '14px' }, children: '爱莉希雅的设置' }),
                        rt.h('button', {
                          type: 'button',
                          style: {
                            width: '26px',
                            height: '26px',
                            border: 'none',
                            borderRadius: '50%',
                            background: 'rgba(127,127,127,0.12)',
                            color: '#5c4b68',
                            cursor: 'pointer',
                            font: 'inherit',
                            fontSize: '14px',
                            lineHeight: '1',
                          },
                          onClick: () => setSettingsOpen(false),
                          children: '×',
                        }),
                      ],
                    }),
                    rt.h(Section, {}),
                    rt.h('div', {
                      style: { marginTop: '8px', fontSize: '10.5px', color: '#8a7896', textAlign: 'center' },
                      children: '右键桌宠打开这里 · 双击聊天 · 拖到边缘会探头',
                    }),
                  ],
                }),
              ],
            })
          : null,
      ],
    });
  };
}

/**
 * 造设置区块组件。
 *
 * @param rt - 注入的 react 能力。
 * @returns 无入参的组件函数（插槽按它渲染卡片）。
 */
function makeSection(rt: Runtime) {
  return function ElysiaSection() {
    const [status, setStatus] = rt.useState<StatusPayload | null>(null);
    const [draft, setDraft] = rt.useState('');
    const [reply, setReply] = rt.useState('');
    const [busy, setBusy] = rt.useState(false);
    const [listening, setListening] = rt.useState(false);
    const [confirmForget, setConfirmForget] = rt.useState(false);

    const refresh = async (): Promise<void> => {
      const payload = await fetchStatus();
      if (payload === null) {
        setReply('连不上宿主：状态没读到。');
        return;
      }
      setStatus(payload);
    };

    rt.useEffect(() => {
      void refresh();
    }, []);

    const send = async (): Promise<void> => {
      const text = draft.trim();
      if (text === '' || busy) return;
      setBusy(true);
      const result = await callApi('/chat', { method: 'POST', body: { text } });
      setReply(result.ok ? result.text : '她这次没说出话来：' + result.text);
      if (result.ok) setDraft('');
      setBusy(false);
      void refresh();
    };

    const say = async (): Promise<void> => {
      if (busy) return;
      setBusy(true);
      const result = await callApi('/say', { method: 'POST' });
      setReply(result.ok ? result.text : '她这会儿没开口：' + result.text);
      setBusy(false);
      void refresh();
    };

    /** 设置页也能语音输入：识别结果填进输入框。 */
    const startListen = async (): Promise<void> => {
      if (listening) return;
      setListening(true);
      const result = await callApi('/listen', { method: 'POST' });
      setListening(false);
      if (result.ok) {
        setDraft(result.text);
        setReply('听到了：' + result.text);
      } else {
        setReply('语音没听成：' + result.text);
      }
    };

    const forget = async (): Promise<void> => {
      if (!confirmForget) {
        setConfirmForget(true);
        setReply('再点一次「确认清空」就会忘掉全部记忆。');
        return;
      }
      setBusy(true);
      const result = await callApi('/forget', { method: 'POST', body: { confirm: true } });
      setReply(result.ok ? '记忆已经清空了。' : '清空失败：' + result.text);
      setConfirmForget(false);
      setBusy(false);
      void refresh();
    };

    /** 在 DSH 窗口外开关独立桌面版。 */
    const toggleDesktop = async (): Promise<void> => {
      if (busy) return;
      const running = status?.desktopActive === true;
      setBusy(true);
      const result = await callApi(running ? '/desktop/stop' : '/desktop/start', { method: 'POST' });
      setReply(result.ok ? (running ? '桌面版已关闭，窗口内这只很快回来。' : '已搬到 DSH 窗口外的桌面。') : '桌面版操作失败：' + result.text);
      setBusy(false);
      void refresh();
    };

    const stopDesktop = async (): Promise<void> => {
      const result = await callApi('/desktop/stop', { method: 'POST' });
      setReply(result.ok ? '桌面版已经收回来了。' : '关闭失败：' + result.text);
      void refresh();
    };

    const moodChip = status
      ? '心情 ' + (status.moodLabel ?? '—') + ' · ' + Math.round(status.mood ?? 0)
      : '未连接宿主';
    const levelChip = status && status.companion ? 'Lv.' + status.companion.level + ' ' + status.companion.tier : '';
    const heartsChip = status && status.companion ? '❤ ' + status.companion.hearts : '';
    const reminderChip = status && (status.reminders ?? 0) > 0 ? '⏰ ' + (status.reminders ?? 0) : '';
    const memoryLine = status
      ? '记忆 ' + (status.facts ?? 0) + ' 画像 · ' + (status.episodes ?? 0) + ' 情节 · ' + (status.turns ?? 0) + ' 近期'
      : '';
    const inboxLine = status && status.inbox && status.inbox.length > 0 ? '最近一句：' + status.inbox[status.inbox.length - 1] : '';

    /** 一条任务进度条。 */
    const taskBar = (label: string, value: number, goal: number, reward: string) => {
      const ratio = goal > 0 ? Math.min(1, value / goal) : 0;
      return rt.h('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '4px' },
        children: [
          rt.h('div', {
            style: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', opacity: '0.75' },
            children: [
              rt.h('span', { children: label + ' ' + Math.floor(value) + '/' + Math.floor(goal) }),
              rt.h('span', { children: reward }),
            ],
          }),
          rt.h('div', {
            style: { height: '5px', borderRadius: '999px', background: 'rgba(127,127,127,0.18)', overflow: 'hidden' },
            children: [
              rt.h('div', {
                style: {
                  height: '100%',
                  width: String(Math.round(ratio * 100)) + '%',
                  borderRadius: '999px',
                  background: 'linear-gradient(90deg, rgba(255,150,205,0.95), rgba(196,120,255,0.95))',
                },
              }),
            ],
          }),
        ],
      });
    };

    /** 顶部小标签。 */
    const chip = (text: string) =>
      rt.h('span', {
        style: {
          padding: '3px 8px',
          borderRadius: '999px',
          background: 'rgba(127,127,127,0.13)',
          fontSize: '11px',
          lineHeight: '1.4',
          whiteSpace: 'nowrap',
        },
        children: text,
      });

    return rt.h('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        borderRadius: '14px',
        border: '1px solid rgba(127,127,127,0.25)',
        background: 'linear-gradient(160deg, rgba(255,150,205,0.06), rgba(127,127,127,0.03))',
        fontSize: '13px',
      },
      children: [
        rt.h('div', {
          style: { display: 'flex', alignItems: 'center', gap: '10px' },
          children: [
            rt.h('div', {
              style: {
                width: '38px',
                height: '38px',
                flex: '0 0 auto',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(255,150,205,0.92), rgba(178,120,255,0.9))',
                color: '#2a1830',
                fontSize: '18px',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 6px 16px rgba(196,120,255,0.28)',
              },
              children: '爱',
            }),
            rt.h('div', {
              style: { display: 'flex', flexDirection: 'column', gap: '2px' },
              children: [
                rt.h('strong', { style: { fontSize: '16px' }, children: '爱莉希雅' }),
                rt.h('span', { style: { ...hintStyle(), fontSize: '11px' }, children: '桌宠 · 记忆 · 心情 · 语音/文字' }),
              ],
            }),
          ],
        }),
        rt.h('div', {
          style: { display: 'flex', flexWrap: 'wrap', gap: '5px' },
          children: [
            chip(moodChip),
            levelChip !== '' ? chip(levelChip) : null,
            heartsChip !== '' ? chip(heartsChip) : null,
            reminderChip !== '' ? chip(reminderChip) : null,
            memoryLine !== '' ? chip(memoryLine) : null,
          ],
        }),
        status && status.companion
          ? rt.h('div', {
              style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', borderRadius: '10px', background: 'rgba(127,127,127,0.06)' },
              children: [
                taskBar('今日摸摸', status.companion.touchToday, status.companion.touchGoal, '满 10 次 +5 ❤'),
                taskBar('今日陪伴', Math.floor(status.companion.staySeconds / 60), Math.floor(status.companion.stayGoal / 60), '满 5 分钟 +6 ❤'),
                rt.h('div', { style: { ...hintStyle(), fontSize: '11px' }, children: '距下一级还差 ' + status.companion.toNext + ' 颗爱心' }),
              ],
            })
          : null,
        inboxLine !== ''
          ? rt.h('div', {
              style: { ...hintStyle(), fontSize: '11.5px', padding: '8px 10px', borderRadius: '10px', background: 'rgba(127,127,127,0.06)', whiteSpace: 'pre-wrap' },
              children: inboxLine,
            })
          : null,
        rt.h('div', {
          style: { display: 'flex', alignItems: 'center', gap: '6px' },
          children: [
            rt.h('input', {
              type: 'text',
              value: draft,
              placeholder: '说点什么…（Enter 发送）',
              style: {
                flex: '1',
                minWidth: '0',
                padding: '8px 11px',
                borderRadius: '10px',
                border: '1px solid rgba(127,127,127,0.35)',
                background: 'rgba(127,127,127,0.06)',
                color: 'inherit',
                font: 'inherit',
                fontSize: '12.5px',
                outline: 'none',
              },
              onInput: (event: { target?: { value?: string } }) => setDraft(event?.target?.value ?? ''),
              onKeyDown: (event: { key?: string }) => {
                if (event?.key === 'Enter') void send();
              },
            }),
            rt.h('button', {
              type: 'button',
              title: listening ? '正在听…' : '语音输入（Windows 离线识别）',
              disabled: listening,
              style: {
                width: '32px',
                height: '32px',
                flex: '0 0 auto',
                padding: '0',
                borderRadius: '50%',
                border: '1px solid rgba(127,127,127,0.35)',
                background: listening ? 'rgba(255,150,205,0.24)' : 'rgba(127,127,127,0.10)',
                color: 'inherit',
                cursor: listening ? 'wait' : 'pointer',
                fontSize: '13px',
                lineHeight: '30px',
              },
              onClick: () => void startListen(),
              children: listening ? '…' : '🎤',
            }),
            rt.h('button', {
              type: 'button',
              disabled: busy,
              style: {
                flex: '0 0 auto',
                padding: '8px 13px',
                borderRadius: '10px',
                border: 'none',
                background: busy ? 'rgba(255,150,205,0.35)' : 'linear-gradient(135deg, rgba(255,150,205,0.92), rgba(196,120,255,0.88))',
                color: '#241626',
                cursor: busy ? 'not-allowed' : 'pointer',
                fontSize: '12.5px',
                fontWeight: '600',
              },
              onClick: () => void send(),
              children: '发送',
            }),
          ],
        }),
        rt.h('div', {
          style: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
          children: [
            rt.h('button', { type: 'button', disabled: busy, style: buttonStyle(busy), onClick: () => void say(), children: '让她说一句' }),
            rt.h('button', {
              type: 'button',
              disabled: busy,
              style: buttonStyle(busy),
              onClick: () => void toggleDesktop(),
              children: status?.desktopActive === true ? '收回桌面版' : '搬到桌面',
            }),
            rt.h('button', { type: 'button', disabled: busy, style: buttonStyle(busy), onClick: () => void refresh(), children: '刷新' }),
            rt.h('button', {
              type: 'button',
              disabled: busy,
              style: buttonStyle(busy),
              onClick: () => setPetHidden(false),
              children: '召唤桌宠',
            }),
            rt.h('button', {
              type: 'button',
              disabled: busy,
              style: buttonStyle(busy),
              onClick: () => void forget(),
              children: confirmForget ? '确认清空' : '清空记忆',
            }),
            status && status.desktopActive
              ? rt.h('button', {
                  type: 'button',
                  disabled: busy,
                  style: buttonStyle(busy),
                  onClick: () => void stopDesktop(),
                  children: '关闭桌面版',
                })
              : null,
          ],
        }),
        reply
          ? rt.h('div', {
              style: {
                padding: '9px 11px',
                borderRadius: '10px',
                borderLeft: '3px solid rgba(255,150,205,0.75)',
                background: 'rgba(127,127,127,0.07)',
                fontSize: '12.5px',
                lineHeight: '1.65',
                whiteSpace: 'pre-wrap',
              },
              children: reply,
            })
          : null,
        rt.h('div', {
          style: { ...hintStyle(), fontSize: '11px' },
          children: '桌宠：单击说话（原音）· 双击聊天 · 拖动换位置 · 拖到边缘探头。命令：/elysia、/elysia-remind 21:30 喝水、/elysia-mood。',
        }),
      ],
    });
  };
}

/**
 * 造 DSH 客户端 factory（`__ModuleLoader__` 的入参）。
 *
 * 契约（对照 dsh-onebot-qq / dsh-mnemon 两个能正常装载的插件）：
 * - `load` 的 `id` 必须是**包名** `dsh-elysia`，写别的值宿主认不出这个条目；
 * - factory 返回一个 cordis 客户端插件：导出 `inject`（要等哪些服务）和
 *   `apply(ctx)`，apply 负责把两块 UI 挂上插槽，并返回 disposer。
 */
function makeFactory(): (require: (name: string) => unknown) => unknown {
  return (require) => {
    const module = { exports: {} as Record<string, unknown> };
    const react = require('react') as {
      useState: Runtime['useState'];
      useEffect: Runtime['useEffect'];
      useRef: Runtime['useRef'];
    };
    const jsxRuntime = require('react/jsx-runtime') as { jsx: Runtime['h'] };
    const rt: Runtime = {
      h: jsxRuntime.jsx,
      useState: react.useState,
      useEffect: react.useEffect,
      useRef: react.useRef,
    };
    const Section = makeSection(rt);
    const Pet = makePet(rt, Section);

    module.exports = {
      inject: ['slots'],
      apply(ctx: {
        slots: {
          inject(slot: string, contribute: () => void): { (): void } | void;
          register(spec: Record<string, unknown>, component: () => unknown): () => void;
        };
      }): () => void {
        const disposers: Array<() => void> = [];

        const register = (slot: string, id: string, order: number, component: () => unknown): void => {
          const unsub = ctx.slots.inject(slot, () => {
            disposers.push(ctx.slots.register({ name: slot, id, order, registrant: 'dsh-elysia' }, component));
          });
          if (typeof unsub === 'function') disposers.push(unsub);
        };

        // 桌宠在下，设置卡片在设置页里。
        register('shell.overlay', PET_ID, 90, () => rt.h(Pet, {}));
        register('settings.section', SECTION_ID, 30, () => rt.h(Section, {}));

        return () => {
          for (const dispose of disposers.reverse()) {
            try {
              dispose();
            } catch {
              // 卸载阶段不因为一块界面炸掉整个客户端。
            }
          }
          disposers.length = 0;
        };
      },
    };
    return module.exports;
  };
}

window.__ModuleLoader__.load({ id: 'dsh-elysia', factory: makeFactory() });
