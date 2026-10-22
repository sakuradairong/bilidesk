using BiliDesk.Core.Playback;

namespace BiliDesk.Core.Tests.Playback;

public sealed class PlaybackEventTests
{
    private static PlaybackOpenRequest Request(string source = "https://example.invalid/a.m3u8")
        => new(source);

    private static PlaybackCoordinator Create(
        FakePlaybackBackendFactory factory,
        ManualPlaybackTimeProvider time)
        => new(factory, time);

    [Fact]
    public async Task ProgressEvent_UpdatesSnapshot()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        var opened = await coordinator.OpenAsync(Request());
        var sink = factory.SinkFor(opened.SessionId);

        sink.Publish(new PlaybackEvent(opened.SessionId, PlaybackEventKind.Progress, 12.5, 120));

        var snapshot = coordinator.Snapshot;
        Assert.Equal(12.5, snapshot.PositionSeconds);
        Assert.Equal(120d, snapshot.DurationSeconds);
        Assert.Equal(PlaybackState.Playing, snapshot.State);
        Assert.False(snapshot.Ended);
        Assert.Equal(opened.SessionId, snapshot.SessionId);
    }

    [Fact]
    public async Task EndOfFile_IsDeduplicatedPerSession()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        var opened = await coordinator.OpenAsync(Request());
        var sink = factory.SinkFor(opened.SessionId);
        var notifications = new List<PlaybackSnapshot>();
        coordinator.SnapshotChanged += notifications.Add;

        sink.Publish(new PlaybackEvent(opened.SessionId, PlaybackEventKind.EndOfFile, 120, 120));
        var ended = coordinator.Snapshot;
        Assert.True(ended.Ended);
        Assert.Equal(120d, ended.PositionSeconds);

        var revisionAfterFirstEnd = ended.Revision;
        sink.Publish(new PlaybackEvent(opened.SessionId, PlaybackEventKind.EndOfFile, 120, 120));

        Assert.Equal(revisionAfterFirstEnd, coordinator.Snapshot.Revision);
        Assert.Equal(1, notifications.Count(snapshot => snapshot.Ended));

        // 新会话重新开始，EOF 标记必须重置。
        var replaced = await coordinator.OpenAsync(Request("b"));
        Assert.False(coordinator.Snapshot.Ended);
        Assert.Equal(replaced.SessionId, coordinator.Snapshot.SessionId);
    }

    [Fact]
    public async Task EventsFromReplacedSession_AreIgnored()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        var first = await coordinator.OpenAsync(Request("a"));
        var firstSink = factory.SinkFor(first.SessionId);
        var second = await coordinator.OpenAsync(Request("b"));
        var secondSink = factory.SinkFor(second.SessionId);

        firstSink.Publish(new PlaybackEvent(first.SessionId, PlaybackEventKind.Progress, 77, 200));
        firstSink.Publish(new PlaybackEvent(first.SessionId, PlaybackEventKind.EndOfFile, 200, 200));

        Assert.Equal(second.SessionId, coordinator.Snapshot.SessionId);
        Assert.Equal(0d, coordinator.Snapshot.PositionSeconds);
        Assert.False(coordinator.Snapshot.Ended);

        // 即使事件身份与会话不匹配（后端标错或旧引用），也不能被接受。
        secondSink.Publish(new PlaybackEvent(first.SessionId, PlaybackEventKind.Progress, 55, 200));
        Assert.Equal(0d, coordinator.Snapshot.PositionSeconds);

        secondSink.Publish(new PlaybackEvent(second.SessionId, PlaybackEventKind.Progress, 5, 200));
        Assert.Equal(5d, coordinator.Snapshot.PositionSeconds);
    }

    [Fact]
    public async Task EventsAfterStop_AreIgnored()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        var opened = await coordinator.OpenAsync(Request());
        var sink = factory.SinkFor(opened.SessionId);
        var stopped = await coordinator.StopAsync();
        Assert.Equal(PlaybackStopStatus.Stopped, stopped.Status);

        sink.Publish(new PlaybackEvent(opened.SessionId, PlaybackEventKind.Progress, 30, 120));
        sink.Publish(new PlaybackEvent(opened.SessionId, PlaybackEventKind.EndOfFile, 120, 120));

        Assert.Equal(PlaybackState.Idle, coordinator.Snapshot.State);
        Assert.Equal(0d, coordinator.Snapshot.PositionSeconds);
        Assert.False(coordinator.Snapshot.Ended);
    }

    [Fact]
    public async Task FailedEvent_SurfacesMessageWithoutChangingOwnershipState()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        var opened = await coordinator.OpenAsync(Request());
        var sink = factory.SinkFor(opened.SessionId);

        sink.Publish(new PlaybackEvent(
            opened.SessionId,
            PlaybackEventKind.Failed,
            Message: "fake decode failure"));

        Assert.Equal(PlaybackState.Playing, coordinator.Snapshot.State);
        Assert.Equal("fake decode failure", coordinator.Snapshot.Message);
        Assert.Equal(opened.SessionId, coordinator.CurrentSessionId);
    }

    [Fact]
    public async Task NonFiniteProgress_IsIgnored()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);

        var opened = await coordinator.OpenAsync(Request());
        var sink = factory.SinkFor(opened.SessionId);
        var revision = coordinator.Snapshot.Revision;

        sink.Publish(new PlaybackEvent(
            opened.SessionId,
            PlaybackEventKind.Progress,
            double.NaN,
            double.PositiveInfinity));

        Assert.Equal(revision, coordinator.Snapshot.Revision);
        Assert.Equal(0d, coordinator.Snapshot.PositionSeconds);
    }

    [Fact]
    public async Task SnapshotNotifications_CarrySessionIdentity()
    {
        var factory = new FakePlaybackBackendFactory();
        var time = new ManualPlaybackTimeProvider();
        await using var coordinator = Create(factory, time);
        var notifications = new List<PlaybackSnapshot>();
        coordinator.SnapshotChanged += notifications.Add;

        var opened = await coordinator.OpenAsync(Request());
        var sink = factory.SinkFor(opened.SessionId);
        sink.Publish(new PlaybackEvent(opened.SessionId, PlaybackEventKind.Progress, 1, 10));
        await coordinator.StopAsync();

        Assert.NotEmpty(notifications);
        foreach (var snapshot in notifications)
        {
            Assert.Equal(opened.SessionId, snapshot.SessionId);
        }

        var notificationCount = notifications.Count;
        Assert.Equal(5, notificationCount);
        Assert.Equal(PlaybackState.Opening, notifications[0].State);
        Assert.Equal(PlaybackState.Playing, notifications[1].State);
        Assert.Equal(PlaybackState.Stopping, notifications[^2].State);
        Assert.Equal(PlaybackState.Idle, notifications[^1].State);
    }
}
