using System.Net;
using BiliDesk.Infrastructure.Networking;

namespace BiliDesk.Infrastructure.Tests.Networking;

public sealed class RestrictedHttpReaderRedirectTests
{
    [Theory]
    [InlineData(301)]
    [InlineData(302)]
    [InlineData(303)]
    [InlineData(307)]
    [InlineData(308)]
    public async Task FollowsRedirectsToAllowedHttpsHosts(int statusCode)
    {
        var handler = new FakeHttpMessageHandler();
        var first = FakeResponses.Redirect((HttpStatusCode)statusCode, "https://hdslb.com/final.jpg");
        handler.Enqueue(() => first);
        handler.Enqueue(() => FakeResponses.Ok("image"u8.ToArray(), contentType: "image/jpeg"));
        using var reader = new RestrictedHttpReader(handler);

        var result = await reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images));

        Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        Assert.Equal("hdslb.com", result.FinalUri.IdnHost);
        Assert.Single(result.RedirectChain);
        Assert.Equal(handler.Requests[0].Uri, result.RedirectChain[0]);
        Assert.True(first.WasDisposed);
    }

    [Fact]
    public async Task ResolvesRelativeLocationAgainstCurrentUri()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Redirect(HttpStatusCode.Found, "/next.jpg"));
        handler.Enqueue(() => FakeResponses.Ok("image"u8.ToArray()));
        using var reader = new RestrictedHttpReader(handler);

        var result = await reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images));

        Assert.Equal(new Uri("https://i0.hdslb.com/next.jpg"), result.FinalUri);
    }

    [Fact]
    public async Task RejectsRedirectsBeyondLimit()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Redirect(HttpStatusCode.Found, "https://i0.hdslb.com/1"));
        handler.Enqueue(() => FakeResponses.Redirect(HttpStatusCode.Found, "https://i0.hdslb.com/2"));
        using var reader = new RestrictedHttpReader(handler, new HttpReadOptions { MaxRedirects = 1 });

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.RedirectLimitExceeded, exception.Kind);
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task ZeroRedirectBudgetRejectsFirstRedirect()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Redirect(HttpStatusCode.Found, "https://i0.hdslb.com/1"));
        using var reader = new RestrictedHttpReader(handler, new HttpReadOptions { MaxRedirects = 0 });

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.RedirectLimitExceeded, exception.Kind);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task RejectsRedirectWithoutLocation()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => new TrackedHttpResponseMessage(HttpStatusCode.Found));
        using var reader = new RestrictedHttpReader(handler);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.InvalidRedirect, exception.Kind);
    }

    [Fact]
    public async Task RejectsRedirectToHttp()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Redirect(HttpStatusCode.Found, "http://i0.hdslb.com/a.jpg"));
        using var reader = new RestrictedHttpReader(handler);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.InsecureScheme, exception.Kind);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task RejectsRedirectLoop()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Redirect(HttpStatusCode.Found, "/a.jpg"));
        using var reader = new RestrictedHttpReader(handler);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.InvalidRedirect, exception.Kind);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task ReturnsNonSuccessStatusWithoutRedirecting()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Content(HttpStatusCode.NotFound, "missing"u8.ToArray(), contentType: "text/plain"));
        using var reader = new RestrictedHttpReader(handler);

        var result = await reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images));

        Assert.Equal(HttpStatusCode.NotFound, result.StatusCode);
        Assert.False(result.IsSuccess);
        Assert.Equal("missing"u8.ToArray(), result.Body);
        Assert.Empty(result.RedirectChain);
    }
}
