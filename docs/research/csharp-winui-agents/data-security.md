# BiliDesk C# 重构：数据/API/安全/兼容研究报告（只读）

> 证据分级：**[证]** 源码或文档直接可见；**[议]** 设计建议；**[验]** 需 Windows 真机验证。本环境未运行任何 Windows 程序，旧报告（`docs/research/csharp-efficiency-first-plan.md` §6）仅作研究起点。

## 1. 已证事实基线

**存储（`src-tauri/src/storage/mod.rs`）**

`SCHEMA`（L27–49）含四表：`schema_migrations(version INTEGER PK, applied_at INTEGER NOT NULL)`、`history(bvid TEXT PK, title/cover/owner TEXT NOT NULL, viewed_at INTEGER NOT NULL)`、`settings(key TEXT PK, value TEXT NOT NULL)`、`play_progress(bvid TEXT, cid INTEGER, position REAL, duration REAL, updated_at INTEGER, PK(bvid,cid))`。库文件 `data_dir/bilidesk.db`（`Storage::open` L75–91），目录来自 `commands/mod.rs:134 app.path().app_data_dir()`，标识符 `com.bilidesk.desktop`（`tauri.conf.json`），即 Windows 漫游 `%APPDATA%\com.bilidesk.desktop`。

- 迁移只有"版本行"语义：`HISTORY_MIGRATION_VERSION = 1` 仅用于 legacy `history.json`→SQLite；无 `user_version`、无列级演进。
- `push_history`(L187) 每插一行即 `DELETE ... LIMIT 100`；`save_progress`(L249) 门限 `position<5` 不存、`position>=duration-15` 删除、裁剪 SQL 以 `bvid NOT IN (... LIMIT 200)` 判断，故同一 bvid 多 cid 行可超出 200。
- 无事务、无 `PRAGMA journal_mode/busy_timeout/foreign_keys`；`import_history`(L117) 逐行 autocommit，失败可留半成品，但按 bvid upsert 幂等。
- `retire_legacy`(L123) 改名 `history.json`→`history.json.migrated`；改名失败则删除；测试 `reimports_migrated_file_when_database_is_recreated` 证明删库后会从 `.migrated` 重新导入。
- 时间统一 Unix 秒 `i64`（`commands/player.rs:289 now_secs`、`mark_migration`），无时区、无单调时钟。
- 设置默认 6 键（`ensure_default_settings` L154），白名单 12 键在命令层 `commands/settings.rs ALLOWED_KEYS`；存储层本身不校验。

**会话（`bili/session.rs`）**

文件 `session.json`，格式 = 魔法 `BILIDESK_SESSION_V1\0` + DPAPI 密文（L8、L84–92）。`CryptProtectData` 描述 `"BiliDesk session"`、**无 entropy**、`CRYPTPROTECT_UI_FORBIDDEN`。非 Windows 分支 `protect_session` 原样返回，**但仍写魔法头**（故 Linux 文件是"魔法+明文 JSON"）。`Session::load` 对无魔法旧文件按明文解析后自动重写加密。JSON 结构 `{"cookies":{...}}`。

## 2. 设计建议（含迁移/回滚）

**[议] Schema 迁移**：新库 `bilidesk-cs.db` 复用同名表/列，额外加 `PRAGMA user_version`（1 起）与显式 `schema_steps` 表；迁移步骤 = 备份→事务内 DDL+版本写入→校验计数→提交。历史/进度裁剪改为显式 `DELETE ... WHERE rowid NOT IN (SELECT rowid ... LIMIT n)` 并按 `(bvid,cid)` 计数，避免现有 bvid 维度偏差。**[议] 时间**：保留 Unix 秒以兼容旧值，新列（若加）用 `INTEGER` 毫秒并标注来源；禁止本地时区换算写入。**[议] 事务**：`SqliteConnection` 单写者队列（`Channel` 串行），`BeginTransaction` 包裹"插入+裁剪"；`busy_timeout` 与 WAL 需同备份策略一起决定（现有程序默认 rollback journal，切 WAL 会让旧程序看到 `-wal/-shm`，须并存期禁用）。**[议] 回滚**：导入只写影子库；失败/中断删除影子库，原 `bilidesk.db` 与 `session.json` 保持字节不变；`user_version` 高于本程序则拒绝打开而非降级写入。

**[验] DPAPI 同用户兼容**：C# `ProtectedData.Unprotect(payload, optionalEntropy: null, DataProtectionScope.CurrentUser)` 应能解 Rust 产物（`ProtectedData` 是对 `CryptProtectData` 的包装，描述字段不参与解密校验），但必须实测：①同用户同机往返；②旧明文文件；③Linux"魔法+明文"文件应解密失败→走扫码登录（**不得**静默降级为明文信任）；④另一用户/另一机器解密失败；⑤`LocalMachine` scope 明确禁止。注意解密失败与损坏要区分记录。

## 3. 安全与网络（已证问题）

- **[证] Cookie 无域隔离**：`session.rs:parse_cookie_pair` 只取首个 `name=value`，丢弃 `Domain/Path/Secure/HttpOnly/Expires`；`client.rs:capture_cookies` 把任意响应（含重定向链）的 `Set-Cookie` 合并进单一 HashMap；`headers()`(L120) 对每个请求注入**全量** Cookie，包括 `fetch_allowed_image`(L464)。`cookie_header` 顺序随 HashMap 变化。`clear_login` 只删本地 5 个键，不产生服务端过期。
- **[议]** Cookie 建模为 `(name, value, domain, path, secure, expires, hostOnly)`；仅 `*.bilibili.com` 接收/发送认证 Cookie；图床与媒体请求使用独立"匿名/最小"头集合；`Set-Cookie` 解析遵循 RFC6265（含 `Max-Age=0` 删除）；登出同时清 WBI 键与内存会话。
- **[证] 限额缺失**：`read_decoded`(L1260) 先 `response.bytes()` 全量读入再解压；`inflate::try_decode` 用 `read_to_end` 无上限（解压炸弹）；仅图片在**解码后**检查 `8MB`。JSON/文本、弹幕 XML 均无限额。
- **[议]** 分层限额：连接/首字节/整体 deadline；`Content-Length` 预检 + 流式累计（压缩前 2MB、解压后文本 8MB、弹幕 32MB、图片 8MB，超限即 `ResponseHeadersRead` 中断并丢弃）；解压器用 `Take(limit)` 包裹。
- **[证] 无超时/取消**：`BiliClient::new`(L64–69) 仅设 `gzip/brotli/deflate(false)`，未设 `timeout/connect_timeout`；Tauri 命令层无 `CancellationToken` 传递。
- **[议]** `HttpClient.Timeout` 全局 15s + 每请求 `CancellationTokenSource`；播放会话带 `session_id`，过期结果丢弃；写操作（投币/三连/评论/关注）超时后标记"结果未知"，**不自动重试**；GET 允许按 `-352/-412` 有界退避。
- **[议] 重定向**：`fetch_allowed_image` 校验初始与最终 host，但中间跳转不受控（reqwest 默认最多 10 跳，且不校验 scheme 降级）。改为 `AllowRedirects.None` 后手动跳转 ≤2 次、每跳校验 https + `is_allowed_host`。
- **[证] 日志**：`src-tauri/src` 无 `println!/log::/tracing::`；`SECURITY.md` 明确日志/截图不得含 Cookie、二维码 key、用户标识。
- **[议] 安全日志**：结构化事件只记 `event/code/http_status/elapsed_ms/session_id`，Cookie、`SESSDATA`、`bili_jct`、二维码 key、`DedeUserID` 一律脱敏（`SECURITY.md` 边界）；`BiliError` 消息保持现有中文可读性但截断 180 字符（`client.rs:truncate`）不引入响应体敏感片段。

## 4. 会话原子写

**[证]** 现状 `fs::write(path, output)` 直接覆盖，崩溃可留半截密文；`load` 对坏文件返回错误（未隔离）。**[议]** 写 `session.json.tmp` → `FlushFileBuffers` → `File.Replace(..., backup: session.json.bak)`；读失败时改名 `.corrupt` 并回退扫码登录，绝不阻止启动；`session.json` 只在单一进程内写，配命名互斥量。

## 5. API 契约测试

**[证]** 现有测试为内联 `json!` 样本（`client.rs` `parse_card_from_rcmd_fixture`、`parse_dynamic_card_from_polymer_object_modules`、`media.rs` host 用例、`session.rs` Set-Cookie 用例、`storage/mod.rs` 迁移用例）；`grep fixtures|include_str!` **无结果**，即当前无 golden fixture 目录。
**[议]** 建 `tests/fixtures/api/*.json`（含真实响应字段裁剪、`code` 变体 `0/-101/-352/-404/62002`）、`wbi/*.json` 签名用例、`set-cookie/*.txt`、`session/*.bin`（DPAPI 密文由 Windows 测试生成，不入库凭据）。契约断言：字段路径、`check_code` 映射、编码（raw deflate 优先、再 zlib）、Cookie 属性、限额触发、取消后无写入。

## 6. 许可与并存

**[证]** 根 `LICENSE` MIT；`Cargo.toml license = "MIT"`；`THIRD_PARTY.md` 固定 libmpv LGPL 构建 `2026-08-21-49418246f3` 及 SHA-256，动态加载、允许替换 DLL，随包 `licenses/LGPL-2.1|3.0|GPL-3.0.txt`。**[议]** C# 依赖记录到 `THIRD_PARTY.md`：`Microsoft.Data.Sqlite`(MIT)、`System.Security.Cryptography.ProtectedData`(MIT)、`CommunityToolkit.Mvvm`(MIT)、xUnit(Apache-2.0)；不静态链接 libmpv；不扩大 MIT 解释覆盖原生组件。
**[议] 并存策略**：新程序用独立标识目录（如 `com.bilidesk.desktop.next`）与独立库文件；首次启动显式"导入旧数据"（复制 `bilidesk.db` + 解密 `session.json`），导入后旧目录只读；启动时检查旧进程锁（`bilidesk.db-journal`/`-wal` 存在或命名互斥量被占）则拒绝写入并提示关闭旧客户端。

## 7. 验收矩阵（Windows 真机）

| # | 用例 | 通过判据 | 级别 |
|---|---|---|---|
| 1 | 旧库只读打开+影子导入 | 100 条历史/进度计数、`viewed_at` 秒值一致 | 阻断 |
| 2 | `user_version` 降级保护 | 高版本库拒绝写、原文件哈希不变 | 阻断 |
| 3 | 导入中断回滚 | 影子库删除、旧库哈希不变 | 阻断 |
| 4 | DPAPI 同用户往返 | `ProtectedData.Unprotect` 成功且 Cookie 集合一致 | 阻断 |
| 5 | DPAPI 跨用户/跨机 | 失败并降级扫码，不抛未处理异常 | 阻断 |
| 6 | 明文/魔法+明文 legacy | 前者迁移加密、后者拒绝信任 | 高 |
| 7 | Cookie 域隔离 | 非 `bilibili.com` 响应无法写入 `SESSDATA`；图床请求无认证 Cookie | 阻断 |
| 8 | 解压炸弹/超大响应 | 在累计字节处中止，内存不随输入线性增长 | 高 |
| 9 | 超时与取消 | 15s 内返回；取消后无 DB 写入 | 高 |
| 10 | 会话原子写 | 断电模拟下文件可解析或回退 `.bak` | 高 |
| 11 | 日志脱敏 | 全流程日志无 Cookie/token 子串 | 阻断 |
| 12 | 契约 fixture 全绿 | 解析/错误码/编码用例 0 失败 | 高 |
| 13 | 许可清单 | 依赖与 libmpv 哈希、许可证文件齐全 | 中 |

## 8. 失败/回退策略

导入失败 → 保留旧数据、提示"稍后重试"；解密失败 → 清内存会话、进扫码；库损坏 → `.corrupt` 隔离 + 空库启动（不删原文件）；限额/超时 → 占位图与可重试错误（`media.rs` 占位 PNG）；旧版残留 → 检测到则只读模式。**任何回退都不得写旧 `bilidesk.db`/`session.json`。**

## 9. 未决问题

1. `app_data_dir()` 在 Windows 的精确目录名（标识符 vs 产品名）需实机确认。
2. reqwest 跨主机重定向是否剥离自定义 `Cookie` 头：行为随版本变化，须实测后决定是否禁用自动重定向。
3. `ProtectedData` 对无描述字段密文的兼容性需真机往返（**[验]**）。
4. 旧程序是否可能在运行中重写 `session.json`（`capture_cookies` 每次响应后 `persist`），并行期冲突窗口需观测。
5. 进度裁剪 200 条的语义（bvid 去重 vs `(bvid,cid)` 行数）应作为兼容决策，需产品确认。
6. WAL 与旧程序并存、备份/迁移窗口的最终取舍未定。
