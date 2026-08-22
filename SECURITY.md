# 安全政策

## 支持范围

安全修复仅保证合入当前默认分支和最新公开版本。预览版本可能包含尚未完成的功能，不建议在不受信任的 Windows 环境中使用。

## 报告漏洞

请使用 GitHub Security Advisory 的私密报告入口：

<https://github.com/sakuradairong/bilidesk/security/advisories/new>

报告应包含受影响版本、复现步骤、影响范围和建议修复方式。不要在公开 Issue、截图或日志中附带哔哩哔哩 Cookie、二维码密钥、用户标识或其他账号资料。

这是个人维护项目，目前不承诺固定响应时限。确认漏洞后会优先限制影响、准备修复，并在适合公开时发布说明。

## 安全边界

- BiliDesk 不应执行来自视频标题、评论、弹幕或远程页面的脚本。
- 图片代理只允许明确列出的哔哩哔哩图片域名。
- 登录 Cookie 在 Windows 上使用当前用户范围的 DPAPI 加密存储。
- 安装包在配置正式代码签名之前仍可能触发 Windows SmartScreen；不要从非项目发布渠道获取安装包。
