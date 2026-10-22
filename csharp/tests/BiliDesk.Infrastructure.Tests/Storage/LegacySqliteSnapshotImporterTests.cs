using System.Text;
using BiliDesk.Infrastructure.Storage;
using Microsoft.Data.Sqlite;

namespace BiliDesk.Infrastructure.Tests.Storage;

public sealed class LegacySqliteSnapshotImporterTests
{
    [Fact]
    public void Import_preserves_tables_keys_settings_and_progress_precision()
    {
        using var workspace = new TempWorkspace();
        var source = workspace.PathFor("bilidesk.db");
        var target = workspace.PathFor("imported.db");

        LegacyDatabases.CreateCurrent(source, connection =>
        {
            LegacyDatabases.Execute(
                connection,
                "INSERT INTO history (bvid, title, cover, owner, viewed_at) VALUES ($bvid, $title, $cover, $owner, $viewedAt);",
                ("$bvid", "BV1d05legacy"),
                ("$title", "旧版历史"),
                ("$cover", "https://example.invalid/cover.jpg"),
                ("$owner", "旧 UP 主"),
                ("$viewedAt", 1_700_000_123L));
            LegacyDatabases.Execute(
                connection,
                "INSERT INTO settings (key, value) VALUES ($key, $value);",
                ("$key", "theme"),
                ("$value", "dark"));
            LegacyDatabases.Execute(
                connection,
                "INSERT INTO settings (key, value) VALUES ($key, $value);",
                ("$key", "unknown_future_setting"),
                ("$value", "  keep 007 中文 "));
            LegacyDatabases.Execute(
                connection,
                "INSERT INTO play_progress (bvid, cid, position, duration, updated_at) VALUES ($bvid, $cid, $position, $duration, $updatedAt);",
                ("$bvid", "BV1d05legacy"),
                ("$cid", 987654L),
                ("$position", 123.456789012345),
                ("$duration", 987.654321098765),
                ("$updatedAt", 1_700_000_456L));
        });

        var result = LegacySqliteSnapshotImporter.Import(source, target);

        Assert.Equal(1, result.SchemaVersion);
        Assert.Equal(1, result.HistoryCount);
        Assert.Equal(2, result.SettingsCount);
        Assert.Equal(1, result.PlayProgressCount);
        Assert.Equal(target, result.TargetPath);
        Assert.False(File.Exists(target + "-wal"));
        Assert.False(File.Exists(target + "-shm"));
        Assert.Equal(new[] { "bilidesk.db", "imported.db" }, workspace.FileNames());

        using (var connection = LegacyDatabases.OpenReadOnly(target))
        {
            Assert.Equal(
                "旧版历史",
                LegacyDatabases.ScalarText(connection, "SELECT title FROM history WHERE bvid = 'BV1d05legacy';"));
            Assert.Equal(
                1_700_000_123L,
                LegacyDatabases.ScalarInt64(connection, "SELECT viewed_at FROM history WHERE bvid = 'BV1d05legacy';"));
            Assert.Equal(
                "dark",
                LegacyDatabases.ScalarText(connection, "SELECT value FROM settings WHERE key = 'theme';"));
            Assert.Equal(
                "  keep 007 中文 ",
                LegacyDatabases.ScalarText(connection, "SELECT value FROM settings WHERE key = 'unknown_future_setting';"));
            Assert.Equal(
                123.456789012345,
                LegacyDatabases.ScalarDouble(
                    connection,
                    "SELECT position FROM play_progress WHERE bvid = 'BV1d05legacy' AND cid = 987654;"));
            Assert.Equal(
                987.654321098765,
                LegacyDatabases.ScalarDouble(
                    connection,
                    "SELECT duration FROM play_progress WHERE bvid = 'BV1d05legacy' AND cid = 987654;"));
            Assert.Equal(
                1_700_000_456L,
                LegacyDatabases.ScalarInt64(
                    connection,
                    "SELECT updated_at FROM play_progress WHERE bvid = 'BV1d05legacy' AND cid = 987654;"));
            Assert.Equal(
                1_699_999_999L,
                LegacyDatabases.ScalarInt64(
                    connection,
                    "SELECT applied_at FROM schema_migrations WHERE version = 1;"));
            Assert.Equal(
                5L,
                LegacyDatabases.ScalarInt64(
                    connection,
                    "SELECT COUNT(*) FROM pragma_table_info('history');"));
            Assert.Equal(
                2L,
                LegacyDatabases.ScalarInt64(
                    connection,
                    "SELECT COUNT(*) FROM pragma_table_info('play_progress') WHERE pk > 0;"));
        }

        using (var writable = LegacyDatabases.OpenWritable(target))
        {
            Assert.Throws<SqliteException>(() => LegacyDatabases.Execute(
                writable,
                "INSERT INTO history (bvid, title, cover, owner, viewed_at) VALUES ('BV1d05legacy', 'x', 'x', 'x', 1);"));
            Assert.Throws<SqliteException>(() => LegacyDatabases.Execute(
                writable,
                "INSERT INTO settings (key, value) VALUES ('theme', 'x');"));
            Assert.Throws<SqliteException>(() => LegacyDatabases.Execute(
                writable,
                "INSERT INTO play_progress (bvid, cid, position, duration, updated_at) VALUES ('BV1d05legacy', 987654, 1.0, 2.0, 3);"));
            LegacyDatabases.Execute(
                writable,
                "INSERT INTO play_progress (bvid, cid, position, duration, updated_at) VALUES ('BV1d05legacy', 987655, 1.0, 2.0, 3);");
        }
    }

    [Fact]
    public void Import_refuses_existing_target_and_leaves_it_untouched()
    {
        using var workspace = new TempWorkspace();
        var source = workspace.PathFor("bilidesk.db");
        var target = workspace.PathFor("imported.db");
        LegacyDatabases.CreateCurrent(source);
        var sentinel = new byte[] { 0x42, 0x49, 0x4C, 0x49 };
        File.WriteAllBytes(target, sentinel);

        var error = Assert.Throws<LegacySnapshotImportException>(() =>
        {
            _ = LegacySqliteSnapshotImporter.Import(source, target);
        });

        Assert.Equal(LegacySnapshotImportFailure.TargetExists, error.Failure);
        Assert.Equal(sentinel, File.ReadAllBytes(target));
        Assert.Equal(new[] { "bilidesk.db", "imported.db" }, workspace.FileNames());
    }

    [Fact]
    public void Import_rejects_repeated_import_of_same_target()
    {
        using var workspace = new TempWorkspace();
        var source = workspace.PathFor("bilidesk.db");
        var target = workspace.PathFor("imported.db");
        LegacyDatabases.CreateCurrent(source, connection => LegacyDatabases.Execute(
            connection,
            "INSERT INTO history (bvid, title, cover, owner, viewed_at) VALUES ('BV1repeat', 't', 'c', 'o', 1700000000);"));

        var first = LegacySqliteSnapshotImporter.Import(source, target);
        Assert.Equal(1, first.HistoryCount);
        var targetBytes = File.ReadAllBytes(target);

        var error = Assert.Throws<LegacySnapshotImportException>(() =>
        {
            _ = LegacySqliteSnapshotImporter.Import(source, target);
        });

        Assert.Equal(LegacySnapshotImportFailure.TargetExists, error.Failure);
        Assert.Equal(targetBytes, File.ReadAllBytes(target));
        using var connection = LegacyDatabases.OpenReadOnly(target);
        Assert.Equal(1L, LegacyDatabases.ScalarInt64(connection, "SELECT COUNT(*) FROM history;"));
    }

    [Fact]
    public void Import_keeps_source_database_bytes_unchanged()
    {
        using var workspace = new TempWorkspace();
        var source = workspace.PathFor("bilidesk.db");
        var target = workspace.PathFor("imported.db");
        LegacyDatabases.CreateCurrent(source, connection => LegacyDatabases.Execute(
            connection,
            "INSERT INTO history (bvid, title, cover, owner, viewed_at) VALUES ('BV1source', 't', 'c', 'o', 1700000000);"));
        var sourceBytes = File.ReadAllBytes(source);

        _ = LegacySqliteSnapshotImporter.Import(source, target);

        Assert.Equal(sourceBytes, File.ReadAllBytes(source));
        Assert.False(File.Exists(source + "-wal"));
        Assert.False(File.Exists(source + "-shm"));
        Assert.False(File.Exists(source + "-journal"));
        Assert.Equal(new[] { "bilidesk.db", "imported.db" }, workspace.FileNames());
    }

    [Fact]
    public void Import_captures_uncheckpointed_wal_frames_without_touching_source()
    {
        using var workspace = new TempWorkspace();
        var source = workspace.PathFor("bilidesk.db");
        var target = workspace.PathFor("imported.db");

        using (var writer = LegacyDatabases.OpenWritable(source))
        {
            LegacyDatabases.Execute(writer, "PRAGMA journal_mode=WAL;");
            LegacyDatabases.Execute(writer, "PRAGMA wal_autocheckpoint=0;");
            LegacyDatabases.Execute(writer, LegacyDatabases.SchemaSql);
            LegacyDatabases.Execute(writer, "INSERT INTO schema_migrations (version, applied_at) VALUES (1, 1699999999);");
            LegacyDatabases.Execute(
                writer,
                "INSERT INTO history (bvid, title, cover, owner, viewed_at) VALUES ('BV1wal', 'WAL', 'c', 'o', 1700000123);");

            var walPath = source + "-wal";
            Assert.True(File.Exists(walPath));
            var sourceBytes = File.ReadAllBytes(source);
            var walBytes = File.ReadAllBytes(walPath);

            var result = LegacySqliteSnapshotImporter.Import(source, target);

            Assert.Equal(1, result.HistoryCount);
            Assert.Equal(sourceBytes, File.ReadAllBytes(source));
            Assert.Equal(walBytes, File.ReadAllBytes(walPath));
        }

        using var reader = LegacyDatabases.OpenReadOnly(target);
        Assert.Equal(
            "WAL",
            LegacyDatabases.ScalarText(reader, "SELECT title FROM history WHERE bvid = 'BV1wal';"));
    }

    [Fact]
    public void Import_rejects_corrupt_source_without_creating_target()
    {
        using var workspace = new TempWorkspace();
        var source = workspace.PathFor("bilidesk.db");
        var target = workspace.PathFor("imported.db");
        File.WriteAllBytes(source, Encoding.ASCII.GetBytes("BILIDESK NOT A SQLITE DATABASE"));

        var error = Assert.Throws<LegacySnapshotImportException>(() =>
        {
            _ = LegacySqliteSnapshotImporter.Import(source, target);
        });

        Assert.Equal(LegacySnapshotImportFailure.SourceCorrupt, error.Failure);
        Assert.False(File.Exists(target));
        Assert.Equal(new[] { "bilidesk.db" }, workspace.FileNames());
    }

    [Fact]
    public void Import_rejects_source_missing_required_tables()
    {
        using var workspace = new TempWorkspace();
        var source = workspace.PathFor("bilidesk.db");
        var target = workspace.PathFor("imported.db");
        using (var connection = LegacyDatabases.OpenWritable(source))
        {
            LegacyDatabases.Execute(
                connection,
                "CREATE TABLE history (bvid TEXT PRIMARY KEY, title TEXT NOT NULL, cover TEXT NOT NULL, owner TEXT NOT NULL, viewed_at INTEGER NOT NULL);");
        }

        var error = Assert.Throws<LegacySnapshotImportException>(() =>
        {
            _ = LegacySqliteSnapshotImporter.Import(source, target);
        });

        Assert.Equal(LegacySnapshotImportFailure.SourceSchemaUnsupported, error.Failure);
        Assert.False(File.Exists(target));
        Assert.Equal(new[] { "bilidesk.db" }, workspace.FileNames());
    }

    [Fact]
    public void Import_rejects_future_schema_version()
    {
        using var workspace = new TempWorkspace();
        var source = workspace.PathFor("bilidesk.db");
        var target = workspace.PathFor("imported.db");
        LegacyDatabases.CreateCurrent(source);
        using (var connection = LegacyDatabases.OpenWritable(source))
        {
            LegacyDatabases.Execute(
                connection,
                "INSERT INTO schema_migrations (version, applied_at) VALUES (2, 1700000000);");
        }

        var error = Assert.Throws<LegacySnapshotImportException>(() =>
        {
            _ = LegacySqliteSnapshotImporter.Import(source, target);
        });

        Assert.Equal(LegacySnapshotImportFailure.SourceSchemaUnsupported, error.Failure);
        Assert.False(File.Exists(target));
        Assert.Equal(new[] { "bilidesk.db" }, workspace.FileNames());
    }

    [Fact]
    public void Import_rejects_source_without_schema_version_marker()
    {
        using var workspace = new TempWorkspace();
        var source = workspace.PathFor("bilidesk.db");
        var target = workspace.PathFor("imported.db");
        LegacyDatabases.CreateWithSchemaOnly(source);

        var error = Assert.Throws<LegacySnapshotImportException>(() =>
        {
            _ = LegacySqliteSnapshotImporter.Import(source, target);
        });

        Assert.Equal(LegacySnapshotImportFailure.SourceSchemaUnsupported, error.Failure);
        Assert.False(File.Exists(target));
        Assert.Equal(new[] { "bilidesk.db" }, workspace.FileNames());
    }

    [Fact]
    public void Import_rejects_missing_source_without_creating_files()
    {
        using var workspace = new TempWorkspace();
        var missing = workspace.PathFor("missing.db");
        var target = workspace.PathFor("nested/imported.db");

        var error = Assert.Throws<LegacySnapshotImportException>(() =>
        {
            _ = LegacySqliteSnapshotImporter.Import(missing, target);
        });

        Assert.Equal(LegacySnapshotImportFailure.SourceMissing, error.Failure);
        Assert.Empty(Directory.GetFileSystemEntries(workspace.Root));
    }

    [Fact]
    public void Import_refuses_source_that_is_also_the_target()
    {
        using var workspace = new TempWorkspace();
        var source = workspace.PathFor("bilidesk.db");
        LegacyDatabases.CreateCurrent(source);
        var sourceBytes = File.ReadAllBytes(source);

        var error = Assert.Throws<LegacySnapshotImportException>(() =>
        {
            _ = LegacySqliteSnapshotImporter.Import(source, source);
        });

        Assert.Equal(LegacySnapshotImportFailure.TargetExists, error.Failure);
        Assert.Equal(sourceBytes, File.ReadAllBytes(source));
    }
}
