# C# 首批实施状态

## 本批交付

代码入口：[csharp/README.md](../../csharp/README.md)。现有 Rust/React 业务、正式发布链路和旧用户数据未被本批实现改写。

| 任务 | 交付 | 状态 / 限制 |
| --- | --- | --- |
| D01 / M0 | 四个生产工程、三个测试工程；完整/portable 两份 `.slnx`；SDK/中央包版本/七份 lock；独立 CI | 本机 locked restore 通过；Windows WinUI 构建尚未执行成功，M0 出口未全部通过 |
| D03 | fake/native seam、单会话协调、session/revision、乱序与旧事件过滤、停止与释放预算 | 纯逻辑通过；不是 MPV adapter，不包含完整播放意图/连播/续播 |
| D05 | 旧 SQLite 只读 BackupDatabase 快照→暂存校验→首次发布；WAL、schema、精度、未知设置保留测试 | 基础导入通过；无 UI/会话导入/旧 JSON 导入；要求旧客户端关闭 |
| D07 | GET-only HTTPS/host/逐跳重定向、Cookie 隔离、原始及解压限额、取消与超时 | fake HTTP 测试通过；未连接真实 B 站端点或 WBI，尚无 API/CDN 生产域名策略 |
| D06 部分 | DPAPI CurrentUser + 旧 magic envelope、拒绝明文/损坏/超限测试 | Windows 测试项目跨编译通过；没有运行 DPAPI 测试，也没有 Rust→C# 真机 fixture |
| D02 / D04 / D08 | 尚未引入 MPV 包或宿主 | 仍需依赖准入、Windows 播放探针和窗口策略评审 |

## 并行实现记录

实际响应模型均核对为 `openai-codex-ext/deepseek-v4.1-flash-1017`：

- 播放协调：14 次 write/edit 工具调用。
- SQLite 导入：9 次 write/edit 工具调用。
- HTTP 安全：22 次 write/edit 工具调用。

三个子代理分别限定在 Playback、Storage、Networking 的源码/测试目录，只开放读取与文本编辑工具，不允许 shell、git、改工程/锁文件或再派生代理。主代理负责工程、WinUI 外壳、DPAPI、依赖和 CI。

**三项均达到 600 秒执行上限并终止，没有正常完成回执。** 所以不将子代理输出认定为完成验收；主代理接手了已写文件，审查并运行测试后修复问题。原始日志和 timeout receipts 在本机 `/tmp/bilidesk-csharp-implementation-agents/`，可能清理；不提交整份模型会话或环境配置。

已修复并通过回归验证：

1. SQLite `PRAGMA table_info` 把 cid/name/type/pk 列索引读错，导致合法旧库被拒绝。
2. 预先取消的 HTTP 请求仍进入 fake handler；现在每次发请求前检查取消。
3. 后端 Dispose 异常被吞掉却宣称 Stopped；现在保留 owner、进入 Faulted、拒绝重开。
4. 用户取消 token 传入 native teardown；现在请求取消与清理预算隔离。
5. 停止超时后重发 Stop 可能重入；现在复用同一在途任务，不发第二次并发停止。
6. 异步 Dispose 未受预算限制；现在与 Stop 共用清理时间预算，未确认释放不清空 owner。
7. EOF 未带入最终时长、停止中旧 EOF 可触发陈旧终态；增加终态数据处理、状态与 generation 过滤。
8. 排队 Open/Stop 在 Dispose 后仍可能继续执行；获取串行 gate 后再次检查已释放状态。

工厂必须保证“失败不泄漏资源”；真正 native adapter 要验证此契约。协调器不能安全强杀 native 死锁，也不能让忽略取消且永不返回的工厂自动释放资源；这些仍是 M1 的强制验收点，不用 fake 通过替代。

## 本机验证证据

| 检查 | 结果 |
| --- | --- |
| 完整 solution `dotnet restore --locked-mode` | 通过 |
| Core Release 测试 | 27 通过，0 失败，0 跳过 |
| Infrastructure Release 测试 | 95 通过，0 失败，0 跳过 |
| 合计跨平台测试 | **122 通过** |
| portable `dotnet format --verify-no-changes --no-restore` | 通过 |
| Windows 测试项目 Release 跨目标编译 | 通过，0 warning / 0 error；未执行测试 |
| NuGet 全依赖已知漏洞查询 | SQLite 升级后当前源未发现漏洞，不代表完整安全审计 |
| WinUI App Linux 编译 | **失败，XamlCompiler.exe exec format error / MSB3073，退出 126** |
| LSP 主动诊断 | C# language server 未回答，5 个路径不确定；不能宣称 LSP clean |

辅助 Semgrep 在导入器两个私有 SQL helper 的 `CommandText = sql` 处报警。主代理核查了全部调用，输入均来自固定语句/固定表名 switch，不包含外部路径或用户 SQL；按当前代码作为保守误报记录，不做全局 suppression。后续修改 helper 调用者必须重新核查。

NuGet 起初选用 SQLite `10.0.0`，漏洞查询发现传递原生包 `2.1.11` 的 High `GHSA-2m69-gcr7-jv3q`；已升级 `Microsoft.Data.Sqlite` 为 `10.0.13`、传递 SQLitePCLRaw `2.1.13` 并刷新所有受影响锁文件。

本机日志：`/tmp/bilidesk-csharp-{locked-restore-final,tests-final,format-final,windows-tests-compile-final,windows-build-probe,dependency-audit-final}.log`；测试 TRX 在 `csharp/tests/*/TestResults/`（均不提交）。CI 将保存其实际运行产物。

## 下一道门禁

1. 在受信 Windows runner 执行新的 `CSharp preview` 工作流，验证 WinUI 完整编译与六项 Windows 平台测试。工作流已写入但本轮未 push/远程触发，不能声称 CI 已绿。
2. 检查 Windows 锁文件是否发生平台差异；如有，以明确的依赖 PR 修订，不能关闭 locked-mode。
3. 建立 Rust 产生合成 DPAPI 会话→C# 解密的真机实验，补充原子写与完整迁移入口。
4. 完成 D02 固定 MPV/native 许可准入，进入 D04 本地合法视频/ASS/窗口探针。
5. M1 真机通过并评审窗口策略前，不开始全量页面迁移、不替换默认安装通道。
