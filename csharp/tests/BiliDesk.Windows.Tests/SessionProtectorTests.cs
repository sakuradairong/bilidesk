using System.Security.Cryptography;
using System.Text;
using BiliDesk.Windows.Security;

namespace BiliDesk.Windows.Tests;

public sealed class SessionProtectorTests
{
    private readonly SessionProtector _protector = new();

    [Fact]
    public void RoundTripUsesLegacyMagicAndHidesPayload()
    {
        byte[] json = """{"cookies":{"SESSDATA":"synthetic-test-only"}}"""u8.ToArray();

        var envelope = _protector.Protect(json);

        Assert.True(envelope.AsSpan().StartsWith("BILIDESK_SESSION_V1\0"u8));
        Assert.DoesNotContain("synthetic-test-only", Encoding.UTF8.GetString(envelope));
        Assert.Equal(json, _protector.Unprotect(envelope));
    }

    [Fact]
    public void ReadsNativeCurrentUserDpapiPayloadWithLegacyEnvelope()
    {
        // Equivalent DPAPI scope/entropy to Rust; not a real Rust-produced fixture.
        byte[] json = """{"cookies":{"bili_jct":"synthetic"}}"""u8.ToArray();
        byte[] nativePayload = ProtectedData.Protect(json, null, DataProtectionScope.CurrentUser);
        byte[] envelope = [.. "BILIDESK_SESSION_V1\0"u8.ToArray(), .. nativePayload];

        Assert.Equal(json, _protector.Unprotect(envelope));
    }

    [Fact]
    public void PlaintextIsNeverAcceptedAsEncryptedSession()
    {
        Assert.Throws<CryptographicException>(() =>
            _protector.Unprotect("""{"cookies":{}}"""u8.ToArray()));
    }

    [Fact]
    public void DamagedCiphertextIsRejected()
    {
        byte[] envelope = _protector.Protect("""{"cookies":{}}"""u8.ToArray());
        Array.Fill(envelope, (byte)0, "BILIDESK_SESSION_V1\0"u8.Length,
            envelope.Length - "BILIDESK_SESSION_V1\0"u8.Length);

        Assert.Throws<CryptographicException>(() => _protector.Unprotect(envelope));
    }

    [Fact]
    public void OversizedPayloadIsRejectedBeforeEncryption()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            _protector.Protect(new byte[1024 * 1024 + 1]));
    }
}
