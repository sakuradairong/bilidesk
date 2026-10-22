using Microsoft.Data.Sqlite;

namespace BiliDesk.Infrastructure.Tests.Storage;

/// <summary>每个测试独占的临时目录；不触碰任何真实用户数据目录。</summary>
internal sealed class TempWorkspace : IDisposable
{
    public TempWorkspace()
    {
        Root = Path.Combine(Path.GetTempPath(), "bilidesk-d05-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Root);
    }

    public string Root { get; }

    public string PathFor(string fileName) => Path.Combine(Root, fileName);

    public string[] FileNames() =>
        Directory.GetFiles(Root)
            .Select(file => Path.GetFileName(file)!)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

    public void Dispose()
    {
        try
        {
            Directory.Delete(Root, recursive: true);
        }
        catch (IOException)
        {
            // 清理失败不应掩盖测试断言结果。
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}

/// <summary>按 Rust 客户端的真实 schema 生成测试用旧库，全部使用临时目录。</summary>
internal static class LegacyDatabases
{
    public const string SchemaSql = """
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS history (
          bvid TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          cover TEXT NOT NULL,
          owner TEXT NOT NULL,
          viewed_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS play_progress (
          bvid TEXT NOT NULL,
          cid INTEGER NOT NULL,
          position REAL NOT NULL,
          duration REAL NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (bvid, cid)
        );
        """;

    public static SqliteConnection OpenWritable(string path)
    {
        var connection = new SqliteConnection(BuildConnectionString(path, SqliteOpenMode.ReadWriteCreate));
        connection.Open();
        return connection;
    }

    public static SqliteConnection OpenReadOnly(string path)
    {
        var connection = new SqliteConnection(BuildConnectionString(path, SqliteOpenMode.ReadOnly));
        connection.Open();
        return connection;
    }

    public static void Execute(
        SqliteConnection connection,
        string sql,
        params (string Name, object? Value)[] parameters)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        }

        command.ExecuteNonQuery();
    }

    public static void CreateCurrent(string path, Action<SqliteConnection>? seed = null)
    {
        using var connection = OpenWritable(path);
        Execute(connection, SchemaSql);
        Execute(connection, "INSERT INTO schema_migrations (version, applied_at) VALUES (1, 1699999999);");
        seed?.Invoke(connection);
    }

    public static void CreateWithSchemaOnly(string path)
    {
        using var connection = OpenWritable(path);
        Execute(connection, SchemaSql);
    }

    public static object? Scalar(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return command.ExecuteScalar();
    }

    public static string? ScalarText(SqliteConnection connection, string sql) =>
        Scalar(connection, sql) as string;

    public static long ScalarInt64(SqliteConnection connection, string sql)
    {
        var value = Scalar(connection, sql);
        return value is null or DBNull ? 0 : Convert.ToInt64(value);
    }

    public static double ScalarDouble(SqliteConnection connection, string sql)
    {
        var value = Scalar(connection, sql);
        return value is null or DBNull ? 0 : Convert.ToDouble(value);
    }

    private static string BuildConnectionString(string path, SqliteOpenMode mode) =>
        new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = mode,
            Pooling = false,
        }.ToString();
}
