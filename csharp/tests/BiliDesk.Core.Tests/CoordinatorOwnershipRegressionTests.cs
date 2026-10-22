using BiliDesk.Core.Playback;
using BiliDesk.Core.Tests.Playback;

namespace BiliDesk.Core.Tests;

public sealed class CoordinatorOwnershipRegressionTests
{
    [Fact]
    public async Task EndOfFileDuringTeardownDoesNotPublishEnded()
    {
        var factory = new FakePlaybackBackendFactory();
        var coordinator = new PlaybackCoordinator(factory);
        var opened = await coordinator.OpenAsync(new PlaybackOpenRequest("content"));
        var backend = factory.Find(opened.SessionId)!;
        backend.BlockStop = true;

        var stopping = coordinator.StopAsync(opened.SessionId);
        await backend.StopStarted.WaitAsync(TimeSpan.FromSeconds(5));
        factory.SinkFor(opened.SessionId).Publish(
            new PlaybackEvent(opened.SessionId, PlaybackEventKind.EndOfFile, 100, 100));

        Assert.False(coordinator.Snapshot.Ended);
        backend.CompleteStop();
        await stopping;
        await coordinator.DisposeAsync();
    }

    [Fact]
    public async Task DisposeFailureRetainsOwnerAndBlocksReplacement()
    {
        var backend = new Backend { FailDispose = true };
        var factory = new Factory(backend);
        var coordinator = new PlaybackCoordinator(factory);
        var opened = await coordinator.OpenAsync(new PlaybackOpenRequest("content-a"));

        var stopped = await coordinator.StopAsync(opened.SessionId);
        var replacement = await coordinator.OpenAsync(new PlaybackOpenRequest("content-b"));

        Assert.Equal(PlaybackStopStatus.Failed, stopped.Status);
        Assert.Equal(PlaybackState.Faulted, stopped.Snapshot.State);
        Assert.Equal(PlaybackOpenStatus.RejectedNotReleased, replacement.Status);
        Assert.Equal(1, factory.Creations);
    }

    [Fact]
    public async Task UserCancellationDoesNotCancelBackendTeardown()
    {
        var backend = new Backend { BlockStop = true };
        var coordinator = new PlaybackCoordinator(new Factory(backend));
        var opened = await coordinator.OpenAsync(new PlaybackOpenRequest("content"));
        using var cancellation = new CancellationTokenSource();

        var stopping = coordinator.StopAsync(opened.SessionId, cancellation.Token);
        await backend.StopStarted.Task.WaitAsync(TimeSpan.FromSeconds(5));
        cancellation.Cancel();
        var backendWasCanceled = backend.StopToken.IsCancellationRequested;
        backend.CompleteStop.TrySetResult();
        var result = await stopping;

        Assert.False(backendWasCanceled);
        Assert.Equal(PlaybackStopStatus.Stopped, result.Status);
        await coordinator.DisposeAsync();
    }

    private sealed class Factory(Backend backend) : IPlaybackBackendFactory
    {
        public int Creations { get; private set; }

        public Task<IPlaybackBackend> CreateAsync(
            PlaybackSessionContext context, CancellationToken cancellationToken)
        {
            Creations++;
            return Task.FromResult<IPlaybackBackend>(backend);
        }
    }

    private sealed class Backend : IPlaybackBackend
    {
        public bool FailDispose { get; init; }
        public bool BlockStop { get; init; }
        public bool BlockDispose { get; init; }
        public CancellationToken StopToken { get; private set; }
        public TaskCompletionSource StopStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource CompleteStop { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource DisposeStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource CompleteDispose { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task StopAsync(CancellationToken cancellationToken)
        {
            StopToken = cancellationToken;
            StopStarted.TrySetResult();
            return BlockStop ? CompleteStop.Task : Task.CompletedTask;
        }

        public ValueTask DisposeAsync()
        {
            DisposeStarted.TrySetResult();
            return FailDispose
                ? ValueTask.FromException(new InvalidOperationException("Synthetic native release failure."))
                : BlockDispose ? new ValueTask(CompleteDispose.Task) : ValueTask.CompletedTask;
        }
    }

    [Fact]
    public async Task HangingDisposeTimesOutWithoutReleasingOwnership()
    {
        var backend = new Backend { BlockDispose = true };
        var time = new ManualPlaybackTimeProvider();
        var coordinator = new PlaybackCoordinator(new Factory(backend), time);
        var opened = await coordinator.OpenAsync(new PlaybackOpenRequest("content"));

        var stopping = coordinator.StopAsync(opened.SessionId);
        await backend.DisposeStarted.Task.WaitAsync(TimeSpan.FromSeconds(5));
        time.Elapse();
        var stopped = await stopping.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Equal(PlaybackStopStatus.Failed, stopped.Status);
        Assert.Equal(PlaybackState.Faulted, stopped.Snapshot.State);
        Assert.Equal(PlaybackOpenStatus.RejectedNotReleased,
            (await coordinator.OpenAsync(new PlaybackOpenRequest("replacement"))).Status);
        backend.CompleteDispose.TrySetResult();
        Assert.Equal(PlaybackStopStatus.Stopped, (await coordinator.StopAsync(opened.SessionId)).Status);
        await coordinator.DisposeAsync();
    }
}
