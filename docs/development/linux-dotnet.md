# Linux .NET 构建环境

> 后续实施更新：新 `csharp/` 工程的全部依赖已成功还原，WinUI 编译实际停在 Windows `XamlCompiler.exe` 的 exec format error，而非仍停留在本文件早期探针的 TLS 故障。当前工程与测试结果见 [实施状态](csharp-implementation-status.md)；下文保留初次安装证据。

## 已安装

本机：Debian 12、x86_64。

| 项目 | 值 |
| --- | --- |
| .NET SDK | `10.0.402` |
| MSBuild | `18.9.15` |
| .NET Runtime | `10.0.13` |
| ASP.NET Core Runtime | `10.0.13` |
| SDK 根目录 | `/usr/share/dotnet` |
| 命令入口 | `/usr/local/bin/dotnet` → `/usr/share/dotnet/dotnet` |
| NuGet 用户缓存 | `/root/.nuget/packages` |

使用微软官方 Linux x64 SDK 压缩包安装，不是 apt 包。现有 ICU、OpenSSL、libstdc++、zlib 等系统依赖已检查。新建的非登录 shell、登录 shell 均验证能够直接运行 `dotnet --version`，无需临时 export PATH。

官方来源：

- [10.0 发布元数据](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json)
- [SDK 10.0.402 linux-x64](https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.402/dotnet-sdk-10.0.402-linux-x64.tar.gz)

解压前按官方元数据验证 SHA-512，通过：

```text
1904a98dda2db34ba78ba3c4fb1b224455329af91c341d83547843c1839e112b04ae699ee92fa2449a8f62249196a938723078c0c60b9f65c88539d5687729c2
```

该 SDK 不会通过 `apt upgrade` 自动更新；后续维护应根据微软受支持补丁重新下载、校验并安装，保留需要的并行 SDK。没有为尚未建立的 C# 工程添加 `global.json` 或改变项目目标框架。

## 实际验证

探针全部位于 `/tmp/bilidesk-dotnet-smoke.PBHTTF`，没有在业务源码目录创建新的 C# 应用。

| 检查 | 结果 |
| --- | --- |
| 控制台 net10.0 Release 构建 | 通过，0 warning / 0 error |
| 控制台程序运行 | 通过，输出 `Hello, World!` |
| NuGet 还原 | xUnit、CommunityToolkit.Mvvm 8.4.0 等包通过 |
| MVVM 源生成 / JSON 运行时 | 两项 xUnit 冒烟测试通过 |
| WPF Windows 目标 + XAML 编译 | 通过，0 warning / 0 error，仅编译，未运行 |
| WinUI 3 探针 | **未通过：还原阶段遇到 NuGet TLS EOF，未进入 XAML 编译** |

WPF 探针使用：

```xml
<TargetFramework>net10.0-windows</TargetFramework>
<UseWPF>true</UseWPF>
<EnableWindowsTargeting>true</EnableWindowsTargeting>
```

这只证明一个最小 WPF 项目能在当前 Linux SDK 上生成 Windows 目标程序集，不证明桌面界面、原生 DLL、DPAPI、播放器、打包或任意 WPF 项目均可在 Linux 验证。

WinUI 探针使用 Windows App SDK `1.8.251106002`。初次还原及一次串行/进程级禁用 HTTP/2 的重试均遇到 `Microsoft.WindowsAppSDK.WinUI/Runtime/ML` 相关包的 TLS EOF；第二次尝试达到时间上限。没有关闭证书校验、加入不安全源或全局修改网络设置。普通 NuGet 包此前还原成功，不应把这个失败泛化为所有 NuGet 均不可用。

**不能把该探针的还原错误说成已经观察到 Windows XAML 编译器错误。** WinUI 3 完整构建/打包仍安排到 Windows runner；Linux 上安装 SDK 不等于获得 Windows SDK/Visual Studio 原生工具链。没有安装 Wine 或声称 Windows GUI 能在此运行。

日志：

```text
/tmp/bilidesk-dotnet-smoke.PBHTTF/console-build.log
/tmp/bilidesk-dotnet-smoke.PBHTTF/console-run.log
/tmp/bilidesk-dotnet-smoke.PBHTTF/mvvm-package.log
/tmp/bilidesk-dotnet-smoke.PBHTTF/xunit-tests.log
/tmp/bilidesk-dotnet-smoke.PBHTTF/wpf-cross-build.log
/tmp/bilidesk-dotnet-smoke.PBHTTF/winui-cross-build.log
/tmp/bilidesk-dotnet-smoke.PBHTTF/winui-serial-restore.log
```

`/tmp` 探针和日志是本机临时验证证据，可能被系统清理；不是项目测试套件或持久 CI 产物。

## 后续工程建议

- Linux：Core / API / 存储中可跨平台的部分、解析 fixture、MVVM 与用例测试。
- Windows：WinUI XAML 编译、MPV/窗口/DPAPI 集成、DPI/焦点、安装与签名。
- 平台 API 在实现层隔离，避免因为 Core 引用了 WinUI 而让全部测试都依赖 Windows。
- 后续需要 Windows 目标引用程序集时，仅对相应工程启用 `EnableWindowsTargeting`，不将其当作 Linux 运行 GUI 的开关。
- 环境验证命令使用了进程级 `DOTNET_CLI_TELEMETRY_OPTOUT=1`；没有修改全局 telemetry 设置。首次运行 SDK 自动创建 ASP.NET 开发 HTTPS 证书，没有启动任何服务。
