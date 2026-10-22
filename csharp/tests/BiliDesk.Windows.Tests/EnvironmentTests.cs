namespace BiliDesk.Windows.Tests;

public sealed class EnvironmentTests
{
    [Fact]
    public void PlatformTestsRequireWindows() => Assert.True(OperatingSystem.IsWindows());
}
