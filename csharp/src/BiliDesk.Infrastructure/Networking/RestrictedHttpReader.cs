using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;

namespace BiliDesk.Infrastructure.Networking;

/// <summary>
/// Minimal read-only HTTP client with explicit constraints:
/// <list type="bullet">
/// <item>HTTPS only, default port only, no user info in the URI.</item>
/// <item>Host allow-list uses exact/dot-boundary suffix matching.</item>
/// <item>Redirects are followed manually and re-validated per hop; credentials are
/// never forwarded to a different origin.</item>
/// <item>Raw and decompressed bodies have independent hard limits enforced while
/// streaming (never after the fact from Content-Length alone).</item>
/// <item>Response and body streams are disposed on every path.</item>
/// </list>
/// </summary>
public sealed class RestrictedHttpReader : IDisposable
{
    private const int StreamBufferSize = 8192;

    private readonly HttpReadOptions _options;
    private readonly HttpClient _client;
    private bool _disposed;

    /// <param name="handler">
    /// Message handler that must not follow redirects, decompress automatically,
    /// or use a cookie jar (see <see cref="CreateDefaultHandler"/>). Test fakes must
    /// honor the same contract.
    /// </param>
    public RestrictedHttpReader(HttpMessageHandler handler, HttpReadOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(handler);

        _options = options ?? new HttpReadOptions();
        ValidateOptions(_options);

        _client = new HttpClient(handler, disposeHandler: true)
        {
            // The reader owns the total budget so timeouts can be mapped to an
            // explicit failure instead of a generic TaskCanceledException.
            Timeout = Timeout.InfiniteTimeSpan,
        };
    }

    /// <summary>Handler that disables the framework behaviors this reader re-implements.</summary>
    public static SocketsHttpHandler CreateDefaultHandler() => new()
    {
        AllowAutoRedirect = false,
        AutomaticDecompression = DecompressionMethods.None,
        UseCookies = false,
        ConnectTimeout = TimeSpan.FromSeconds(10),
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
    };

    /// <summary>Convenience factory using <see cref="CreateDefaultHandler"/>.</summary>
    public static RestrictedHttpReader CreateDefault(HttpReadOptions? options = null)
        => new(CreateDefaultHandler(), options);

    public async Task<HttpReadResult> ReadAsync(HttpReadRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ObjectDisposedException.ThrowIf(_disposed, this);

        var initialUri = request.Uri;
        ValidateReadUri(initialUri, request.AllowedHosts);
        ValidateCookieHeader(request.CookieHeader);

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(_options.TotalTimeout);
        var token = timeoutCts.Token;

        var visited = new HashSet<string>(StringComparer.Ordinal) { CanonicalKey(initialUri) };
        var redirectChain = new List<Uri>();
        var current = initialUri;

        try
        {
            while (true)
            {
                token.ThrowIfCancellationRequested();
                using var message = new HttpRequestMessage(HttpMethod.Get, current);
                var cookieHeader = request.CookieHeader;
                if (cookieHeader is { Length: > 0 } && ShouldSendCookie(request, initialUri, current))
                {
                    if (!message.Headers.TryAddWithoutValidation("Cookie", cookieHeader))
                    {
                        throw new HttpReadException(
                            HttpReadFailureKind.InvalidRequest,
                            "Cookie header was rejected by the HTTP stack.")
                        {
                            TargetUri = current,
                        };
                    }
                }

                using var response = await _client
                    .SendAsync(message, HttpCompletionOption.ResponseHeadersRead, token)
                    .ConfigureAwait(false);

                if (IsRedirect(response.StatusCode))
                {
                    if (redirectChain.Count >= _options.MaxRedirects)
                    {
                        throw new HttpReadException(
                            HttpReadFailureKind.RedirectLimitExceeded,
                            $"Redirect limit of {_options.MaxRedirects} hop(s) was exceeded.")
                        {
                            TargetUri = current,
                        };
                    }

                    var location = response.Headers.Location;
                    if (location is null)
                    {
                        throw new HttpReadException(
                            HttpReadFailureKind.InvalidRedirect,
                            "Redirect response did not include a Location header.")
                        {
                            TargetUri = current,
                        };
                    }

                    Uri next;
                    try
                    {
                        next = new Uri(current, location);
                    }
                    catch (UriFormatException ex)
                    {
                        throw new HttpReadException(
                            HttpReadFailureKind.InvalidRedirect,
                            "Redirect Location was not a valid URI.",
                            ex)
                        {
                            TargetUri = current,
                        };
                    }

                    ValidateReadUri(next, request.AllowedHosts);

                    if (!visited.Add(CanonicalKey(next)))
                    {
                        throw new HttpReadException(
                            HttpReadFailureKind.InvalidRedirect,
                            "Redirect loop detected.")
                        {
                            TargetUri = next,
                        };
                    }

                    redirectChain.Add(current);
                    current = next;
                    continue;
                }

                return await ReadBodyAsync(response, current, redirectChain, token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            throw new HttpReadException(
                HttpReadFailureKind.Timeout,
                $"HTTP read exceeded the total timeout of {_options.TotalTimeout}.")
            {
                TargetUri = current,
            };
        }
        catch (HttpRequestException ex)
        {
            throw new HttpReadException(
                HttpReadFailureKind.TransportFailure,
                "HTTP transport failed.",
                ex)
            {
                TargetUri = current,
            };
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _client.Dispose();
    }

    private async Task<HttpReadResult> ReadBodyAsync(
        HttpResponseMessage response,
        Uri finalUri,
        List<Uri> redirectChain,
        CancellationToken token)
    {
        var content = response.Content;
        var declaredLength = content.Headers.ContentLength;
        if (declaredLength.HasValue && declaredLength.Value > _options.MaxRawBytes)
        {
            throw new HttpReadException(
                HttpReadFailureKind.RawLimitExceeded,
                $"Declared response body length {declaredLength.Value} exceeds the {_options.MaxRawBytes} byte limit.")
            {
                TargetUri = finalUri,
            };
        }

        var encodings = ParseEncodings(content.Headers.ContentEncoding);
        foreach (var encoding in encodings)
        {
            if (!IsSupportedEncoding(encoding))
            {
                throw new HttpReadException(
                    HttpReadFailureKind.UnsupportedContentEncoding,
                    $"Content-Encoding '{encoding}' is not supported.")
                {
                    TargetUri = finalUri,
                };
            }
        }

        using var stream = await content.ReadAsStreamAsync(token).ConfigureAwait(false);
        var raw = await ReadBoundedAsync(
                stream,
                _options.MaxRawBytes,
                HttpReadFailureKind.RawLimitExceeded,
                "Raw response body",
                finalUri,
                token)
            .ConfigureAwait(false);

        var body = await DecodeAsync(raw, encodings, finalUri, token).ConfigureAwait(false);

        return new HttpReadResult
        {
            StatusCode = response.StatusCode,
            FinalUri = finalUri,
            RedirectChain = redirectChain.ToArray(),
            Body = body,
            RawLength = raw.Length,
            ContentType = content.Headers.ContentType?.MediaType,
            ContentEncoding = encodings.Count == 0 ? null : string.Join(", ", encodings),
            WasDecompressed = encodings.Count > 0,
        };
    }

    private bool ShouldSendCookie(HttpReadRequest request, Uri initialUri, Uri currentUri)
    {
        if (!request.AllowCredentials || string.IsNullOrEmpty(request.CookieHeader))
        {
            return false;
        }

        if (!_options.TrustedApiHosts.IsAllowed(currentUri.IdnHost))
        {
            return false;
        }

        // Same-origin only: a redirect to another host (even another trusted API
        // host) never receives the session cookie.
        return initialUri.Scheme.Equals(currentUri.Scheme, StringComparison.OrdinalIgnoreCase)
            && initialUri.IdnHost.Equals(currentUri.IdnHost, StringComparison.OrdinalIgnoreCase)
            && initialUri.Port == currentUri.Port;
    }

    private async Task<byte[]> DecodeAsync(
        byte[] raw,
        List<string> encodings,
        Uri uri,
        CancellationToken token)
    {
        if (encodings.Count == 0)
        {
            if (raw.Length > _options.MaxDecodedBytes)
            {
                throw DecodedLimitExceeded(uri);
            }

            return raw;
        }

        var current = raw;
        for (var i = encodings.Count - 1; i >= 0; i--)
        {
            current = await DecodeSingleAsync(current, encodings[i], uri, token).ConfigureAwait(false);
        }

        return current;
    }

    private async Task<byte[]> DecodeSingleAsync(
        byte[] input,
        string encoding,
        Uri uri,
        CancellationToken token)
    {
        switch (encoding)
        {
            case "gzip":
                return await DecodeCheckedAsync(
                        () => new GZipStream(new MemoryStream(input, writable: false), CompressionMode.Decompress),
                        uri,
                        token)
                    .ConfigureAwait(false);
            case "br":
                return await DecodeCheckedAsync(
                        () => new BrotliStream(new MemoryStream(input, writable: false), CompressionMode.Decompress),
                        uri,
                        token)
                    .ConfigureAwait(false);
            case "deflate":
                try
                {
                    return await DecodeStreamAsync(
                            new ZLibStream(new MemoryStream(input, writable: false), CompressionMode.Decompress),
                            uri,
                            token)
                        .ConfigureAwait(false);
                }
                catch (InvalidDataException)
                {
                    // Some servers (and Bilibili's danmaku XML) label raw deflate
                    // as "deflate" even though it has no zlib wrapper.
                    return await DecodeCheckedAsync(
                            () => new DeflateStream(new MemoryStream(input, writable: false), CompressionMode.Decompress),
                            uri,
                            token)
                        .ConfigureAwait(false);
                }

            default:
                throw new HttpReadException(
                    HttpReadFailureKind.UnsupportedContentEncoding,
                    $"Content-Encoding '{encoding}' is not supported.")
                {
                    TargetUri = uri,
                };
        }
    }

    private async Task<byte[]> DecodeCheckedAsync(Func<Stream> decoderFactory, Uri uri, CancellationToken token)
    {
        try
        {
            return await DecodeStreamAsync(decoderFactory(), uri, token).ConfigureAwait(false);
        }
        catch (InvalidDataException ex)
        {
            throw new HttpReadException(
                HttpReadFailureKind.DecompressionFailed,
                "Response body could not be decompressed.",
                ex)
            {
                TargetUri = uri,
            };
        }
    }

    private async Task<byte[]> DecodeStreamAsync(Stream decoder, Uri uri, CancellationToken token)
    {
        using (decoder)
        {
            return await ReadBoundedAsync(
                    decoder,
                    _options.MaxDecodedBytes,
                    HttpReadFailureKind.DecodedLimitExceeded,
                    "Decompressed response body",
                    uri,
                    token)
                .ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Reads at most <paramref name="limit"/> bytes and requests one extra byte on
    /// the boundary so a body of exactly limit+1 bytes is detectable.
    /// </summary>
    private static async Task<byte[]> ReadBoundedAsync(
        Stream stream,
        int limit,
        HttpReadFailureKind kind,
        string description,
        Uri uri,
        CancellationToken token)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[StreamBufferSize];
        var total = 0;

        while (true)
        {
            var toRead = (int)Math.Min(chunk.Length, (long)limit - total + 1);
            var read = await stream.ReadAsync(chunk.AsMemory(0, toRead), token).ConfigureAwait(false);
            if (read == 0)
            {
                break;
            }

            total += read;
            if (total > limit)
            {
                throw new HttpReadException(
                    kind,
                    $"{description} exceeded the {limit} byte limit.")
                {
                    TargetUri = uri,
                };
            }

            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }

    private HttpReadException DecodedLimitExceeded(Uri uri) => new(
        HttpReadFailureKind.DecodedLimitExceeded,
        $"Decompressed response body exceeded the {_options.MaxDecodedBytes} byte limit.")
    {
        TargetUri = uri,
    };

    private static void ValidateReadUri(Uri uri, HostAllowList allowedHosts)
    {
        if (!uri.IsAbsoluteUri)
        {
            throw new HttpReadException(HttpReadFailureKind.InvalidRequest, "Request URI must be absolute.");
        }

        if (!uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            throw new HttpReadException(
                HttpReadFailureKind.InsecureScheme,
                "Only HTTPS requests are allowed.")
            {
                TargetUri = uri,
            };
        }

        if (!string.IsNullOrEmpty(uri.UserInfo))
        {
            throw new HttpReadException(
                HttpReadFailureKind.InvalidRequest,
                "Request URI must not contain embedded credentials.")
            {
                TargetUri = uri,
            };
        }

        if (!uri.IsDefaultPort)
        {
            throw new HttpReadException(
                HttpReadFailureKind.InvalidRequest,
                "Only the default HTTPS port is allowed.")
            {
                TargetUri = uri,
            };
        }

        if (!allowedHosts.IsAllowed(uri.IdnHost))
        {
            throw new HttpReadException(
                HttpReadFailureKind.HostNotAllowed,
                $"Host '{uri.IdnHost}' is not in the request allow-list.")
            {
                TargetUri = uri,
            };
        }
    }

    private static void ValidateCookieHeader(string? cookieHeader)
    {
        if (cookieHeader is null)
        {
            return;
        }

        if (cookieHeader.AsSpan().IndexOfAny('\r', '\n') >= 0 || cookieHeader.Contains('\0'))
        {
            throw new HttpReadException(
                HttpReadFailureKind.InvalidRequest,
                "Cookie header must not contain control characters.");
        }
    }

    private static List<string> ParseEncodings(ICollection<string> values)
    {
        var encodings = new List<string>();
        foreach (var value in values)
        {
            foreach (var token in value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var encoding = token.ToLowerInvariant();
                if (encoding.Length == 0 || encoding == "identity")
                {
                    continue;
                }

                encodings.Add(encoding);
            }
        }

        return encodings;
    }

    private static bool IsSupportedEncoding(string encoding)
        => encoding is "gzip" or "br" or "deflate";

    private static bool IsRedirect(HttpStatusCode statusCode)
        => statusCode is HttpStatusCode.MovedPermanently
            or HttpStatusCode.Found
            or HttpStatusCode.SeeOther
            or HttpStatusCode.TemporaryRedirect
            or HttpStatusCode.PermanentRedirect;

    private static string CanonicalKey(Uri uri) => uri.GetLeftPart(UriPartial.Query);

    private static void ValidateOptions(HttpReadOptions options)
    {
        ArgumentNullException.ThrowIfNull(options.TrustedApiHosts);

        if (options.MaxRawBytes <= 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(options),
                options.MaxRawBytes,
                $"{nameof(HttpReadOptions.MaxRawBytes)} must be positive.");
        }

        if (options.MaxDecodedBytes <= 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(options),
                options.MaxDecodedBytes,
                $"{nameof(HttpReadOptions.MaxDecodedBytes)} must be positive.");
        }

        if (options.MaxRedirects < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(options),
                options.MaxRedirects,
                $"{nameof(HttpReadOptions.MaxRedirects)} must not be negative.");
        }

        if (options.TotalTimeout <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(
                nameof(options),
                options.TotalTimeout,
                $"{nameof(HttpReadOptions.TotalTimeout)} must be positive.");
        }
    }
}
