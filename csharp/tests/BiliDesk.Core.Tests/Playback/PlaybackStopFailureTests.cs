using BiliDesk.Core.Playback;

namespace BiliDesk.Core.Tests.Playback;

public sealed class PlaybackStopFailureTests
{
    private static readonly TimeSpan GuardTimeout = TimeSpan.FromSeconds(5);

    private static PlaybackOpenRequest Request(string source)
        => new(source);

    private static PlaybackCoordinator Create(
        FakePlaybackBackendFactory factory,
        ManualPlaybackTimeProvider time,
        TimeSpan? stopTimeout = null)
        => new(factory, time, stopTimeout);

    [Fact]
    public async Task StopTimeout_LeavesSessionFaulted_AndRejectsNewOpen()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        var timeout = TimeSpan.FromSeconds(3);
        await using var coordinator = Create(factory, time, timeout);

        var opened = await coordinator.OpenAsync(Request("a"));
        var backend = factory.Find(opened.SessionId);
        Assert.NotNull(backend);
        backend.BlockStop = true;

        var stopTask = coordinator.StopAsync();
        await backend.StopStarted.WaitAsync(GuardTimeout);
        Assert.True(time.Elapse(), "停止路径应当请求一次超时等待。");
        Assert.Equal(new[] { timeout }, time.RequestedDelays.ToArray());

        var stop = await stopTask;
        Assert.Equal(PlaybackStopStatus.Failed, stop.Status);
        Assert.False(stop.Succeeded);
        Assert.Equal(PlaybackState.Faulted, coordinator.Snapshot.State);
        Assert.Equal(opened.SessionId, coordinator.Snapshot.SessionId);
        Assert.NotNull(coordinator.Snapshot.Message);

        var createdBefore = factory.Created.Count;
        var reopen = await coordinator.OpenAsync(Request("b"));

        Assert.Equal(PlaybackOpenStatus.RejectedNotReleased, reopen.Status);
        Assert.False(reopen.Succeeded);
        var createdAfter = factory.Created.Count;
        Assert.Equal(createdBefore, createdAfter);
        Assert.Equal(opened.SessionId, coordinator.CurrentSessionId);
        Assert.Equal(PlaybackState.Faulted, coordinator.Snapshot.State);

        // 收尾：让 dispose 能真正释放，避免测试结束在挂起的 stop 上。
        backend.CompleteStop();
    }

    [Fact]
    public async Task StopTimeout_AfterWaitingForStop_BlocksOpenUntilStopCompletes()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        var opened = await coordinator.OpenAsync(Request("a"));
        var backend = factory.Find(opened.SessionId);
        Assert.NotNull(backend);
        backend.BlockStop = true;

        var stopTask = coordinator.StopAsync();
        await backend.StopStarted.WaitAsync(GuardTimeout);
        time.Elapse();
        var timedOut = await stopTask;
        Assert.Equal(PlaybackStopStatus.Failed, timedOut.Status);

        backend.BlockStop = false;
        backend.CompleteStop();

        var retry = await coordinator.StopAsync();
        Assert.Equal(PlaybackStopStatus.Stopped, retry.Status);
        Assert.Equal(PlaybackState.Idle, retry.Snapshot.State);
        Assert.Null(coordinator.CurrentSessionId);
        // Reuse the in-flight teardown instead of issuing a concurrent native stop.
        Assert.Equal(1, backend.StopCalls);
        Assert.Equal(1, backend.DisposeCalls);
    }

    [Fact]
    public async Task StopFailure_RetrySucceeds_ThenOpenIsAllowed()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        var opened = await coordinator.OpenAsync(Request("a"));
        var backend = factory.Find(opened.SessionId);
        Assert.NotNull(backend);
        backend.ThrowOnStop = true;

        var failed = await coordinator.StopAsync();
        Assert.Equal(PlaybackStopStatus.Failed, failed.Status);
        Assert.Equal(PlaybackState.Faulted, coordinator.Snapshot.State);
        Assert.NotNull(coordinator.Snapshot.Message);

        var blocked = await coordinator.OpenAsync(Request("b"));
        Assert.Equal(PlaybackOpenStatus.RejectedNotReleased, blocked.Status);
        Assert.Single(factory.Created);

        backend.ThrowOnStop = false;
        var retried = await coordinator.StopAsync();
        Assert.Equal(PlaybackStopStatus.Stopped, retried.Status);
        Assert.Equal(PlaybackState.Idle, coordinator.Snapshot.State);

        var reopened = await coordinator.OpenAsync(Request("b"));
        Assert.Equal(PlaybackOpenStatus.Opened, reopened.Status);
        Assert.Equal(PlaybackState.Playing, coordinator.Snapshot.State);
        Assert.Equal(2, backend.StopCalls);
        var createdCount = factory.Created.Count;
        Assert.Equal(2, createdCount);
    }

    [Fact]
    public async Task ReplacementWithFailingStop_RejectsNewSession()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        var first = await coordinator.OpenAsync(Request("a"));
        var firstBackend = factory.Find(first.SessionId);
        Assert.NotNull(firstBackend);
        firstBackend.ThrowOnStop = true;

        var second = await coordinator.OpenAsync(Request("b"));

        Assert.Equal(PlaybackOpenStatus.RejectedNotReleased, second.Status);
        Assert.Single(factory.Created);
        Assert.Equal(first.SessionId, coordinator.CurrentSessionId);
        Assert.Equal(PlaybackState.Faulted, coordinator.Snapshot.State);
        Assert.DoesNotContain(
            factory.LogSnapshot(),
            entry => entry == $"create:{second.SessionId.Value}");
    }

    [Fact]
    public async Task StaleStopRequest_DoesNotStopReplacement()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        var first = await coordinator.OpenAsync(Request("a"));
        var firstBackend = factory.Find(first.SessionId);
        Assert.NotNull(firstBackend);
        firstBackend.BlockStop = true;

        // B 的 Open 正在替换 A：A 的 stop 卡住，此时调用 Stop 会把目标捕获成 A。
        var openSecond = coordinator.OpenAsync(Request("b"));
        await firstBackend.StopStarted.WaitAsync(GuardTimeout);
        var staleStop = coordinator.StopAsync();
        firstBackend.CompleteStop();

        var second = await openSecond;
        var staleResult = await staleStop;

        Assert.Equal(PlaybackOpenStatus.Opened, second.Status);
        Assert.Equal(PlaybackStopStatus.NotCurrent, staleResult.Status);
        Assert.Equal(second.SessionId, coordinator.CurrentSessionId);
        Assert.Equal(PlaybackState.Playing, coordinator.Snapshot.State);

        var secondBackend = factory.Find(second.SessionId);
        Assert.NotNull(secondBackend);
        Assert.Equal(0, secondBackend.StopCalls);
    }

    [Fact]
    public async Task StopWithTargetOfFinishedSession_IsIdempotent()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        var opened = await coordinator.OpenAsync(Request("a"));
        await coordinator.StopAsync();

        var again = await coordinator.StopAsync(opened.SessionId);

        Assert.Equal(PlaybackStopStatus.NotCurrent, again.Status);
        Assert.Equal(PlaybackState.Idle, again.Snapshot.State);

        var backend = factory.Find(opened.SessionId);
        Assert.NotNull(backend);
        Assert.Equal(1, backend.StopCalls);
    }
}
