using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using BiliDesk.Infrastructure.Networking;

namespace BiliDesk.Infrastructure.Tests.Networking;

/// <summary>
/// Contract-matching fake: it never follows redirects, never decompresses, and
/// never touches cookies. Responses are returned exactly as queued, mirroring a
/// real handler configured with AllowAutoRedirect/AutomaticDecompression/UseCookies
/// disabled.
/// </summary>
internal sealed class FakeHttpMessageHandler : HttpMessageHandler
{
    private readonly Queue<Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>> _responses = new();

    public List<RecordedRequest> Requests { get; } = [];

    public FakeHttpMessageHandler Enqueue(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> responder)
    {
        _responses.Enqueue(responder);
        return this;
    }

    public FakeHttpMessageHandler Enqueue(Func<HttpResponseMessage> responder)
        => Enqueue((_, _) => Task.FromResult(responder()));

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var uri = request.RequestUri
            ?? throw new InvalidOperationException("Request URI is required.");

        Requests.Add(new RecordedRequest(
            request.Method,
            uri,
            request.Headers.TryGetValues("Cookie", out var cookies) ? string.Join("; ", cookies) : null,
            request.Headers.TryGetValues("Accept-Encoding", out var encodings) ? string.Join(", ", encodings) : null));

        if (_responses.Count == 0)
        {
            throw new InvalidOperationException($"No fake response was queued for {uri}.");
        }

        return _responses.Dequeue()(request, cancellationToken);
    }
}

internal sealed record RecordedRequest(HttpMethod Method, Uri Uri, string? Cookie, string? AcceptEncoding);

internal sealed class TrackedHttpResponseMessage : HttpResponseMessage
{
    public TrackedHttpResponseMessage(HttpStatusCode statusCode)
        : base(statusCode)
    {
    }

    public bool WasDisposed { get; private set; }

    protected override void Dispose(bool disposing)
    {
        WasDisposed = true;
        base.Dispose(disposing);
    }
}

/// <summary>Non-seekable source so StreamContent reports no Content-Length.</summary>
internal sealed class NonSeekableReadStream(byte[] data) : Stream
{
    private int _position;

    public override bool CanRead => true;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length => throw new NotSupportedException();

    public override long Position
    {
        get => _position;
        set => throw new NotSupportedException();
    }

    public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

    public override int Read(Span<byte> buffer)
    {
        var remaining = data.Length - _position;
        var chunk = Math.Min(remaining, buffer.Length);
        if (chunk <= 0)
        {
            return 0;
        }

        data.AsSpan(_position, chunk).CopyTo(buffer);
        _position += chunk;
        return chunk;
    }

    public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var remaining = data.Length - _position;
        var chunk = Math.Min(remaining, buffer.Length);
        if (chunk <= 0)
        {
            return ValueTask.FromResult(0);
        }

        data.AsMemory(_position, chunk).CopyTo(buffer);
        _position += chunk;
        return ValueTask.FromResult(chunk);
    }

    public override void Flush()
    {
    }

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}

/// <summary>Blocks asynchronously until the supplied token is cancelled.</summary>
internal sealed class HangingReadStream : Stream
{
    public override bool CanRead => true;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length => throw new NotSupportedException();

    public override long Position
    {
        get => 0;
        set => throw new NotSupportedException();
    }

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken).ConfigureAwait(false);
        return 0;
    }

    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    public override void Flush()
    {
    }

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}

internal static class FakeResponses
{
    public static TrackedHttpResponseMessage Ok(
        byte[] body,
        string? contentEncoding = null,
        string? contentType = "application/json")
        => Content(HttpStatusCode.OK, body, contentEncoding, contentType);

    public static TrackedHttpResponseMessage Content(
        HttpStatusCode status,
        byte[] body,
        string? contentEncoding = null,
        string? contentType = null)
    {
        var response = new TrackedHttpResponseMessage(status)
        {
            Content = new ByteArrayContent(body),
        };

        if (contentType is not null)
        {
            response.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        }

        if (contentEncoding is not null)
        {
            foreach (var token in contentEncoding.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                response.Content.Headers.ContentEncoding.Add(token);
            }
        }

        return response;
    }

    public static TrackedHttpResponseMessage Redirect(HttpStatusCode status, string location)
    {
        var response = new TrackedHttpResponseMessage(status);
        response.Headers.Location = new Uri(location, UriKind.RelativeOrAbsolute);
        return response;
    }

    public static TrackedHttpResponseMessage Streaming(
        HttpStatusCode status,
        Stream stream,
        string? contentEncoding = null,
        long? declaredLength = null)
    {
        var response = new TrackedHttpResponseMessage(status)
        {
            Content = new StreamContent(stream),
        };

        if (contentEncoding is not null)
        {
            response.Content.Headers.ContentEncoding.Add(contentEncoding);
        }

        if (declaredLength.HasValue)
        {
            response.Content.Headers.ContentLength = declaredLength.Value;
        }

        return response;
    }

    public static byte[] Gzip(byte[] data) => Compress(
        data,
        (stream, level) => new GZipStream(stream, level, leaveOpen: true));

    public static byte[] Brotli(byte[] data) => Compress(
        data,
        (stream, level) => new BrotliStream(stream, level, leaveOpen: true));

    public static byte[] Zlib(byte[] data) => Compress(
        data,
        (stream, level) => new ZLibStream(stream, level, leaveOpen: true));

    public static byte[] DeflateRaw(byte[] data) => Compress(
        data,
        (stream, level) => new DeflateStream(stream, level, leaveOpen: true));

    private static byte[] Compress(byte[] data, Func<Stream, CompressionLevel, Stream> factory)
    {
        using var buffer = new MemoryStream();
        using (var encoder = factory(buffer, CompressionLevel.SmallestSize))
        {
            encoder.Write(data, 0, data.Length);
        }

        return buffer.ToArray();
    }
}

internal static class TestHosts
{
    public static readonly HostAllowList Images = new(["i0.hdslb.com", "hdslb.com"]);

    public static readonly HostAllowList Api = new(["api.bilibili.com", "passport.bilibili.com"]);

    public static Uri Image(string path = "/a.jpg") => new("https://i0.hdslb.com" + path);

    public static Uri ApiUri(string path = "/x/test") => new("https://api.bilibili.com" + path);
}
