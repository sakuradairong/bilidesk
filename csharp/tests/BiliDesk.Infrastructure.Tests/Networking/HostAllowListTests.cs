using BiliDesk.Infrastructure.Networking;

namespace BiliDesk.Infrastructure.Tests.Networking;

public sealed class HostAllowListTests
{
    private static readonly HostAllowList List = new(["api.bilibili.com", "hdslb.com"]);

    [Theory]
    [InlineData("api.bilibili.com")]
    [InlineData("API.BILIBILI.COM")]
    [InlineData("api.bilibili.com.")]
    [InlineData("hdslb.com")]
    [InlineData("i0.hdslb.com")]
    [InlineData("a.b.c.hdslb.com")]
    [InlineData("  i0.hdslb.com  ")]
    public void AllowsExactHostAndDotBoundarySuffix(string host)
    {
        Assert.True(List.IsAllowed(host));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("evil.com")]
    [InlineData("api.bilibili.com.evil.com")]
    [InlineData("hdslb.com.evil.com")]
    [InlineData("xhdslb.com")]
    [InlineData("not-hdslb.com")]
    [InlineData("hdslb.co")]
    [InlineData(".hdslb.com")]
    [InlineData("evil..hdslb.com")]
    [InlineData("*.hdslb.com")]
    [InlineData("-hdslb.com")]
    [InlineData("hdslb.com-")]
    [InlineData("127.0.0.1")]
    [InlineData("localhost")]
    [InlineData("hdslb.com:443")]
    [InlineData("hdslb.com/path")]
    [InlineData(null)]
    public void RejectsHostsOutsideTheAllowList(string? host)
    {
        Assert.False(List.IsAllowed(host));
    }

    [Fact]
    public void EmptyAllowListRejectsEverything()
    {
        Assert.False(HostAllowList.Empty.IsAllowed("hdslb.com"));
        Assert.Empty(HostAllowList.Empty.Hosts);
    }

    [Theory]
    [InlineData("https://evil.com/")]
    [InlineData("bad host")]
    [InlineData("*.hdslb.com")]
    [InlineData("")]
    public void ConstructorRejectsInvalidEntries(string host)
    {
        Assert.Throws<ArgumentException>(() => new HostAllowList([host]));
    }

    [Fact]
    public void NormalizesAndDeduplicatesHosts()
    {
        var list = new HostAllowList(["API.Bilibili.COM", "api.bilibili.com.", "api.bilibili.com"]);

        var host = Assert.Single(list.Hosts);
        Assert.Equal("api.bilibili.com", host);
    }
}
