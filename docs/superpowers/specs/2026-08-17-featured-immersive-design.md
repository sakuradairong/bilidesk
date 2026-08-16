# BiliDesk 精选沉浸页设计

**日期：** 2026-08-17  
**产品：** BiliDesk（非官方）  
**对照：** 官方电脑版 Electron 精选（内部名 Selected，`feed_version=CLIENT_SELECTED`）

在第一期播放能力上增加侧栏「精选」：进入后全窗口连播 UGC，半透明壳叠在画面上，并可赞、投币、收藏、发弹幕、看/发评论。不冒充官方品牌与客户端身份。

## 1. 目标与非目标

必须完成：

侧栏点「精选」→ 拉官方同款片单 → 内嵌 libmpv 立刻开播 → 上下一条 → 半透明顶栏/侧栏叠在视频上 → 登录后赞/币/藏/发弹幕/评论。

不做：直播、番剧 PGC 当主内容、下载、破解大会员、地区绕过、官方 logo、`mobi_app=pc_electron` / `web_location=bilibili-electron` / `x-app-version` 伪装。动态 Tab 本 spec 不做（那是 `polymer/web-dynamic/desktop`）。

## 2. 片单接口

`GET https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd`（已有 WBI，与推荐同一路径）。

| 参数 | 精选 | 现有推荐 |
|------|------|----------|
| `feed_version` | `CLIENT_SELECTED` | `V3` |
| `fresh_idx` / `fresh_idx_1h` | 从 1 递增 | 同左 |
| `plat` | `1` | 可不传 |
| `ps` | `10` | 默认 |
| `fresh_type` | 首页 `0`，加载更多 `1` | — |
| `brush` | `0` | `0` |

解析 `data.item`（或 `items`）。**丢掉没有正 `cid` 的卡片**（官方 `.filter(ce=>!!ce.cid)`），只留 UGC（`goto` 为 `av` 或 bvid 以 `BV` 开头）。

卡片补齐：`aid`、`cid`、`owner_face`。现有推荐网格可忽略这些新字段的空值。

身份：继续 Chrome UA、`Referer: https://www.bilibili.com/`、Cookie（含 buvid / SESSDATA）。不伪造官方 Electron 头。

## 3. 播放与布局

独立 `FeaturedPage`，不改推荐「卡片 → PlayerPage」路径。

- 进入精选即 `player_open` 第一条可播稿；HWND 铺满窗口客户区（stage 全屏）。
- `html.featured-mode`：`html/body/#root` 透明；侧栏与顶栏 `background: rgba(16,18,22,0.62)` + `backdrop-filter: blur(16px)`，叠在画面上。
- 离开精选或切回推荐/搜索/历史：去掉该类、`player_stop`。
- 右缘上/下一条；当前条播完（`player-ended`）自动下一条；接近末尾再拉一页 `fresh_idx++`。
- 空格暂停；底栏进度、清晰度、音量、倍速（`mpv` `speed` 属性：0.75 / 1 / 1.25 / 1.5 / 2）。
- 左下：头像、UP 名、标题；有 `ugc_season.title` 则显示合集名（点击暂不跳转合集列表）。
- 右下数字来自 `view` 的 `stat`：赞/币/藏/转/评；转发复制 `https://www.bilibili.com/video/{bvid}`。

## 4. 互动接口

全部网页端、Cookie、`csrf=bili_jct`。无 jct 返回「未登录」并弹出已有扫码框。POST 用 `application/x-www-form-urlencoded`。

| 动作 | 方法 | 路径 | 要点 |
|------|------|------|------|
| 点赞 | POST | `/x/web-interface/archive/like` | `aid`, `like`：1 赞 / 2 取消 |
| 不喜欢 | POST | `/x/web-interface/feedback/dislike` | `aid`；取消走 `.../dislike/cancel` |
| 投币 | POST | `/x/web-interface/coin/add` | `aid`, `multiply=1`, `select_like=0` |
| 收藏夹 | GET | `/x/v3/fav/folder/created/list-all?up_mid=` | 登录 mid |
| 收藏 | POST | `/x/v3/fav/resource/deal` | `rid=aid`, `type=2`, `add_media_ids` 默认第一个夹 |
| 发弹幕 | POST | `/x/v2/dm/post` | `type=1`, `oid=cid`, `msg`, `bvid`, `progress` 为当前秒×1000，`mode=1`, `fontsize=25`, `color=16777215` |
| 评论列表 | GET | `/x/v2/reply/wbi/main` | `oid=aid`, `type=1`, `mode=3`, `ps=20` |
| 发评/回复 | POST | `/x/v2/reply/add` | `oid`, `type=1`, `message`, `plat=1`；回复带 `root`/`parent` |

错误：`-101` 未登录；风控沿用现有文案；币不足等用接口 `message`。不伪造会员。一键三连（`like/triple`）本迭代不做。

发弹幕成功不强制重拉 ASS；当前片弹幕仍以开播时 ASS 为准。

## 5. 命令与模块

Rust `BiliClient`：`selected(fresh_idx, fresh_type)`、`view` 增加 stat/头像/合集、`like`/`dislike`/`coin`/`fav`/`danmaku_post`/`reply_list`/`reply_add`。  
Tauri commands 同名蛇形。`player_set_speed(f64)`。

前端：`PageId` 增加 `featured`；侧栏「精选」；`FeaturedPage.tsx`。

## 6. 测试

- Fixture：`CLIENT_SELECTED` 有 cid 保留、无 cid / 直播丢掉。
- Fixture：点赞 form 含 `csrf` 与 `like=1|2`；无 jct 映射「未登录」。
- Fixture：评论 `replies` 列表解析。
- 不打真实网络（可选 `#[ignore]`）。

## 7. 合规

README / 应用名仍为 BiliDesk。本功能是个人学习用网页端公开接口适配，不是官方精选翻版皮肤。
