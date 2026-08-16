# BiliDesk Windows 客户端第一期设计

**日期：** 2026-08-16  
**产品名：** BiliDesk（非官方）  
**平台：** Windows 10/11 x64

非官方、自用向的哔哩哔哩桌面看视频客户端。不冒充官方品牌，不使用官方 logo / 名称作为应用标识。接口走网页端公开 HTTP API，可能随时变更。

## 1. 目标与非目标

第一期必须能完成这条路径：

打开应用 → 可选扫码登录 → 浏览推荐或搜索 → 打开 UGC 视频 → 用 libmpv/mpv 播放音视频 DASH → 叠加弹幕 → 切换分P / 清晰度 / 进度。

不做：直播、下载/缓存、评论、追番详情、私信、大会员破解、地区限制绕过。清晰度只请求当前登录态真实可播的流。

游客可搜索、可看当前账号权限允许的低清晰度；登录后解锁该账号可用的更高清晰度。

## 2. 架构

```
React (WebView2)  --invoke-->  Rust Tauri
                                 ├─ bili::session   Cookie / DPAPI 或本地加密文件
                                 ├─ bili::wbi       WBI 签名
                                 ├─ bili::client    登录、推荐、搜索、view、playurl、弹幕
                                 ├─ bili::danmaku   XML/字段 → ASS
                                 └─ player          HWND 嵌入 + 进程内 libmpv-2.dll
```

- UI 不直接访问 B 站域名；所有请求由 Rust 发出，统一 UA、`Referer: https://www.bilibili.com`、Cookie、WBI。
- 播放页将窗口内容区背景设为透明，mpv 画在同一窗口 HWND（或内容区子窗口）上。非播放页用不透明背景盖住。
- 弹幕转 ASS 后交给 mpv 字幕渲染，时间轴与画面绑定。

## 3. 模块边界

| 单元 | 职责 | 对外 | 依赖 |
|------|------|------|------|
| `wbi` | mixin_key、`w_rid`/`wts` | `sign(params) -> QueryMap` | 无 |
| `session` | 读写 Cookie、登录态 | `cookies()`, `save()`, `clear()` | 文件系统 |
| `client` | B 站 HTTP | DTO 结构体 | wbi + session |
| `danmaku` | 弹幕 → ASS 文本 | `to_ass(events, opts)` | 无 |
| `player` | 启停 libmpv、seek、音量、字幕 | Tauri events + commands | playurl 结果、ASS 路径 |
| React shell | 路由、列表、登录框、控制条 | invoke | 上述 commands |

## 4. API 适配（网页端）

统一请求头：Chrome UA、`Referer: https://www.bilibili.com/`。需要时带 `buvid3` / `SESSDATA` / `bili_jct` / `DedeUserID`。WBI 密钥来自 `GET /x/web-interface/nav` 的 `wbi_img`，缓存至当日或失败再刷新。

- 二维码：`passport.bilibili.com/x/passport-login/web/qrcode/generate` 与 `.../poll`
- 导航/用户：`api.bilibili.com/x/web-interface/nav`
- 推荐：`/x/web-interface/wbi/index/top/feed/rcmd`
- 搜索视频：`/x/web-interface/wbi/search/type`（`search_type=video`）
- 稿件：`/x/web-interface/view`
- 播放：`/x/player/wbi/playurl`（`fnval` 含 DASH，如 4048）
- 弹幕：优先 `/x/v1/dm/list.so?oid={cid}` XML；失败再考虑分段 protobuf

错误映射成可读中文：未登录、风控、稿件不可用、大会员清晰度不可用、地区限制。不伪造会员身份。

## 5. 会话存储

Cookie 存在应用数据目录。Windows 上优先 DPAPI（`CryptProtectData`）；失败则写本地文件。登出时删除。不把 Cookie 打进日志。

## 6. 播放

1. 取 `view` 得 `aid`/`bvid`/`cid`/pages。
2. 取 playurl DASH，列出当前响应里真实出现的 `video`/`audio` 流（id/quality）。
3. 默认选最高可用视频轨 + 最高可用音频轨。
4. 将 URL 与 `Referer`/`Cookie`/`User-Agent` 交给进程内 libmpv（`http-header-fields`，视频主文件 + `audio-add`）。
5. 弹幕 ASS 写入临时文件，`sub-add` 加载。
6. 控制：空格暂停、进度条 seek、音量、开关弹幕、清晰度、分P。

打包：捆绑 `libmpv-2.dll`（LGPL，README 指向 mpv 源码与 zhongfly `mpv-dev-lgpl` 构建）。开发时放到 `src-tauri/vendor/mpv/` 或设置 `BILIDESK_MPV`。

## 7. 弹幕

解析 `p` 属性：时间、模式（1–3 滚动，4 底，5 顶）、字号、颜色、内容。选项：开关、字号、密度（行数上限，超出丢弃）。不做关键词屏蔽/彩色高级弹幕特效。ASS 转义 `{}`、换行。

## 8. 界面

深色壳，粉红强调色参考而不复制官方资源。

- 左栏：推荐、搜索、历史（第一期历史仅本地：打开过的稿件）
- 顶栏：搜索框、登录/头像
- 主区：封面卡片网格
- 播放：隐藏列表；返回、标题、分P、进度、清晰度、弹幕开关

窗口约 1280×800，最小 960×600。

## 9. 测试

- `wbi`：固定 img/sub key 与参数的签名快照
- `danmaku`：滚动/顶/底、转义、密度截断
- `client` 解析：用固定 JSON/XML fixture，不打真实网络（可选 `#[ignore]` 集成测）

## 10. 合规

README 写明：非官方、个人学习自用、遵守哔哩哔哩用户协议、不提供破解或下载盗用。应用显示名不得叫「哔哩哔哩」。
