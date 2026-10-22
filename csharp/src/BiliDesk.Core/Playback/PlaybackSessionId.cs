namespace BiliDesk.Core.Playback;

/// <summary>
/// 一次播放尝试的身份。协调器为每个 <c>OpenAsync</c> 调用分配单调递增的值，
/// 旧会话的事件与旧 Stop 请求都依靠它隔离，不会被误用于新会话。
/// </summary>
public readonly record struct PlaybackSessionId(long Value)
{
    public override string ToString() => $"playback-session-{Value}";
}
