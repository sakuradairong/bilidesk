# Bili.Uwp / Bili.Copilot 对 BiliDesk C# 重构的参考价值

## 结论

用户提供的两个项目改变了上一轮选型的证据基础：**不宜再仅根据通用桌面开发经验默认 WPF 更高效，应优先验证 C# + WinUI 3 + 已有 MPV 封装的纵向切片。**

这不是“WinUI 自动解决视频合成”或“Copilot 可以直接搬过来”。效率收益取决于能合法采用哪些模块、能否接受独立播放窗口，以及其 NuGet/原生 DLL 版本能否稳定运行。WPF 保留为简化窗口模型或封装不适用时的备选；不建议新建 UWP 工程。

本轮为仓库/源码/包元数据研究，没有运行两个应用、构建其源码、复现播放或执行完整安全审计。默认分支、许可证与发布日期会变化，下列结论固定到查询的提交。

## 1. 研究基线

| 项目 | 分支 / 提交 | GitHub archived | 根许可证 |
| --- | --- | --- | --- |
| Bili.Uwp | main / `bd5d4053bb18bf97567c834f235bce3c970b96d3` | true | MIT |
| Bili.Copilot | master / `896a06290ba440cb17776d292dff119bbd3383d6` | false | GPLv3 |
| mpv-kernel 当前默认分支 | master / `9c0b352efc2932f9d6a23e29603a8bc47d5d752d` | false | MIT |
| bili-kernel 当前默认分支 | main / `e26f6dbd071e20d4220806fcff7bd675f3c29fc5` | false | GPLv3 |

“没有归档”不证明维护及时、安全或服务端接口仍然有效；本轮未以 stars、fork 数或下载量推断质量。

## 2. 两个客户端不是同一种 C# UI 工程

### Bili.Uwp：旧 UWP 客户端，适合参考，不适合新工程底座

- `src/App/App.csproj` 是旧式 UWP 工程，`OutputType=AppContainerExe`，导入 `Uwp.props`；源码使用 `Windows.UI.Xaml`。
- `NativePlayerViewModel` / `FFmpegPlayerViewModel` 等展示了原生媒体和 FFmpeg 适配路径。
- MIT 根许可证使保留版权/许可后的自有代码复用具备较宽松基础；但仍要核对具体文件、依赖、图片、图标等权利，不能把仓库所有内容一概视为无条件可复制。
- UWP 的 AppContainer、存储、网络、生命周期及 XAML 体系与新的 WinUI 3 桌面应用不同。`Windows.UI.Xaml` 也不能简单替换 namespace 就完成迁移。
- 已归档，旧接口、协议和工具链需要重新验证。参考它的功能划分、交互组织与历史设计，不等于沿用旧身份/端点。

**适合借鉴：** 功能布局、ViewModel/服务分工、用户状态、播放流程的设计经验。

**不建议：** 为了获得现成页面，重新承担旧 UWP 工具链和已归档客户端的整套迁移债务。

### Bili.Copilot：更贴近本项目的现代参照

当前 UI 工程确认：

```text
TargetFramework = net9.0-windows10.0.22621.0
TargetPlatformMinVersion = 10.0.19041.0
UseWinUI = true
Windows App SDK（中央版本）= 1.8.251106002
```

这说明它是 WinUI 3 / Windows App SDK 桌面路线，不是 WPF，也不是旧 UWP。README 的产品定位为 Windows 11；工程 min-version 不应被当作 Windows 10 全部功能的实际支持证明。

源码确认使用独立 API/播放器包，而不是把所有逻辑塞进 UI：

- `Richasy.BiliKernel.*`：媒体、用户、搜索、动态、评论、扫码/登录等。
- `Richasy.MpvKernel.Core` / `.Player` / `.WinUI`：MPV 原生调用、播放业务与 WinUI 适配。
- `PlayerViewModel` 将媒体源 resolver、history resolver 和播放窗口装配起来。
- `PlayerWindow` 使用 `AppWindow` 和 `DesktopWindowXamlSource` 承载 XAML 控制层。

**重要：** README 的 V2 播放说明是 MPV / 外部 MPV；仓库 `docs/player.md` 仍描述较旧的原生/FFmpeg 等多后端方案。不能只读旧播放文档就宣称当前版本采用某个后端，应以匹配提交的 README、工程引用与实际代码为准。

## 3. 最值得继续验证的是 mpv-kernel

Copilot 实际引用 `0.0.2-preview2` 包；其 NuGet nuspec 将源码定位到：

```text
repository: Richasy/mpv-kernel
branch: refs/heads/richasy/arch
commit: c1ef0f403097129c3b6db4c466cc4147054471d2
license expression: MIT
```

**这不是当前 master 的同一版本。** 本轮进一步核查该提交：

- `MpvKernel.Core`：net9.0，底层 MPV 适配。
- `MpvKernel.Player`：net9.0，依赖 Core 和 CommunityToolkit.Mvvm。
- `MpvKernel.WinUI`：net9.0-windows10.0.22621.0、UseWinUI，依赖 Player / Windows App SDK / WinUIKernel.Share。

价值是避免立即重新编写全部 P/Invoke 和播放器状态封装；但它不是零依赖组件。Core 还引用 FluentResults、日志抽象及 RichasyKernel.Abstractions 等，需做锁定版本和依赖审计。

WinUI 包已提供独立播放窗口与 XAML UI 的组织方式。这比“先选 WPF，再自行验证 HWND 与浮层”更直接，因此值得提升优先级。

需要验证：

1. 选定 NuGet 包与固定 `libmpv-2.dll` 的 ABI 和行为兼容。
2. 从 net9 框架资产在新 .NET 10 应用中使用的还原/运行情况；不要误认为本轮已经做过升级测试。
3. DASH 外挂音轨、ASS、seek、清晰度切换、倍速、取消/退出、会话事件隔离。
4. preview 包的稳定性，以及是否适合锁定使用或在许可允许范围内维护最小分支。

## 4. 视频层叠：有参照，不等于难点消失

Copilot 的 `PlayerViewModel.ShowPlayerWindow()` 创建 `PlayerWindow`，安装 `PlayerOverlay`；初始化媒体时把 `Window.Handle` 交给 source resolver，再交给 `MpvPlayer`。

这是一条明确的独立窗口/原生宿主/XAML 控制层路径，不足以证明：

- 任意页面中的普通 WinUI 控件都能自动覆盖视频；
- 视频被作为纹理统一合成进任意 XAML 布局；
- BiliDesk 的标准页与精选页可以无修改地使用同一窗口方案。

**产品取舍：** 如果允许浏览主窗口 + 独立沉浸播放窗口，复用收益很可能更大；如果必须保留现有单窗口路由与画面内浮层，应将嵌入、z-order、焦点、DPI、切页和退出作为第一阶段闸门。

新方案仍需显式 session_id、取消和可靠资源回收；同类开源应用运行过，不代表这些路径已经为 BiliDesk 验收。

## 5. 许可复用不能只看“都是同一作者”

| 对象 | 本轮核验 | 建议 |
| --- | --- | --- |
| Bili.Uwp 自有代码 | 根 LICENSE 为 MIT | 可逐文件核查后借鉴/复用，保留通知，升级旧 API |
| Bili.Copilot 自有代码，包括 C#/XAML | 根 LICENSE 为 GPLv3 | 不直接搬入仍只按 MIT 分发的实现；如需派生，应评估相应 GPL 分发义务 |
| mpv-kernel | 根 MIT；Core/WinUI `0.0.2-preview2` nuspec 也为 MIT | 优先验证的复用候选，仍审计完整依赖/原生媒体许可 |
| WinUIKernel.Share `0.0.7-preview6` | nuspec 声明 MIT，指向 `9a889cf...` | 按固定包审计；当前仓库未见根许可证，不能据此扩大到任意源码版本 |
| bili-kernel | **源码与包元数据不一致**，详见下文 | 先澄清，不直接认定可作为 MIT SDK 采用 |

### 发现的许可不一致

查询 Copilot 实际引用的：

- `Richasy.BiliKernel.Services.Media 0.0.2-preview2`
- `Richasy.BiliKernel.Resolvers.WinUIQRCode 0.0.2-preview2`

两者 nuspec 均声明 `MIT`，源码 commit 为 `22fdf8ca04bab384b46536b05f6524a41f83a2d4`；但**该提交的根 LICENSE 仍是 GPLv3**，并非只有最新分支才变为 GPL。

因此既不能简单断言“所有发布的 API 包必然 GPL”，也不能只看 NuGet 的 MIT 标签就说“可以放心按 MIT 使用”。本轮没有获得作者的双许可解释，也没有完成每个包内容/依赖的许可核查。下一步应检查具体包内通知、源码头及打包配置，必要时请求作者澄清。

目前最保守且适合保持 BiliDesk 自有 MIT 代码的路径：**自行迁移现有网页 API 适配层，不复制有争议代码；播放器优先核查独立 MIT 包。**

GPL 不是“禁止使用”或“禁止商用”；这里关注的是当前自有 MIT 实现与派生分发义务的匹配，不是法律意见。

## 6. 不应照单全收的功能和依赖

- Copilot 有 AI、下载、外部工具等功能；BiliDesk 当前明确不做直播/下载/绕过，不应因重构顺带引入。
- `WebSignInWindow.xaml` 直接包含 WebView2，UI 工程也直接引用 WebView2。它是原生客户端，但不是完全无浏览器依赖的示范。如果 BiliDesk 要无 WebView2，保留扫码并评估整个传递依赖，不能直接复制工程。
- Copilot 引用了 TV authorizer、token/cookies 等多个身份路径。BiliDesk 当前以网页 UA/Referer/Cookie 为契约；不同身份的请求、权限和协议不能机械混用。
- README 中 API 库的 AOT 能力不等于整个 WinUI 客户端已经 NativeAOT 可发布；本轮未验证 AOT。
- 当前项目的 SQLite 表和 DPAPI 会话应保留兼容策略，不用参考项目的数据模型直接覆盖旧用户数据。
- 用户品牌、图标、截图、内容和账户不能因源码许可宽松而默认获得全部使用授权。

## 7. 修订后的实施建议

### 优先路径：保持 BiliDesk 独立实现

```text
C# + .NET 10 + WinUI 3 / Windows App SDK
  ├─ BiliDesk.Core：会话、取消、连播、续播与稳定 DTO
  ├─ BiliDesk.BiliApi：从本项目现有行为/fixture 迁移
  ├─ BiliDesk.Storage：SQLite + 当前用户 DPAPI
  └─ BiliDesk.Playback：独立 MIT MPV 包候选 + 项目自己的 adapter
```

首次 PoC 使用合法本地视频，主窗口卡片 + 独立播放窗口，先不依赖有许可不一致的 BiliKernel 包，也不复制 Copilot 的 GPL XAML。

依次通过：

1. MPV + ASS + XAML 控制层、中文输入/焦点、退出/重开、DPI；
2. 当前项目网页登录/搜索/播放的真实闭环；
3. 现有标准/精选交互是否接受独立播放窗口，或能稳定实现单窗口嵌入；
4. 干净 Windows 安装、原生 DLL 缺失/回滚、依赖与许可审计。

通过后再迁移其他功能。若 MPV 包不适配，可以只参考 MIT 核心实现并独立适配，不把 UI 和业务绑定到整个 Copilot。

### 另一条路径：明确接受 GPL 派生项目

若目标转为“基于 Copilot 做一个精简分支”，且接受适用 GPL 义务，可以另外评估 fork。这可能缩短部分功能交付，但仍有许可证、旧项目数据兼容、下载/AI/浏览器依赖裁剪和界面差异工作，不能称为零成本。

在尚未决定采用 GPL 派生方案前，不引入其代码。用户提供链接是参考意图，不等于已授权改变本项目许可或全面 fork。

## 8. 一手证据

- [UWP 工程](https://github.com/Richasy/Bili.Uwp/blob/bd5d4053bb18bf97567c834f235bce3c970b96d3/src/App/App.csproj)、[Uwp.props](https://github.com/Richasy/Bili.Uwp/blob/bd5d4053bb18bf97567c834f235bce3c970b96d3/Uwp.props)、[MIT](https://github.com/Richasy/Bili.Uwp/blob/bd5d4053bb18bf97567c834f235bce3c970b96d3/LICENSE)。
- [Copilot README](https://github.com/Richasy/Bili.Copilot/blob/896a06290ba440cb17776d292dff119bbd3383d6/README.md)、[UI 工程](https://github.com/Richasy/Bili.Copilot/blob/896a06290ba440cb17776d292dff119bbd3383d6/src/Desktop/BiliCopilot.UI/BiliCopilot.UI.csproj)、[包版本](https://github.com/Richasy/Bili.Copilot/blob/896a06290ba440cb17776d292dff119bbd3383d6/src/Directory.Packages.props)、[GPL](https://github.com/Richasy/Bili.Copilot/blob/896a06290ba440cb17776d292dff119bbd3383d6/LICENSE)。
- [PlayerWindow](https://github.com/Richasy/Bili.Copilot/blob/896a06290ba440cb17776d292dff119bbd3383d6/src/Desktop/BiliCopilot.UI/Forms/PlayerWindow.cs)、[PlayerViewModel](https://github.com/Richasy/Bili.Copilot/blob/896a06290ba440cb17776d292dff119bbd3383d6/src/Desktop/BiliCopilot.UI/ViewModels/Core/PlayerViewModel/PlayerViewModel.cs)、[WebSignInWindow](https://github.com/Richasy/Bili.Copilot/blob/896a06290ba440cb17776d292dff119bbd3383d6/src/Desktop/BiliCopilot.UI/Forms/WebSignInWindow.xaml)。
- [发布包对应 mpv-kernel 源码](https://github.com/Richasy/mpv-kernel/tree/c1ef0f403097129c3b6db4c466cc4147054471d2)、[MIT](https://github.com/Richasy/mpv-kernel/blob/c1ef0f403097129c3b6db4c466cc4147054471d2/LICENSE.txt)。
- [MPV WinUI 包 nuspec](https://api.nuget.org/v3-flatcontainer/richasy.mpvkernel.winui/0.0.2-preview2/richasy.mpvkernel.winui.nuspec)、[MPV Core 包 nuspec](https://api.nuget.org/v3-flatcontainer/richasy.mpvkernel.core/0.0.2-preview2/richasy.mpvkernel.core.nuspec)。
- [API Media 包 nuspec](https://api.nuget.org/v3-flatcontainer/richasy.bilikernel.services.media/0.0.2-preview2/richasy.bilikernel.services.media.nuspec)、[QRCode 包 nuspec](https://api.nuget.org/v3-flatcontainer/richasy.bilikernel.resolvers.winuiqrcode/0.0.2-preview2/richasy.bilikernel.resolvers.winuiqrcode.nuspec)、[其对应源码 GPL](https://github.com/Richasy/bili-kernel/blob/22fdf8ca04bab384b46536b05f6524a41f83a2d4/LICENSE)。
- [WinUIKernel.Share 包 nuspec](https://api.nuget.org/v3-flatcontainer/richasy.winuikernel.share/0.0.7-preview6/richasy.winuikernel.share.nuspec)。
