namespace BiliDesk.Infrastructure.Networking;

public enum HttpReadFailureKind
{
    InvalidRequest,
    InsecureScheme,
    HostNotAllowed,
    RedirectLimitExceeded,
    InvalidRedirect,
    RawLimitExceeded,
    DecodedLimitExceeded,
    UnsupportedContentEncoding,
    DecompressionFailed,
    Timeout,
    TransportFailure,
}

/// <summary>
/// Failure raised by <see cref="RestrictedHttpReader"/>. The <see cref="Kind"/>
/// is stable so callers can map failures without parsing messages.
/// </summary>
public sealed class HttpReadException : Exception
{
    public HttpReadException(HttpReadFailureKind kind, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        Kind = kind;
    }

    public HttpReadFailureKind Kind { get; }

    /// <summary>
    /// Hop that failed, when known. The query string is intentionally never
    /// included in messages so signed URLs do not end up in logs.
    /// </summary>
    public Uri? TargetUri { get; init; }
}
