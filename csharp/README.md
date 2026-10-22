# BiliDesk C# preview workbench

这是按 [开发方案](../docs/development/csharp-winui-development-plan.md) 开始的独立实施目录，不替代当前 Tauri 应用。现有数据目录不会被新外壳打开或修改。

首批产物、122 项跨平台测试、子代理超时后的修复记录与未通过的 Windows 门禁见 [实施状态](../docs/development/csharp-implementation-status.md)。

## 构建和测试

要求 .NET SDK `10.0.402`（由 `global.json` 限定同 feature band 的补丁滚动）。

Linux / Windows 均可：

```sh
cd csharp
dotnet restore BiliDesk.Portable.slnx --locked-mode
dotnet test BiliDesk.Portable.slnx -c Release --no-restore
dotnet format BiliDesk.Portable.slnx --verify-no-changes --no-restore
```

Windows：

```powershell
cd csharp
dotnet restore BiliDesk.slnx --locked-mode
dotnet build src/BiliDesk.App -c Release --no-restore
dotnet test tests/BiliDesk.Windows.Tests -c Release --no-restore
dotnet run --project src/BiliDesk.App -c Release --no-build
```

App 当前只有状态说明界面，不包含登录、真实播放、数据迁移入口、安装器或自动更新。Windows App SDK 选择自包含部署，但 .NET 自包含发布/最终安装策略尚未完成；不要把 `dotnet build` 目录当作可分发安装包。

## 结构与所有权

| 工程 | 职责 |
| --- | --- |
| Core | 播放会话协调、无 native 依赖的状态与策略 |
| Infrastructure | 受限 HTTP 读取、旧 SQLite 一致快照导入 |
| Windows | 当前用户 DPAPI 会话 envelope，后续 MPV/窗口 adapter |
| App | WinUI 组合根和最小外壳 |

`BiliDesk.Portable.slnx` 刻意排除 App 和 Windows，防止 Linux 工作流触发 Windows XAML 编译。

旧库导入模块仅接收显式路径；调用者必须先关闭旧程序并经用户同意。目标已存在时拒绝而不是合并/覆盖。不包含会话文件导入、旧 `history.json` 或 UI 入口。DPAPI 保护器只处理字节、不访问文件，不等于迁移流程已经通过 Windows 兼容验收。

HTTP 模块是 GET-only 安全基础设施，不是已接通的 B 站 API。生产使用默认 handler；注入 handler 必须关闭 Cookie 容器、自动跳转和自动解压，否则它们可以绕过模块策略。不得记录包含签名参数的完整 URI 或凭据。

播放模块只接 fake/native seam；请求中的字符串标识仅用作稳定内容标识，不传登录信息或有时效签名 URL。真实 resolver、MPV、ASS、连播与续播用例尚未接线。

## 锁定、许可和平台证据

- 所有项目提交 `packages.lock.json`；改依赖后有意执行非 locked restore，再审查锁文件，CI 使用 locked restore。
- SQLite 初始 `10.0.0` 引入原生包高危告警 `GHSA-2m69-gcr7-jv3q`，已提升到 `10.0.13` / SQLitePCLRaw `2.1.13`，不采用告警 suppression。
- NuGet 的“未发现漏洞”仅代表当前数据源结果，不是完整安全/许可审计。
- WinAppSDK 是聚合包，其传递依赖包含 WebView2、AI/ML 等；本外壳没有使用这些功能，但**不宣称包依赖完全无 WebView2**。发布前需评估依赖裁剪、包体与 Microsoft 文件型许可证。
- 当前未引入 mpv-kernel 或 BiliKernel；D02 包/native 准入与 Windows M1 实验仍须完成。自有代码沿用根 MIT；NuGet/native 依赖各自许可，不统一归为 MIT。
- 独立工作流：`.github/workflows/csharp.yml`，不改变既有 Rust/React CI 和正式发布通道。

本机完整解决方案依赖还原已成功；WinUI 编译在 Linux 调用 `XamlCompiler.exe` 时得到 exec format error / MSB3073。这是实际平台工具限制，不再只是先前的 TLS 还原失败。需要 Windows runner 提供完整构建结果；Windows/DPI/MPV/IME 仍需真机，不可由跨目标编译代替。
