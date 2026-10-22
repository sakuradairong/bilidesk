# BiliDesk C# 重构：工程结构、功能迁移与开发效率研究（只读）

> 标注：**[事实]** 来自本工作区源码/文档；**[建议]** 设计取舍；**[待验证]** 无 Windows 证据。本环境未运行任何 Windows 构建；既有报告只作研究起点。

## 1. 实际产品功能（[事实]，源码核对）

- 命令面：`src-tauri/src/lib.rs` 注册 43 个 `commands::*`，按 auth/feed/video/social/player/settings 分组；`commands/mod.rs` 的 `AppState` 只持有 `bili / storage(Mutex<Option<Storage>>) / player(Mutex<PlayerHost>) / player_requests / danmaku_*`，无 DI 框架。
- 播放状态机：`PlayerScope`（Standard/Featured）+ `PlayerRequests{generation,current}`；单元测试 `stale_featured_stop_cannot_cancel_standard_playback` 固化“旧 scope 的 stop 不得取消新会话”。`commands/player.rs::player_open` 中以外挂 generation 校验贯穿 view→streams→danmaku→spawn_blocking 装配，失败即 `player.stop()`。
- 播放实现：`player.rs::PlayerHost` 用原生子 HWND 承载 libmpv（`create_host/move_host/sync_window`），弹幕走 `write_ass` 交 libass；`lib.rs` 在 `Moved/Resized/Focused/ScaleFactorChanged` 时同步宿主矩形。**这是重构最大风险点**（WinUI 3 无 HwndHost 等价物）。
- 数据：`storage/mod.rs` 表 `history / settings / play_progress / schema_migrations`，含 `history.json` 旧数据迁移、隔离（quarantine）与 `.migrated` 重放；`bili/session.rs` 用 `CryptProtectData` 存 `session.json`（当前用户 DPAPI）。
- 安全不变量：`bili/media.rs::is_allowed_host` 仅 `hdslb.com/biliimg.com` 且强制 https，有正反测试；mpv 只收固定 Referer/Cookie header。
- 页面：`App.tsx` 9 条业务路由 + 3 条旧路径重定向；`AppShell.tsx` 5 项胶囊导航 + 搜索 + 登录下拉；`HomePage.tsx` 4 个发现 Tab（推荐/热门/分区/动态）并用 `normalizeDiscoverSearch` 规范化 URL；`SettingsPage.tsx` 外观/弹幕/播放/关于四段，键名与 `stores/settings.ts` 一一对应（`theme`、`accent_color`、`danmaku_*`、`default_volume/speed`、`auto_play_next`、`resume_position`）；`PlayerPage.tsx` 5 秒可取消连播 + `playerProgressGet/Save` 续播；`FeaturedPage.tsx` 用 `featured` scope 的 backdrop 播放 + 键盘切条；`lib/watch.ts` 的 `from/fromState` 是返回导航契约。
- 明确排除：直播、下载/缓存、大会员破解、地区绕过（README 与命令面无对应实现，[事实]）。

## 2. 建议项目结构（3+1，[建议]）

```text
native-csharp/
  BiliDesk.sln, global.json, Directory.Packages.props
  src/BiliDesk.Core/           DTO、AppError(code/message)、设置键、纯策略
  src/BiliDesk.Infrastructure/ BiliApi、LocalStore、SecretSession、AssBuilder、MpvHost
  src/BiliDesk.App/            WinUI 3 XAML + ViewModel + 装配（WPF 备选，同一 Core）
  tests/BiliDesk.Tests/        跨平台：fixture、策略、迁移、许可清单
  tests/BiliDesk.WindowsTests/ HWND/DPAPI/DLL/退出/焦点
```

依赖方向单向：App → Infrastructure → Core；Core 不引用任何 UI/Windows 类型。**深模块而非接口森林**：只保留 4 个具体封装（`BiliApi` 按域分组扩展方法、`LocalStore` 单连接+队列、`PlaybackCoordinator` 持 session_id/取消/连播/续播、`MpvHost` 持 HWND 与生命周期）。不建 `IRepository<T>`、`IEventBus`、MediatR、按类一接口；只有确需替换的 OS 边界（如 DLL 搜索目录、时钟）才抽 1 个 seam。

不变量（建议写成测试）：① 任何进度/结束事件必须带 `session_id`，过期会话不得写库或触发连播；② `LocalStore` 连接单线程归属，UI 线程不做迁移/批量写；③ 只允许 https + 图床白名单；④ 弹幕设置只对下一个打开的会话生效（与现状一致）；⑤ C# 首版**不得**写入新的 `schema_migrations` 版本号。

## 3. 迁移顺序（按“可验收垂直切片”）

| 里程碑 | 内容 | 理由 |
|---|---|---|
| M0 闸门 | `MpvHost` 最小可播 + WinUI 宿主方案（嵌入 vs 独立播放窗） | 技术风险前置，避免页面重写后才发现不可行 |
| M1 只读浏览 | Cookie 复用登录态、推荐/热门/分区/动态/搜索、视频详情 | 无副作用，可先用只读 DB |
| M2 本地 | 历史、设置读写、续播记录、目录兼容 | 验证 DPAPI + SQLite 行为 |
| M3 播放 | open/seek/倍速/音量/清晰度/ASS 弹幕/退出回收 | 主体验 |
| M4 写操作 | 赞/踩/币/藏/三连/稍后再看/关注/评论/发弹幕 | 有副作用，最后做，需人工回归 |
| M5 其余页面 | 用户空间、收藏夹、稍后再看、精选沉浸 | 依赖前面能力 |
| M6 发布 | 打包、签名、许可、回滚演练 | 见 §4–5 |

## 4. CI 分工（[建议]）

- **Linux（ubuntu-latest）**：`dotnet restore --locked-mode` → Core/Infrastructure 构建（不设 Windows TFM）→ `BiliDesk.Tests`（WBI 签名 fixture、模型解析、ASS 生成、设置键、迁移、播放策略纯函数）→ `dotnet format --verify-no-changes` → `dotnet list package --vulnerable` → 许可清单脚本。
- **Windows（windows-latest）**：WinUI XAML 编译、`BiliDesk.WindowsTests`（DPAPI、HWND 生命周期、DLL 加载目录、卸载后残留）、`fetch-mpv.ps1` 校验哈希、打包与可选签名。
- 与现有 `.github/workflows/ci.yml`（rust-audit + windows quality）并存为独立 workflow，不修改现有发布链路，直到 C# 版本验收通过。注意 `docs/development/linux-dotnet.md` 记录：WinUI NuGet 在 Linux 曾 TLS EOF，**不要**在 Linux 尝试还原 WinUI 包。

## 5. 版本锁定 / 许可 / 包体 / 回退

- 锁定：`global.json` sdk `10.0.402`（与本机一致）；`Directory.Packages.props` 集中版本；启用 `packages.lock.json`。CommunityToolkit.Mvvm 8.4.0 已在本机还原验证（[事实]，`/tmp` 探针）；WinUI/WindowsAppSDK 版本需在 Windows runner 实测后固定。
- libmpv：沿用 `THIRD_PARTY.md` 的 `zhongfly/mpv-winbuild 2026-08-21-49418246f3` + SHA-256 `317dfd9e…`，继续动态加载以保留 LGPL 可替换性，安装包内保留 `licenses/LGPL-2.1/3.0`、`GPL-3.0`。
- 包体：优先 WindowsAppSDK 自包含（无运行时前置），记录与 Tauri 版体积对比；libmpv 单独目录 `vendor/mpv/` 不打进单文件。
- 回退：C# 产物用独立 artifact 名/新版本号段；数据目录与表结构不变（`%APPDATA%\com.bilidesk.desktop`、`bilidesk.db`、`session.json`），使卸载新版后可装回 Tauri 安装包；首次写库前生成 `bilidesk.db.bak`，迁移失败走既有 quarantine 策略。

## 6. 验收矩阵（摘要）

| 能力 | Linux CI | Windows 手测 | 回退 |
|---|---|---|---|
| 解析/策略/许可 | 必须全绿 | — | 保留 Tauri |
| 播放+弹幕 | 仅纯函数 | [待验证] 嵌入、DPI、焦点、退出 | 独立播放窗降级 |
| 登录/Cookie | 不可测 | [待验证] DPAPI 兼容与旧文件读取 | 走裸登录态 |
| 历史/设置/续播 | 迁移 fixture | [待验证] 真实库读写 | 只读模式 |
| 写操作 | 错误码映射 | [待验证] 逐项人工 | 保留网页端操作 |
| 打包/安装 | — | [待验证] 升级、卸载残留 | 装回 Tauri 包 |

## 7. 失败与回退策略

M0 不达标（嵌入 layer/z-order/焦点无法满足精选页“画面外渐变 + 浮层”）：优先采用“主窗口浏览 + 独立沉浸播放窗”并对精选页做产品取舍，而非先写纹理合成；仍不达标则回退 WPF（HwndHost 路径已有跨平台编译证据，仅编译）。任一里程碑失败都停止继续向下迁移，C# 代码留在 `native-csharp/` 不影响 `src/`。

## 8. 未决问题

1. WinUI 3 中 libmpv 子 HWND 的裁剪/焦点/DPI 行为（无 HwndHost）[待验证]。
2. `player_set_bounds` 的 CSS→物理像素换算在新框架下是否需要重写（`player.rs::css_to_physical` 现有实现依赖 scale）。
3. mpv-kernel 类第三方封装是否引入：需 ABI/许可/维护审计，当前**未做准入**，默认自写薄 interop。
4. WBI 签名与风控参数是否需在 C# 侧重放 fixture 对拍（建议以现有请求快照做 golden test）。
5. 是否复用现有 CI 的 Windows runner 额度、以及签名证书是否继续沿用 Secrets（不在此文披露任何凭据）。