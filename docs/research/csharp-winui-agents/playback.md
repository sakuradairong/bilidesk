# BiliDesk C# 播放器方案研究（只读）

## 一、已证事实（源码现状，Rust 参考实现）

1. **单一全局播放器**：`AppState.player: Mutex<PlayerHost>`（`src-tauri/src/commands/mod.rs`）。Standard/Featured 两个 `PlayerScope` 共用同一实例，仅靠 `PlayerRequests::begin` 在 scope 变化时 `stop()`。因此不存在真正的多窗口并发播放。
2. **generation 只覆盖"打开前"**：`PlayerRequests::begin/is_current/cancel` 是 `u64` 自增 + `Option<PlayerScope>`，仅在校验点 `ensure_player_request` 生效；`player_open`（`commands/player.rs`）在 detail/streams/ASS/headers 各阶段插桩，但 `spawn_blocking` 内 `player.open()` 返回后仍有一次校验，失败则 `stop()`。
3. **事件无 session 标识**：`mpv::run`/`event_loop` 通过 `app.emit("player-progress", PlayerProgress)`、`"player-ended"`、`"player-error"` 广播；`PlayerProgress`（`player.rs`）只有 `time/duration/paused/volume`。前端 `PlayerPage.tsx` 的 `listen` 直接 `setProgress`，无法区分新旧会话。
4. **停止超时后资源被弃管**：`PlayerHost::stop` → `shutdown_worker(2s)`。超时分支只置 `embed=None / window=None`（不销毁 HWND），`JoinHandle` 被丢弃（线程 detach），`tx` 已 `take()` 导致**再也发不出 `Quit`**。随后 `open()` 会新建第二个 mpv 实例（`prepare_embed` 重新建 HWND），旧 worker 仍可能持有 D3D11/音频设备并继续 emit 事件。
5. **mpv 已是"函数表"形态**：`mpv.rs` 的 `Api` 用 `libloading` 载入 10 个符号，`prepare_session` 设置 `wid/vo=gpu/gpu-context=d3d11/hwdec=auto/http-header-fields`，`event_loop` 用 `wait_event(0.05)` 轮询 + `Receiver::try_recv` 收命令。这是最干净的替换 seam。
6. **DASH 音轨后置**：视频 `loadfile ... replace`，`MPV_EVENT_FILE_LOADED` 后发 `audio-add` 与 `sub-add`（ASS），`tracks_added` 保证只做一次。
7. **舞台是纯占位 DOM**：`PlayerPage.tsx` 的 `.player-stage` 为空 div，控件在 `footer.player-controls`（`src/index.css`），因为原生 HWND 覆盖 WebView2 且 `WS_EX_TRANSPARENT|HTTRANSPARENT` 让点击穿透。
8. **边界换算单点**：`player_set_bounds` 每次用 `window.scale_factor()` 换算，`player.rs::css_to_physical`；`FeaturedPage.tsx` 用 `x=-2400` 隐藏播放窗。
9. **libmpv 已钉版本**：`THIRD_PARTY.md` 固定 `zhongfly/mpv-winbuild` release + SHA-256，`tauri.conf.json` 作为 resource 打包 `vendor/mpv/libmpv-2.dll`。

## 二、设计建议（C# / WinUI 3）

### 2.1 Session 与 generation

```csharp
sealed record PlaybackSessionId(ulong Generation, PlayerScope Scope);
interface IPlaybackCoordinator {
  PlaybackLease Begin(PlayerScope scope);            // 递增 generation，作废旧 lease
  bool IsCurrent(PlaybackSessionId id);              // 纯函数，无锁可测
  Task<PlaySession> OpenAsync(PlaybackLease lease, OpenRequest req, CancellationToken ct);
  Task StopAsync(PlayerScope scope);                 // 幂等
}
```

不变量：*任一时刻至多一个 `Active` 会话*；*每个事件携带 `SessionId`*（`PlaybackProgress(SessionId, …)`）；*UI 丢弃非当前 id 的事件*；*lease 校验在 await 边界后必须重做*（对应现有 `ensure_player_request` 的多点插桩）。建议把 generation 与设备所有权放在**同一把锁/同一 actor**下，消除现网 `player_requests` 与 `player` 两把锁的窗口。

### 2.2 停止超时与资源所有权（关键改造）

状态机：`Idle → Starting → Playing → Stopping → Idle | Orphaned`。

- 引入 `PlaybackResourceOwner`：持有 mpv 上下文、HWND、worker、CancellationToken，**唯一拥有销毁权**。
- `StopAsync` 顺序：`Quit` → 等待重放事件线程 `≤2s` → 仍超时则**不销毁 HWND 的所有权转移给该 worker**（worker 自己在 `Dispose` 时销毁），主线程仅记录 `Orphaned` 并在下一次 `OpenAsync` 前 `await` 其结束（硬上限如 5s 后报 `player-stop-timeout` 错误并拒绝新会话）。
- 禁止 detach-and-forget；`Orphaned` 期间新 `OpenAsync` 返回明确错误码而非静默并行双实例。

### 2.3 libmpv adapter 替换 seam

```csharp
interface IMpvNativeApi       // 1:1 函数表，可被 fake 实现
interface IMpvSession : IAsyncDisposable {
  Task InitializeAsync(MpvSessionConfig cfg, nint hwndHost, CancellationToken ct);
  Task LoadAsync(VideoStream video, AudioStream? audio, AssTrack? ass, CancellationToken ct);
  IDisposable Observe(MpvEventSink sink);        // 事件出口，带 SessionId
  Task CommandAsync(MpvCommand cmd, CancellationToken ct);
}
interface IPlaybackSurface { nint Handle { get; } void SetBounds(PhysicalRect r); void Hide(); }
```

`IMpvNativeApi` 用 `NativeLibrary`/`LibraryImport` 替代 `libloading`；`IMpvSession` 内保留"`wid` 必须在 `initialize` 前设置"这一顺序约束（`prepare_session` 已验证）。fake 实现可在 Linux CI 驱动 coordinator/event-gating 测试。

## 三、PoC 判据

**嵌入（Embedded）**：child HWND 覆盖舞台、点击穿透、控件区不被遮挡、缩放/DPI 变化 500ms 内跟随、`SetBounds` 无残留黑边。
**独立窗口（Backdrop/独立）**：顶层 `WS_EX_TOOLWINDOW|NOACTIVATE` 窗随主窗移动/最小化隐藏、多显示器 DPI 切换不撕裂、主窗焦点不被抢、任务栏/Alt-Tab 行为符合预期。
判定顺序：先嵌入（与现有行为等价，基线可比），独立窗口作为第二个切片。

## 四、ASS / DASH / 连播 / 续播

- **ASS**：`write_ass` 写 `%TEMP%/bilidesk-{cid}.ass`，无清理。C# 应写 `%LOCALAPPDATA%\BiliDesk\cache\ass\`，按会话生成、会话结束删除，保留"每会话一次 `sub-add` + `sub-visibility`"语义。
- **DASH**：建议用 `--audio-file`（load 时一次性应用）替代 `FILE_LOADED` 后 `audio-add`，减少音轨晚起；待验证（`--audio-file` 对 http URL 的支持）。`http-header-fields` 现只塞一条 `Cookie:`，含逗号会破坏分隔，需单独构造。
- **连播**：`nextTarget()`（同 P 优先、否则首个 related）与 5s 倒计时在 UI 层；建议下沉为 Core 纯函数 + `AutoAdvancePlan` 测试，UI 只渲染。
- **续播**：现策略 `position>10 && position<duration-15`，10s 节流保存，`ended` 时以 `duration` 落库触发"看完清除"。保留阈值但做成 Core 测试（fixture）。

## 五、最小可交付切片

1. **S0（Linux 可测）**：Core 的 `PlaybackSessionId/Lease/Coordinator` + 事件 id 过滤 + 续播/连播策略纯逻辑 + 单测。
2. **S1（Windows）**：`IMpvNativeApi` 实装 + `IMpvSession` + 嵌入 `IPlaybackSurface`，对齐现有 `prepare_session` 选项与 `event_loop` 语义。
3. **S2（Windows）**：停止超时/Orphaned 状态机与错误码；DPI 变化跟随。
4. **S3（Windows）**：独立窗口 PoC 与判据表。
回退：若 WinUI 3 子 HWND 合成出现 z-order/DPI 不可控，同 seam 切 WPF `HwndHost`，S0/S1 接口不变。

## 六、验收矩阵

| 项 | 判据 | Linux 可验 |
|---|---|---|
| generation | 交叉 open/stop 后无陈旧事件到达 UI | 是（fake） |
| 停止超时 | 2s 未退则 Orphaned，新 open 报错 | 是（fake） |
| 双实例 | 任意时序无并存 mpv | 是（fake） |
| DASH+ASS | 音画同步、弹幕可见可切 | 否 |
| 嵌入/独立窗 | 见 §3 判据 | 否 |
| DPI/焦点 | 跨屏拖动、无焦点抢占 | 否 |
| 续播/连播 | 阈值边界与状态清除 | 是 |

## 七、不能在 Linux 验收

HWND 合成与 z-order、D3D11/gpu-context、`hwdec`、libmpv DLL 加载与 PATH、DPI 感知与跨屏、焦点/激活策略、ASS 字形渲染、音频设备、安装包 resource 装配。`docs/development/linux-dotnet.md` 已证 WinUI 3 探针仅"还原失败"，**未进入 XAML 编译**，不得据此声称 WinUI 构建可行。

## 八、未决问题

1. WinUI 3 中舞台元素→屏幕物理坐标的换算链（`TransformToVisual` + `RasterizationScale`）是否在多 DPI 下稳定，待 Windows 实测。
2. 是否保留"单全局播放器"（当前语义）还是允许 Standard/Featured 并行；影响 `IMpvSession` 实例数与设备抢占。
3. `--audio-file` 与 `audio-add` 的实测差异（同步、seek 后重载）。
4. 事件频率：`time-pos` 每次变化 emit 是否需要在 adapter 内节流到 10Hz。
5. `stop` 超时上限取值（2s 是否覆盖慢磁盘/网络首帧）需实机数据。
6. libmpv 升级策略：`THIRD_PARTY.md` 固定哈希，C# 侧需同步维护校验与替换文档（沿用现有报告，不作扩大解释）。