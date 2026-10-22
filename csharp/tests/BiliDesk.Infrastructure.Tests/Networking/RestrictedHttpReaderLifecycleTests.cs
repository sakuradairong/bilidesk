using System.Net;
using BiliDesk.Infrastructure.Networking;

namespace BiliDesk.Infrastructure.Tests.Networking;

public sealed class RestrictedHttpReaderLifecycleTests
{
    [Fact]
    public void DefaultHandlerDisablesFrameworkRedirectDecompressionAndCookies()
    {
        using var handler = RestrictedHttpReader.CreateDefaultHandler();

        Assert.False(handler.AllowAutoRedirect);
        Assert.Equal(DecompressionMethods.None, handler.AutomaticDecompression);
        Assert.False(handler.UseCookies);
    }

    [Fact]
    public async Task DisposesResponseOnSuccessfulRead()
    {
        var response = FakeResponses.Ok("body"u8.ToArray(), contentType: "text/plain");

        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => response);
        using var reader = new RestrictedHttpReader(handler);

        var result = await reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images));

        Assert.Equal("body"u8.ToArray(), result.Body);
        Assert.Equal("text/plain", result.ContentType);
        Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        Assert.Equal(TestHosts.Image(), result.FinalUri);
        Assert.True(result.IsSuccess);
        Assert.True(response.WasDisposed);
    }

    [Fact]
    public void RejectsInvalidOptions()
    {
        using var handler = new FakeHttpMessageHandler();

        Assert.Throws<ArgumentOutOfRangeException>(
            () => new RestrictedHttpReader(handler, new HttpReadOptions { MaxRawBytes = 0 }));
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new RestrictedHttpReader(handler, new HttpReadOptions { MaxDecodedBytes = 0 }));
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new RestrictedHttpReader(handler, new HttpReadOptions { MaxRedirects = -1 }));
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new RestrictedHttpReader(handler, new HttpReadOptions { TotalTimeout = TimeSpan.Zero }));
    }

    [Fact]
    public async Task ThrowsAfterDispose()
    {
        var handler = new FakeHttpMessageHandler();
        var reader = new RestrictedHttpReader(handler);
        reader.Dispose();

        await Assert.ThrowsAsync<ObjectDisposedException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));
    }

    [Fact]
    public async Task SendsGetRequestsOnly()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok("ok"u8.ToArray()));
        using var reader = new RestrictedHttpReader(handler);

        await reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images));

        Assert.Equal(HttpMethod.Get, Assert.Single(handler.Requests).Method);
    }
}
