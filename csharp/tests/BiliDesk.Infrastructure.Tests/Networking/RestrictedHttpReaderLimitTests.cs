using System.Net;
using System.Text;
using BiliDesk.Infrastructure.Networking;

namespace BiliDesk.Infrastructure.Tests.Networking;

public sealed class RestrictedHttpReaderLimitTests
{
    private static readonly HttpReadOptions SmallLimits = new()
    {
        MaxRawBytes = 100,
        MaxDecodedBytes = 100,
    };

    [Fact]
    public async Task AcceptsBodyAtExactlyTheLimit()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok(new byte[100]));
        using var reader = new RestrictedHttpReader(handler, SmallLimits);

        var result = await reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images));

        Assert.Equal(100, result.Body.Length);
        Assert.Equal(100, result.RawLength);
    }

    [Fact]
    public async Task RejectsRawBodyOneByteOverTheLimit()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok(new byte[101]));
        using var reader = new RestrictedHttpReader(handler, SmallLimits);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.RawLimitExceeded, exception.Kind);
    }

    [Fact]
    public async Task RejectsBodyWithoutContentLengthThatExceedsTheRawLimit()
    {
        var response = new TrackedHttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StreamContent(new NonSeekableReadStream(new byte[200])),
        };

        // The limit must be enforced while streaming, not from the header.
        Assert.Null(response.Content.Headers.ContentLength);

        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => response);
        using var reader = new RestrictedHttpReader(handler, SmallLimits);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.RawLimitExceeded, exception.Kind);
        Assert.True(response.WasDisposed);
    }

    [Fact]
    public async Task RejectsDeclaredContentLengthOverLimitWithoutReadingBody()
    {
        // A body that would fit is declared as oversized: the reader must fail
        // before reading anything.
        var response = new TrackedHttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StreamContent(new NonSeekableReadStream(new byte[10])),
        };
        response.Content.Headers.ContentLength = 500;

        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => response);
        using var reader = new RestrictedHttpReader(handler, SmallLimits);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.RawLimitExceeded, exception.Kind);
    }

    [Fact]
    public async Task EnforcesDecodedLimitForIdentityBodies()
    {
        var options = new HttpReadOptions { MaxRawBytes = 100, MaxDecodedBytes = 50 };
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok(new byte[80]));
        using var reader = new RestrictedHttpReader(handler, options);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.DecodedLimitExceeded, exception.Kind);
    }

    [Fact]
    public async Task DecodesGzipBody()
    {
        var payload = Encoding.UTF8.GetBytes("{\"code\":0,\"message\":\"ok\"}");
        var compressed = FakeResponses.Gzip(payload);

        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok(compressed, "gzip"));
        using var reader = new RestrictedHttpReader(handler);

        var result = await reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images));

        Assert.Equal(payload, result.Body);
        Assert.True(result.WasDecompressed);
        Assert.Equal(compressed.Length, result.RawLength);
        Assert.Equal("gzip", result.ContentEncoding);
    }

    [Fact]
    public async Task DecodesBrotliBody()
    {
        var payload = Encoding.UTF8.GetBytes("brotli payload");
        var compressed = FakeResponses.Brotli(payload);

        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok(compressed, "br"));
        using var reader = new RestrictedHttpReader(handler);

        var result = await reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images));

        Assert.Equal(payload, result.Body);
        Assert.True(result.WasDecompressed);
    }

    [Fact]
    public async Task DecodesRawDeflateBody()
    {
        var payload = Encoding.UTF8.GetBytes("<i><d p=\"1.0\">hi</d></i>");
        var compressed = FakeResponses.DeflateRaw(payload);

        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok(compressed, "deflate"));
        using var reader = new RestrictedHttpReader(handler);

        var result = await reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images));

        Assert.Equal(payload, result.Body);
        Assert.True(result.WasDecompressed);
    }

    [Fact]
    public async Task DecodesZlibWrappedDeflateBody()
    {
        var payload = Encoding.UTF8.GetBytes("{\"code\":0}");
        var compressed = FakeResponses.Zlib(payload);

        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok(compressed, "deflate"));
        using var reader = new RestrictedHttpReader(handler);

        var result = await reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images));

        Assert.Equal(payload, result.Body);
        Assert.True(result.WasDecompressed);
    }

    [Fact]
    public async Task DecodesChainedEncodingsInReverseOrder()
    {
        var payload = Encoding.UTF8.GetBytes("{\"code\":0,\"data\":\"chained\"}");
        var gzipped = FakeResponses.Gzip(payload);
        var doubleEncoded = FakeResponses.Brotli(gzipped);

        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok(doubleEncoded, "gzip, br"));
        using var reader = new RestrictedHttpReader(handler);

        var result = await reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images));

        Assert.Equal(payload, result.Body);
        Assert.True(result.WasDecompressed);
    }

    [Fact]
    public async Task RejectsGzipBombBeyondDecodedLimit()
    {
        var bomb = FakeResponses.Gzip(new byte[512 * 1024]);
        var options = new HttpReadOptions { MaxRawBytes = 4096, MaxDecodedBytes = 4096 };

        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok(bomb, "gzip"));
        using var reader = new RestrictedHttpReader(handler, options);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.DecodedLimitExceeded, exception.Kind);
    }

    [Fact]
    public async Task RejectsCompressedBodyBeyondRawLimit()
    {
        var payload = new byte[8192];
        new Random(7).NextBytes(payload);
        var compressed = FakeResponses.Gzip(payload);
        Assert.True(compressed.Length > 1024);

        var options = new HttpReadOptions { MaxRawBytes = 1024, MaxDecodedBytes = 64 * 1024 };
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Streaming(
            HttpStatusCode.OK,
            new NonSeekableReadStream(compressed),
            contentEncoding: "gzip"));
        using var reader = new RestrictedHttpReader(handler, options);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.RawLimitExceeded, exception.Kind);
    }

    [Fact]
    public async Task RejectsUnknownContentEncoding()
    {
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok("data"u8.ToArray(), "zstd"));
        using var reader = new RestrictedHttpReader(handler);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.UnsupportedContentEncoding, exception.Kind);
    }

    [Fact]
    public async Task RejectsCorruptGzipBody()
    {
        var corrupt = FakeResponses.Gzip(new byte[1024]);
        corrupt[corrupt.Length / 2] ^= 0xFF;

        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok(corrupt, "gzip"));
        using var reader = new RestrictedHttpReader(handler);

        var exception = await Assert.ThrowsAsync<HttpReadException>(
            () => reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images)));

        Assert.Equal(HttpReadFailureKind.DecompressionFailed, exception.Kind);
    }

    [Fact]
    public async Task IdentityEncodingPassesThrough()
    {
        var payload = "plain body"u8.ToArray();
        var handler = new FakeHttpMessageHandler();
        handler.Enqueue(() => FakeResponses.Ok(payload, "identity"));
        using var reader = new RestrictedHttpReader(handler);

        var result = await reader.ReadAsync(HttpReadRequest.Image(TestHosts.Image(), TestHosts.Images));

        Assert.Equal(payload, result.Body);
        Assert.False(result.WasDecompressed);
    }
}
