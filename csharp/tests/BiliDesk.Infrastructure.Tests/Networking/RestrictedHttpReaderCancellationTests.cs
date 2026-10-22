using System.Net;
using BiliDesk.Infrastructure.Networking;

namespace BiliDesk.Infrastructure.Tests.Networking;

public sealed class RestrictedHttpReaderCancellationTests
{
    [Fact]
    public async Task PreCanceledTokenStopsBeforeSending()
    {
        var handler = new FakeHttpMessageHandler();
        using var reader = new RestrictedHttpReader(handler);
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images), cts.Token));

        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task UserCancellationSurfacesAsOperationCanceledException()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(async (_, token) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, token).ConfigureAwait(false);
            return FakeResponses.Ok("late"u8.ToArray());
        });

        using var reader = new RestrictedHttpReader(handler, new HttpReadOptions
        {
            TotalTimeout = TimeSpan.FromSeconds(30),
        });
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images), cts.Token));
    }

    [Fact]
    public async Task TotalTimeoutWhileSendingMapsToTimeoutFailure()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(async (_, token) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, token).ConfigureAwait(false);
            return FakeResponses.Ok("late"u8.ToArray());
        });

        using var reader = new RestrictedHttpReader(handler, new HttpReadOptions
        {
            TotalTimeout = TimeSpan.FromMilliseconds(100),
        });

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.Timeout, exception.Kind);
    }

    [Fact]
    public async Task TotalTimeoutCoversBodyReads()
    {
        var response = FakeResponses.Streaming(HttpStatusCode.OK, new HangingReadStream());

        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => response);

        using var reader = new RestrictedHttpReader(handler, new HttpReadOptions
        {
            TotalTimeout = TimeSpan.FromMilliseconds(100),
        });

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.Timeout, exception.Kind);
        Assert.True(response.WasDisposed);
    }
}
