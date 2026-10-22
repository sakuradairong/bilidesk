namespace BiliDesk.Infrastructure.Networking;

/// <summary>
/// Host allow-list that matches either the exact normalized host or a dot-boundary
/// subdomain suffix. Matching is never performed with a substring/contains check,
/// so entries such as <c>hdslb.com</c> do not match <c>hdslb.com.evil.com</c>.
/// </summary>
public sealed class HostAllowList
{
    private const int MaxHostLength = 253;
    private const int MaxLabelLength = 63;

    private readonly string[] _hosts;

    public static HostAllowList Empty { get; } = new(Array.Empty<string>());

    public HostAllowList(IEnumerable<string> hosts)
    {
        ArgumentNullException.ThrowIfNull(hosts);

        var normalized = new List<string>();
        foreach (var raw in hosts)
        {
            var host = NormalizeOrNull(raw)
                ?? throw new ArgumentException($"'{raw}' is not a valid DNS host name.", nameof(hosts));
            if (!normalized.Contains(host, StringComparer.Ordinal))
            {
                normalized.Add(host);
            }
        }

        _hosts = normalized.ToArray();
    }

    /// <summary>Normalized (lowercase, no trailing dot) hosts in the list.</summary>
    public IReadOnlyList<string> Hosts => _hosts;

    public bool IsAllowed(string? host)
    {
        var candidate = NormalizeOrNull(host);
        if (candidate is null)
        {
            return false;
        }

        foreach (var allowed in _hosts)
        {
            if (candidate.Length == allowed.Length
                && candidate.Equals(allowed, StringComparison.Ordinal))
            {
                return true;
            }

            // A subdomain must be separated by a dot. This is the only acceptable
            // suffix relationship; plain ends-with matching would accept
            // "evil-hdslb.com".
            var suffix = allowed.AsSpan();
            if (candidate.Length > suffix.Length
                && candidate[candidate.Length - suffix.Length - 1] == '.'
                && candidate.AsSpan(candidate.Length - suffix.Length).SequenceEqual(suffix))
            {
                return true;
            }
        }

        return false;
    }

    private static string? NormalizeOrNull(string? host)
    {
        if (host is null)
        {
            return null;
        }

        var value = host.Trim();
        if (value.Length == 0)
        {
            return null;
        }

        value = value.TrimEnd('.');
        if (value.Length == 0 || value.Length > MaxHostLength)
        {
            return null;
        }

        var labelLength = 0;
        var previousWasDot = false;
        foreach (var c in value)
        {
            if (c == '.')
            {
                if (previousWasDot || labelLength == 0)
                {
                    return null;
                }

                labelLength = 0;
                previousWasDot = true;
                continue;
            }

            if (!char.IsAsciiLetterOrDigit(c) && c != '-')
            {
                return null;
            }

            if (labelLength >= MaxLabelLength)
            {
                return null;
            }

            if (labelLength == 0 && c == '-')
            {
                return null;
            }

            labelLength++;
            previousWasDot = false;
        }

        if (labelLength == 0 || value[^1] == '-')
        {
            return null;
        }

        return value.ToLowerInvariant();
    }
}
