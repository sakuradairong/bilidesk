using System.Security.Cryptography;
using System.Text;

namespace BiliDesk.Windows.Security;

/// <summary>
/// Protects session JSON using the legacy envelope and current-user DPAPI.
/// Does not parse JSON, access files, or fall back to plaintext.
/// </summary>
public sealed class SessionProtector
{
    private static readonly byte[] Magic = Encoding.ASCII.GetBytes("BILIDESK_SESSION_V1\0");
    private const int MaximumPayloadBytes = 1024 * 1024;

    public byte[] Protect(byte[] json)
    {
        ArgumentNullException.ThrowIfNull(json);
        EnsureWindows();
        if (json.Length == 0 || json.Length > MaximumPayloadBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(json), "Session size is invalid.");
        }

        var encrypted = ProtectedData.Protect(json, null, DataProtectionScope.CurrentUser);
        var envelope = new byte[Magic.Length + encrypted.Length];
        Magic.CopyTo(envelope, 0);
        encrypted.CopyTo(envelope, Magic.Length);
        return envelope;
    }

    public byte[] Unprotect(byte[] envelope)
    {
        ArgumentNullException.ThrowIfNull(envelope);
        EnsureWindows();
        if (envelope.Length <= Magic.Length ||
            envelope.Length > MaximumPayloadBytes + 65536 ||
            !envelope.AsSpan().StartsWith(Magic))
        {
            throw new CryptographicException("Invalid encrypted session envelope.");
        }

        var json = ProtectedData.Unprotect(
            envelope.AsSpan(Magic.Length).ToArray(), null, DataProtectionScope.CurrentUser);
        if (json.Length == 0 || json.Length > MaximumPayloadBytes)
        {
            CryptographicOperations.ZeroMemory(json);
            throw new CryptographicException("Session payload exceeds the size limit.");
        }

        return json;
    }

    private static void EnsureWindows()
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Session encryption requires Windows DPAPI.");
        }
    }
}
