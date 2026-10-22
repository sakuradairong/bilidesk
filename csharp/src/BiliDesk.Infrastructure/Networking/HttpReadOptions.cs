namespace BiliDesk.Infrastructure.Networking;

/// <summary>
/// Limits and credential policy for <see cref="RestrictedHttpReader"/>.
/// Values are validated when the reader is constructed.
/// </summary>
public sealed class HttpReadOptions
{
    public const int DefaultMaxRawBytes = 8 * 1024 * 1024;
    public const int DefaultMaxDecodedBytes = 16 * 1024 * 1024;
    public const int DefaultMaxRedirects = 5;

    public static readonly TimeSpan DefaultTotalTimeout = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Hosts that may receive cookies. A cookie is attached only when the request
    /// host is listed here, the request explicitly allows credentials, and the hop
    /// is the same origin as the initial request.
    /// </summary>
    public HostAllowList TrustedApiHosts { get; init; } = HostAllowList.Empty;

    /// <summary>Maximum number of bytes read from the wire (compressed form).</summary>
    public int MaxRawBytes { get; init; } = DefaultMaxRawBytes;

    /// <summary>Maximum number of bytes produced by decompression (or an identity body).</summary>
    public int MaxDecodedBytes { get; init; } = DefaultMaxDecodedBytes;

    /// <summary>Maximum number of redirects followed before failing.</summary>
    public int MaxRedirects { get; init; } = DefaultMaxRedirects;

    /// <summary>Total budget covering DNS/connect, all redirect hops, and body reads.</summary>
    public TimeSpan TotalTimeout { get; init; } = DefaultTotalTimeout;
}
