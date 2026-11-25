/**
 * 桌面端本机接口：给设置页和桌宠一个**不依赖 DSH 网关**的通道。
 *
 * 为什么不用 `ctx.webServer`：桌面版把界面跑在 `dsh-app://` 外壳里，这层协议只转发
 * 自己认识的路径，插件注册的前缀路由在渲染层拿不到（实测请求一条都没到宿主）。
 * 于是宿主自己起一个只绑 127.0.0.1 的小 HTTP 服务：渲染层直接跨域访问，
 * 应答里给 `Access-Control-Allow-Origin: *`。
 *
 * 安全边界：只听回环地址、只暴露爱莉希雅自己的状态与动作（没有文件读写、没有任意 URL）；
 * 端口固定从 7823 起，最多试 8 个，客户端按同一顺序探测。
 * @module dsh-elysia/src/local-api
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 立绘目录：`lib/` 的上一级（包根）下的 assets。 */
const ASSET_DIR = fileURLToPath(new URL('../assets/', import.meta.url));

/** 只放行这些立绘文件名，别让路由变成任意文件读取（新版动效用 webp）。 */
const ASSET_NAME = /^elysia_[a-z0-9_]+\.(png|webp)$/;
/** 音效目录与文件名白名单（手机端 res/raw 的五条）。 */
const SOUND_DIR = fileURLToPath(new URL('../assets/sounds/', import.meta.url));
const SOUND_NAME = /^[a-z0-9_]+\.mp3$/;
/** 台词语音目录：手机端 `assets/voices` 里的七类 wav（顺序即台词编号）。 */
const VOICE_DIR = fileURLToPath(new URL('../assets/voices/', import.meta.url));
const VOICE_NAME = /^(head|heart|wings|body|idle|drag|peek)_(\d+)\.wav$/;
const VOICE_CATEGORIES = ['head', 'heart', 'wings', 'body', 'idle', 'drag', 'peek'];

/** 候选端口：宿主按顺序占用第一个能用的，客户端按同一顺序探测。 */
export const API_PORTS = [7823, 7824, 7825, 7826, 7827, 7828, 7829, 7830];

/** 请求体上限：一句话聊天，1 MB 足够。 */
const MAX_BODY_BYTES = 1_048_576;

/** 宿主交给路由的动作。 */
export interface LocalApiDeps {
  status(): unknown;
  chat(text: string): Promise<{ ok: true; text: string } | { ok: false; message: string }>;
  say(): Promise<{ ok: true; text: string } | { ok: false; message: string }>;
  forget(): void;
  /** 摸摸一次（亲密度任务）。 */
  touch(): unknown;
  /** 陪伴若干秒（亲密度任务）。 */
  stay(seconds: number): unknown;
  /** 听一句语音并返回识别文字。 */
  listen(): Promise<{ ok: true; text: string } | { ok: false; message: string }>;
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

/** 统一补 CORS：渲染层是 `dsh-app://app`，属于跨域。 */
function cors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-max-age', '86400');
}

/** 写 JSON。 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  cors(res);
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/** 读请求体。 */
function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        resolve({});
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        resolve(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/** 一台机器上的路由实现。 */
function handleRequest(deps: LocalApiDeps, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  const method = (req.method ?? 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (path === '/sprites' && method === 'GET') {
    // 一次给全套立绘（base64）：渲染层会把 `/xxx.png` 这类图片路径当静态资源拦下，
    // 走 JSON 通道最稳；整套三十多帧、五兆左右，本机回环没有负担。
    const sprites: Record<string, string> = {};
    const mimes: Record<string, string> = {};
    try {
      for (const file of readdirSync(ASSET_DIR)) {
        if (!ASSET_NAME.test(file)) continue;
        const key = file.replace(/^elysia_/, '').replace(/\.(png|webp)$/, '');
        try {
          sprites[key] = readFileSync(join(ASSET_DIR, file)).toString('base64');
          mimes[key] = file.endsWith('.webp') ? 'image/webp' : 'image/png';
        } catch {
          // 缺哪张就少哪张，界面会退回占位。
        }
      }
    } catch {
      // 目录读不到就给空表，界面显示占位。
    }
    sendJson(res, 200, { ok: true, service: 'dsh-elysia', sprites, mimes });
    return;
  }

  if (path === '/sounds' && method === 'GET') {
    // 音效同样走 JSON：渲染层对二进制资源的路由不保证转发。
    const sounds: Record<string, string> = {};
    try {
      for (const file of readdirSync(SOUND_DIR)) {
        if (!SOUND_NAME.test(file)) continue;
        const key = file.replace(/\.mp3$/, '');
        try {
          sounds[key] = readFileSync(join(SOUND_DIR, file)).toString('base64');
        } catch {
          // 缺哪条就少哪条，界面静默。
        }
      }
    } catch {
      // 目录读不到就给空表。
    }
    sendJson(res, 200, { ok: true, service: 'dsh-elysia', sounds });
    return;
  }

  if (path === '/voices' && method === 'GET') {
    // 按类目懒加载原始台词语音：一次一类，几百 KB 到两兆，点她之前后台预取。
    const category = url.searchParams.get('category') ?? '';
    if (!VOICE_CATEGORIES.includes(category)) {
      sendJson(res, 400, { ok: false, message: 'unknown category' });
      return;
    }
    const voices: Record<string, string> = {};
    try {
      for (const file of readdirSync(VOICE_DIR)) {
        if (!VOICE_NAME.test(file) || !file.startsWith(category + '_')) continue;
        const key = file.replace(/\.wav$/, '');
        try {
          voices[key] = readFileSync(join(VOICE_DIR, file)).toString('base64');
        } catch {
          // 缺哪条就少哪条，界面静默。
        }
      }
    } catch {
      // 目录读不到就给空表。
    }
    sendJson(res, 200, { ok: true, service: 'dsh-elysia', category, voices });
    return;
  }

  if (path === '/lines' && method === 'GET') {
    const category = url.searchParams.get('category') ?? '';
    const list = deps.lines(category);
    if (list.length === 0 && category !== '') {
      sendJson(res, 400, { ok: false, message: 'unknown category' });
      return;
    }
    sendJson(res, 200, { ok: true, category, lines: list });
    return;
  }

  if (path === '/desktop/start' && method === 'POST') {
    const ok = deps.desktopStart();
    sendJson(res, 200, { ok, active: deps.desktopActive(), message: ok ? 'desktop pet launched' : 'desktop pet not launched' });
    return;
  }

  if (path === '/desktop/stop' && method === 'POST') {
    deps.desktopStop();
    sendJson(res, 200, { ok: true, active: deps.desktopActive() });
    return;
  }

  if (path === '/status' && method === 'GET') {
    sendJson(res, 200, { ok: true, service: 'dsh-elysia', ...(deps.status() as Record<string, unknown>) });
    return;
  }

  if (path.startsWith('/asset/') && method === 'GET') {
    const file = path.slice('/asset/'.length);
    if (!ASSET_NAME.test(file)) {
      sendJson(res, 404, { ok: false, message: 'no such asset' });
      return;
    }
    try {
      const bytes = readFileSync(join(ASSET_DIR, file));
      cors(res);
      res.writeHead(200, {
        'content-type': file.endsWith('.webp') ? 'image/webp' : 'image/png',
        'content-length': String(bytes.length),
        'cache-control': 'public, max-age=86400',
      });
      res.end(bytes);
    } catch {
      sendJson(res, 404, { ok: false, message: 'no such asset' });
    }
    return;
  }

  if (path === '/chat' && method === 'POST') {
    void readJsonBody(req).then(async (body) => {
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (text === '') {
        sendJson(res, 400, { ok: false, message: '说点什么吧。' });
        return;
      }
      const result = await deps.chat(text.slice(0, 2000));
      sendJson(res, result.ok ? 200 : 502, result.ok ? { ok: true, text: result.text } : { ok: false, message: result.message });
    });
    return;
  }

  if (path === '/say' && method === 'POST') {
    void deps.say().then((result) => {
      sendJson(res, result.ok ? 200 : 409, result.ok ? { ok: true, text: result.text } : { ok: false, message: result.message });
    });
    return;
  }

  if (path === '/touch' && method === 'POST') {
    const result = deps.touch();
    sendJson(res, 200, { ok: true, ...(result as Record<string, unknown>) });
    return;
  }

  if (path === '/stay' && method === 'POST') {
    void readJsonBody(req).then((body) => {
      const seconds = typeof body.seconds === 'number' ? body.seconds : 30;
      const result = deps.stay(Math.max(1, Math.min(300, Math.round(seconds))));
      sendJson(res, 200, { ok: true, ...(result as Record<string, unknown>) });
    });
    return;
  }

  if (path === '/listen' && method === 'POST') {
    void deps.listen().then((result) => {
      if (result.ok) sendJson(res, 200, { ok: true, text: result.text });
      else sendJson(res, 409, { ok: false, message: result.message });
    });
    return;
  }

  if (path === '/speak' && method === 'POST') {
    void readJsonBody(req).then((body) => {
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (text === '') {
        sendJson(res, 400, { ok: false, message: '没有要念的内容。' });
        return;
      }
      deps.speak(text.slice(0, 200));
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  if (path === '/forget' && method === 'POST') {
    void readJsonBody(req).then((body) => {
      if (body.confirm !== true) {
        sendJson(res, 400, { ok: false, message: '需要 confirm: true 才能清空。' });
        return;
      }
      deps.forget();
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  sendJson(res, 404, { ok: false, message: 'no such route' });
}

/**
 * 起本机接口：从 7823 起找第一个能绑的端口。
 *
 * @param deps - 四个动作。
 * @param onError - 起不来 / 运行期出错时的回调。
 * @param onReady - 监听成功后的回调（桌面独立窗口要用实际端口）。
 * @returns 句柄；全占满时返回 `{port:0, dispose(){}}`。
 */
export function startLocalApi(
  deps: LocalApiDeps,
  onError?: (message: string) => void,
  onReady?: (port: number) => void,
): LocalApiHandle {
  // 同步返回句柄，端口在监听成功后补进 handle.port。
  const handle: LocalApiHandle = { port: 0, dispose: () => undefined };
  let server: ReturnType<typeof createServer> | null = null;
  let index = 0;

  const tryListen = (): void => {
    if (index >= API_PORTS.length) {
      onError?.('本机接口没有可用端口（7823–7830 都被占用）');
      return;
    }
    const port = API_PORTS[index]!;
    const candidate = createServer((req, res) => {
      try {
        handleRequest(deps, req, res);
      } catch (error) {
        try {
          sendJson(res, 500, { ok: false, message: error instanceof Error ? error.message : String(error) });
        } catch {
          // 已经断开就算了。
        }
      }
    });
    candidate.once('error', (error) => {
      candidate.close();
      index += 1;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' && code !== 'EACCES') {
        onError?.('本机接口启动失败：' + error.message);
      }
      tryListen();
    });
    candidate.listen(port, '127.0.0.1', () => {
      server = candidate;
      handle.port = port;
      onReady?.(port);
    });
  };

  tryListen();

  handle.dispose = () => {
    try {
      server?.close();
    } catch {
      // 关闭失败不影响卸载。
    }
    server = null;
  };

  return handle;
}
