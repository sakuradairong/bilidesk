# BiliDesk 更多 C 系列重构路线

本报告补充 [首轮项目审查与 Qt 重构评估](project-review-and-native-cpp-feasibility.md)，重点是增加候选、核实技术边界，不重复审查发现。

**研究性质：** 查阅官方文档、项目 README、许可文件及部分后端/构建源码；没有安装框架、编译示例或执行 Windows 真机 PoC。下文“适合”“成本高”等是基于当前项目需求的工程判断，不是性能实测或维护健康度审计。在线 master/latest 可变，落地必须锁定版本。

## 1. 先分清三个不同目标

“纯 C 系列”可以指三个不同约束：

1. **A：应用与 GUI 使用 C/C++，移除浏览器、JS、Rust 和 CLR。** 允许 XML、资源、构建脚本等描述文件；但仍需核查第三方依赖。本文主要按此比较。
2. **B：不仅逻辑，UI 定义也必须是 C/C++ 代码。** 这是更严格的限制。RML/RCSS、XAML、QML 不能混称成纯 C++ 源码；部分框架可以程序式建 UI，但要计入维护成本。
3. **C：C 系列包括 C#，允许 .NET，但不要 WebView。** WPF、WinUI C#、Avalonia 重新进入候选；这不符合 A 的无 CLR 目标，却可能更接近“快速摆脱前端技术栈”的真实需求。

本轮不强行假设 C# 被排除，而是单列。原生 C++ 也有 CRT、系统库和框架依赖，不等于没有运行时依赖或一个 EXE 就能分发。

## 2. 候选总表

“浏览器”指是否必须内嵌 WebView/Chromium；不是指框架能否可选提供网页控件。全部媒体路线均需自行接入 libmpv，表中没有假定原生工具包附带播放器就能替代当前 DASH/ASS 能力。

| 路线 | 应用语言 | 必须浏览器/JS | 范围 | 对 BiliDesk 的主要价值 | 最大代价 |
| --- | --- | --- | --- | --- | --- |
| Qt Widgets | C++ | 否 | 跨平台 | 成熟桌面功能、输入和布局 | 视觉重建、Qt 分发许可、视频合成 |
| **WinUI 3 + C++/WinRT** | C++，通常 XAML | 否 | Windows | 原生现代控件、系统交互 | App SDK 部署与视频渲染互操作 |
| **wxWidgets** | C++ | 否 | 跨平台 | 原生控件、成熟桌面能力 | 高定制卡片与动画仍需自绘 |
| **SDL3 + RmlUi** | C++ + RML/RCSS | 否 | 跨平台 | 接近当前视觉设计方法、统一 GPU 合成的候选 | IME/无障碍/列表及平台服务集成 |
| FLTK | C++ | 否 | 跨平台 | 较小的 GUI 抽象、OpenGL 入口 | 现代视觉与复杂应用交互工作 |
| GTK4 | C；也可 C++ binding | 否 | 跨平台 | 可用 C 写完整保留式 UI | Windows 分发/字体/主题/视频适配 |
| Win32 + WTL / MFC | C++ | 否 | Windows | HWND 和系统控件控制力 | 沉浸视觉、大量自绘和状态编排 |
| Win32 + Direct2D/DirectWrite/Composition 自绘 | C++，部分 C 接口 | 否 | Windows | 视觉与渲染完全控制 | 实质上自行承担 GUI 基础设施 |
| DuiLib 类 DirectUI | C++，常用 XML | 否 | Windows | 可换肤、自绘、中文桌面历史场景 | 分支差异、许可、DPI/无障碍核查 |
| JUCE | C++ | 否 | 跨平台 | 多媒体、自绘应用框架 | AGPL/商业许可、非现成视频客户端框架 |
| LVGL + SDL/Win32 后端 | C | 否 | 以嵌入式为主要场景 | 真正可用 C 编写 UI | 桌面文本输入、合成和可访问性适配 |
| Nuklear + SDL/Win32 | C89 | 否 | 自选后端 | 极简纯 C UI、原型快 | 不是完整桌面应用框架 |
| Dear ImGui + SDL/Win32 | C++ | 否 | 自选后端 | 播放器技术验证、调试工具 | 不以普通终端用户 UI 为目标 |
| Ultimate++ | C++ | 否 | 跨平台 | 集成式桌面开发方案 | 额外工具/框架约定和视频适配验证 |
| C# + WPF / WinUI 3 | C#，通常 XAML | 否 | Windows | 功能开发、绑定和系统集成 | 保留 .NET，仍需原生播放器互操作 |
| C# + Avalonia | C#，通常 XAML | 否 | 跨平台 | 自绘跨平台 UI、.NET 开发体验 | .NET/native 互操作、视频合成 |

这不是按“库越小，应用越好”排序。BiliDesk 的当前需求包含中文输入、扫码、封面图片列表、评论、快捷键、精选切条、播放控制、分区/空间页和设置；欠缺这些能力的小库，可能只是把体积换成自研工作量。

## 3. 最值得新增验证的三条路线

### 3.1 WinUI 3 + C++/WinRT：Windows 专用路线

**为什么值得：** 当前产品明确是 Windows 10/11 x64，不一定需要承担跨平台抽象。WinUI 支持 C++ 项目；C++/WinRT 是标准 C++ 投影，不是 C++/CLI，不要求为了使用它引入 CLR。[W1][W2]

建议组合：

```text
C++/WinRT + WinUI 3
  ├─ C++ 领域逻辑和播放会话状态机
  ├─ WinHTTP 或 libcurl + 明确的会话/图片策略
  ├─ SQLite + DPAPI
  └─ libmpv adapter + 单独验证的渲染宿主
```

注意：

- 常见界面定义使用 XAML。XAML 不是 JS/浏览器，但若要求 B，则需研究程序式控件构建的可维护性，而不是声称默认方案没有描述语言。
- 不要把 WinUI 3 等同于 UWP。Windows App SDK 支持桌面应用；框架依赖型、未打包部署仍涉及运行时引导与依赖解析，不能简单称“系统自带，无需安装”。最低 OS 与支持期限按选定 SDK 版本核查。[W3]
- `SwapChainPanel` 是 DirectX swap chain 的 XAML 合成入口，**不是能直接塞入任意 libmpv HWND/GL texture 的通用容器**。[W4]
- 当前 libmpv 路径是 wid + D3D11。若想统一合成，必须核对所固定 mpv DLL 的 render API 能力；不能因为 master 有 D3D11 相关接口就认为旧包可用。
- Fluent 控件可以改善原生体验，但不会自动复刻现有 BiliOne 风格，也不会自动解决自定义标题栏、焦点或快捷键冲突。

**适用：** Windows 体验优先，愿意接受 App SDK 分发与 XAML 工程模型。**否决条件：** 必须短期跨平台，或无法打通播放器合成。

### 3.2 SDL3 + RmlUi + libmpv：视觉保真路线

RmlUi 是 C++ 的 HTML/CSS 风格界面库，不是 Chromium/WebView。其 RML/RCSS、C++ 事件和数据绑定可以构建界面；Lua 是可选扩展，不是必须运行时。[R1][R2]

建议组合：

```text
SDL3：窗口、事件、平台输入
  └─ 明确选定的共享图形上下文/渲染循环
       ├─ libmpv render API：视频、ASS
       └─ RmlUi：导航、卡片、评论、控制层
C++ services：网络、账号、SQLite、播放状态机
```

项目存在 SDL + OpenGL 后端源码，可作为接入证据，而不是凭空设想两者完全不能组合。[R3]

优势：

- 胶囊导航、圆角卡片、封面渐变和沉浸播放器更接近当前设计表达方式。
- 有机会把视频和控制层交给同一渲染链管理，避免将两个独立原生窗口叠放。
- RmlUi 为 MIT 许可，便于与当前自有 MIT 代码组合；整体分发仍受 libmpv 等依赖许可约束。[R2]

必须承认的成本：

- **接受 RML/RCSS 是对上一轮“完全不使用 HTML 类界面描述”的放宽。** 若禁用一切标记式 UI，这条不应入选。
- 不是完整 Web 标准实现，不能直接运行 React、Radix 或照搬 Tailwind；原 CSS 的可用程度需要逐项迁移验证。
- 系统剪贴板等由集成层负责，默认实现可能仅在应用内部工作；IME 需要结合平台/backend 接好，而不是把“UTF-8 文本显示”当作“中文输入完整支持”。[R4]
- 无障碍、屏幕阅读器、长列表虚拟化、焦点、拖放等必须列入 PoC；本轮未证明已经具备与成熟桌面框架同等级的开箱能力。
- 选定共享 OpenGL 路径不等于可以混用 SDL 的所有 renderer。纹理、context、线程及 mpv 回调必须明确归属；D3D/OpenGL 跨 API 互操作不能假定零成本。
- SDL 不是 HTTP/存储框架。需要自行选择网络库、异步任务和图片缓存，并实现有界请求/解压/取消。

**适用：** 当前视觉与沉浸播放优先，愿意投资自绘平台集成。**否决条件：** 输入法/无障碍不能达标，或图形链对目标机器兼容性不好。

### 3.3 wxWidgets + libmpv：成熟桌面替代路线

官方定位是跨平台 C++ GUI，利用平台原生控件；wxWindows 许可含有分发例外，官方明确允许静态或动态链接应用，无需仅因链接而公开应用源码。[X1][X2]

建议组合：wxMSW 控件/窗口、libcurl 或 WinHTTP、SQLite、DPAPI、libmpv。不要为了省事使用 wxWebView 重建前端，那将违背去浏览器目标。

接入路径：

- 以原生窗口作为 wid 视频宿主，先保证基本播放；
- 如需要视频与控件统一绘制，研究 `wxGLCanvas` + mpv render，不能假定普通原生控件会自然覆盖 GL/视频窗口。[X3]

优势是桌面功能覆盖、原生输入与跨平台延展；劣势是当前高定制视觉仍需自绘，跨平台的最终效果也依端口/构建选项验证。不能把 wx 的“原生控件”说成当前卡片式界面可原样复用。

**适用：** 想避开 Qt 的框架与许可选择，同时重视桌面能力。**否决条件：** 必须低成本完整复刻现有动效和皮肤。

## 4. 其他路线：值得知道，但不宜一概升级为首选

### 4.1 FLTK

C++ 工具包，自绘为主，提供 `Fl_Gl_Window`；可以承载 OpenGL 渲染实验。许可为 LGPL 加例外，明确有静态链接例外，不应误写成“静态链接必须开源应用”。[F1][F2]

适合简化界面的轻量播放器；不应把框架小等同于最终应用小，媒体 DLL、字体、图片缓存可能占主要开销。BiliDesk 若保留全部界面与交互，省下框架复杂度也可能转化成自绘、文本和无障碍工作。

### 4.2 GTK4

GTK 提供 C API，是“业务和 GUI 都用 C”时比极简 UI 库更完整的候选。`GtkGLArea` 创建自己的 GL context/FBO，并把结果作为纹理纳入 GTK 场景树，为 mpv render 提供潜在接入点。[G1][G2]

风险在 Windows 环境的构建、分发、主题/字体、IME 和 OpenGL 驱动路径。应先做干净 Windows 安装包，不只在 Linux 编译通过。可选语言绑定或插件依赖需要分别核对，C API 不证明每个第三方插件都只有 C。

### 4.3 Win32 + WTL / MFC

WTL 扩展 ATL，以模板封装窗口、控件等，接近 SDK 模型；MFC 对 Win32/COM 提供更完整的传统包装。[N1][N2]

- 可直接控制 HWND，适合 Windows 专用播放器底座。
- 不能把“原生窗口容易建立”误判成“现代视觉容易完成”。
- MFC 官方目前注明继续支持，但不再新增功能/更新相关文档，不宜只因历史成熟就当作现代 UI 投资首选。[N1]
- WTL 需要 ATL/MSVC 工具链背景；实际分发与工具授权按所用构建工具核查。

如果团队已熟悉这些技术，它们的成本可以显著低于陌生的 Qt/WinUI；反之不是天然更便宜。

### 4.4 Win32 + Direct2D/DirectWrite/DirectComposition 自绘

这不是一个现成 GUI 框架，而是自行组合窗口、文字、绘图、布局、事件、焦点、无障碍和资源系统。控制力最高，缺失的产品能力也最多。

可以由标准 EDIT/系统弹窗承担复杂输入，自绘卡片/画面；但这形成混合 HWND/合成层，仍有 z-order、裁剪、DPI、主题一致性问题。只有确实需要系统级精细控制、且愿意长期维护基础设施时才值得。

### 4.5 DuiLib 类 DirectUI

上游将其定位为 Windows C++ 界面库，可构建可换肤桌面客户端。[D1]

它与 BiliDesk 的中文、皮肤化桌面场景有契合点；但必须锁定具体仓库/分支，核实许可证、DPI、Unicode/IME、可访问性、控件性能、安全和媒体窗口集成。不要把所有 fork 的特性拼成一个不存在的“DuiLib 标准版”。

本轮没有完成其精确 fork 的许可/维护审计，因此只列为备选，不作为已满足生产准入的方案。“DirectUI”也不自动等于 DirectComposition 或 GPU 合成。

### 4.6 JUCE

是完整 C++ 跨平台应用框架，擅长音频与多媒体、自绘界面；但这不意味着自带 Bilibili DASH/ASS 播放能力。[J1]

关键筛选项是许可：当前 JUCE README 明确采用 **AGPLv3 或商业许可**。不能把现有 MIT 项目直接按“所有依赖都宽松许可”处理；如不能接受相应开源义务，商业许可可能是必要条件。[J1] 许可证义务需单独评估，不是法律意见。

若项目以后扩展大量音频处理，价值会上升；仅为视频客户端 UI 引入它，未显现出优于 Qt/wx/RmlUi 的决定性收益。

### 4.7 LVGL：纯 C 保留式 UI

适合嵌入式/设备式界面，也能用桌面后端运行。开源 LVGL 库为 MIT，LVGL Pro 的工具/服务是另一套许可，不能混为一谈。[L1]

值得验证的目标是键盘/遥控器或触屏导向的精简播放器。对于当前多列表、评论、中文编辑、快捷键与窗口应用，需要额外的桌面适配；视频纹理注入、GPU 合成、输入法和无障碍不能从“有 SDL demo”推出“已经解决”。

### 4.8 Nuklear / Dear ImGui

- **Nuklear**：ANSI C89、单头文件，不包含默认渲染/窗口/输入实现；现维护源提供 MIT/public-domain 双许可选择。适合纯 C 原型。[I1]
- **Dear ImGui**：C++，官方明确面向开发/内容工具，且当前 README 指出完整国际化/文本整形与无障碍能力缺失。不适合不加评估就作为中文消费级客户端主 UI。[I2]

两者适合快速验证 libmpv 的 pause/seek/ASS/线程等技术问题。UI debug 面板成功，不能用来证明完整产品界面选型成功。

### 4.9 Ultimate++

可以作为 C++ 集成式桌面开发的备选，提供自己的应用框架与开发约定。[U1] 适用前提是团队愿意采用其生态；本轮只核实基本定位，没有完成 Windows 媒体合成、许可/依赖和工具链验收，因此不列入本次短名单。

## 5. 不应误判为“纯 C++”的路线

### Slint

有 C++ API 和可编译 UI 描述，但当前 C++ 构建脚本包含 Corrosion/Rust 查找与 runtime 构建。提供 C++ 接口不等于底层实现也是 C++。[S1]

如果目标只是业务逻辑用 C++、不使用浏览器，它仍可研究；若目标是移除 Rust 及其构建链，则应排除。Rust 编译成原生库不等于需要 GC/解释器，但依旧不符合这里的无 Rust 约束。

### Qt Quick / QML

可以去掉浏览器，但常规方案依赖 QML/JS 引擎，不满足 A/B 的严格定义。若愿意放宽约束，动画和现代界面值得重新比较；不能把它混入严格纯 C++ 方案。

### CEF / WebView2 / Sciter 类

解决的是不同程度的网页/脚本 UI 承载，不适合拿来证明“完全移除网页界面运行时”。它们可以作为过渡适配器，但不满足本轮主要目标。

## 6. 如果 C 系列包括 C#，应该另开一条分支

不能因为上一轮以原生 C++ 为主就遗漏托管路线：

- **C# + WPF + libmpv**：Windows 专用、XAML/绑定/文字与复杂表单能力成熟。去掉浏览器，但保留 .NET。原生视频子窗口仍会涉及 airspace/遮挡，不能因为 WPF 有合成系统就假定问题消失。[C1]
- **C# + WinUI 3 + libmpv**：现代 Windows 控件、.NET 与原生 interop 并存。App SDK 分发和视频合成仍需验证。
- **C# + Avalonia + libmpv**：.NET 跨平台、自有绘制引擎，不是默认使用 Chromium 的 Web UI。仍需精确选定原生窗口承载还是纹理合成，并核对每个平台的实现。[C2]

对这些路线不要预设 NativeAOT/单文件发布能消除所有依赖或兼容所有反射/GUI/native interop。本轮没有验证其 AOT 能力，也不因它们使用 C# 就将其包装为纯原生 C++。

如果目的只是“不要 TS/Rust/WebView，想提高业务开发速度”，C# 值得与 C++ 并列评估；如果目的是没有 CLR、代码与工具链都 C/C++，则不是候选。

## 7. 对 BiliDesk 的重新排序

不做伪精确的 8.7/10 评分，按目标排序：

| 首要目标 | 优先验证 | 保留对照 | 暂不优先 |
| --- | --- | --- | --- |
| 低产品化风险、完整桌面能力 | Qt Widgets、wxWidgets | WinUI C++ | Nuklear、ImGui、全自绘 |
| Windows 原生交互与系统整合 | WinUI 3 C++/WinRT | Qt/wxMSW | 跨平台嵌入式 UI |
| 保留 BiliOne 风格和沉浸式画面 | SDL3 + RmlUi | Qt Widgets 自绘 | 默认原生控件式界面 |
| 严格业务/UI 都用 C | GTK4、Win32 C | LVGL | Qt、WinUI C++、wx |
| 简化成轻量播放器 | FLTK | Win32/WTL | 原样保留所有复杂页面 |
| 接受 C#，尽快交付功能 | WPF/WinUI C#；跨平台则 Avalonia | Qt C++ | 为语言纯度大量自研 |

**新增结论：Qt 不再是唯一推荐，而是完整桌面框架的基线。WinUI C++ 和 RmlUi 应按两种不同产品目标进入同等级 PoC。wxWidgets 是不能遗漏的成熟替代。**

## 8. 用相同任务筛选，而不是为每个框架做空白窗口

最多同时做三条主路线：Qt/wx 中选一个成熟框架作对照、WinUI C++、SDL3+RmlUi。如果希望继续保持资源投入最小，可先只比较既定 Qt 基线和最感兴趣的一条新增路线。

每条 PoC 使用同一份场景：

1. 从本地 fixture 展示 200 张视频卡，测试滚动、图片异步加载、缓存与取消。
2. 搜索框与评论输入框，测试微软拼音组合输入、候选窗位置、跨 DPI、复制粘贴、快捷键和键盘焦点。
3. 同一段合法本地视频、同一 ASS、相同 mpv DLL；做 play/pause/seek/倍速和音量。
4. 播放画面上弹出控制层/评论/登录窗口，验证输入和遮挡，不只把按钮放画面外。
5. 程序化驱动连续 100 次切片/页面切换，注入旧会话 EOF/错误，观察新会话是否被污染、线程/HWND 是否回收。
6. 100/125/150/200% DPI、跨显示器、缩放/最小化/恢复；测 UI Automation/Narrator 的可发现性。
7. 在不装开发环境的干净 Windows 机器上安装，验证 SDK/CRT/插件/DLL 缺失、升级与卸载保留数据。

性能测量必须区分：

- GUI 空闲开销与同一媒体内容下的播放开销；
- 冷启动/暖启动、图片冷缓存/热缓存；
- 私有内存/working set/峰值，CPU/GPU、掉帧、首帧、输入响应；
- 框架部分大小与包含 mpv/解码依赖/字体的最终安装包大小。

任何方案如果在中文输入、稳定退出、画面叠层或干净机器分发上失败，应先淘汰或降级，不用一个较低的空闲内存数字抵消硬性缺陷。

**媒体后端是独立变量：** 初期所有候选保留同一 libmpv。若改用 Media Foundation、自组 FFmpeg 解码器或其他播放器，DASH 拼装、音轨、ASS/弹幕、硬解和色彩都要重新验收，届时不再是公平的 GUI 框架比较。

## 9. 一手来源索引

以下链接用于事实核验，不代表已对对应框架所有版本及依赖做完审计。404 的尝试未用作成功证据。

- [W1] [Windows App SDK](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/)。
- [W2] [C++/WinRT 概览](https://learn.microsoft.com/en-us/windows/uwp/cpp-and-winrt-apis/intro-to-using-cpp-with-winrt)。
- [W3] [未打包、框架依赖型应用部署](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/deploy-unpackaged-apps)；只用于该部署模型，不泛化为所有打包方式。
- [W4] [SwapChainPanel](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.controls.swapchainpanel?view=windows-app-sdk-1.8)。
- [R1] [RmlUi README](https://github.com/mikke89/RmlUi)、[文档](https://mikke89.github.io/RmlUiDoc/)。
- [R2] [RmlUi MIT License](https://github.com/mikke89/RmlUi/blob/master/LICENSE.txt)。
- [R3] [RmlUi SDL/GL 后端源码](https://github.com/mikke89/RmlUi/blob/master/Backends/RmlUi_Backend_SDL_GL3.cpp)。
- [R4] [RmlUi SystemInterface](https://mikke89.github.io/RmlUiDoc/pages/cpp_manual/interfaces/system.html)。
- [X1] [wxWidgets Overview](https://www.wxwidgets.org/about/)。
- [X2] [wxWidgets Licence](https://www.wxwidgets.org/about/licence/)。
- [X3] [wxGLCanvas](https://docs.wxwidgets.org/latest/classwx_g_l_canvas.html)。
- [F1] [FLTK README](https://github.com/fltk/fltk/blob/master/README.txt)、[COPYING](https://github.com/fltk/fltk/blob/master/COPYING)。
- [F2] [Fl_Gl_Window](https://www.fltk.org/doc-1.4/classFl__Gl__Window.html)。
- [G1] [GTK4 API](https://docs.gtk.org/gtk4/)。
- [G2] [GtkGLArea](https://docs.gtk.org/gtk4/class.GLArea.html)。
- [N1] [MFC Desktop Applications](https://learn.microsoft.com/en-us/cpp/mfc/mfc-desktop-applications?view=msvc-170)。
- [N2] [WTL mirror README](https://github.com/Win32-WTL/WTL)，其中注明[正式项目地址](https://wtl.sourceforge.io)与 MS-PL；本轮读取的是 mirror，不把它当作维护活跃度证明。
- [D1] [DuiLib 上游](https://github.com/duilib/duilib)。
- [J1] [JUCE README](https://github.com/juce-framework/JUCE)、[JUCE 8 EULA](https://juce.com/legal/juce-8-licence/)。
- [L1] [LVGL README](https://github.com/lvgl/lvgl)，开源库与 Pro 工具许可分开。
- [I1] [Nuklear 当前维护源](https://github.com/Immediate-Mode-UI/Nuklear)、[LICENSE](https://github.com/Immediate-Mode-UI/Nuklear/blob/master/LICENSE)；旧 vurtun 源已声明迁移。
- [I2] [Dear ImGui README](https://github.com/ocornut/imgui/blob/master/docs/README.md)。
- [U1] [Ultimate++ 概览](https://www.ultimatepp.org/www$uppweb$overview$en-us.html)。
- [S1] [Slint C++ CMakeLists](https://github.com/slint-ui/slint/blob/master/api/cpp/CMakeLists.txt)，含 Rust/Corrosion 和 runtime 构建配置。
- [C1] [WPF 概览](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/overview/)。
- [C2] [Avalonia 官方介绍](https://docs.avaloniaui.net/docs/overview/what-is-avalonia)。
