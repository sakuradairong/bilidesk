using Microsoft.Data.Sqlite;

namespace BiliDesk.Infrastructure.Storage;

/// <summary>
/// 将旧版 Rust 客户端的 SQLite 数据库以只读快照方式导入到独立的新库。
///
/// 约束：
/// - 源库只以 ReadOnly 打开，绝不写入，也不在校验失败时被替换或删除；
/// - 目标库只允许首次创建，已存在时直接拒绝，绝不覆盖；
/// - 先写入同目录下的暂存文件，校验 quick_check、schema 版本、四张表结构与计数后，
///   再以不覆盖的方式原子发布；任何失败都会清理暂存文件，不留下可误用的目标库；
/// - 仅支持当前四表 schema（schema_migrations/history/settings/play_progress），
///   旧 history.json、DPAPI 会话文件不在本模块范围内。
/// </summary>
public static class LegacySqliteSnapshotImporter
{
    /// <summary>旧版 Rust 客户端当前写入的 schema 版本（schema_migrations.version）。</summary>
    public const int CurrentSchemaVersion = 1;

    private const string StagingSuffix = ".importing";

    private static readonly RequiredTable[] RequiredTables =
    [
        new("schema_migrations",
        [
            new ColumnSpec("version", "INTEGER", 1),
            new ColumnSpec("applied_at", "INTEGER", 0),
        ]),
        new("history",
        [
            new ColumnSpec("bvid", "TEXT", 1),
            new ColumnSpec("title", "TEXT", 0),
            new ColumnSpec("cover", "TEXT", 0),
            new ColumnSpec("owner", "TEXT", 0),
            new ColumnSpec("viewed_at", "INTEGER", 0),
        ]),
        new("settings",
        [
            new ColumnSpec("key", "TEXT", 1),
            new ColumnSpec("value", "TEXT", 0),
        ]),
        new("play_progress",
        [
            new ColumnSpec("bvid", "TEXT", 1),
            new ColumnSpec("cid", "INTEGER", 2),
            new ColumnSpec("position", "REAL", 0),
            new ColumnSpec("duration", "REAL", 0),
            new ColumnSpec("updated_at", "INTEGER", 0),
        ]),
    ];

    /// <summary>
    /// 从 <paramref name="sourcePath"/> 读取快照并发布到 <paramref name="targetPath"/>。
    /// 目标路径已存在、源库缺失/损坏/schema 不受支持时抛出
    /// <see cref="LegacySnapshotImportException"/>，且不修改源库、不覆盖目标。
    /// </summary>
    public static SnapshotImportResult Import(string sourcePath, string targetPath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sourcePath);
        ArgumentException.ThrowIfNullOrWhiteSpace(targetPath);

        var source = Path.GetFullPath(sourcePath);
        var target = Path.GetFullPath(targetPath);

        if (string.Equals(source, target, StringComparison.OrdinalIgnoreCase))
        {
            throw new LegacySnapshotImportException(
                LegacySnapshotImportFailure.TargetExists,
                "源库与目标路径相同，拒绝覆盖。");
        }

        if (File.Exists(target) || Directory.Exists(target))
        {
            throw new LegacySnapshotImportException(
                LegacySnapshotImportFailure.TargetExists,
                $"目标库已存在，拒绝覆盖：{target}");
        }

        if (!File.Exists(source))
        {
            throw new LegacySnapshotImportException(
                LegacySnapshotImportFailure.SourceMissing,
                $"源库不存在，拒绝创建空库：{source}");
        }

        string? staging = null;
        try
        {
            using var sourceConnection = OpenSourceReadOnly(source);
            _ = InspectSource(sourceConnection);

            var targetDirectory = Path.GetDirectoryName(target)
                ?? throw new LegacySnapshotImportException(
                    LegacySnapshotImportFailure.TargetWriteFailed,
                    "目标路径缺少父目录。");
            Directory.CreateDirectory(targetDirectory);

            staging = Path.Combine(
                targetDirectory,
                $".{Path.GetFileName(target)}.{Guid.NewGuid():N}{StagingSuffix}");

            using (var stagingConnection = OpenStaging(staging))
            {
                try
                {
                    sourceConnection.BackupDatabase(stagingConnection);
                }
                catch (SqliteException ex)
                {
                    throw new LegacySnapshotImportException(
                        LegacySnapshotImportFailure.TargetWriteFailed,
                        "备份源库到暂存库失败。",
                        ex);
                }
            }

            var staged = FinalizeStaging(staging);
            DeleteSidecarFiles(staging);
            Publish(staging, target);
            staging = null;

            return new SnapshotImportResult(
                target,
                (int)staged.SchemaVersion,
                staged.HistoryCount,
                staged.SettingsCount,
                staged.PlayProgressCount);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new LegacySnapshotImportException(
                LegacySnapshotImportFailure.TargetWriteFailed,
                "写入导入目标失败。",
                ex);
        }
        finally
        {
            if (staging is not null)
            {
                DeleteStagingArtifacts(staging);
            }
        }
    }

    private static SqliteConnection OpenSourceReadOnly(string path)
    {
        var connection = new SqliteConnection(BuildConnectionString(path, SqliteOpenMode.ReadOnly));
        try
        {
            connection.Open();
            return connection;
        }
        catch (Exception ex)
        {
            connection.Dispose();
            if (ex is SqliteException or IOException or UnauthorizedAccessException)
            {
                throw new LegacySnapshotImportException(
                    ex is SqliteException sqlite && IsCorruption(sqlite)
                        ? LegacySnapshotImportFailure.SourceCorrupt
                        : LegacySnapshotImportFailure.SourceUnreadable,
                    "无法以只读方式打开源库。",
                    ex);
            }

            throw;
        }
    }

    private static SqliteConnection OpenStaging(string path)
    {
        var connection = new SqliteConnection(BuildConnectionString(path, SqliteOpenMode.ReadWriteCreate));
        try
        {
            connection.Open();
            return connection;
        }
        catch (Exception ex)
        {
            connection.Dispose();
            if (ex is SqliteException or IOException or UnauthorizedAccessException)
            {
                throw new LegacySnapshotImportException(
                    LegacySnapshotImportFailure.TargetWriteFailed,
                    "无法打开暂存库。",
                    ex);
            }

            throw;
        }
    }

    private static string BuildConnectionString(string path, SqliteOpenMode mode) =>
        new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = mode,
            Pooling = false,
            DefaultTimeout = 5,
        }.ToString();

    private static SnapshotInfo InspectSource(SqliteConnection connection)
    {
        try
        {
            return Inspect(
                connection,
                LegacySnapshotImportFailure.SourceCorrupt,
                LegacySnapshotImportFailure.SourceSchemaUnsupported);
        }
        catch (SqliteException ex)
        {
            throw new LegacySnapshotImportException(
                IsCorruption(ex)
                    ? LegacySnapshotImportFailure.SourceCorrupt
                    : LegacySnapshotImportFailure.SourceUnreadable,
                "读取源库结构失败。",
                ex);
        }
    }

    private static SnapshotInfo FinalizeStaging(string stagingPath)
    {
        try
        {
            using var connection = OpenStaging(stagingPath);

            // BackupDatabase 会把源库页头里的 WAL 标记一起复制过来；显式切回单文件日志模式，
            // 保证发布出去的是一个自包含的 .db 文件，而不是还依赖 -wal/-shm 的库。
            var journalMode = ExecuteScalarText(connection, "PRAGMA journal_mode=DELETE;");
            if (!string.Equals(journalMode, "delete", StringComparison.OrdinalIgnoreCase))
            {
                throw new LegacySnapshotImportException(
                    LegacySnapshotImportFailure.TargetWriteFailed,
                    "暂存库无法切换为单文件日志模式。");
            }

            return Inspect(
                connection,
                LegacySnapshotImportFailure.TargetWriteFailed,
                LegacySnapshotImportFailure.TargetWriteFailed);
        }
        catch (SqliteException ex)
        {
            throw new LegacySnapshotImportException(
                LegacySnapshotImportFailure.TargetWriteFailed,
                "暂存库校验失败。",
                ex);
        }
    }

    private static void Publish(string staging, string target)
    {
        try
        {
            File.Move(staging, target, overwrite: false);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            if (File.Exists(target) || Directory.Exists(target))
            {
                throw new LegacySnapshotImportException(
                    LegacySnapshotImportFailure.TargetExists,
                    "目标库在导入期间被创建，拒绝覆盖。",
                    ex);
            }

            throw new LegacySnapshotImportException(
                LegacySnapshotImportFailure.PublishFailed,
                "发布导入结果失败。",
                ex);
        }
    }

    private static void DeleteStagingArtifacts(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (IOException)
        {
            // 尽力清理；失败也不允许把暂存文件当成目标发布。
        }
        catch (UnauthorizedAccessException)
        {
            // 同上。
        }

        DeleteSidecarFiles(path);
    }

    private static void DeleteSidecarFiles(string path)
    {
        foreach (var candidate in new[] { path + "-wal", path + "-shm", path + "-journal" })
        {
            try
            {
                if (File.Exists(candidate))
                {
                    File.Delete(candidate);
                }
            }
            catch (IOException)
            {
                // 已切回 DELETE 日志模式，副文件不应再携带数据；删除失败不回滚已校验结果。
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }

    private static SnapshotInfo Inspect(
        SqliteConnection connection,
        LegacySnapshotImportFailure corruptFailure,
        LegacySnapshotImportFailure unsupportedFailure)
    {
        EnsureQuickCheck(connection, corruptFailure);

        var tables = ReadTableNames(connection);
        var missingTables = RequiredTables
            .Select(table => table.Name)
            .Where(name => !tables.Contains(name))
            .ToArray();
        if (missingTables.Length > 0)
        {
            throw new LegacySnapshotImportException(
                unsupportedFailure,
                $"数据库缺少必需的表：{string.Join(", ", missingTables)}。");
        }

        ValidateShapes(connection, unsupportedFailure);

        var schemaVersion = ReadSchemaVersion(connection);
        if (schemaVersion != CurrentSchemaVersion)
        {
            throw new LegacySnapshotImportException(
                unsupportedFailure,
                $"不支持 schema 版本 {schemaVersion}，仅支持 {CurrentSchemaVersion}。");
        }

        return new SnapshotInfo(
            schemaVersion,
            CountRows(connection, "history"),
            CountRows(connection, "settings"),
            CountRows(connection, "play_progress"));
    }

    private static void EnsureQuickCheck(
        SqliteConnection connection,
        LegacySnapshotImportFailure corruptFailure)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA quick_check;";
        using var reader = command.ExecuteReader();

        var found = false;
        while (reader.Read())
        {
            found = true;
            if (reader.IsDBNull(0))
            {
                continue;
            }

            var result = reader.GetString(0);
            if (!string.Equals(result, "ok", StringComparison.OrdinalIgnoreCase))
            {
                throw new LegacySnapshotImportException(
                    corruptFailure,
                    $"完整性检查失败：{result}");
            }
        }

        if (!found)
        {
            throw new LegacySnapshotImportException(
                corruptFailure,
                "完整性检查没有返回结果。");
        }
    }

    private static HashSet<string> ReadTableNames(SqliteConnection connection)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';";
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            if (!reader.IsDBNull(0))
            {
                names.Add(reader.GetString(0));
            }
        }

        return names;
    }

    private static void ValidateShapes(
        SqliteConnection connection,
        LegacySnapshotImportFailure unsupportedFailure)
    {
        foreach (var table in RequiredTables)
        {
            var columns = ReadColumns(connection, table.Name);
            foreach (var expected in table.Columns)
            {
                if (!columns.TryGetValue(expected.Name, out var actual))
                {
                    throw new LegacySnapshotImportException(
                        unsupportedFailure,
                        $"表 {table.Name} 缺少列 {expected.Name}，schema 不受支持。");
                }

                if (!string.Equals(actual.Type.Trim(), expected.Type, StringComparison.OrdinalIgnoreCase)
                    || actual.PrimaryKeyOrdinal != expected.PrimaryKeyOrdinal)
                {
                    throw new LegacySnapshotImportException(
                        unsupportedFailure,
                        $"表 {table.Name} 的列 {expected.Name} 定义不受支持。");
                }
            }
        }
    }

    private static Dictionary<string, ColumnInfo> ReadColumns(
        SqliteConnection connection,
        string tableName)
    {
        var columns = new Dictionary<string, ColumnInfo>(StringComparer.OrdinalIgnoreCase);
        using var command = connection.CreateCommand();
        command.CommandText = tableName switch
        {
            "schema_migrations" => "PRAGMA table_info(schema_migrations);",
            "history" => "PRAGMA table_info(history);",
            "settings" => "PRAGMA table_info(settings);",
            "play_progress" => "PRAGMA table_info(play_progress);",
            _ => throw new ArgumentOutOfRangeException(nameof(tableName), tableName, "未知表。"),
        };
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            // table_info: cid, name, type, notnull, dflt_value, pk.
            var name = reader.GetString(1);
            var type = reader.IsDBNull(2) ? string.Empty : reader.GetString(2);
            var primaryKeyOrdinal = reader.GetInt32(5);
            columns[name] = new ColumnInfo(type, primaryKeyOrdinal);
        }

        return columns;
    }

    private static long ReadSchemaVersion(SqliteConnection connection) =>
        ExecuteScalarInt64(
            connection,
            "SELECT COALESCE(MAX(CAST(version AS INTEGER)), 0) FROM schema_migrations;");

    private static long CountRows(SqliteConnection connection, string tableName) => tableName switch
    {
        "history" => ExecuteScalarInt64(connection, "SELECT COUNT(*) FROM history;"),
        "settings" => ExecuteScalarInt64(connection, "SELECT COUNT(*) FROM settings;"),
        "play_progress" => ExecuteScalarInt64(connection, "SELECT COUNT(*) FROM play_progress;"),
        _ => throw new ArgumentOutOfRangeException(nameof(tableName), tableName, "未知表。"),
    };

    private static long ExecuteScalarInt64(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        var value = command.ExecuteScalar();
        return value is null or DBNull ? 0 : Convert.ToInt64(value);
    }

    private static string? ExecuteScalarText(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return command.ExecuteScalar() as string;
    }

    private static bool IsCorruption(SqliteException exception) =>
        exception.SqliteErrorCode is 11 or 24 or 26;

    private readonly record struct ColumnSpec(string Name, string Type, int PrimaryKeyOrdinal);

    private readonly record struct ColumnInfo(string Type, int PrimaryKeyOrdinal);

    private sealed record RequiredTable(string Name, ColumnSpec[] Columns);

    private readonly record struct SnapshotInfo(
        long SchemaVersion,
        long HistoryCount,
        long SettingsCount,
        long PlayProgressCount);
}
