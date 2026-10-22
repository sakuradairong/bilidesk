# BiliDesk C# / WinUI 开发方案

状态：用户已批准按方案渐进实施；已开始独立 `csharp/` 工程基线与 D03/D05/D07 基础模块，不代表已批准跳过 Windows 闸门或立即替换现有主线。实施入口见 [`csharp/README.md`](../../csharp/README.md)。

本文件作为下一阶段实施入口，取代旧研究报告中“WPF 默认优先”的执行顺序，但不删除历史分析。技术依据见 [同类客户端核查](../research/richasy-clients-reference-review.md)、[原选型](../research/csharp-efficiency-first-plan.md) 和 [Linux 环境实测](linux-dotnet.md)。

## 1. 决策与未决项

### 已固定的方向

- Windows 专用、功能交付效率优先；候选主线为 C# / .NET 10 LTS / WinUI 3 / CommunityToolkit.Mvvm。
- 保留 libmpv、SQLite、Windows 当前用户 DPAPI 和网页身份语义；不迁入 Copilot 的整套功能。
- 自有代码保持 MIT 路线；Copilot GPL 源码/XAML 不直接移植；bili-kernel 的源码/包许可差异未澄清前不引入。
- 现有 Tauri 主线保持可构建、可发布；迁移分支和新数据目录隔离，不覆盖已有未提交变更。
- 明确不做直播、下载/缓存、会员破解、地区绕过。不为了重写伪装成官方客户端。

### 必须通过实验而不是讨论锁定的事项

| 项目 | 暂定选择 | 锁定条件 / 失败出口 |
| --- | --- | --- |
| UI | WinUI 3 | Windows XAML 构建 + 播放交互闸门；失败可转 WPF PoC，不迁移全部 UI 再发现问题 |
| 播放封装 | 独立 MIT mpv-kernel 候选 | 固定包与源码 SHA、依赖许可、ABI、退出和 ASS 验证；失败仅替换 adapter |
| 播放窗口 | 独立窗口是首个技术探针 | 不代表已获准改变最终产品交互；精选及单窗口体验另做评审 |
| Windows 最低版本 | 保留现有 Windows 10/11 x64 产品目标 | 具体受支持系统版本、WinAppSDK 版本及干净机验证后确定；不得只凭 TFM min-version 宣布支持 |
| 发布 | 首个 PoC 优先 unpackaged Windows 构建 | MSIX / 安装器独立决策；先证明原生 DLL、数据路径和当前用户安装可行 |

不提前指定尚未验证的最新 WinAppSDK/MPV 包。开工时记录精确版本、源码提交、SHA、许可证与依赖树；SDK 可先使用当前实测的 `10.0.402`。不要把 .NET 9 参考项目直接等同于 .NET 10 兼容验收。

## 2. 现状证据和范围

当前功能基线以 [README](../../README.md) 和 [`src-tauri/src/lib.rs`](../../src-tauri/src/lib.rs) 的命令注册为准，而非仅按页面截图复刻。

| 能力 | 现有依据 | 计划阶段 |
| --- | --- | --- |
| 登录、个人状态、登出 | auth 命令、`bili/session.rs` | M2 |
| 搜索、详情、分P、清晰度 | feed/video 命令、`src/api.ts` | M2 |
| 播放、ASS、音量/速度、续播、连播 | player 命令、`PlayerPage.tsx`、`FeaturedPage.tsx` | M1→M2→M4 |
| 历史、设置、主题 | storage/settings、SettingsPage | M2→M3 |
| 推荐/热门/排行/分区/动态 | feed 命令、发现 Tab 实现 | M3 |
| 空间/投稿/关注、收藏夹、稍后再看 | user/fav/watchlater 命令 | M3 |
| 赞/不喜欢/币/收藏/三连、评论、发弹幕 | social/reply/danmaku 命令 | M4 |
| 精选沉浸切条与快捷键 | FeaturedPage、README | M4 |
| 干净机安装、升级、回退和第三方声明 | 当前 workflow / RELEASE_CHECKLIST / THIRD_PARTY | M0 设计，M5 验收 |

必须维护一张功能对照表，列出“已迁移 / 降级 / 未迁移 / 验证证据”。M2 是可用预览，不宣称功能对等；M5 前不替换默认安装通道。

## 3. 最小工程布局与依赖方向

建议在独立 `csharp/` 目录渐进建立，不移动 Rust/React 源码：

```text
csharp/
  BiliDesk.sln
  global.json / Directory.Build.props / Directory.Packages.props
  src/
    BiliDesk.Core/             net10.0：用例、模型、播放策略、设置规则
    BiliDesk.Infrastructure/   net10.0：HTTP、DTO、SQLite、图片、ASS
    BiliDesk.Windows/          net10.0-windows...：MPV、DPAPI、窗口适配
    BiliDesk.App/              WinUI：页面、ViewModel、组合根、导航
  tests/
    BiliDesk.Core.Tests/
    BiliDesk.Infrastructure.Tests/
    BiliDesk.Windows.Tests/
  probes/                     可丢弃播放探针，不作为生产业务骨架
```

依赖：App → Windows / Infrastructure → Core；Core 不引用 WinUI、SQLite、MPV 或平台 DTO。Infrastructure 不反向引用 App/Windows，Windows 不依赖 UI 页面；窗口内容装配留在 App。早期测试项目可合并，禁止按每张页面/每个 DTO 建工程。

采用深模块：调用者不需要知道 Cookie 拼接、WBI、解压、播放线程或 SQLite SQL。仅在实际替换点建立 seam：真实 MPV / fake 播放后端、Windows 会话保护 / 测试替身、真实 HTTP / fixture handler。普通 mapper 不为 DI 强行建接口。不引入跨进程 IPC、微服务、全局事件总线或可插拔多播放器框架。

## 4. 核心行为契约

### 4.1 播放协调模块

单个 `PlaybackCoordinator` 拥有当前请求、已解析媒体、session、连播计时和续播策略；标准页和精选页只订阅快照、提交意图，不各实现一套业务。

设计表面（不是已经存在的代码）：

```text
OpenAsync(PlaybackRequest, CancellationToken) → PlaybackSessionId
ExecuteAsync(sessionId, PlaybackIntent, CancellationToken)
StopAsync(sessionId, reason, CancellationToken)
ObserveAsync(CancellationToken) → PlaybackSnapshot 流
```

- request 使用 `bvid/cid`、来源与起始策略，不让 UI 保存长期有效的媒体 URL；媒体源解析和 URL 刷新在模块内部。
- 所有意图带 sessionId；快照带 sessionId / 单调 revision / 内容身份。UI 把未知或旧 revision 丢弃。
- 搜索/列表等另用请求 generation 和取消；取消 HTTP 不能代替“旧结果不得覆盖新状态”的检查。
- 依赖注入 fake adapter 与可控时钟，使“开 A→开 B→A 迟到”“EOF→手动切换→倒计时结束”能无 Windows 测试。
- 新 Open 使旧请求失效；只有本次已获 MPV 确认的就绪状态才开始续播 seek/记录。
- 暂停和音量可合并，seek 使用明确的绝对/相对单位，避免 0.1x 和秒/毫秒混淆。
- EOF 只消费一次，连播规则保持“下一P → 相关推荐、5 秒可取消”；手动切换、关闭或来源变更立即取消旧倒计时。不从旧页面闭包读取 detail。
- UI 退出订阅不等于后端停止；停止由协调模块显式执行。

状态：Idle → Resolving → Loading → Playing ↔ Paused → Stopping → Idle；错误可进入 Failed。任何状态均可收到替换/停止，Stopped/Failed 事件不能复活旧 session。

### 4.2 资源所有权与超时

- 播放 adapter 独占 MPV handle、工作线程、原生事件和播放目标 HWND；UI 不直接调用 P/Invoke。
- 按所选 MPV API 约束实现线程调度；不能假设任意回调线程可操作 XAML。
- `Stopping` 先禁止新命令，取消网络/弹幕，发停止/销毁请求；直到 native teardown 完成前，不能释放其仍可能访问的宿主或回调。
- 超时只表示未证实释放，不能把清空字段当作成功。超时后停止复用该后端，并暴露“重启应用”的安全恢复路径。
- 进程内原生死锁无法保证被安全强杀；先记录诊断并阻止扩大泄漏。只有 Windows 证据表明进程内方案无法接受时，另评估受控独立播放器进程，不在第一版预建 IPC。
- 关闭顺序：冻结新操作 → 保存当前有效 session 进度 → 停止后端 → 释放宿主/窗口 → 完成关闭。保存失败与停止失败分别记录，不吞异常。
- 用户取消 Open 只取消其请求，资源清理使用独立的受限生命周期，不能复用已取消的 token 导致 Stop/Dispose 根本不执行；不在 UI 线程同步等待 native join。

### 4.3 设置、错误和交互

- 设置是强类型快照 + 单次 patch；同时驱动持久化和当前播放器，下一次播放使用同一快照。
- 保留现有字符串 KV 的读兼容，未知 key 留存，非法数值回落并提示；不能把“写库成功”当作“运行时已应用”。
- 持久化与 native 应用不构成一个原子事务：快照区分 requested/applied revision；保存失败不宣称已保存，runtime 拒绝则保留明确的待应用/错误状态，支持重新应用，避免 UI 静默显示已成功。
- 稳定错误分类：取消、网络/限流、登录失效、权限不可用、内容不可播、解码/后端、数据损坏。UI 绑定用户可理解消息，不显示内部 token/URL。
- 写操作不盲目自动重试；状态未知时重新查询关系，无法查询则明确提示“结果未知”，不推断失败后重复投币/评论。
- TextBox/IME、弹窗、评论输入获得焦点时屏蔽全局播放快捷键。Esc 优先关闭临时面板，再退出播放。

## 5. 数据迁移与并存

源码事实：

- [`storage/mod.rs`](../../src-tauri/src/storage/mod.rs)：`bilidesk.db`；`history(bvid...)`、`settings(key,value)`、`play_progress` 主键 `(bvid,cid)`；`schema_migrations` 已使用版本 1。
- `viewed_at/updated_at/applied_at` 是 Unix 秒；position/duration 是秒的 REAL；历史最多 100。
- 进度不足 5 秒不保存，剩余不足约 15 秒删除；当前按 bvid 的清理 SQL 不等价于严格“最多 200 行”，迁移不得擅自修正而无测试。
- [`session.rs`](../../src-tauri/src/bili/session.rs)：文件名 `session.json`，前缀 `BILIDESK_SESSION_V1\0`，后接 DPAPI 数据；解密后是 `{"cookies":{...}}`；无额外 entropy、当前用户范围。Linux 实现只是直通字节，绝不能当作 Windows 加密证据。
- 旧目录据 README 为 `%APPDATA%\com.bilidesk.desktop`，实际导入仍需核实 `commands::init_data_dir` 和 Tauri 配置。

### 默认迁移方式：副本导入，不共写

1. 预览版使用独立数据根目录/应用标识，并记录原始来源和导入版本；不把旧程序的 DB/session 当作新程序工作文件。
2. 用户同意后定位旧目录；明确要求关闭旧客户端以取得一致的 DB 与会话快照。不满足时中止导入，不悄悄复制正在写的数据库。
3. 使用 SQLite online backup API / 一致性快照，不能只复制 `.db` 而忽略可能存在的 WAL。不要改变旧库 journal 模式。
4. 暂存到新目录，同用户 Windows 解密测试会话，再重加密到新会话文件；不可解密则保留原件，允许重新扫码登录。
5. 验证 quick/integrity check、表/行数、主键、设置、历史排序和精度；事务内转换，最后提交新目录中的迁移标记。
6. 崩溃可重试且不重复插入；已存在新数据不静默覆盖，导入前备份新数据并让用户决定冲突策略。默认仅首次空目录导入。
7. 回退安装旧版继续读取旧目录；不承诺新格式反向兼容。新版本使用期间的新增历史不会自动合并回旧版，预览版说明必须披露。

`schema_migrations` 的旧版本与新应用导入清单分开，避免再次执行版本 1。新应用 schema migration 在事务中执行并带版本上限检查；较旧程序拒绝打开未知新 schema。

会话写入：同目录临时文件 → 写完并 flush → 原子替换，保留可恢复的上一份；失败不可破坏旧文件，日志不输出内容。备份包含凭据，按敏感文件控制 ACL、数量与生命周期。

旧明文兼容仅在明确的导入流程中读取并立即在 Windows 重加密；生产实现不沿用 Rust 非 Windows 的明文保护替身。无法保护时拒绝落盘，不降级保存明文；损坏密文不按明文再次解析来“恢复”。

## 6. 网络、图片与协议

- 不引入有许可争议的 BiliKernel 作为前提；从本项目现有契约逐端点迁移，不把网页内部端点称作官方开放 API。
- HTTP adapter 隔离身份、签名、DTO 和错误；Core 接收稳定模型而不是任意 JSON。
- API、媒体和图片使用不同策略；图片客户端不得携带登录 Cookie。每次重定向重检 scheme/host，跨域不可转发 Cookie；媒体 CDN 域名策略单独核查，不拿 API 域策略生搬。
- 保持网页 UA/Referer/CSRF 语义；日志与 fixtures 脱敏 Cookie、Set-Cookie、二维码凭据、签名 URL。
- 媒体源和请求 header 只在受信 resolver/adapter 内流转，不进入导航参数或任意 XAML 绑定；是否向具体 CDN 携带登录 Cookie 逐端点按最小权限验证，绝不把整份 Cookie 默认附到任意媒体 URL。
- 设置 connect/headers/body/overall 超时与取消、连接复用；流式消费并在读入阶段限额，不在完整入内存后才检查 Content-Length。
- 原始字节、解压后字节、弹幕条目/字符串长度、图片像素和缓存容量分别限制。gzip/brotli/deflate/zlib 按现有端点实际契约验证；不默认套用同一压缩格式。
- 初始预算是设计建议：普通 JSON 解压后 16 MiB、弹幕分段 16 MiB/片、封面压缩输入 8 MiB/解码像素 32 MP；超限报错、可配置且有边界测试。上线前用合法样本校准，不能当作现有服务承诺。
- GET 的瞬态错误有限次指数退避并尊重 Retry-After；登录二维码有生命周期；鉴权失败不重试风暴。请求切换、登出时清理旧身份请求。
- 本地非下载缓存只存必要封面/临时字幕，有大小上限和清理规则，不演变为音视频离线缓存。

## 7. 分阶段交付与停止条件

每阶段产物包含代码、测试、Windows 证据（涉及平台时）、风险更新与回滚说明；日历工期在 M1 后根据真实工作量再估算。

| 阶段 | 产物 | 出口标准 | 不通过时 |
| --- | --- | --- | --- |
| M0 可复现基线 | C# 解决方案骨架、锁文件、Linux/Windows PR CI、版本与许可清单 | Linux 测 Core/Infrastructure；Windows 构建空 WinUI 和测试；原主线仍绿 | 不做页面迁移，先修工具链 |
| M1 播放技术闸门 | 本地合法样本、MPV adapter、XAML 控制层、标准/精选窗口探针 | 见下方 Windows 矩阵；选择宿主与包装方式 | 换 adapter / WPF 对照探针；不全量重写 |
| M2 可用纵向切片 | 扫码→搜索→详情/分P→真实播放→历史续播，最小设置、旧数据导入 | 新用户/旧用户闭环，错误/取消/清晰度权限验证，DPAPI 跨语言实验 | 保持预览，不替换默认客户端 |
| M3 浏览能力 | 发现 Tab、动态、空间、收藏、稍后再看、完整主题/设置 | 每项有空/错/分页/切换测试、虚拟化、设置实时生效 | 功能对照中标缺失，不宣称对等 |
| M4 交互与精选 | 评论/弹幕写入、关系操作、连播、沉浸切换、全部快捷键 | 认证/CSRF/结果未知、快速切换/倒计时隔离、焦点测试 | 关闭不稳定入口，保留明确降级说明 |
| M5 发布候选 | 独立预览安装器→迁移验收→默认通道候选 | 干净 Windows、升级/卸载/回退、许可审计、功能对照全签收 | 不发正式替代版 |

### M1 Windows 验收矩阵（拟定，尚未执行）

- 固定 libmpv x64 LGPL 发行和校验值；缺失 DLL、架构错误、损坏文件均可诊断，不只返回“打开失败”。
- 本地 MP4、DASH 样本独立音轨、ASS 中文/描边/换行；暂停/seek/0.5–3.0x/音量/EOF。
- 中文输入法、评论弹窗、快捷键焦点；100/150/200% DPI、跨屏移动、最小化/恢复、全屏往返、关闭重开。
- 初始压力目标：连续 100 次切换、50 次窗口开关、20 次全屏往返，零崩溃/旧事件串场；记录前后私有内存、线程、handle 数和稳定后的趋势，不能只做最终一张截图。
- 注入停止迟到/超时、解析完成迟到、窗口关闭时事件到达；资源回收和 UI 状态有证据。
- Windows 10/11 实际支持组合各跑关键测试；记录 OS build、GPU/驱动、样本、DLL hash、显示配置。没有目标设备时该项标阻塞而非跳过后宣称通过。
- 独立窗口仅先证明技术；标准页/精选交互对照演示后，再决定保留/嵌入。普通 XAML 能否覆盖视频不能靠同类项目推断。

## 8. 测试与 CI

| 执行环境 | 测试面 | 不可替代的证据 |
| --- | --- | --- |
| Linux PR | Core 用例、状态机/虚拟时钟、fixture HTTP、SQLite 导入副本、配置/错误/脱敏、格式/包审计 | 不证明 DPAPI/GUI/MPV/Windows XAML |
| Windows PR | WinUI 完整构建、Windows adapter 测试、无交互 DPAPI 往返、原生 DLL 装载检查 | hosted runner 不证明 GPU/DPI/IME 桌面体验 |
| Windows 真机 | 视频、音轨、ASS、焦点、DPI、全屏、资源循环、安装升级回退 | M1/M5 人工证据清单 |

建议命令：`dotnet restore --locked-mode`、按测试项目 `dotnet test -c Release --no-restore`、Windows App `dotnet build -c Release`；Linux 不对整个带 WinUI 的 solution 盲跑测试。NuGet TLS EOF 属工具链失败，不算业务测试通过，不能关闭 TLS 校验兜底。

`global.json` 指定 SDK 与有意的 rollForward；中央包版本 + `packages.lock.json`；CI 更新依赖走 PR，安全告警逐项判断不一键忽略。SDK/包/native DLL 更新分别验收。

现有 Rust/React fixture 可作为输入和预期行为依据，跨语言产物比较 JSON/ASS 的语义与规范化输出，不要求不同字典排序逐字相同。禁止把真实登录态提交到测试仓库。

关键用例：数据迁移 N 次幂等/中断恢复/未知 schema；DPAPI 同用户兼容/损坏/其他用户失败；URI 重定向 Cookie 隔离；取消与迟到响应；解压炸弹/超大封面；自动连播与用户意图冲突；设置保存/运行时应用失败。

## 9. 发布、安全与性能

- AppContext.BaseDirectory 下显式加载可信原生 DLL，不依赖任意当前目录/PATH；沿用项目 LGPL x64 非 v3 选择，固定哈希并保留组件许可和对应源码获取说明。
- 签名/证书只在受信发布通道使用，fork PR 不接触秘密；没有签名就如实说明 SmartScreen 风险。
- 明确 Windows App Runtime 部署策略；干净 VM 断网/在线各试依赖缺失，安装器不能依赖开发机现存运行时。
- 当前用户安装、稳定 AppId/协议与数据目录变更独立评估；预览 AppId 不抢占旧版入口，不写旧目录。
- 不预设重写必然更快。M0 记录旧版启动、首屏、滚动、播放首帧、包体与内存；同机同数据比较中位数与长尾。目标预算在 M1 后按实测填写，不捏造数字。
- 列表虚拟化/分页、封面并发和解码上限、取消、UI 线程工作预算比“全局 async”更重要。保存诊断仅含非敏感 sessionId/阶段耗时/错误码。

## 10. 第一批可以开工的任务卡

| ID | 任务 | 依赖 | 验收 |
| --- | --- | --- | --- |
| D01 | 建解决方案与受限 CI | 当前 SDK、Windows runner | M0 空工程双平台分工通过 |
| D02 | 审计并锁定 MPV 包/原生 DLL | 同类参考报告 | 包/SHA/源码/许可证清单，无未澄清 API SDK |
| D03 | fake 后端+时钟驱动协调模块 | D01 | A/B 乱序、取消、EOF 去重、连播取消测试 |
| D04 | WinUI 本地播放与窗口探针 | D01,D02 | M1 视频与宿主核心矩阵 |
| D05 | 原数据样本生成器+导入测试 | D01 | 不含真实凭据的 schema/进度/设置样本，幂等和中断测试 |
| D06 | Rust→C# DPAPI 兼容探针 | D01，Windows | 同用户、magic、JSON、坏数据，旧文件不变 |
| D07 | HTTP 身份/限额/取消模块 | D01 | fake handler 证明隔离、重定向、超限/退避契约 |
| D08 | M1 评审并锁定窗口策略 | D03,D04 | 明确通过/阻塞和宿主选择，再进入登录与页面开发 |

D03/D05/D07 可在 Linux 并行，D04/D06 需要 Windows。每个任务单独小 PR，不能一个 PR 里混合播放器宿主、schema 改写和全页重做。

## 11. 证据状态

现已开始 M0 和 D03/D05/D07 基础实现，具体产物、122 项跨平台测试、子代理超时交接和未完成闸门见 [实施状态](csharp-implementation-status.md)。M0 的 Windows 出口和 M1 播放器真机验收仍未通过，M2–M5 未实施；不把源码风险或 fake 测试说成 Windows 真机结果。

三个只读研究子代理已完成，实际响应模型均为 `openai-codex-ext/deepseek-v4.1-flash-1017`。原始报告、执行摘要及主代理采纳/纠正记录见 [并行研究与复核](../research/csharp-winui-agents/README.md)。报告不等于工程实现或运行证明；相冲突的建议以本方案和复核记录为准。
