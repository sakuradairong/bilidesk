# BiliDesk

非官方的 Windows 哔哩哔哩桌面客户端，仅供个人学习与自用。不是哔哩哔哩官方产品，不使用官方名称或 logo 作为应用标识。使用前请自行遵守哔哩哔哩用户协议；接口来自网页端公开 HTTP API，可能随时变更。

## 能力

- 二维码登录、首页胶囊 Tab（推荐 / 热门 / 排行 / 分区 / 动态）、搜索、本地观看历史（SQLite）
- UGC 播放（分P / 当前登录态真实可用清晰度）、弹幕（ASS → 进程内 libmpv，字号 / 密度 / 透明度 / 显示区域 / 加粗可调）
- 播放体验：自动连播（下一P → 相关推荐，5 秒可取消倒计时）、断点续播（SQLite 记忆进度）、0.1 步进倍速滑杆（0.5~3.0x）
- 「精选」沉浸连播、一键三连、赞 / 不喜欢 / 投币 / 收藏、稍后再看、发弹幕、查看与发送评论
- 用户空间页（UP 主资料 / 关注 / 投稿浏览）、收藏夹与稍后再看列表页
- 界面：BiliOne 风格统一视觉（顶部胶囊导航、封面氛围色大圆角卡片、可选主题色：粉 / 青 / 蓝 / 紫 / 绿）、播放页画面外封面取色渐变背景
- 设置页（浅色 / 深色 / 跟随系统、主题色、弹幕与播放默认值、自动连播与续播开关）
- 快捷键：空格暂停、左右 seek、`+/-` 调音量；播放页上下也可调音量；精选上下切条（或 `F` 下一条）、`Esc` 先关评论再回首页

明确不做直播、下载 / 缓存、破解大会员、地区限制绕过。网络请求保持网页 Chrome 身份（UA + `Referer: https://www.bilibili.com/` + Cookie），不伪装官方 Electron 客户端。

## 技术栈

- 前端：React 19 + Vite + Tailwind CSS + shadcn/ui + React Router + Zustand
- 后端：Tauri 2（Rust），按 auth / feed / video / social / storage / player 领域拆分
- 本地数据：SQLite（历史、设置）；Cookie 使用 Windows 当前用户范围的 DPAPI 加密（自动迁移旧明文 `session.json`）

## 环境

- Windows 10/11 x64（需要 [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)；安装包可引导下载）
- Node.js 20+
- Rust / MSVC 构建工具（Tauri 2）
- [libmpv](https://mpv.io/)（LGPL）。开发或打包前把 `libmpv-2.dll` 放到 `src-tauri/vendor/mpv/`，或设置 `BILIDESK_MPV`

项目固定使用 [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild/releases) 的 **`mpv-dev-lgpl-x86_64`** 包（不要用 `v3` 包，兼容面更窄），下载脚本会验证版本和 SHA-256：

```powershell
pwsh -File scripts/fetch-mpv.ps1
```

## 运行

```powershell
npm install
npm run tauri dev
```

## 打包

Windows 本机：

```powershell
pwsh -File scripts/fetch-mpv.ps1
npm run tauri build
```

产出：`src-tauri/target/release/bundle/nsis/BiliDesk_0.1.0_x64-setup.exe`（当前用户安装，默认简体中文界面，内含 `libmpv-2.dll`）。未签名，SmartScreen 可能提示。

GitHub Actions：手动运行 `Windows installer` workflow，或推送 `v*` 标签，产物在 Artifact 里。

数据目录保存加密登录 Cookie、SQLite 数据库与本地观看历史。隐私、安全、发布和捆绑组件说明见 [PRIVACY.md](PRIVACY.md)、[SECURITY.md](SECURITY.md)、[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) 与 [THIRD_PARTY.md](THIRD_PARTY.md)。设计与功能参考来源见 [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md)。

## 许可证

BiliDesk 自有代码采用 [MIT License](LICENSE)。安装包内动态加载的 libmpv 及其依赖不属于 MIT 授权范围，仍分别遵循 [THIRD_PARTY.md](THIRD_PARTY.md) 中列出的许可证。
