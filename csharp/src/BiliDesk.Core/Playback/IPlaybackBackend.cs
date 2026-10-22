namespace BiliDesk.Core.Playback;

/// <summary>
/// 后端上报事件的出口。协调器为每个会话注入一个绑定会话身份的实例，
/// 因此适配器（未来 MPV adapter）不需要自己管理归属关系。
/// </summary>
public interface IPlaybackEventSink
{
    void Publish(PlaybackEvent playbackEvent);
}

/// <summary>
/// 一段已打开的原生播放会话。所有权属于 <see cref="PlaybackCoordinator"/>：
/// 只允许协调器调用 <see cref="StopAsync"/>，实现必须真正释放原生资源后才算成功。
/// </summary>
public interface IPlaybackBackend : IAsyncDisposable
{
    /// <summary>
    /// 释放原生资源。成功返回表示资源已释放；抛出异常或超出协调器给的时间预算表示
    /// 资源可能仍在使用，协调器会进入 Faulted 并拒绝重开。
    /// </summary>
    Task StopAsync(CancellationToken cancellationToken);
}

/// <summary>创建会话时交给适配器的上下文。</summary>
public sealed record PlaybackSessionContext(
    PlaybackSessionId SessionId,
    PlaybackOpenRequest Request,
    IPlaybackEventSink Events);

/// <summary>
/// native 会话工厂。约定：要么返回可用的 backend，要么抛出异常且不泄漏资源。
/// 工厂实现不得自行停止或替换其他会话，替换由协调器串行完成。
/// </summary>
public interface IPlaybackBackendFactory
{
    Task<IPlaybackBackend> CreateAsync(
        PlaybackSessionContext context,
        CancellationToken cancellationToken);
}
