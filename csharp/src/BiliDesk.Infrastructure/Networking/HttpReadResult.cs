using System.Net;

namespace BiliDesk.Infrastructure.Networking;

/// <summary>
/// Fully buffered read result. <see cref="RawLength"/> is the number of bytes
/// received from the network before decompression; <see cref="Body"/> is the
/// decompressed payload and is bounded by <see cref="HttpReadOptions.MaxDecodedBytes"/>.
/// </summary>
public sealed class HttpReadResult
{
    public required HttpStatusCode StatusCode { get; init; }

    public required Uri FinalUri { get; init; }

    /// <summary>URIs of the redirect hops that were followed, in request order.</summary>
    public required IReadOnlyList<Uri> RedirectChain { get; init; }

    public required byte[] Body { get; init; }

    public required int RawLength { get; init; }

    public string? ContentType { get; init; }

    public string? ContentEncoding { get; init; }

    public bool WasDecompressed { get; init; }

    public bool IsSuccess => (int)StatusCode is >= 200 and <= 299;
}
