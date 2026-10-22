namespace BiliDesk.Infrastructure.Storage;

/// <summary>
/// 旧 SQLite 快照导入的失败分类。调用方依赖分类而非错误文案做分支。
/// </summary>
public enum LegacySnapshotImportFailure
{
    /// <summary>源库文件不存在；拒绝静默创建一个空源库。</summary>
    SourceMissing,

    /// <summary>源库无法以只读方式打开或读取。</summary>
    SourceUnreadable,

    /// <summary>源库文件不是可用的 SQLite 数据库，或完整性检查失败。</summary>
    SourceCorrupt,

    /// <summary>源库缺少要求的表/列/主键，或 schema 版本不在支持范围内。</summary>
    SourceSchemaUnsupported,

    /// <summary>目标路径已存在（含导入期间被其他进程抢先创建），拒绝覆盖。</summary>
    TargetExists,

    /// <summary>暂存库创建、备份或校验失败。</summary>
    TargetWriteFailed,

    /// <summary>校验通过的暂存库无法发布到目标路径。</summary>
    PublishFailed,
}
