# BiliDesk

非官方的 Windows 哔哩哔哩桌面客户端，仅供个人学习与自用。不是哔哩哔哩官方产品，不使用官方名称或 logo 作为应用标识。使用前请自行遵守哔哩哔哩用户协议；接口来自网页端公开 HTTP API，可能随时变更。

## 能力

- 二维码登录、推荐、搜索、本地观看历史（SQLite）
- UGC 播放（分P / 当前登录态真实可用清晰度）、弹幕（ASS → 进程内 libmpv）
- 「精选」沉浸连播、赞 / 不喜欢 / 投币 / 收藏、发弹幕、查看与发送评论
- 设置页（浅色 / 深色 / 跟随系统、弹幕与播放默认值）
- 快捷键：空格暂停、左右 seek、播放页上下调音量；精选上下切条（或 `F` 下一条）、`Esc` 关闭评论/退出播放

明确不做直播、下载 / 缓存、破解大会员、地区限制绕过或一键三连。网络请求保持网页 Chrome 身份（UA + `Referer: https://www.bilibili.com/` + Cookie），不伪装官方 Electron 客户端。

## 技术栈

- 前端：React 19 + Vite + Tailwind CSS + shadcn/ui + React Router + Zustand
- 后端：Tauri 2（Rust），按 auth / feed / video / social / storage / player 领域拆分
- 本地数据：SQLite（历史、设置）；Cookie 仍为 `session.json`（启动时迁移旧 `history.json`）

## 环境

- Windows 10/11 x64
- Node.js 20+
- Rust / MSVC 构建工具（Tauri 2）
- [libmpv](https://mpv.io/)（LGPL）。把 `libmpv-2.dll` 放到 `src-tauri/vendor/mpv/`，或设置 `BILIDESK_MPV` 指向该 DLL / 其所在目录。

推荐用 [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild/releases) 的 **`mpv-dev-lgpl-x86_64`** 包。

## 运行

```powershell
npm install
npm run tauri dev
```

打包：

```powershell
npm run tauri build
```

数据目录保存登录 Cookie、SQLite 数据库与本地观看历史。
