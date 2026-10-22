namespace BiliDesk.Infrastructure.Storage;

/// <summary>
/// 已发布快照的摘要。计数来自发布前重新校验过的暂存库。
/// </summary>
public sealed record SnapshotImportResult(
    string TargetPath,
    int SchemaVersion,
    long HistoryCount,
    long SettingsCount,
    long PlayProgressCount);
