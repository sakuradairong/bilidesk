namespace BiliDesk.Infrastructure.Networking;

/// <summary>
/// One read-only GET request. <see cref="AllowedHosts"/> is the destination
/// allow-list validated for the initial URI and for every redirect hop.
/// </summary>
public sealed class HttpReadRequest
{
    public HttpReadRequest(
        Uri uri,
        HostAllowList allowedHosts,
        bool allowCredentials = false,
        string? cookieHeader = null)
    {
        ArgumentNullException.ThrowIfNull(uri);
        ArgumentNullException.ThrowIfNull(allowedHosts);

        Uri = uri;
        AllowedHosts = allowedHosts;
        AllowCredentials = allowCredentials;
        CookieHeader = cookieHeader;
    }

    public Uri Uri { get; }

    public HostAllowList AllowedHosts { get; }

    /// <summary>
    /// Opt-in switch for credentials. It is still gated by
    /// <see cref="HttpReadOptions.TrustedApiHosts"/> and same-origin redirect rules.
    /// </summary>
    public bool AllowCredentials { get; }

    public string? CookieHeader { get; }

    /// <summary>Image/media request: credentials are always dropped.</summary>
    public static HttpReadRequest Image(Uri uri, HostAllowList imageHosts)
        => new(uri, imageHosts, allowCredentials: false, cookieHeader: null);

    /// <summary>Trusted first-party API request that may carry a session cookie.</summary>
    public static HttpReadRequest TrustedApi(Uri uri, HostAllowList apiHosts, string? cookieHeader = null)
        => new(uri, apiHosts, allowCredentials: !string.IsNullOrEmpty(cookieHeader), cookieHeader);
}
