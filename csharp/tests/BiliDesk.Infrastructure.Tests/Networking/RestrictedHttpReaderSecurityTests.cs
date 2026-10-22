using System.Net;
using BiliDesk.Infrastructure.Networking;

namespace BiliDesk.Infrastructure.Tests.Networking;

public sealed class RestrictedHttpReaderSecurityTests
{
    [Theory]
    [InlineData("http://i0.hdslb.com/a.jpg")]
    [InlineData("ftp://i0.hdslb.com/a.jpg")]
    [InlineData("file:///etc/passwd")]
    public async Task RejectsNonHttpsSchemes(string url)
    {
        var handler = new FakeHttpMessageHandler();
        using var reader = new RestrictedHttpReader(handler);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(new Uri(url), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.InsecureScheme, exception.Kind);
        Assert.Empty(handler.Requests);
    }

    [Theory]
    [InlineData("https://evil.com/a.jpg")]
    [InlineData("https://i0.hdslb.com.evil.com/a.jpg")]
    [InlineData("https://evil.com/?u=https://i0.hdslb.com/a.jpg")]
    [InlineData("https://evil-hdslb.com/a.jpg")]
    public async Task RejectsHostsThatOnlyLookAllowed(string url)
    {
        var handler = new FakeHttpMessageHandler();
        using var reader = new RestrictedHttpReader(handler);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(new Uri(url), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.HostNotAllowed, exception.Kind);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task RejectsUriWithEmbeddedCredentials()
    {
        var handler = new FakeHttpMessageHandler();
        using var reader = new RestrictedHttpReader(handler);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(
                new Uri("https://user:pass@i0.hdslb.com/a.jpg"),
                TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.InvalidRequest, exception.Kind);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task RejectsNonDefaultPort()
    {
        var handler = new FakeHttpMessageHandler();
        using var reader = new RestrictedHttpReader(handler);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(
                new Uri("https://i0.hdslb.com:8443/a.jpg"),
                TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.InvalidRequest, exception.Kind);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task ImageRequestDoesNotSendCookieEvenIfCredentialFlagIsSet()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok("ok"u8.ToArray()));
        using var reader = new RestrictedHttpReader(handler);

        var request = new HttpReadRequest(
            TestHosts.Image(),
            TestHosts.Images,
            allowCredentials: true,
            cookieHeader: "SESSDATA=secret");

        var result = await reader.ReadAsync(request);

        Assert.True(result.IsSuccess);
        Assert.Null(Assert.Single(handler.Requests).Cookie);
    }

    [Fact]
    public async Task TrustedApiRequestSendsCookieOnlyToConfiguredApiHosts()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok("{}"u8.ToArray()));
        var options = new HttpReadOptions { TrustedApiHosts = TestHosts.Api };
        using var reader = new RestrictedHttpReader(handler, options);

        await reader.ReadAsync(HttpReadRequest.TrustedApi(TestHosts.ApiUri(), TestHosts.Api, "SESSDATA=abc"));

        Assert.Equal("SESSDATA=abc", Assert.Single(handler.Requests).Cookie);
    }

    [Fact]
    public async Task CookieIsNotSentWhenHostIsNotATrustedApiHost()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok("ok"u8.ToArray()));
        var options = new HttpReadOptions { TrustedApiHosts = TestHosts.Api };
        using var reader = new RestrictedHttpReader(handler, options);

        var request = new HttpReadRequest(
            TestHosts.Image(),
            TestHosts.Images,
            allowCredentials: true,
            cookieHeader: "SESSDATA=abc");

        await reader.ReadAsync(request);

        Assert.Null(Assert.Single(handler.Requests).Cookie);
    }

    [Fact]
    public async Task RejectsCookieHeaderWithLineBreaks()
    {
        var handler = new FakeHttpMessageHandler();
        using var reader = new RestrictedHttpReader(handler);

        var request = new HttpReadRequest(
            TestHosts.ApiUri(),
            TestHosts.Api,
            allowCredentials: true,
            cookieHeader: "SESSDATA=abc\r\nX-Injected: 1");

        var exception = await Assert.ThrowsAsync<HttpReadException>(() => reader.ReadAsync(request));

        Assert.Equal(HttpReadFailureKind.InvalidRequest, exception.Kind);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task DoesNotForwardCookiesAcrossRedirectHosts()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Redirect(HttpStatusCode.Found, "https://passport.bilibili.com/x"));
        handler.Enqueue(() => FakeResponses.Ok("{}"u8.ToArray()));
        var options = new HttpReadOptions { TrustedApiHosts = TestHosts.Api };
        using var reader = new RestrictedHttpReader(handler, options);

        var result = await reader.ReadAsync(
            HttpReadRequest.TrustedApi(TestHosts.ApiUri(), TestHosts.Api, "SESSDATA=abc"));

        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal("SESSDATA=abc", handler.Requests[0].Cookie);
        Assert.Null(handler.Requests[1].Cookie);
        Assert.Equal("passport.bilibili.com", result.FinalUri.IdnHost);
    }

    [Fact]
    public async Task KeepsCookieOnSameOriginRedirect()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Redirect(HttpStatusCode.Found, "https://api.bilibili.com/y"));
        handler.Enqueue(() => FakeResponses.Ok("{}"u8.ToArray()));
        var options = new HttpReadOptions { TrustedApiHosts = TestHosts.Api };
        using var reader = new RestrictedHttpReader(handler, options);

        await reader.ReadAsync(HttpReadRequest.TrustedApi(TestHosts.ApiUri(), TestHosts.Api, "SESSDATA=abc"));

        Assert.Equal("SESSDATA=abc", handler.Requests[1].Cookie);
    }

    [Fact]
    public async Task RedirectToUntrustedHostIsRejectedBeforeSending()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Redirect(HttpStatusCode.Found, "https://evil.com/x"));
        using var reader = new RestrictedHttpReader(handler);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.HostNotAllowed, exception.Kind);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task MapsTransportFailureToHttpReadException()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue((_, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("boom")));
        using var reader = new RestrictedHttpReader(handler);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.TransportFailure, exception.Kind);
    }
}
