# BiliDesk 项目审查与纯 C 系列重构可行性

## 1. 结论与范围

**可以重构，建议的候选主线是 C++20 + Qt 6 Widgets + libmpv，而不是纯 C，也不是保留 WebView 后只替换 Rust。** 先证明 Windows 视频合成与生命周期可行，再决定是否全面迁移。本报告是审查和技术探索，不是已完成重构或经过实测的性能承诺。

审查基线：`4cd43000f6977aff846b3a0685c260ac5cd74385` 加当前工作区，包含用户尚未提交的分区相关修改。没有恢复、提交或改写这些修改。审查按整个项目而不是某个提交差异展开，以当前 README 的 Windows 功能承诺为主要核对依据。

覆盖：架构、依赖、启动/IPC、网络与会话、图片代理、播放器 FFI 与线程、标准/精选播放页、弹幕、SQLite、设置、登录及发行工作流。重点源码做了定向静态审查；**不是每行代码的形式化审计，也没有证明所有功能均正确。** 未逐项执行登录、社交写操作或真实视频播放。未将旧代码图中的结构提示当成当前缺陷证据：所要求的 code-review-graph MCP 工具未暴露，可用 pi-lens 图又明确过期，因此回落到当前文件核验。

本次环境为 Linux。Windows HWND、DPAPI、D3D11、WebView2、NSIS、硬件解码与画面效果均未真机验证；结论中区分代码事实、推导风险和待验证假设。

## 2. 现状

```text
React 页面 / Zustand 状态 / Router
                │ Tauri invoke + 全局事件
Rust commands ──┼── BiliClient：网页内部 HTTP 端点、Cookie、WBI
                ├── Storage：SQLite / 设置 / 历史 / 续播
                └── PlayerHost：工作线程 / 原生子 HWND
                              └── libmpv / DASH / ASS
```

- 自有前端目录共 63 个 TS/TSX/CSS 文件、约 8,443 行；Rust 源码 22 个文件、约 5,247 行。含测试，前端还含通用 UI 封装，不是重写工作量的等价估计。
- `src/pages/FeaturedPage.tsx` 993 行、`PlayerPage.tsx` 891 行；`bili/client.rs` 1,629 行。这些文件同时容纳请求编排、交互、状态和表现，迁移时应按职责重新组织，不能一对一改后缀。
- 当前平台契约是 Windows 10/11 x64，非跨平台产品。非 Windows 的会话保护函数原样返回字节，原生视频窗口也没有实现；Linux 测试通过不代表 Linux 客户端可用。
- 有价值的现有资产：接口字段知识、WBI 算法与 fixture、错误分类、弹幕转 ASS、SQLite 表结构、DPAPI 文件格式、固定 libmpv 包及校验、功能/隐私/许可证文档。
- 非官方网页端点随时可能调整。更换编程语言不会带来官方兼容承诺，也不会解决风控或接口授权问题。

## 3. 实际验证结果

| 命令 | 本次结果 | 解释 |
| --- | --- | --- |
| `npm run check` | 通过 | TypeScript + Vite 构建；12 个测试文件、59 个测试通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked` | 通过 | 47 通过、1 ignored；不能把 ignored 计为已验证 |
| `npm run check:release` | 通过 | 当前版本号一致 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 通过 | 格式检查 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings` | 失败 | Linux 下 `StageBounds.x/y`、`Backdrop`、`on_window_thread` 的 dead-code 诊断；不推断 Windows 也必然失败 |
| `npm audit --json` | 失败 | 4 个受影响包：2 high、2 moderate，详情见 F1 |

未运行 RustSec 审计：当前 PATH 没有 `cargo-audit`。没有执行 Windows 安装包构建或 UI E2E。已有前端测试主要覆盖纯函数、导航、版本与错误转换，不覆盖实际 React 播放页生命周期。

## 4. 审查发现

优先级：P1 表示应优先处理的发布/隐私问题；P2 表示可触发的功能/可靠性缺陷；P3 表示工程改进。不把所有建议都当作已经复现的漏洞。

### F1 / P1：当前依赖审计未通过，发布门禁存在阻断

证据：本次 `npm audit --json`；`.github/workflows/windows-installer.yml` 的 quality job 执行 `npm audit --audit-level=high`，nsis 依赖 quality。

本地解析版本包括 Vite 7.3.6、Vitest 4.1.11。审计列出：

- `vite`：high，包含 Windows 编辑器命令处理等问题，例 [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm)。
- `source-map-js`：high，索引 sourcemap 偏移导致事件循环 DoS，[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)。
- `@vitest/mocker`、`vitest`：moderate，包括 mock 注册注入/Windows 路径遍历，[GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)、[GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp)。

这主要是开发/测试工具链风险，**不是已经证明安装包存在同等远程代码执行漏洞**。审计结果会随公告更新，干净 CI 仍需重新确认。建议更新受影响依赖及锁文件后重新执行干净安装、审计和完整构建，不通过关闭 audit 门禁绕过。

### F2 / P1：图片 CDN 请求不必要地携带全部登录 Cookie

证据：`src-tauri/src/bili/client.rs:119-134` 的 `headers()` 将整个 Cookie map 序列化；`:464-472` 的 `fetch_allowed_image()` 对 hdslb.com/biliimg.com 图片请求复用这些头。

当前实现绕开浏览器的 Cookie 域隔离，将包括 SESSDATA/bili_jct 在内的登录信息发送至图床请求。白名单能限制目标，不等于图片请求需要账号凭证。**确认的是传输范围扩大，不是已发现攻击者获得 Cookie。**

建议拆分认证 API、匿名图片、媒体请求的头策略；图片不带登录 Cookie。播放器也使用通用 Cookie 头（`:493-498`，`mpv.rs:267-268`），应验证哪些播放请求真正需要它，不能把同一份凭证无条件交给所有媒体地址。

验收：本地 mock 抓取各类请求，断言图片 Cookie 缺席；重定向每一跳在发送前执行协议/域/凭证策略。当前图片代码仅在拿到最终响应后检查 final host，不宜把它当成完整出站策略。

### F3 / P2：标准播放页最后一 P 无法可靠进入相关推荐连播

证据：`src/pages/PlayerPage.tsx:165-221` 以空依赖注册 `player-ended`；回调调用该次渲染的 `nextLabel()`，再经 `nextTarget()` 在 `:223-237` 读取闭包里的 `detail`。`detail` 在异步 `videoView()` 完成后才设置。

`sessionRef` 是新的，但闭包中的 `detail` 仍可能是初始 null。于是下一 P 能找到，最后一 P 的相关推荐却找不到，与 README 的自动连播承诺不符。

建议将“计算下一条”变成接受当前 session/detail 的纯函数；事件回调读取最新快照或使用正确维护的 effect-event/ref。测试应覆盖单 P、有相关推荐、最后一 P、切换 bvid、关闭连播。

这是静态闭包分析，尚未在 Windows 播放到 EOF 的真机流程中重现。

### F4 / P2：停止超时后失去 HWND 所有权，缺少最终回收

证据：`src-tauri/src/player.rs:109-135`。

工作线程未在 2 秒内退出时，`stop()` 清空 `embed/window`；后台 join 线程只等待 worker，之后没有拿着原 HWND 执行销毁。这样即使 worker 稍后退出，宿主也已失去窗口句柄，无法正常走 `destroy_embed()`。可能留下窗口/句柄或旧画面，实际表现依 Windows 时序而定。

建议把“工作线程 + HWND + 最终清理责任”一起交给可追踪的 retiring session；退出确认后在 UI 线程销毁。不要以忘掉资源代替取消。验收需注入慢退出并重复切换视频、页面与关闭窗口，观察线程数和 HWND 数是否回落。

### F5 / P2：网络缺少显式整体 deadline，资源大小限制晚于分配/解压

证据：`bili/client.rs:63-70` 创建 HTTP client 未设置整体请求 timeout；`:1260-1269` 完整 `response.bytes()` 后解码；`:486-489` 在拿到完整图片后才检查 8 MiB；`bili/inflate.rs:36-39` 无上限 `read_to_end()`。

慢响应可长时间占住登录/打开播放流程；大响应或高压缩比内容可能先造成大量内存分配，之后才被图片大小检查拒绝。播放前还同步等待弹幕请求完成（`commands/player.rs:52-59`），因此弹幕慢会拖住视频启动。

建议 API/图片/弹幕分别设置 deadline、取消和并发上限；逐块累计限制解压后字节数；弹幕失败或超时不阻塞视频首帧。对 gzip/brotli 自动解压后的 body 同样限额。对受信任上游异常输入的健壮性风险，不等于任意网站可直接触发。

### F6 / P2：部分弹幕设置写入数据库但运行时选项仍是旧值

证据：`src-tauri/src/commands/settings.rs:33-67` 只同步 enabled/font_size/max_rows，不同步 opacity/area/bold；设置页走 Zustand `setKey()` → `settingsSet()`；`commands/player.rs:47-56` 先按运行时 opts 生成 ASS，`PlayerPage.tsx:359-379` 却在打开完成后才再次提交偏好。

修改透明度、区域或加粗后，不重启直接播放，第一份 ASS 可能仍用旧值。后提交的 `player_set_danmaku_prefs` 只改 opts/数据库，不重建当前 ASS（`commands/player.rs:200-241`），不能修复已经加载的样式；精选路径也需要单独验收。

建议设置由一个经过验证的类型统一管理、持久化与更新运行时；明确区分“立即应用”和“下次播放应用”。播放准备应使用同一份不可变设置快照。测试修改设置后打开首个视频，无需重启即可符合选项。

### F7 / P2：会话文件非原子写，损坏后可能阻止应用启动

证据：`bili/session.rs:84-94` 直接 `fs::write(path, output)`；`Session::load` 的读取、解密和 JSON 错误向上传播；`commands::init_data_dir` 调用 `set_data_dir()?`，`lib.rs` setup 将错误继续向上传递。

截断写入、进程中断、磁盘故障或会话文件损坏可能让下次启动失败，而不是退回未登录状态。`capture_cookies` 还可能由并行响应触发持久化，需要保证写入排序。SQLite 历史迁移已有坏文件隔离，但 session 没有同等恢复策略。

建议同目录临时文件 + 可靠替换、串行持久化、备份/损坏隔离；对会话失效安全降级为未登录并提示，不要删数据库。Windows 上替换语义、磁盘满、DPAPI 解密失败均需测试。

### F8 / P2：后端取消编号没有传播到播放器事件

证据：`commands/mod.rs` 中 `PlayerRequests` 有 generation/scope；`mpv.rs:344-367` 发出的 progress/ended/error 却不含它们，两个播放页直接消费全局事件。

请求准备阶段已有过期检查，这是优点；但旧 worker 延迟事件或切页期间已排队事件仍可能被新页面理解成自己的进度/结束。结合 F4 的慢退出路径风险更明显。**这里只证明事件缺少来源校验，未在真机复现串台。**

建议所有事件含 `session_id/generation/bvid/cid`，UI 只接收当前会话事件；seek、保存进度、自动连播同样绑定会话。用人为延迟的旧 EOF/进度/错误事件验收，而不只测试请求编号类。

### 工程与测试补充

- Linux 严格 Clippy 失败属于非主要平台的可维护性问题；按 cfg 限定 Windows 专用代码，并在 Windows runner 重新核对，不泛化为所有平台构建失败。
- 后端已有 host 白名单、SQL 参数绑定、设置键白名单、Windows DPAPI、CSP 和播放请求代次，不能把项目描述成“完全没有安全设计”。
- FFI 使用手写 libmpv ABI。重构后应直接采用与固定 DLL 匹配的官方头文件，增加版本检查和错误传播；不要盲目使用 master 头文件对应发行 DLL。
- 当前没有能覆盖播放页 effect、原生工作线程退出、DPI/遮挡、安装升级、登录失效的自动化证据。单元测试通过不等于这些路径通过。
- 第三方媒体 DLL 下载已有版本/哈希固定。新实现仍需保留许可证、来源、可替换动态库及供应链检查；迁移语言不是许可证豁免。

## 5. “纯 C 系列”的可执行定义

建议采用以下定义，避免到了中途才发现双方理解不同：

- 应用业务、网络编排、UI、播放器宿主均为 C++；依赖可为 C 或 C++。
- 不依赖 Rust、Node.js、TypeScript、React、HTML、运行时 JavaScript、QML 或 WebView2。
- CMake、资源文件、翻译文件和 CI 脚本属于构建/数据描述，不算应用运行时语言。
- 保留 libmpv/FFmpeg/libass、SQLite、系统 TLS/DPAPI。所谓“纯”不是重写操作系统和解码器。
- 若要求包括每个第三方二进制内部实现也只能是 C/C++，必须另做传递依赖/SBOM 审计，本报告没有证明这一点。
- C# 虽常被口语归入 C 系语法语言，但属于另一种托管技术路线，不是本报告推荐的原生 C/C++ 方案。Objective-C/Objective-C++ 可服务 macOS 原生适配，当前 Windows 目标没有引入理由。

若要求严格 ISO C 而非允许 C++，Qt 路线不适用，应选 Win32 + C 库，并接受更高的 UI/生命周期维护成本。

## 6. 候选路线比较

| 路线 | 满足上述定义 | 对当前项目的判断 |
| --- | --- | --- |
| C++20 + Qt Widgets + libmpv | 是，可避免 QML/JS | 推荐作为验证主线；成熟文本输入、列表、布局、可访问性能力，但需要重做 CSS 视觉和验证视频合成 |
| C++ + Win32/Direct2D/DirectWrite + libmpv | 是 | Windows 专用、控制力强；控件、布局、输入法、无障碍和主题工作量显著增大 |
| C + Win32 + WinHTTP/libcurl + SQLite + libmpv | 是，且可严格纯 C | 技术可行但性价比低；复杂异步 UI、字符串与资源管理由自己负责 |
| C++ + Qt Quick/QML | 否，若要求 UI 也纯 C++ | 动画/视觉有优势，但不能把 QML 方案包装成“纯 C++” |
| C++ + WebView2/CEF 保留前端 | 否 | 可作临时迁移桥，不是最终全原生实现 |
| C++ + Dear ImGui | 是 | 可做播放器技术验证，不建议直接承担当前消费级客户端的全部 UI、输入法和无障碍需求 |

**为什么选 Qt Widgets 而不是“全手写”：** 此项目价值在推荐/搜索/账号/互动/播放体验，而不是 GUI 工具包。Widgets 允许在 C++ 中定义界面，代价是视觉重建；不能假定原来的 Tailwind/Radix 界面可直接复用。

本轮未安装 Qt 或生成 C++ 项目；环境有 g++，但检查未找到 CMake/Qt6Widgets。路线尚未达到“编译并运行验证”的程度。

## 7. 建议的原生架构

```text
app/                       QApplication、导航、生命周期、依赖装配
ui/                        Widgets、列表模型、搜索、评论、设置
domain/                    稳定 DTO、错误、用户命令、用例
services/
  playback_coordinator     串行状态机、session_id、取消、连播、续播
  account_session          Cookie 域策略、登录状态、原子持久化
infra/
  bili_http                QNetworkAccessManager、WBI、限额、deadline
  image_cache              匿名下载、缓存、并发/大小限制
  sqlite_store             SQLite C 接口 + RAII、事务、迁移
  windows_dpapi            会话加解密
  mpv_adapter              官方 C 接口、事件线程、渲染适配
```

不要把现有几十个 Tauri command 原样变成一组 Qt signals 再让页面承担编排。播放器模块应对外隐藏：

- 当前播放会话与请求的对应关系；
- 过期操作、准备/播放/暂停/停止/失败状态转换；
- worker 与渲染上下文的销毁顺序；
- 最后进度、续播、连播及弹幕准备；
- 网络超时与取消。

UI 发出 `open/seek/pause/stop` 等少量意图，接收带会话编号的状态快照。HTTP、存储、播放器后端通过可替换的接口注入；测试跨越相同接口，不直接依赖 Widget 内部状态。

线程约束：

1. Widgets 只在 GUI 线程操作；网络对象在哪个线程创建，就在对应事件循环中使用。
2. SQLite 用单独存储队列或明确的连接线程归属，不从任意回调共享一个裸连接。
3. mpv 事件处理与正常命令单独管理；渲染回调仅唤醒绘制，不在回调里直接执行 render。
4. OpenGL render 调用需要正确且 current 的上下文，不能同时有多个线程使用同一 render context。
5. 停止、渲染上下文释放、mpv core 销毁按顺序完成；UI 不同步等待可能回调 UI 的 worker。

## 8. 最关键技术闸门：视频与 UI 合成

当前方式是 `wid` 子 HWND 位于 WebView 上方。换成 C++ 并不自动解决原生子窗口覆盖、弹窗、透明层和输入问题。

两条应对比验证的路径：

- **基线：Qt 管理原生视频子窗口 + libmpv wid。** 便于延续当前 D3D11/hwdec 路径；控件安排在画面之外。若保留任何画面内浮层，必须测试遮挡、鼠标输入与 z-order，不能假设普通 Widget 会自然覆盖。
- **候选：QOpenGLWidget + libmpv render API。** 可将视频置于 Qt 管理的绘制链，适合研究视频与 UI 一起合成；但是要实测 Windows 驱动兼容、硬件解码互操作、DPI、HDR/色彩与开销，不能宣称一定更快。使用 `defaultFramebufferObject()`，不可假定 FBO 为 0。

mpv 当前 master 的 render API 文档还出现 D3D11 backend，**不代表项目固定的发行 DLL 具备该接口**。先核对下载包版本与实际导出符号，再决定是否研究 D3D11 render 路线；不以在线最新头文件作为本地兼容证据。

PoC 输入优先用本地合法测试视频，隔离账号/网络变量；再接入实际有权限的 DASH 音视频和 ASS。不得以改变渲染路线为由引入下载缓存、绕过会员或地域限制等既定非目标。

### Windows 验收矩阵

- Windows 10/11、Intel/AMD/NVIDIA，硬件解码启用/退回软件；
- 100/125/150/200% DPI、跨屏、窗口缩放/最大化/最小化、锁屏恢复；
- 标准页↔精选页、快速连续切片、停止中再打开、慢退出与立即关闭应用；
- 中文搜索/评论输入、IME、快捷键、焦点与键盘可访问性；
- 评论/登录/设置弹窗与播放器遮挡；
- DASH 音画同步、seek、切清晰度位置恢复、倍速、ASS 样式/密度；
- 网络失联、超时、无权限、坏数据、旧会话事件、磁盘满、会话损坏；
- 安装、升级、回滚、DLL 缺失、用户替换媒体 DLL、历史数据保留。

测量空闲与播放时 working set/private bytes、冷启动、首帧时间、CPU/GPU、掉帧、线程/HWND 数和包体；同硬件、相同视频/清晰度、相同解码路径与缓存条件，取多次中位数。当前没有这些基线，所以不承诺“内存减少多少”。

## 9. 数据与功能迁移

| 当前资产 | 迁移策略 |
| --- | --- |
| `bilidesk.db` | 同表结构导入/兼容打开，先备份，保留 settings/history/play_progress/schema_migrations |
| DPAPI `session.json` | 识别 `BILIDESK_SESSION_V1\\0` 魔数，调用当前用户的 CryptUnprotectData，解析 JSON；失败退回扫码 |
| 旧明文会话/历史文件 | 延续迁移与损坏隔离策略，不复活已退出的会话 |
| WBI/解析/ASS/纯函数 tests | 抽出 fixture、输入输出 golden corpus，移植到 Qt Test/C++ 测试，不机械复用 Rust/TS 测试运行时 |
| React UI/CSS | 仅可复用设计/资源和行为规范，Widgets 需要重做布局、动效、焦点、缩放与可访问性 |
| README、PRIVACY、许可证 | 更新技术描述，保持“非官方、无下载/绕过”等功能边界和真实隐私声明 |
| NSIS/签名/下载校验 | 用新的原生打包流水线实现，不依赖 Tauri 打包继续存在 |

新旧应用不应同时写同一数据库和会话文件。开发期用独立目录，以显式迁移导入真实数据；发布前再决定是否继承原目录。Qt 的默认应用数据路径不一定等同于旧 Tauri identifier，必须显式处理路径，不能误判为数据丢失。

DPAPI 兼容以原 Windows 用户/机器环境为前提；这不是跨机器迁移登录态的机制。

## 10. 分阶段路线与成本

以下为有 Qt/Windows/libmpv 经验的一名工程师的**规划估计**，不是工期承诺，各阶段可能重叠；视频渲染未知项会显著影响成本。

1. **现状收敛：约 1–2 周。** 修复优先问题，补播放/设置/取消回归场景，保存行为 fixture 和性能基线。
2. **独立播放器 PoC：约 1–2 周。** 对比 wid 与 render API，只做窗口、视频、控件、ASS、生命周期与 DPI；未达闸门则暂停全量重写。
3. **原生纵向切片：约 2–4 周。** SQLite/DPAPI、扫码、搜索、打开播放、错误与取消，打通构建/打包。
4. **功能补齐：约 4–8 周。** 推荐/热门/排行/分区/动态、空间/收藏/稍后再看、评论/互动、精选、设置与视觉。
5. **产品化：约 2–4 周。** 真机矩阵、性能、无障碍、升级回滚、签名和许可。

总量约 **10–20 人周量级**，高保真视觉、陌生 GUI 技术栈、多平台或额外合规要求需另估。不能只按约 1.4 万行源码估算；功能回归、视频驱动和分发更容易成为长尾。

建议保留当前主线，在独立分支/目录做 PoC；可以复用 fixture 和 DLL，但不要为了迁移方便在新产品长期保留第二套 Rust+TS 运行时。达到功能/数据/性能/发行验收后才替换旧主线。

**决策标准：**

- 目标是摆脱 WebView2/JS/Rust 运行时、统一 C++ 技术栈或掌控原生渲染：值得进入 PoC。
- 目标只是修缺陷或让内存“可能更低”：先修当前缺陷并量测，全面重写未必划算。
- 要求严格纯 C、完整复刻所有动效、跨平台同时交付：必须重新评估工具包和投入，不默认归入推荐方案。

## 11. 一手资料与核验限制

本轮查阅官方文档/项目头文件，以下用于支撑方案，不构成已完成运行验证：

1. [Qt QOpenGLWidget](https://doc.qt.io/qt-6/qopenglwidget.html)：绘制函数、current context、默认 FBO 的使用规则。
2. [libmpv render.h](https://raw.githubusercontent.com/mpv-player/mpv/master/include/mpv/render.h)：wid 与 render 路线、回调/线程及 context/core 生命周期；master 是可变引用，落地时应锁定与 DLL 对应 tag/commit。
3. [Qt QNetworkAccessManager](https://doc.qt.io/qt-6/qnetworkaccessmanager.html)：C++ 网络管理及 reply 生命周期。
4. [SQLite C/C++ interface](https://www.sqlite.org/cintro.html)：现有库文件与表结构不依赖 Rust 语言。
5. [Microsoft CryptUnprotectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptunprotectdata)：原生解密函数，可延续 DPAPI 文件兼容。
6. [Qt Licensing](https://doc.qt.io/qt-6/licensing.html)：商业/LGPL/GPL 选项及部分模块的不同条款。优先采用动态链接且逐模块核对；动态链接本身不是“自动满足 LGPL 全部义务”。还需处理通知、许可证、可替换/重新链接权利、适用源码提供要求及第三方组件义务。此处不是法律意见。

Qt 在线文档跟随版本更新；实施前需要锁定明确 Qt 版本、编译器、构建选项和分发依赖，重新确认 Win10 支持范围、模块许可、TLS/image plugins 与 GPU 路径。
