# C# 效率优先：BiliDesk 技术选型与迁移计划

> **当前执行入口：** 已形成 [C# / WinUI 深化开发方案](../development/csharp-winui-development-plan.md)，含三项精确 DeepSeek 模型并行研究的复核、工程拆分、行为契约、里程碑及验收。本文仍保留选型历史，不作为当前开工任务清单。

> **后续证据修订：** 用户提供 Bili.Uwp / Bili.Copilot 后，已核查到同类 WinUI 3 客户端及独立 MIT MPV 封装。本文件保留为此前的 WPF 优先方案；当前建议改为优先验证 WinUI 3 + C# + MPV，WPF 保留备选，详见 [参考项目核查与修订](richasy-clients-reference-review.md)。尚未证明任何方案已在本项目运行。

> **环境更新：** 后续已在 Linux 安装 .NET 10 SDK，并完成控制台、MVVM 测试和最小 WPF 跨目标编译验证；文末“未安装 SDK”是当时的历史状态。当前能力和 WinUI 还原限制见 [Linux .NET 环境记录](../development/linux-dotnet.md)。

## 决策

用户已明确接受 C#，优先功能开发效率。因此不再以“全部依赖都必须 C/C++、无 CLR”为优化目标。

**首选：C# + .NET 10 LTS + WPF + CommunityToolkit.Mvvm，保留 libmpv、SQLite、DPAPI。** 该选择基于当前 Windows 专用产品定位；播放器宿主 PoC 通过后再锁定 UI 路线。当前不是已完成的实现或性能结论。

接受 XAML 和 .NET；不引入 WebView、React、Node.js 或 Rust 应用运行时。使用 C# 调用 libmpv 的 C ABI，不要求自行开发一层 C++ 中间 DLL。第三方原生媒体/SQLite 依赖仍然存在。

相关前置报告：[项目审查](project-review-and-native-cpp-feasibility.md)、[更多重构路线](native-rewrite-alternatives.md)。

## 1. 为什么先选 WPF，而不是继续扩大框架比较

| 选项 | 对效率的收益 | 当前主要成本 | 决策 |
| --- | --- | --- | --- |
| WPF | 成熟绑定、模板、输入、桌面控件和调试体系；Windows 专用不浪费跨平台投入 | libmpv HWND airspace；封面网格虚拟化；样式重建 | 当前首选 |
| WinUI 3 / C# | 现代 Windows 控件和系统视觉 | App SDK 分发、工程模型、原生视频合成；不是选了新 UI 就免做适配 | 系统视觉优先时再选 |
| Avalonia / C# | 同一 .NET 生态，未来跨平台价值高 | 当前没有跨平台需求；每个平台仍需视频/输入/分发验证 | 出现明确跨平台需求时重评 |

这是项目取向下的工程判断，不是 WPF 在任何团队、任何应用中都更快。已有 WinUI/Avalonia 经验的团队可能有不同成本。

WPF 也能通过 DataTemplate/ControlTemplate/ResourceDictionary 实现卡片、主题、胶囊导航和自定义视觉，不必退回传统业务表单外观。首轮不同时引入多套皮肤/控件库；精确视觉还原晚于功能纵向切片。

### .NET 版本与 OS 边界

本轮查询的官方支持表显示 .NET 10 为 LTS，支持到 **2028-11-14**；.NET 8/9 在该表中的结束日期为 2026-11-10，因此新迁移项目优先 .NET 10，而不是为“成熟”停留在 .NET Framework 4.8 或临近退出支持的版本。[1]

Windows 产品版本的支持独立于 .NET LTS 生命周期。当前 .NET 10 OS 表列出特定 Windows 11 和 Windows 10 Enterprise/IoT 等版本，不能把 README 中笼统的“Windows 10/11”直接转换成所有版本均受官方支持的承诺。[2] 发版前应明确最低 build、消费版/LTSC/企业版本范围及真实测试矩阵；能启动不等于仍有官方支持。

## 2. 技术栈：少而够用

| 领域 | 选择 |
| --- | --- |
| UI | WPF / XAML / 小规模自定义样式 |
| ViewModel | CommunityToolkit.Mvvm：ObservableObject、RelayCommand、AsyncRelayCommand |
| HTTP | 长生命周期 HttpClient、明确的会话与图片请求策略 |
| JSON | System.Text.Json |
| SQLite | Microsoft.Data.Sqlite，复用现有 schema，先不引入 EF Core |
| 会话加密 | ProtectedData + CurrentUser，与当前 DPAPI 文件兼容验证 |
| 播放 | 项目内薄 libmpv interop adapter，先验证现有固定 DLL |
| 并发 | async/await、CancellationToken；确有串行化需要的存储/播放器队列 |
| 测试 | xUnit；解析 golden fixture、用例测试和 Windows 原生集成测试分开 |
| 分发 | win-x64、自包含、普通目录发布 + 安装器，保留原生 DLL 和许可证 |

不为简单本地客户端预先引入微服务、通用消息总线、全局 EventAggregator、MediatR、通用 Repository<T>、动态插件框架或多套 DI 容器。HTTP 客户端、存储、播放服务在启动入口装配即可。确有多种实现时再抽接口，不为每个类配一个接口。

社区播放器封装可以减少 P/Invoke 工作，但采用前必须核查维护、license、固定 DLL ABI、DASH 外挂音轨、ASS、暂停/结束事件、seek、停止与线程销毁。不能仅凭“播放一个 MP4”示例决定。当前没有完成任何封装包的准入审计。

## 3. 项目划分

```text
native-csharp/
  BiliDesk.sln
  src/
    BiliDesk.Desktop/       WPF Views/ViewModels、HwndHost、启动装配
    BiliDesk.Core/          DTO、错误、播放用例、连播/续播决策
    BiliDesk.Infrastructure/HTTP、WBI、SQLite、DPAPI、libmpv interop
  tests/
    BiliDesk.Tests/         纯函数、fixture、服务回归
    BiliDesk.WindowsTests/  HWND、DPAPI、原生媒体 DLL、安装与退出
```

这是建议目录，尚未创建解决方案。UI 引用 Core/Infrastructure，基础设施引用 Core；Core 不依赖 WPF。复用的是行为契约，不是把每个 Rust command 机械改成一个 ViewModel 方法。

ViewModel 管 UI 状态与用户命令；PlaybackCoordinator 负责会话状态、取消、连播、续播和最后进度。普通错误通过统一的 code/message 呈现，用户取消不应变成错误 toast。

## 4. 先过播放器闸门

### 最低成本起点：HwndHost + libmpv wid

WPF 提供 HwndHost 承载 Win32 子窗口，适合延续当前 libmpv 原生视频路径。[3]

但 WPF 与 HWND 存在明确的 **airspace 限制**：不能假设将一个 WPF Grid/Border 放到视频宿主“上面”，就可以正常绘制半透明控制条或评论。[4]

首轮优先策略：

- 播放控制放画面外；ASS 弹幕继续由 mpv/libass 绘制。
- 评论/扫码等弹窗可使用真实独立窗口，打开时暂停或隐藏视频宿主；具体体验需确认。
- 不先堆砌大量跟随视频的透明 top-level window 来伪装统一合成。
- 将画面内社交按钮、悬浮控制、原生弹窗、DPI 和键盘焦点作为单独验收项。

**如果不能接受以上交互调整，必须先验证统一合成。** WPF D3DImage 并不是接收任意 libmpv D3D11/GL 输出的现成适配器；转换、纹理共享、线程和驱动兼容都会增加成本。Avalonia 的 NativeControlHost 同样是在承载原生控件，不能把换框架当作自然消除 HWND 问题的证据。[5]

PoC 不达标时，先定位是原生窗口承载方案失败，还是 WPF 本身不适合，再决定纹理合成或改用 WinUI/Avalonia。不要等全站页面重写后才测试。

### interop 生命周期硬约束

- 使用与发行 DLL 匹配的官方 ABI，Windows x64 固定配置；LibraryImport 可用作源生成 P/Invoke，但这不自动保证签名正确。[6]
- 字符串编码、结构布局、回调委托存活、DLL 搜索目录必须显式处理；限制从可信发布目录加载 DLL。
- 正常 mpv 命令/事件有明确 worker 所有权；回调不直接操作 WPF 控件。
- UI 更新走 Dispatcher，停止流程不能让 UI 同步等待一个又要等待 UI 的 worker。
- 销毁顺序显式可等待，不把“最终等 GC”当作媒体核心和 HWND 的生命周期设计。
- 所有进度/结束/错误都携带 session_id；被取消的旧会话不能保存到新视频或触发新页面连播。

## 5. 为效率而避免的三个常见误区

### 所有调用加 Async，不等于不阻塞 UI

Microsoft.Data.Sqlite 的 async ADO.NET 方法实际同步执行，官方明确提醒这一限制。[7] 本地查询短小也不应在 UI 回调里做不可控迁移/大批写入；使用明确的存储执行队列，连接归属固定，事务和 busy 策略可测。是否启用 WAL 由读写并发和备份/迁移策略共同决定。

### 选 MVVM，不等于把所有逻辑放入 ViewModel

CommunityToolkit.Mvvm 减少通知与命令样板代码。[8] 它不替代请求取消、并发控制、错误恢复和播放状态机。不要把原来的 900 行页面变成 900 行 ViewModel 再额外增加接口层。

### WPF 支持虚拟化，不等于封面瀑布流默认已虚拟化

官方的 VirtualizingStackPanel/Recycling 示例适用于相应列表布局。[9] 普通 ItemsControl + WrapPanel 不能被当作已完成虚拟网格。第一版可用“虚拟化行列表 + 每行固定数量卡片”，响应式改变行划分；需要完整虚拟 WrapPanel 时再评估有维护和许可保障的实现。

同时做异步图片解码、合理 DecodePixelWidth、并发和缓存上限，避免封面原图占用掩盖 GUI 框架差异。

## 6. 数据与网络迁移

### 数据

- 保留 `history/settings/play_progress/schema_migrations` 和已有 key，先备份再迁移。
- 识别现有 session 魔数，移除头部后用 CurrentUser DPAPI 解密 payload，再解析 JSON；现有实现没有额外 entropy，迁移验证需按同一契约处理。[10]
- 在同一 Windows 用户/机器环境做兼容测试；不能承诺跨机器复制后仍可登录。
- 会话损坏/解密失败降级为扫码登录，不阻止整个应用启动；原子保存并隔离坏文件。
- 开发版独立数据目录，显式导入，不允许新旧客户端并行写同一数据库或 session 文件。

### 网络

- 复用当前端点知识与 WBI fixture；签名排序、过滤和 query 编码逐例对照，不能假设 .NET URL 编码天然与现有实现相同。
- 长生命周期 HttpClient；明确 Cookie 域策略，认证 API、匿名图片、媒体头分开，不复刻图片携带全部登录 Cookie 的问题。
- 请求有整体 deadline、CancellationToken 和分层并发上限；响应/解压限制作用在实际累计字节上，而不是全部读入后才判断。
- GET 可按错误类型做有界重试；投币、三连、评论、关注等写操作不能因超时而盲目重试，先考虑结果未知与重复副作用。
- 视频先启动，弹幕超时/失败不拖住首帧；补载方案要有当前会话检查。

## 7. 按功能闭环迁移，不按源文件翻译

1. **播放器/输入 PoC**：窗口 + 本地视频 + ASS + 控制 + 中文编辑框 + 弹窗遮挡 + 连续停止重开 + DPI。先决定是否接受外置控制层。
2. **真实纵向切片**：扫码/恢复会话 → 搜索 → 详情 → DASH 音画播放 → 历史/进度保存 → 重新打开续播。
3. **主要浏览功能**：推荐、热门/排行、分区、动态、空间；同时处理分页、取消与过期结果。
4. **互动与沉浸播放**：收藏、稍后再看、赞/投币/三连、评论/发弹幕、精选切条、快捷键、连播和设置。
5. **发行**：清洁 Windows 安装、用户数据导入、升级/回滚、签名/校验、隐私与依赖许可更新。

每一步有可运行交付和相应测试。现有 Rust/TS 主线保持可用；最终产品不依赖旧运行时，但迁移期间不必先删除旧代码。C# 可以减少样板/异步 UI 开发成本，不会自动消除功能覆盖与原生视频验收工作。

第一步验收不只看首帧，还要检查：反复切换 100 次、旧事件注入、退出超时、资源回收、键盘输入/IME 与多 DPI。性能用同 DLL/同视频基线比较，不承诺托管代码必然更省内存。

## 8. 分发与当前验证状态

首版建议 self-contained win-x64 目录发布并打安装器，降低用户手动安装 .NET 的摩擦。原生 DLL 独立打包并保留来源、哈希和许可证，不急于启用 single-file、trimming、NativeAOT 或改换媒体引擎；这些都不是功能交付的前置条件。

这会增加 .NET 运行时分发体积，应与去除 WebView2 依赖带来的改变一起测量，不能只报应用 EXE 的大小。

当前环境是 Linux，`command -v dotnet` 未找到 SDK。**本轮只形成方案，没有 C# 项目、编译、Windows UI 验证或安装包。** 即便后续在 Linux 编译 Windows targeting 项目，也不能替代 Windows 真机测试。下一阶段的真正产物应是上述播放器/中文输入 PoC，而不是继续扩充框架候选名单。

## 一手资料

1. [.NET 支持政策](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)。
2. [.NET 10 支持 OS 列表](https://github.com/dotnet/core/blob/main/release-notes/10.0/supported-os.md)，可变文档，发版时复核。
3. [WPF 承载 Win32 控件](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/walkthrough-hosting-a-win32-control-in-wpf)。
4. [WPF Technology Regions / Airspace](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/technology-regions-overview)。
5. [Avalonia NativeControlHost 当前源码](https://github.com/AvaloniaUI/Avalonia/blob/master/src/Avalonia.Controls/NativeControlHost.cs)，不是完整合成能力的验证。
6. [源生成 P/Invoke](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/pinvoke-source-generation)、[mpv client.h](https://github.com/mpv-player/mpv/blob/master/include/mpv/client.h)；实现应锁定与 DLL 对应的 tag。
7. [Microsoft.Data.Sqlite 概览](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/)、[异步限制](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/async)。
8. [CommunityToolkit.Mvvm](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/)。
9. [WPF ListBox 回收虚拟化](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/controls/how-to-improve-the-scrolling-performance-of-a-listbox)。
10. [ProtectedData.Unprotect](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata.unprotect?view=windowsdesktop-10.0)。
