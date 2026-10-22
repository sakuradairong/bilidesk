using BiliDesk.Core.Playback;

namespace BiliDesk.Core.Tests.Playback;

public sealed class PlaybackCoordinatorTests
{
    private static readonly TimeSpan GuardTimeout = TimeSpan.FromSeconds(5);

    private static PlaybackOpenRequest Request(string source = "https://example.invalid/a.m3u8")
        => new(source);

    private static PlaybackCoordinator Create(
        FakePlaybackBackendFactory factory,
        ManualPlaybackTimeProvider time,
        TimeSpan? stopTimeout = null)
        => new(factory, time, stopTimeout);

    [Fact]
    public void OpenRequest_RejectsBlankSource()
    {
        Assert.Throws<ArgumentException>(() => new PlaybackOpenRequest(" "));
    }

    [Fact]
    public async Task OpenAsync_PublishesOpeningThenPlaying()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);
        var notifications = new List<PlaybackSnapshot>();
        coordinator.SnapshotChanged += notifications.Add;

        var result = await coordinator.OpenAsync(Request());

        Assert.True(result.Succeeded);
        Assert.Equal(PlaybackOpenStatus.Opened, result.Status);
        Assert.Equal(PlaybackState.Playing, coordinator.Snapshot.State);
        Assert.Equal(result.SessionId, coordinator.CurrentSessionId);
        Assert.NotNull(factory.Find(result.SessionId));
        Assert.Equal(
            new[] { PlaybackState.Opening, PlaybackState.Playing },
            notifications.Select(snapshot => snapshot.State).ToArray());
        Assert.Equal(Request().Source, coordinator.Snapshot.Request?.Source);
    }

    [Fact]
    public async Task OpenAsync_NullRequest_Throws()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        await Assert.ThrowsAsync<ArgumentNullException>(
            () => coordinator.OpenAsync(null!));
        Assert.Empty(factory.Created);
    }

    [Fact]
    public async Task OpenAsync_StopsPreviousSessionBeforeCreatingNext()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        var first = await coordinator.OpenAsync(Request("a"));
        var second = await coordinator.OpenAsync(Request("b"));

        Assert.True(first.Succeeded);
        Assert.True(second.Succeeded);
        Assert.NotEqual(first.SessionId, second.SessionId);
        Assert.Equal(
            new[]
            {
                $"create:{first.SessionId.Value}",
                $"stop:{first.SessionId.Value}",
                $"create:{second.SessionId.Value}",
            },
            factory.LogSnapshot());

        var firstBackend = factory.Find(first.SessionId);
        var secondBackend = factory.Find(second.SessionId);
        Assert.NotNull(firstBackend);
        Assert.NotNull(secondBackend);
        Assert.Equal(1, firstBackend.StopCalls);
        Assert.Equal(0, secondBackend.StopCalls);
        Assert.Equal(1, firstBackend.DisposeCalls);
        Assert.Equal(second.SessionId, coordinator.CurrentSessionId);
        Assert.Equal(PlaybackState.Playing, coordinator.Snapshot.State);
    }

    [Fact]
    public async Task OpenAsync_LaterRequestWins_AndEarlierCreationIsTornDown()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        var releaseFirstCreate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var createCalls = 0;

        factory.Handler = async (context, backend, cancellationToken) =>
        {
            if (Interlocked.Increment(ref createCalls) == 1)
            {
                // 第一个请求卡在创建阶段，期间第二个请求进入。
                await releaseFirstCreate.Task.WaitAsync(cancellationToken);
            }

            return backend;
        };

        await using var coordinator = Create(factory, time);

        var openFirst = coordinator.OpenAsync(Request("a"));
        var firstSession = await factory.FirstCreateStarted.WaitAsync(GuardTimeout);
        var openSecond = coordinator.OpenAsync(Request("b"));
        releaseFirstCreate.SetResult();

        var results = await Task.WhenAll(openFirst, openSecond);

        Assert.Equal(PlaybackOpenStatus.Superseded, results[0].Status);
        Assert.Equal(PlaybackOpenStatus.Opened, results[1].Status);
        Assert.NotEqual(firstSession, results[1].SessionId);
        Assert.Equal(PlaybackState.Playing, coordinator.Snapshot.State);
        Assert.Equal(results[1].SessionId, coordinator.CurrentSessionId);

        var supersededBackend = factory.Find(firstSession);
        Assert.NotNull(supersededBackend);
        Assert.Equal(1, supersededBackend.StopCalls);
        Assert.Equal(1, supersededBackend.DisposeCalls);

        // 被取代的会话即使还能发事件，也不能污染新会话的快照。
        factory.SinkFor(firstSession).Publish(
            new PlaybackEvent(firstSession, PlaybackEventKind.Progress, 42, 100));
        Assert.Equal(0d, coordinator.Snapshot.PositionSeconds);
        Assert.False(coordinator.Snapshot.Ended);
    }

    [Fact]
    public async Task OpenAsync_CanceledDuringCreation_LeavesIdleAndAllowsReopen()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        var releaseCreate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        // 创建阶段被取消：工厂未返回 backend，协调器直接回到 Idle。
        factory.Handler = async (context, backend, cancellationToken) =>
        {
            await releaseCreate.Task.WaitAsync(cancellationToken);
            return backend;
        };

        await using var coordinator = Create(factory, time);
        using var cts = new CancellationTokenSource();

        var open = coordinator.OpenAsync(Request("a"), cts.Token);
        await factory.FirstCreateStarted.WaitAsync(GuardTimeout);
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => open);
        Assert.Equal(PlaybackState.Idle, coordinator.Snapshot.State);
        Assert.Null(coordinator.CurrentSessionId);

        factory.Handler = null;
        var reopened = await coordinator.OpenAsync(Request("b"));
        Assert.Equal(PlaybackOpenStatus.Opened, reopened.Status);
        Assert.Equal(PlaybackState.Playing, coordinator.Snapshot.State);
    }

    [Fact]
    public async Task StopAsync_IsIdempotent()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        var opened = await coordinator.OpenAsync(Request());
        var firstStop = await coordinator.StopAsync();
        var secondStop = await coordinator.StopAsync();

        Assert.Equal(PlaybackStopStatus.Stopped, firstStop.Status);
        Assert.Equal(PlaybackStopStatus.AlreadyIdle, secondStop.Status);
        Assert.Equal(PlaybackState.Idle, secondStop.Snapshot.State);
        Assert.Equal(opened.SessionId, coordinator.Snapshot.SessionId);
        Assert.Null(coordinator.CurrentSessionId);

        var backend = factory.Find(opened.SessionId);
        Assert.NotNull(backend);
        Assert.Equal(1, backend.StopCalls);
        Assert.Equal(1, backend.DisposeCalls);
    }

    [Fact]
    public async Task StopAsync_ExplicitOldSession_DoesNotTouchReplacement()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        var first = await coordinator.OpenAsync(Request("a"));
        var second = await coordinator.OpenAsync(Request("b"));

        var stopOld = await coordinator.StopAsync(first.SessionId);

        Assert.Equal(PlaybackStopStatus.NotCurrent, stopOld.Status);
        Assert.Equal(second.SessionId, coordinator.CurrentSessionId);
        Assert.Equal(PlaybackState.Playing, coordinator.Snapshot.State);

        var secondBackend = factory.Find(second.SessionId);
        Assert.NotNull(secondBackend);
        Assert.Equal(0, secondBackend.StopCalls);
    }

    [Fact]
    public async Task SnapshotHandler_CanReadSnapshotAndStopWithoutDeadlock()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        var handled = 0;
        var stoppedInsideHandler = false;
        PlaybackSessionId? handledSession = null;

        coordinator.SnapshotChanged += snapshot =>
        {
            if (snapshot.State != PlaybackState.Playing)
            {
                return;
            }

            if (Interlocked.Increment(ref handled) != 1)
            {
                return;
            }

            handledSession = snapshot.SessionId;
            // 回调在内部锁之外执行，因此这里读快照、再停止都不会自锁。
            Assert.Equal(PlaybackState.Playing, coordinator.Snapshot.State);
            Blocking.Await(coordinator.StopAsync());
            stoppedInsideHandler = coordinator.Snapshot.State == PlaybackState.Idle;
        };

        var open = coordinator.OpenAsync(Request());
        var completed = await Task.WhenAny(open, Task.Delay(GuardTimeout));
        Assert.Same(open, completed);

        var result = await open;
        Assert.Equal(PlaybackOpenStatus.Opened, result.Status);
        Assert.True(stoppedInsideHandler);
        Assert.Equal(result.SessionId, handledSession);
        Assert.Equal(PlaybackState.Idle, coordinator.Snapshot.State);
        Assert.Null(coordinator.CurrentSessionId);
    }

    [Fact]
    public async Task DisposeAsync_StopsActiveSession_AndRejectsFurtherOpens()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        var coordinator = Create(factory, time);

        var opened = await coordinator.OpenAsync(Request());
        await coordinator.DisposeAsync();

        Assert.Equal(PlaybackState.Idle, coordinator.Snapshot.State);
        Assert.Equal(opened.SessionId, coordinator.Snapshot.SessionId);

        var backend = factory.Find(opened.SessionId);
        Assert.NotNull(backend);
        Assert.Equal(1, backend.StopCalls);

        await Assert.ThrowsAsync<ObjectDisposedException>(() => coordinator.OpenAsync(Request()));
        await Assert.ThrowsAsync<ObjectDisposedException>(() => coordinator.StopAsync());
    }
}
