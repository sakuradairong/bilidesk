# 更新日志

本项目采用语义化版本编号。公开版本发布前，将“未发布”内容移动到对应版本小节。

## 未发布

## 1.0.0 - 2026-08-23

### 新增

- BiliOne 风格的桌面导航、内容卡片和排行页面
- 收藏、稍后再看和动态页面的未登录引导
- 前端 Vitest 基础测试和 GitHub Actions 质量门禁
- 隐私说明、安全政策和发布检查清单
- 推送 `v*` 标签后自动构建 NSIS 安装包、生成 SHA-256，并创建 GitHub Release
- 设置页提供当前版本与 GitHub Release 检查入口

### 改进

- 播放页使用两层控制布局，并收纳高级弹幕设置
- 紧凑导航增加名称提示和无障碍标签
- 固定 libmpv 构建版本并在下载时校验 SHA-256
- 登录过期、断网、稿件失效和 libmpv 缺失改为稳定错误码与用户可读提示
- 版本号由 `package.json`、`Cargo.toml`、`tauri.conf.json` 与前端常量共同约束

### 安全

- 为正式构建启用 Content Security Policy
- Windows 登录 Cookie 改用当前用户范围的 DPAPI 加密，并自动迁移旧明文会话
- 安装包在配置 `WINDOWS_CERTIFICATE` 后使用 Authenticode 签名并加盖时间戳；未配置时仍发布未签名预发布包
