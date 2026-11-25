# dsh-elysia

![dsh-elysia](docs/banner.png)

爱莉希雅住进 DeepSeek Harness（DSH）：**人设对话 + 四层长期记忆 + 七维心情 + 主动开口**。

这是「桌面端可玩」版：宿主半侧 + 设置页卡片 + 窗口内桌宠浮层 + 独立透明置顶桌面版 + 本机回环接口；
语音走 Windows 自带能力（System.Speech 离线识别 + SAPI 朗读），不含手机端 PetLink。
目标很明确——把手机 App 里真正撑起「陪伴感」的那几件事，按 DSH 插件规范跑起来。

---

## 一、它做什么

| 能力 | 说明 |
|---|---|
| 人设对话 | `/elysia 今天好累` —— 带人设、时间感、心情与记忆的回答；末尾剥掉模型自己给的情绪标签，不进气泡正文 |
| 四层记忆 | 工作记忆（最近 12 条）→ 情节（120 段）→ 画像事实（60 条）→ 摘要（150 字）；召回带人称归一、槽位意图、IDF 加权、身份常驻 |
| 心情 | 底子 0–100（基线 70）+ 七维情绪；每轮只吃三分之一的判定值，按 12h / 1.5h 半衰期自己平复 |
| 主动开口 | 五道闸门（开关 / 安静时段 / 最小间隔 / 每日上限 / 55% 抽签），过了才说，说过的进收件箱 |
| 门禁 | 回复出门前过六层：手机号打码、删联系方式分句、提示词泄露整句兜底；广告法与平台引流只在 `PLATFORM` 作用域生效 |
| 桌宠 | 窗口内 `shell.overlay` 浮层 + 独立透明置顶桌面版：默认动作只有静态 `ide`（抱爱心坐垫，不缩放、不忽大忽小），不自动 dance/walk/action；交互时才切 blink / shy / wings / drag / peek，贴边 10 秒走回中间；`动一下` 按钮可手动触发舞蹈或行走；空闲碎碎念、启动/召唤时从屏外滑入、收起挥手 |
| 音效 | 手机端 `res/raw` 五条音效（click / wings / happy / walk / drag）随立绘一起取回，点击、拖拽循环、走路、跳舞各播各的；`soundEnabled` 可关 |
| 台词语音 | 点她、拖拽、空闲碎碎念直接播手机端 `assets/voices` 的原始 WAV（head/heart/wings/body/idle/drag 七类 76 条，按台词顺序一一对应），气泡停 3.5 秒；不再用系统 TTS 念桌宠台词 |
| 亲密度 | 搬 `CompanionManager` 的抛物线等级公式（20·l + 2·l²，1–100 级）与十档等第；每日任务：摸摸 10 次 +5 心、陪伴 5 分钟 +6 心，达标当场发 |
| 时段问候 | 按本机时钟换开场白（凌晨 / 早晨 / 中午 / 下午 / 晚上 / 深夜），对应手机端 ClockManager 的问候链路 |
| 提醒 | `/elysia-remind 21:30 喝水`；到点进收件箱、桌宠冒泡、可朗读 |
| 朗读 | Windows 自带语音（SAPI）只用于聊天回复的朗读；桌宠点击/拖拽台词走原始 WAV，两套互不干扰 |
| 语音/文字 | 桌宠聊天面板 = 文字输入 + 🎤 离线语音识别（Windows System.Speech，zh-CN）+ 🔊 聊天朗读开关；设置页也有同一套输入与麦克风 |

## 二、命令

| 命令 | 作用 |
|---|---|
| `/elysia <消息>` | 和她说话（限 2000 字） |
| `/elysia-mood` | 看此刻心情、最强的那一维、今天主动说了几次 |
| `/elysia-memory [关键词]` | 留空看总量；给词看这一次能召回什么 |
| `/elysia-say` | 现在就让她主动说一句（绕开间隔与抽签，仍守安静时段） |
| `/elysia-inbox` | 看她主动说过的最近几句 |
| `/elysia-remind <时间> <内容>` | 设一条提醒：`21:30 喝水` / `30m 起来走走` / `2h 收衣服` |
| `/elysia-reminders` | 看还没到点的提醒 |
| `/elysia-forget confirm` | 清空长期记忆 |

> 界面半边：设置页里有一张「爱莉希雅」卡片（头像/状态标签/今日任务进度条/文字与语音输入/让她说 + 刷新 + 召唤桌宠 + 清空记忆），
> 右下角有桌宠浮层（气泡、聊天面板、🎤 语音、🔊 朗读开关、Lv 徽标）。两块 UI 都走宿主自己起的本机回环接口（`127.0.0.1:7823` 起，最多试到 7830），
> 不走 DSH 网关——桌面外壳不转发插件注册的前缀路由。

## 三、安装

### 方式一：一键安装（Windows，推荐）

下载仓库 ZIP 并解压，双击 `install.cmd`。脚本会自动：

- 找到本机 DSH 的 profile 和自带 pnpm
- 把插件复制到 `<dshHome>\plugins\dsh-elysia`
- 写入 profile 依赖和 `cordis.patch.yml`

装完手动重启 DSH 即可；想让它装完自动重启，用：

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -Restart
```

常用参数：

```powershell
# Web 版 profile
powershell -ExecutionPolicy Bypass -File install.ps1 -Profile web

# 只看会做什么，不落盘
powershell -ExecutionPolicy Bypass -File install.ps1 -DryRun
```

也可以从 GitHub 下载 ZIP：

`https://github.com/Elysia-gy/elysia-pt/archive/refs/heads/main.zip`

解压后双击里面的 `install.cmd` 即可。

### 方式二：从 GitHub 源码安装

```sh
git clone https://github.com/Elysia-gy/elysia-pt.git
cd elysia-pt
npm install
npm run build          # tsc → lib/index.js + lib/client.js + 类型声明

# dsh web 用 --profile web；桌面应用用 --profile desktop
dsh plugin --profile desktop add file:.
```

装完**重开 DSH**（或重启 `dsh web`）才生效。

> 如果 `dsh plugin` 在桌面 profile 上被拒绝，用桌面应用的「插件管理」安装本地目录，
> 或直接运行上面的 `install.ps1`。

### 方式三：应用内「插件管理」

桌面应用里打开插件管理页，安装框填仓库本地路径；`lib/` 已随仓库提交，克隆后即可安装。
桌面版 exe 也已提交，只有改 `desktop/ElysiaDesktopPetWin.cs` 时才需要重新编译：

```powershell
powershell -ExecutionPolicy Bypass -File desktop/build.ps1
```

### 前置

- Node.js ≥ 22.12（与 DSH 运行时一致）
- DSH `0.2.x`（`dsh --version` 查看）；本插件按 Cordis 4 写法，不依赖桌面端 Electron

## 四、配置

```jsonc
{
  "enabled": true,              // 总开关：关掉后不注册命令与定时器
  "persona": "",                // 自定义人设；空 = 内置爱莉希雅
  "modelProvider": "",          // 与 modelName 一起填才生效；都空 = 跟随当前对话
  "modelName": "",
  "maxReplyChars": 120,         // 单条回复裁剪上限
  "memoryEnabled": true,        // 是否把记忆注入提示词
  "moodEnabled": true,          // 关掉后心情永远停在基线
  "proactiveEnabled": true,
  "quietStartHour": 23,         // 安静时段（跨零点也支持）
  "quietEndHour": 8,
  "proactiveMinGapMin": 45,     // 距主人上次说话至少多久
  "proactiveDailyMax": 4,
  "proactiveChance": 0.55,      // 抽签概率，别拉满——机械准点比不说更假
  "tickMinutes": 1,             // 闸门判定粒度
  "sensitiveWords": []          // 额外敏感词；默认空，宁可漏也别误伤
}
```

默认值只写在 `src/config.ts` 的 schema 里，`apply` 内不再兜底。

## 五、数据在哪

```
<dshHome>/dsh-elysia/state.json
```

```jsonc
{
  "version": 1,
  "value": {
    "memory": { "turns": [], "episodes": [], "facts": [], "summary": "", "updatedAt": 0 },
    "mood": { "mood": 70, "dims": {}, "updatedAt": 0, "lastDecayAt": 0, "injectedToday": 0, "injectedDate": "" },
    "lastUserAt": 0,
    "spokenDate": "", "spokenToday": 0,
    "inbox": []
  }
}
```

- 写入是原子的：先写 `state.json.tmp` 再 rename，断电最坏丢这一次写入。
- 文件损坏 / 版本不认识 → 回空壳，不会让插件起不来。
- 删掉这个文件 = 清空全部记忆与心情（等价于 `/elysia-forget confirm`，但连心情一起重置）。

## 六、设计取舍（照实写）

1. **心情不二次调模型**：手机端每轮单独发一次 judge 请求判定心情，桌面端这里改成「模型自己给的情绪标签驱动」。标签本来就是它写的，省一次真金白银的调用；代价是拿不到 `confidence` 与细粒度数值，只能用固定 +4。
2. **主动消息进收件箱**：核心版没有 UI，与其假造一个通知通道，不如把话存下来等 `/elysia-inbox` 或后续 UI 消费——至少不会出现「她说了一句、谁也没看见」。
3. **不做平台合规那一层**：广告法与引流只在 `scope: 'PLATFORM'` 生效，聊天默认 `CHAT`。在主人的屏幕上说「这是最好的办法」谈不上广告，全局开着只会让回复动不动被拦。
4. **不引第三方依赖**：网络与 JSON 都是 Node 自带；唯一的外部输入是宿主给的 `llm`。依赖越少，升级 DSH 时越不会被连带炸掉。
5. **命令返回回复正文**：`handler` 是 `async`，直接 `await` 生成再回帖；若你的 DSH 版本不等待异步 handler，用 `/elysia-inbox` 也能拿到刚说的话（对话回复同时进记忆，不会丢）。

## 七、与手机 App（Elysia）的功能映射

手机端 18 个功能域 → 本插件：

| # | 手机端功能域 | 本插件 | 说明 |
|---|---|---|---|
| 1 | 桌宠本体 | ✅ 窗口内浮层 + 独立透明置顶桌面版 | 默认只播静态 `ide`（抱爱心坐垫）；区域点击 / 拖拽帧 / 右键菜单 / 手动「动一下」都保留；桌面版在 DSH 启动后自动拉起，窗口内浮层自动让位 |
| 2 | 显示模式 | — | 同上 |
| 3 | 智能状态（时段/天气/电量） | 部分 | 只保留「时间感」（`timeLine`）；天气与电量属系统能力，留作 M4 |
| 4 | 等级与亲密度 | — | 桌宠养成线，与 DSH 场景无关（可用 GM 式开关替代） |
| 5 | AI 对话 | ✅ | `/elysia` |
| 6 | 人格与风格 | ✅ | `persona` 配置 + 场景后缀（代码常量，不进人设） |
| 7 | 长期记忆 | ✅ | 四层结构、四处召回修补全部移植 |
| 8 | 心情引擎 | ✅（轻量） | 七维、1/3 步长、双半衰期；判定来源改为情绪标签 |
| 9 | 主动行为 | 部分 | 主动开口 ✅；玩具/作画依赖浏览器与外部图像模型，M3/M6 |
| 10 | 语音系统 | ✅ 桌面端可用 | 语音输入走 Windows System.Speech 离线识别（`/listen`），朗读走 SAPI（`/speak`）；手机端的四级回落音源不需要 |
| 11 | 给她打电话 | — | 需预生成语音包与通话 UI |
| 12 | 视频陪伴 | — | 抖音/B站读屏与媒体会话是 Android 能力，桌面端无对应接口 |
| 13 | 她的小屋 | — | three.js + Spine 场景，M5 视 UI 方案 |
| 14 | 小游戏 | — | 桌面端无对应入口 |
| 15 | 作品与文件抽屉 | — | 依赖 blob 通道与 UI |
| 16 | API 余额查询 | — | DSH 自带余额能力，不必重复实现 |
| 17 | PetLink 连接器 | — | M4：可复用手机端 v1 协议（HMAC + 事件上行） |
| 18 | 任务台账 | — | M4 与连接器一起做才有意义 |

## 八、开发

```sh
npm install          # 只为 typecheck/build 装 peer 与工具链
npm test             # 47 条纯逻辑用例，零依赖，Node 22 --experimental-strip-types
npm run test:smoke   # 6 条装配冒烟：桩宿主 + 桩 dsh-llm，验证导出契约/命令/定时器/落盘
npm run test:all     # 上面两套一起跑（53 条）
npm run typecheck    # 需要上面装过依赖
npm run build        # 产出 lib/
```

装好之后的逐条验收见 [`docs/验收清单.md`](docs/验收清单.md)。

代码分层：

```
src/
├── index.ts       # 装配根：读配置、注册命令、拉定时器（唯一碰 ctx 的地方）
├── config.ts      # schemastery schema：类型 + 默认值 + 校验
├── chat.ts        # 模型调用唯一出口（ctx.llm.stream + BlockAssembler）
├── persona.ts     # 人设与场景后缀
├── memory.ts      # 四层记忆与召回（纯函数）
├── mood.ts        # 心情引擎（纯函数）
├── emotion.ts     # 情绪标签解析（纯函数）
├── gate.ts        # 六层门禁（纯函数）
├── proactive.ts   # 五道闸门（纯函数）
└── store.ts       # JSON 存档：原子写 + 版本号
```

`index.ts` 之外的模块都不碰 `ctx`，所以都能在 `node:test` 里直接跑。

## 九、下一步

- **M2 语音**：已完成桌面端最小闭环——`/listen` 离线听写、`/speak` SAPI 朗读；跨设备音色与在线音源不做。
- **M3 气泡与卡片**：`lib/client.js` + `dsh.client`，把 `inbox` 做成宠物头上的气泡。
- **M4 PetLink**：复用手机端 v1 协议，让手机与桌面共享同一份记忆与会话。
- **M5 真桌面桌宠**：已完成。WinForms 分层透明窗 `ElysiaDesktopPet.exe`，自动置顶、可拖、右键菜单、独立聊天/设置，DSH 启动后自动拉起。
- **M6 玩具/作画**：浏览器侧生成 HTML 与图片，仍走 `ChatEngine` 的 `TOY` 场景口径。

## 十、已知限制

- 心情判定是轻量的，拿不到 confidence，也不会写时间线。
- 没有流式输出：`llm.stream` 拼完整段再回帖，长回复体感偏慢。
- 未做多会话隔离：一份存档对应一个 DSH 用户。

