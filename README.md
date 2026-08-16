# BiliDesk

非官方的 Windows 哔哩哔哩桌面客户端，仅供个人学习与自用。不是哔哩哔哩官方产品，不使用官方名称或 logo 作为应用标识。使用前请自行遵守哔哩哔哩用户协议；接口来自网页端公开 HTTP API，可能随时变更。

第一期能力：二维码登录、推荐、搜索、UGC 播放（分P / 清晰度）、弹幕（ASS 交给进程内 libmpv 渲染）。不做直播、下载、评论或任何破解大会员 / 绕过地区限制的功能。

## 环境

- Windows 10/11 x64
- Node.js 20+
- Rust / MSVC 构建工具（Tauri 2）
- [libmpv](https://mpv.io/)（LGPL）。把 `libmpv-2.dll` 放到 `src-tauri/vendor/mpv/`，或设置 `BILIDESK_MPV` 指向该 DLL / 其所在目录。源码：<https://github.com/mpv-player/mpv>

推荐用 [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild/releases) 的 **`mpv-dev-lgpl-x86_64`** 包（不要用 v3，除非能确认 CPU 支持 AVX2）：

```powershell
# 下载 7z 后解出 libmpv-2.dll 到下面目录
New-Item -ItemType Directory -Force src-tauri/vendor/mpv | Out-Null
```

## 运行

```powershell
npm install
npm run tauri dev
```

打包：

```powershell
npm run tauri build
```

数据目录保存登录 Cookie 与本地观看历史。
