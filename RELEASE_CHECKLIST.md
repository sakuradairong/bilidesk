# 发布检查清单

以下项目全部完成后，版本才能从受控内测提升为公开发布候选。

## 源码与合规

- [ ] 工作区无未提交文件，发布提交已经过复核
- [x] 确认项目许可证并添加根目录 `LICENSE`
- [x] 确认未复制不兼容许可证的代码、图标、截图或其他资源
- [x] 更新 `CHANGELOG.md`、`PRIVACY.md`、`SECURITY.md` 和第三方组件清单
- [x] 版本号在 `package.json`、`Cargo.toml`、`tauri.conf.json` 和 `src/lib/version.ts` 中一致（`npm run check:release`）

## 自动化门禁

- [ ] GitHub Actions `CI` 全部通过
- [ ] `npm ci && npm run build && npm test` 通过
- [ ] `npm audit --audit-level=high` 无高危或严重问题
- [ ] `cargo fmt --check`、严格 Clippy、Rust 测试和 RustSec 审计通过
- [x] libmpv 下载版本和 SHA-256 与 `scripts/fetch-mpv.ps1`、`scripts/fetch-mpv.sh` 一致

## Windows 验收

- [ ] Windows 10 x64 和 Windows 11 x64 均完成安装、启动、升级和卸载测试
- [ ] 验证 WebView2 缺失、离线和下载失败时的提示
- [ ] 在 100%、125%、150% 和 200% 缩放下检查单屏和多屏布局
- [ ] 使用普通账号验证扫码登录、退出、历史、收藏、稍后再看和互动功能
- [ ] 验证常见 AVC/HEVC/AV1 视频、分 P、弹幕、清晰度切换、续播和自动连播
- [ ] 验证断网、接口限流、登录过期、视频失效和 libmpv 加载失败
- [ ] 确认卸载后是否保留用户数据，并与隐私说明一致

## 制品

- [ ] EXE 和 NSIS 安装包使用可信 Windows 代码签名并带时间戳
- [ ] 从干净 tag 在 CI 中构建，不发布本地脏工作区产物
- [ ] 记录安装包文件大小、SHA-256、签名状态和对应提交 SHA
- [ ] 在至少一台非开发机上安装最终 CI 制品并完成冒烟测试
- [x] 准备故障版本撤回、降级或热修复方案

## 发布命令

1. 确认目标分支已合入默认分支，且 `CI` 全绿。
2. `npm run check:release` 确认版本号一致。
3. 推送 annotated tag：`git tag -a v1.0.0 -m "BiliDesk 1.0.0" && git push origin v1.0.0`。
4. 等待 `Windows installer` 创建 GitHub Release。未配置证书时 Release 会标为 prerelease。
5. 在非开发机安装该 Release 中的 EXE，完成上方 Windows 验收后再取消 prerelease / 对外宣布。

## 故障撤回

- 热修：在默认分支修复后发布 `1.0.x`，再打新 tag。
- 降级：卸载当前版本，安装上一份 GitHub Release 的安装包。不要手工覆盖 `libmpv-2.dll` 以外的程序文件。
- 用户数据：默认保留在 `%APPDATA%\com.bilidesk.desktop`。卸载程序不会自动删除该目录，与 [PRIVACY.md](PRIVACY.md) 一致。
- 签名密钥：`WINDOWS_CERTIFICATE` 与密码只存在 GitHub Secrets。证书过期后必须轮换 Secrets 再发版。
