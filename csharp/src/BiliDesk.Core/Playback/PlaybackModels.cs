namespace BiliDesk.Core.Playback;

/// <summary>
/// 协调器对外暴露的资源状态。Faulted 表示上一次 Stop 失败或超时，
/// native 资源可能仍被占用，必须重试 Stop 才能重开。
/// </summary>
public enum PlaybackState
{
    Idle,
    Opening,
    Playing,
    Stopping,
    Faulted,
}

/// <summary>后端向协调器上报的事件种类。</summary>
public enum PlaybackEventKind
{
    Opened,
    Progress,
    EndOfFile,
    Failed,
}

/// <summary>
/// 一次打开请求。只携带 future MPV adapter 必需的最小信息，
/// 具体头部/字幕等参数由适配器在 CreateAsync 内部拼装。
/// </summary>
public sealed record PlaybackOpenRequest
{
    public PlaybackOpenRequest(string source)
    {
        if (string.IsNullOrWhiteSpace(source))
        {
            throw new ArgumentException("播放源不能为空。", nameof(source));
        }

        Source = source;
    }

    public string Source { get; }
}

/// <summary>后端事件。每个事件都带会话身份，协调器会丢弃不属于当前会话的事件。</summary>
public sealed record PlaybackEvent(
    PlaybackSessionId SessionId,
    PlaybackEventKind Kind,
    double PositionSeconds = 0,
    double DurationSeconds = 0,
    string? Message = null);

/// <summary>不可变快照。<see cref="Revision"/> 每次发布递增，便于订阅方去重。</summary>
public sealed record PlaybackSnapshot(
    PlaybackSessionId? SessionId,
    PlaybackState State,
    PlaybackOpenRequest? Request,
    double PositionSeconds,
    double DurationSeconds,
    bool Ended,
    string? Message,
    long Revision);

public enum PlaybackOpenStatus
{
    /// <summary>新会话已创建并进入 Playing。</summary>
    Opened,

    /// <summary>更晚的 Open 请求已经接管，旧请求创建的会话已被拆除。</summary>
    Superseded,

    /// <summary>上一次会话未能释放（Faulted），拒绝创建新的 native 会话。</summary>
    RejectedNotReleased,

    /// <summary>后端创建失败。</summary>
    Failed,
}

public sealed record PlaybackOpenResult(
    PlaybackOpenStatus Status,
    PlaybackSessionId SessionId,
    PlaybackSnapshot Snapshot,
    string? Message = null)
{
    public bool Succeeded => Status == PlaybackOpenStatus.Opened;
}

public enum PlaybackStopStatus
{
    /// <summary>目标会话已停止并且资源已释放。</summary>
    Stopped,

    /// <summary>本就没有活跃会话，幂等成功。</summary>
    AlreadyIdle,

    /// <summary>目标会话已不是当前会话（被替换或已停止），未触碰任何资源。</summary>
    NotCurrent,

    /// <summary>停止失败或超时；状态进入 Faulted，native 资源可能仍在使用。</summary>
    Failed,
}

public sealed record PlaybackStopResult(
    PlaybackStopStatus Status,
    PlaybackSnapshot Snapshot,
    string? Message = null)
{
    public bool Succeeded => Status != PlaybackStopStatus.Failed;
}
