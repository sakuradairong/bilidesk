using BiliDesk.Core.Playback;

namespace BiliDesk.Core.Tests.Playback;

/// <summary>用 TCS 驱动的假后端，不涉及任何 native 资源。</summary>
internal sealed class FakePlaybackBackend : IPlaybackBackend
{
    private readonly TaskCompletionSource _stopGate = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource _stopStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly Action<PlaybackSessionId>? _onStop;
    private int _stopCalls;
    private int _disposeCalls;

    public FakePlaybackBackend(PlaybackSessionId sessionId, Action<PlaybackSessionId>? onStop = null)
    {
        SessionId = sessionId;
        _onStop = onStop;
    }

    public PlaybackSessionId SessionId { get; }

    /// <summary>为 true 时 StopAsync 挂起，直到测试调用 <see cref="CompleteStop"/>。</summary>
    public bool BlockStop { get; set; }

    /// <summary>为 true 时 StopAsync 同步抛出异常。</summary>
    public bool ThrowOnStop { get; set; }

    public int StopCalls => Volatile.Read(ref _stopCalls);

    public int DisposeCalls => Volatile.Read(ref _disposeCalls);

    public Task StopStarted => _stopStarted.Task;

    public Task StopAsync(CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref _stopCalls);
        _onStop?.Invoke(SessionId);
        _stopStarted.TrySetResult();

        if (ThrowOnStop)
        {
            throw new InvalidOperationException($"fake stop failure: {SessionId}");
        }

        return BlockStop ? _stopGate.Task : Task.CompletedTask;
    }

    public void CompleteStop() => _stopGate.TrySetResult();

    public ValueTask DisposeAsync()
    {
        Interlocked.Increment(ref _disposeCalls);
        return ValueTask.CompletedTask;
    }
}

/// <summary>记录创建/停止顺序的假工厂。</summary>
internal sealed class FakePlaybackBackendFactory : IPlaybackBackendFactory
{
    private readonly object _sync = new();
    private readonly List<FakePlaybackBackend> _created = new();
    private readonly List<PlaybackSessionContext> _contexts = new();
    private readonly List<string> _log = new();
    private readonly TaskCompletionSource<PlaybackSessionId> _firstCreateStarted =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>可选的创建挂钩，用于阻塞或模拟创建失败。</summary>
    public Func<PlaybackSessionContext, FakePlaybackBackend, CancellationToken, Task<IPlaybackBackend>>? Handler { get; set; }

    public Task<PlaybackSessionId> FirstCreateStarted => _firstCreateStarted.Task;

    public IReadOnlyList<FakePlaybackBackend> Created
    {
        get
        {
            lock (_sync)
            {
                return _created.ToArray();
            }
        }
    }

    public IReadOnlyList<string> LogSnapshot()
    {
        lock (_sync)
        {
            return _log.ToArray();
        }
    }

    public FakePlaybackBackend? Find(PlaybackSessionId sessionId)
    {
        lock (_sync)
        {
            foreach (var backend in _created)
            {
                if (backend.SessionId == sessionId)
                {
                    return backend;
                }
            }
        }

        return null;
    }

    public IPlaybackEventSink SinkFor(PlaybackSessionId sessionId)
    {
        lock (_sync)
        {
            foreach (var context in _contexts)
            {
                if (context.SessionId == sessionId)
                {
                    return context.Events;
                }
            }
        }

        throw new InvalidOperationException($"未找到会话 {sessionId} 的事件接收器。");
    }

    public async Task<IPlaybackBackend> CreateAsync(
        PlaybackSessionContext context,
        CancellationToken cancellationToken)
    {
        var backend = new FakePlaybackBackend(
            context.SessionId,
            id =>
            {
                lock (_sync)
                {
                    _log.Add($"stop:{id.Value}");
                }
            });

        lock (_sync)
        {
            _created.Add(backend);
            _contexts.Add(context);
            _log.Add($"create:{context.SessionId.Value}");
        }

        _firstCreateStarted.TrySetResult(context.SessionId);

        var handler = Handler;
        if (handler is null)
        {
            return backend;
        }

        return await handler(context, backend, cancellationToken);
    }
}

/// <summary>手动时间源：DelayAsync 只在测试显式调用 <see cref="Elapse"/> 时完成。</summary>
internal sealed class ManualPlaybackTimeProvider : IPlaybackTimeProvider
{
    private readonly object _sync = new();
    private readonly List<PendingDelay> _pending = new();
    private readonly List<TimeSpan> _requested = new();

    public DateTimeOffset UtcNow { get; set; } = DateTimeOffset.UnixEpoch;

    public IReadOnlyList<TimeSpan> RequestedDelays
    {
        get
        {
            lock (_sync)
            {
                return _requested.ToArray();
            }
        }
    }

    public int PendingCount
    {
        get
        {
            lock (_sync)
            {
                return _pending.Count;
            }
        }
    }

    public Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken)
    {
        var pending = new PendingDelay();
        lock (_sync)
        {
            _pending.Add(pending);
            _requested.Add(delay);
        }

        if (cancellationToken.CanBeCanceled)
        {
            pending.Registration = cancellationToken.Register(
                static state => ((PendingDelay)state!).Cancel(),
                pending);
        }

        return pending.Source.Task;
    }

    /// <summary>完成当前所有等待；返回是否有等待被完成。</summary>
    public bool Elapse()
    {
        PendingDelay[] pending;
        lock (_sync)
        {
            if (_pending.Count == 0)
            {
                return false;
            }

            pending = _pending.ToArray();
            _pending.Clear();
        }

        foreach (var item in pending)
        {
            item.Complete();
        }

        return true;
    }

    private sealed class PendingDelay
    {
        public TaskCompletionSource Source { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public CancellationTokenRegistration Registration { get; set; }

        public void Complete()
        {
            Registration.Dispose();
            Source.TrySetResult();
        }

        public void Cancel() => Source.TrySetCanceled();
    }
}

/// <summary>避免在测试方法里直接写阻塞 API（xUnit1031）。</summary>
internal static class Blocking
{
    public static void Await(Task task) => task.GetAwaiter().GetResult();
}
