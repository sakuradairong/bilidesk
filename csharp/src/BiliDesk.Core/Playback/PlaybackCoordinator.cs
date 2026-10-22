namespace BiliDesk.Core.Playback;

/// <summary>
/// 播放协调器：串行地拥有 native 会话的所有权。
///
/// 核心约束：
/// <list type="bullet">
/// <item>Open/Stop 通过同一个异步门串行执行，任何时刻最多一个 native 会话。</item>
/// <item>每次 Open 立刻获得单调递增的会话身份；更晚的请求会让更早的请求变成 Superseded，
///       更早请求已经创建出来的 backend 会被立即拆除，而不是发布为当前会话。</item>
/// <item>停止失败或超时会进入 Faulted 并保留 backend 引用，不假装资源已释放；
///       此时新的 Open 一律拒绝，只有成功重试 Stop 才能继续。</item>
/// <item>后端事件必须带会话身份；旧会话事件与旧 Stop 请求都不会影响新会话。</item>
/// <item>快照通知在内部锁之外触发，订阅回调可以安全地读取快照或再次调用协调器。</item>
/// </list>
/// </summary>
public sealed class PlaybackCoordinator : IAsyncDisposable
{
    private static readonly TimeSpan DefaultStopTimeout = TimeSpan.FromSeconds(2);

    private readonly IPlaybackBackendFactory _factory;
    private readonly IPlaybackTimeProvider _time;
    private readonly TimeSpan _stopTimeout;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly object _sync = new();
    private readonly Queue<PlaybackSnapshot> _pendingNotifications = new();

    private SessionEntry? _current;
    private PlaybackOpenRequest? _request;
    private PlaybackSessionId? _lastSessionId;
    private PlaybackState _state = PlaybackState.Idle;
    private double _positionSeconds;
    private double _durationSeconds;
    private bool _ended;
    private string? _message;
    private long _revision;
    private long _nextSessionValue;
    private long _latestRequestedSessionValue;
    private int _draining;
    private bool _disposed;

    public PlaybackCoordinator(
        IPlaybackBackendFactory factory,
        IPlaybackTimeProvider? timeProvider = null,
        TimeSpan? stopTimeout = null)
    {
        ArgumentNullException.ThrowIfNull(factory);
        var timeout = stopTimeout ?? DefaultStopTimeout;
        if (timeout <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(stopTimeout), "停止超时必须大于零。");
        }

        _factory = factory;
        _time = timeProvider ?? SystemPlaybackTimeProvider.Instance;
        _stopTimeout = timeout;
    }

    /// <summary>快照变更通知。回调在内部锁之外同步触发；回调抛出的异常会被吞掉，不影响协调器状态。</summary>
    public event Action<PlaybackSnapshot>? SnapshotChanged;

    public PlaybackSnapshot Snapshot
    {
        get
        {
            lock (_sync)
            {
                return BuildSnapshotLocked();
            }
        }
    }

    public PlaybackSessionId? CurrentSessionId
    {
        get
        {
            lock (_sync)
            {
                return _current?.Id;
            }
        }
    }

    /// <summary>
    /// 打开（或替换）播放会话。调用顺序决定结果：更晚调用的 Open 一定胜出，
    /// 更早的调用会得到 <see cref="PlaybackOpenStatus.Superseded"/>。
    /// </summary>
    public async Task<PlaybackOpenResult> OpenAsync(
        PlaybackOpenRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ThrowIfDisposed();

        // 身份在进入队列前分配，因此“先调用”的请求即使后完成也能被识别为旧请求。
        var sessionId = new PlaybackSessionId(Interlocked.Increment(ref _nextSessionValue));
        AdvanceLatestRequested(sessionId.Value);

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            return await OpenCoreAsync(request, sessionId, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
            DrainNotifications();
        }
    }

    /// <summary>停止当前会话。没有活跃会话时幂等成功。</summary>
    public Task<PlaybackStopResult> StopAsync(CancellationToken cancellationToken = default)
        => StopAsync(null, cancellationToken);

    /// <summary>
    /// 停止指定会话。若目标已被替换或已停止，返回
    /// <see cref="PlaybackStopStatus.NotCurrent"/> 且不触碰当前资源，
    /// 因此排队中的旧 Stop 不会杀掉新会话。
    /// </summary>
    public async Task<PlaybackStopResult> StopAsync(
        PlaybackSessionId? session,
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();

        PlaybackSessionId? target;
        lock (_sync)
        {
            target = session ?? _current?.Id;
        }

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            SessionEntry? entry;
            lock (_sync)
            {
                entry = _current;
            }

            if (entry is null)
            {
                return target is null
                    ? new PlaybackStopResult(PlaybackStopStatus.AlreadyIdle, Snapshot, null)
                    : new PlaybackStopResult(
                        PlaybackStopStatus.NotCurrent,
                        Snapshot,
                        "目标会话已经停止。");
            }

            if (target is not null && entry.Id != target.Value)
            {
                return new PlaybackStopResult(
                    PlaybackStopStatus.NotCurrent,
                    Snapshot,
                    "目标会话已被新的会话替换，未触碰当前资源。");
            }

            var release = await ReleaseAsync(entry, cancellationToken).ConfigureAwait(false);
            return release.Succeeded
                ? new PlaybackStopResult(PlaybackStopStatus.Stopped, Snapshot, null)
                : new PlaybackStopResult(PlaybackStopStatus.Failed, Snapshot, release.Message);
        }
        finally
        {
            _gate.Release();
            DrainNotifications();
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_disposed)
            {
                return;
            }

            var entry = _current;
            if (entry is not null)
            {
                // 尽力释放；失败时只能通过 Faulted 快照暴露，对象本身不再接受新操作。
                await ReleaseAsync(entry, CancellationToken.None).ConfigureAwait(false);
            }

            lock (_sync)
            {
                _disposed = true;
            }
        }
        finally
        {
            _gate.Release();
            DrainNotifications();
        }
    }

    private async Task<PlaybackOpenResult> OpenCoreAsync(
        PlaybackOpenRequest request,
        PlaybackSessionId sessionId,
        CancellationToken cancellationToken)
    {
        lock (_sync)
        {
            if (_state == PlaybackState.Faulted)
            {
                var message = _message ?? "上一次播放会话未能释放，拒绝创建新的 native 会话。";
                return new PlaybackOpenResult(
                    PlaybackOpenStatus.RejectedNotReleased,
                    sessionId,
                    BuildSnapshotLocked(),
                    message);
            }
        }

        if (!IsLatest(sessionId))
        {
            return Superseded(sessionId);
        }

        // 替换旧会话：必须先真正停止并释放旧 backend，否则不创建新的 native 会话。
        var existing = _current;
        if (existing is not null)
        {
            var release = await ReleaseAsync(existing, cancellationToken).ConfigureAwait(false);
            if (!release.Succeeded)
            {
                return new PlaybackOpenResult(
                    PlaybackOpenStatus.RejectedNotReleased,
                    sessionId,
                    Snapshot,
                    release.Message);
            }

            if (!IsLatest(sessionId))
            {
                return Superseded(sessionId);
            }
        }

        var entry = new SessionEntry(sessionId, request);
        lock (_sync)
        {
            _current = entry;
            _request = request;
            _lastSessionId = sessionId;
            _positionSeconds = 0;
            _durationSeconds = 0;
            _ended = false;
            _message = null;
            _state = PlaybackState.Opening;
            PublishLocked();
        }

        IPlaybackBackend backend;
        try
        {
            var context = new PlaybackSessionContext(
                sessionId,
                request,
                new SessionEventSink(this, sessionId));
            backend = await _factory.CreateAsync(context, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            ClearCurrent(sessionId, "打开播放会话已取消。");
            throw;
        }
        catch (Exception ex)
        {
            ClearCurrent(sessionId, ex.Message);
            return new PlaybackOpenResult(PlaybackOpenStatus.Failed, sessionId, Snapshot, ex.Message);
        }

        lock (_sync)
        {
            if (_current?.Id == sessionId)
            {
                _current.Backend = backend;
            }
        }

        // 创建期间可能有更晚的 Open 进入：此时立刻拆除刚创建的会话，绝不发布为当前会话。
        if (!IsLatest(sessionId))
        {
            var release = await ReleaseAsync(entry, cancellationToken).ConfigureAwait(false);
            return release.Succeeded
                ? Superseded(sessionId)
                : new PlaybackOpenResult(
                    PlaybackOpenStatus.RejectedNotReleased,
                    sessionId,
                    Snapshot,
                    release.Message);
        }

        lock (_sync)
        {
            if (_current?.Id == sessionId)
            {
                _state = PlaybackState.Playing;
                _message = null;
                PublishLocked();
            }
        }

        return new PlaybackOpenResult(PlaybackOpenStatus.Opened, sessionId, Snapshot, null);
    }

    /// <summary>
    /// 释放一个会话。成功返回表示 backend 已停止并清理；失败或超时会把状态置为 Faulted
    /// 并保留 <see cref="_current"/>，等待重试。
    /// </summary>
    private async Task<ReleaseOutcome> ReleaseAsync(SessionEntry entry, CancellationToken cancellationToken)
    {
        var backend = entry.Backend;
        if (backend is null)
        {
            ClearCurrent(entry.Id, null);
            return new ReleaseOutcome(true, null);
        }

        lock (_sync)
        {
            if (_current?.Id != entry.Id)
            {
                return new ReleaseOutcome(true, null);
            }

            _state = PlaybackState.Stopping;
            _message = null;
            PublishLocked();
        }

        // Once teardown owns the backend, caller cancellation must not abandon it.
        using var timeoutCts = new CancellationTokenSource();

        Task stopTask;
        try
        {
            stopTask = entry.StopTask ??= backend.StopAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            timeoutCts.Cancel();
            return Fault(entry.Id, $"停止播放会话失败: {ex.Message}");
        }

        Task timeoutTask;
        try
        {
            timeoutTask = _time.DelayAsync(_stopTimeout, timeoutCts.Token);
        }
        catch (Exception)
        {
            timeoutTask = Task.CompletedTask;
        }

        var completed = await Task.WhenAny(stopTask, timeoutTask).ConfigureAwait(false);
        if (!ReferenceEquals(completed, stopTask))
        {
            // 超时：不能再等待 stop，也不能假装资源已释放。
            Observe(stopTask);
            timeoutCts.Cancel();
            return Fault(
                entry.Id,
                $"停止播放会话超时（{_stopTimeout.TotalSeconds:0.###}s），native 资源可能仍在使用。");
        }

        try
        {
            await stopTask.ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            timeoutCts.Cancel();
            return Fault(entry.Id, $"停止播放会话失败: {ex.Message}");
        }

        try
        {
            var disposal = entry.DisposalTask ??= backend.DisposeAsync().AsTask();
            if (!ReferenceEquals(await Task.WhenAny(disposal, timeoutTask).ConfigureAwait(false), disposal))
            {
                Observe(disposal);
                return Fault(entry.Id, "释放播放会话超时，资源仍由当前会话持有。");
            }

            await disposal.ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            return Fault(entry.Id, $"释放播放会话失败: {ex.Message}");
        }
        finally
        {
            timeoutCts.Cancel();
        }

        lock (_sync)
        {
            if (_current?.Id == entry.Id)
            {
                _current = null;
                _state = PlaybackState.Idle;
                _message = null;
                _lastSessionId = entry.Id;
                PublishLocked();
            }
        }

        return new ReleaseOutcome(true, null);
    }

    private ReleaseOutcome Fault(PlaybackSessionId sessionId, string message)
    {
        lock (_sync)
        {
            if (_current?.Id == sessionId)
            {
                _state = PlaybackState.Faulted;
                _message = message;
                _lastSessionId = sessionId;
                PublishLocked();
            }
        }

        return new ReleaseOutcome(false, message);
    }

    private void ClearCurrent(PlaybackSessionId sessionId, string? message)
    {
        lock (_sync)
        {
            if (_current?.Id != sessionId)
            {
                return;
            }

            _current = null;
            _lastSessionId = sessionId;
            _state = PlaybackState.Idle;
            _message = message;
            PublishLocked();
        }
    }

    private void OnBackendEvent(PlaybackSessionId expectedSession, PlaybackEvent playbackEvent)
    {
        if (playbackEvent.SessionId != expectedSession)
        {
            return;
        }

        lock (_sync)
        {
            if (_current?.Id != expectedSession || !IsLatest(expectedSession))
            {
                return;
            }

            if (_state is not (PlaybackState.Opening or PlaybackState.Playing))
            {
                return;
            }

            switch (playbackEvent.Kind)
            {
                case PlaybackEventKind.Opened:
                    return;
                case PlaybackEventKind.Progress:
                    if (!double.IsFinite(playbackEvent.PositionSeconds))
                    {
                        return;
                    }

                    _positionSeconds = Math.Max(0, playbackEvent.PositionSeconds);
                    if (double.IsFinite(playbackEvent.DurationSeconds) && playbackEvent.DurationSeconds > 0)
                    {
                        _durationSeconds = playbackEvent.DurationSeconds;
                    }

                    PublishLocked();
                    break;
                case PlaybackEventKind.EndOfFile:
                    if (_ended)
                    {
                        return;
                    }

                    _ended = true;
                    if (double.IsFinite(playbackEvent.DurationSeconds) && playbackEvent.DurationSeconds > 0)
                    {
                        _durationSeconds = playbackEvent.DurationSeconds;
                    }

                    if (_durationSeconds > 0)
                    {
                        _positionSeconds = _durationSeconds;
                    }

                    PublishLocked();
                    break;
                case PlaybackEventKind.Failed:
                    _message = string.IsNullOrWhiteSpace(playbackEvent.Message)
                        ? "播放后端报告错误。"
                        : playbackEvent.Message;
                    PublishLocked();
                    break;
                default:
                    return;
            }
        }

        DrainNotifications();
    }

    private void PublishLocked()
    {
        _revision++;
        _pendingNotifications.Enqueue(BuildSnapshotLocked());
    }

    private PlaybackSnapshot BuildSnapshotLocked()
        => new(
            _current?.Id ?? _lastSessionId,
            _state,
            _request,
            _positionSeconds,
            _durationSeconds,
            _ended,
            _message,
            _revision);

    /// <summary>
    /// 在内部锁之外按入队顺序派发快照。同一时刻只有一个线程派发；
    /// 派发期间新入队的通知由当前派发者收尾，避免丢失。
    /// </summary>
    private void DrainNotifications()
    {
        while (true)
        {
            if (Interlocked.CompareExchange(ref _draining, 1, 0) != 0)
            {
                return;
            }

            try
            {
                while (true)
                {
                    PlaybackSnapshot next;
                    lock (_sync)
                    {
                        if (_pendingNotifications.Count == 0)
                        {
                            break;
                        }

                        next = _pendingNotifications.Dequeue();
                    }

                    RaiseSnapshotChanged(next);
                }
            }
            finally
            {
                Volatile.Write(ref _draining, 0);
            }

            lock (_sync)
            {
                if (_pendingNotifications.Count == 0)
                {
                    return;
                }
            }
        }
    }

    private void RaiseSnapshotChanged(PlaybackSnapshot snapshot)
    {
        var handler = SnapshotChanged;
        if (handler is null)
        {
            return;
        }

        foreach (var subscriber in handler.GetInvocationList())
        {
            try
            {
                ((Action<PlaybackSnapshot>)subscriber)(snapshot);
            }
            catch (Exception)
            {
                // 订阅方异常不能破坏协调器状态，也不能阻断其他订阅方。
            }
        }
    }

    private void AdvanceLatestRequested(long sessionValue)
    {
        long current;
        while ((current = Volatile.Read(ref _latestRequestedSessionValue)) < sessionValue)
        {
            if (Interlocked.CompareExchange(ref _latestRequestedSessionValue, sessionValue, current) == current)
            {
                return;
            }
        }
    }

    private bool IsLatest(PlaybackSessionId sessionId)
        => Volatile.Read(ref _latestRequestedSessionValue) <= sessionId.Value;

    private PlaybackOpenResult Superseded(PlaybackSessionId sessionId)
        => new(
            PlaybackOpenStatus.Superseded,
            sessionId,
            Snapshot,
            "已被更新的打开请求取代。");

    private void ThrowIfDisposed()
    {
        lock (_sync)
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(nameof(PlaybackCoordinator));
            }
        }
    }

    private static void Observe(Task task)
    {
        _ = task.ContinueWith(
            static completed => _ = completed.Exception,
            CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
    }

    private sealed class SessionEntry
    {
        public SessionEntry(PlaybackSessionId id, PlaybackOpenRequest request)
        {
            Id = id;
            Request = request;
        }

        public PlaybackSessionId Id { get; }

        public PlaybackOpenRequest Request { get; }

        public IPlaybackBackend? Backend { get; set; }

        public Task? StopTask { get; set; }

        public Task? DisposalTask { get; set; }
    }

    private sealed class SessionEventSink : IPlaybackEventSink
    {
        private readonly PlaybackCoordinator _owner;
        private readonly PlaybackSessionId _sessionId;

        public SessionEventSink(PlaybackCoordinator owner, PlaybackSessionId sessionId)
        {
            _owner = owner;
            _sessionId = sessionId;
        }

        public void Publish(PlaybackEvent playbackEvent)
        {
            ArgumentNullException.ThrowIfNull(playbackEvent);
            _owner.OnBackendEvent(_sessionId, playbackEvent);
        }
    }

    private readonly record struct ReleaseOutcome(bool Succeeded, string? Message);
}
