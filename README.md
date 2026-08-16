# BiliDesk

非官方的 Windows 哔哩哔哩桌面客户端，仅供个人学习与自用。不是哔哩哔哩官方产品，不使用官方名称或 logo 作为应用标识。使用前请自行遵守哔哩哔哩用户协议；接口来自网页端公开 HTTP API，可能随时变更。

第一期能力：二维码登录、推荐、搜索、UGC 播放（分P / 清晰度）、弹幕（ASS 交给 mpv 渲染）。不做直播、下载、评论或任何破解大会员 / 绕过地区限制的功能。

## 环境

- Windows 10/11 x64
- Node.js 20+
- Rust / MSVC 构建工具（Tauri 2）
- [mpv](https://mpv.io/)（LGPL）。请安装并加入 PATH，或设置 `BILIDESK_MPV` 指向 `mpv.exe`。源码：<https://github.com/mpv-player/mpv>

```powershell
winget install mpv
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
