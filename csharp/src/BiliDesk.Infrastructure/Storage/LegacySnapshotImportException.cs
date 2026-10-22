namespace BiliDesk.Infrastructure.Storage;

/// <summary>
/// 旧 SQLite 快照导入失败。失败时目标路径不会留下可通过校验的数据库文件。
/// </summary>
public sealed class LegacySnapshotImportException : Exception
{
    public LegacySnapshotImportException(LegacySnapshotImportFailure failure, string message)
        : base(message)
    {
        Failure = failure;
    }

    public LegacySnapshotImportException(
        LegacySnapshotImportFailure failure,
        string message,
        Exception innerException)
        : base(message, innerException)
    {
        Failure = failure;
    }

    public LegacySnapshotImportFailure Failure { get; }
}
