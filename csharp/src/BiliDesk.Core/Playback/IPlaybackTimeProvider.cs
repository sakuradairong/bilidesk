namespace BiliDesk.Core.Playback;

/// <summary>
/// 协调器唯一的时间来源：停止超时与时间戳都通过它获取，
/// 测试可以注入手动实现，避免真实睡眠。
/// </summary>
public interface IPlaybackTimeProvider
{
    DateTimeOffset UtcNow { get; }

    Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken);
}

/// <summary>生产实现，直接使用 <see cref="Task.Delay(TimeSpan, CancellationToken)"/>。</summary>
public sealed class SystemPlaybackTimeProvider : IPlaybackTimeProvider
{
    public static SystemPlaybackTimeProvider Instance { get; } = new();

    private SystemPlaybackTimeProvider()
    {
    }

    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;

    public Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken)
    {
        if (delay <= TimeSpan.Zero)
        {
            return Task.CompletedTask;
        }

        return Task.Delay(delay, cancellationToken);
    }
}
