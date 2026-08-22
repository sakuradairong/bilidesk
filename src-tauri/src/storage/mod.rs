use crate::bili::error::{BiliError, BiliResult};
use crate::bili::models::{HistoryItem, PlayProgressRecord};
use crate::bili::session;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const HISTORY_MIGRATION_VERSION: i64 = 1;

const SCHEMA: &str = r#"
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
"#;

pub struct Storage {
    conn: Mutex<Connection>,
    data_dir: PathBuf,
}

impl Storage {
    pub fn open(data_dir: &Path) -> BiliResult<Self> {
        fs::create_dir_all(data_dir)?;
        let db_path = data_dir.join("bilidesk.db");
        let conn = Connection::open(&db_path).map_err(|e| BiliError::msg(e.to_string()))?;
        conn.execute_batch(SCHEMA)
            .map_err(|e| BiliError::msg(e.to_string()))?;
        let storage = Self {
            conn: Mutex::new(conn),
            data_dir: data_dir.to_path_buf(),
        };
        storage.migrate_legacy_history()?;
        storage.ensure_default_settings()?;
        Ok(storage)
    }

    fn migrated_path(&self) -> PathBuf {
        self.data_dir.join("history.json.migrated")
    }

    fn has_migration(&self, version: i64) -> BiliResult<bool> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| BiliError::msg("数据库锁失败"))?;
        conn.query_row(
            "SELECT 1 FROM schema_migrations WHERE version = ?1",
            params![version],
            |_| Ok(()),
        )
        .optional()
        .map(|row| row.is_some())
        .map_err(|e| BiliError::msg(e.to_string()))
    }

    fn mark_migration(&self, version: i64) -> BiliResult<()> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let conn = self
            .conn
            .lock()
            .map_err(|_| BiliError::msg("数据库锁失败"))?;
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![version, now],
        )
        .map_err(|e| BiliError::msg(e.to_string()))?;
        Ok(())
    }

    fn history_count(&self) -> BiliResult<i64> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| BiliError::msg("数据库锁失败"))?;
        conn.query_row("SELECT COUNT(*) FROM history", [], |row| row.get(0))
            .map_err(|e| BiliError::msg(e.to_string()))
    }

    fn read_history_file(path: &Path) -> BiliResult<Vec<HistoryItem>> {
        Ok(serde_json::from_slice(&fs::read(path)?)?)
    }

    fn quarantine(path: &Path) {
        let dest = PathBuf::from(format!("{}.corrupt", path.to_string_lossy()));
        let _ = fs::rename(path, dest);
    }

    fn import_history(&self, items: Vec<HistoryItem>) -> BiliResult<()> {
        for item in items.into_iter().rev() {
            self.push_history(item)?;
        }
        Ok(())
    }

    fn retire_legacy(&self, legacy: &Path, migrated: &Path) -> BiliResult<()> {
        if !legacy.exists() {
            return Ok(());
        }
        if fs::rename(legacy, migrated).is_err() {
            let _ = fs::remove_file(legacy);
        }
        Ok(())
    }

    fn migrate_legacy_history(&self) -> BiliResult<()> {
        if self.has_migration(HISTORY_MIGRATION_VERSION)? && self.history_count()? > 0 {
            return Ok(());
        }

        let legacy = session::history_path(&self.data_dir);
        let migrated = self.migrated_path();
        let sources = [legacy.clone(), migrated.clone()];

        for path in &sources {
            if !path.exists() {
                continue;
            }
            match Self::read_history_file(path) {
                Ok(items) => {
                    self.import_history(items)?;
                    if path == &legacy {
                        self.retire_legacy(&legacy, &migrated)?;
                    }
                    self.mark_migration(HISTORY_MIGRATION_VERSION)?;
                    return Ok(());
                }
                Err(_) => Self::quarantine(path),
            }
        }

        self.mark_migration(HISTORY_MIGRATION_VERSION)?;
        Ok(())
    }

    fn ensure_default_settings(&self) -> BiliResult<()> {
        let defaults = [
            ("theme", "light"),
            ("danmaku_enabled", "true"),
            ("danmaku_font_size", "42"),
            ("danmaku_max_rows", "10"),
            ("default_volume", "80"),
            ("default_speed", "1"),
        ];
        let conn = self
            .conn
            .lock()
            .map_err(|_| BiliError::msg("数据库锁失败"))?;
        for (key, value) in defaults {
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
                params![key, value],
            )
            .map_err(|e| BiliError::msg(e.to_string()))?;
        }
        Ok(())
    }

    pub fn push_history(&self, item: HistoryItem) -> BiliResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| BiliError::msg("数据库锁失败"))?;
        conn.execute(
            "INSERT INTO history (bvid, title, cover, owner, viewed_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(bvid) DO UPDATE SET
               title=excluded.title,
               cover=excluded.cover,
               owner=excluded.owner,
               viewed_at=excluded.viewed_at",
            params![
                item.bvid,
                item.title,
                item.cover,
                item.owner,
                item.viewed_at
            ],
        )
        .map_err(|e| BiliError::msg(e.to_string()))?;
        conn.execute(
            "DELETE FROM history WHERE bvid NOT IN (
               SELECT bvid FROM history ORDER BY viewed_at DESC LIMIT 100
             )",
            [],
        )
        .map_err(|e| BiliError::msg(e.to_string()))?;
        Ok(())
    }

    pub fn list_history(&self) -> BiliResult<Vec<HistoryItem>> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| BiliError::msg("数据库锁失败"))?;
        let mut stmt = conn
            .prepare(
                "SELECT bvid, title, cover, owner, viewed_at
                 FROM history ORDER BY viewed_at DESC LIMIT 100",
            )
            .map_err(|e| BiliError::msg(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(HistoryItem {
                    bvid: row.get(0)?,
                    title: row.get(1)?,
                    cover: row.get(2)?,
                    owner: row.get(3)?,
                    viewed_at: row.get(4)?,
                })
            })
            .map_err(|e| BiliError::msg(e.to_string()))?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|e| BiliError::msg(e.to_string()))?);
        }
        Ok(items)
    }

    /// 保存播放进度；接近播完（剩余<15秒）视为看完并删除记录
    pub fn save_progress(
        &self,
        bvid: &str,
        cid: i64,
        position: f64,
        duration: f64,
    ) -> BiliResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| BiliError::msg("数据库锁失败"))?;
        if position < 5.0 || duration <= 0.0 {
            return Ok(());
        }
        if position >= duration - 15.0 {
            conn.execute(
                "DELETE FROM play_progress WHERE bvid = ?1 AND cid = ?2",
                params![bvid, cid],
            )
            .map_err(|e| BiliError::msg(e.to_string()))?;
            return Ok(());
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO play_progress (bvid, cid, position, duration, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(bvid, cid) DO UPDATE SET
               position=excluded.position,
               duration=excluded.duration,
               updated_at=excluded.updated_at",
            params![bvid, cid, position, duration, now],
        )
        .map_err(|e| BiliError::msg(e.to_string()))?;
        conn.execute(
            "DELETE FROM play_progress WHERE bvid NOT IN (
               SELECT bvid FROM play_progress ORDER BY updated_at DESC LIMIT 200
             )",
            [],
        )
        .map_err(|e| BiliError::msg(e.to_string()))?;
        Ok(())
    }

    pub fn load_progress(&self, bvid: &str, cid: i64) -> BiliResult<Option<PlayProgressRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| BiliError::msg("数据库锁失败"))?;
        conn.query_row(
            "SELECT position, duration FROM play_progress WHERE bvid = ?1 AND cid = ?2",
            params![bvid, cid],
            |row| {
                Ok(PlayProgressRecord {
                    position: row.get(0)?,
                    duration: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|e| BiliError::msg(e.to_string()))
    }

    #[cfg(test)]
    fn progress_count(&self) -> BiliResult<i64> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| BiliError::msg("数据库锁失败"))?;
        conn.query_row("SELECT COUNT(*) FROM play_progress", [], |row| row.get(0))
            .map_err(|e| BiliError::msg(e.to_string()))
    }

    pub fn get_setting(&self, key: &str) -> BiliResult<Option<String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| BiliError::msg("数据库锁失败"))?;
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| BiliError::msg(e.to_string()))
    }

    pub fn set_setting(&self, key: &str, value: &str) -> BiliResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| BiliError::msg("数据库锁失败"))?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )
        .map_err(|e| BiliError::msg(e.to_string()))?;
        Ok(())
    }

    pub fn all_settings(&self) -> BiliResult<HashMap<String, String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| BiliError::msg("数据库锁失败"))?;
        let mut stmt = conn
            .prepare("SELECT key, value FROM settings")
            .map_err(|e| BiliError::msg(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| BiliError::msg(e.to_string()))?;
        let mut map = HashMap::new();
        for row in rows {
            let (k, v) = row.map_err(|e| BiliError::msg(e.to_string()))?;
            map.insert(k, v);
        }
        Ok(map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "bilidesk-storage-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample(bvid: &str) -> HistoryItem {
        HistoryItem {
            bvid: bvid.into(),
            title: "t".into(),
            cover: "c".into(),
            owner: "o".into(),
            viewed_at: 100,
        }
    }

    #[test]
    fn history_roundtrip_and_legacy_migration() {
        let dir = temp_dir();
        session::save_history(&dir, &[sample("BV1xx")]).unwrap();
        let storage = Storage::open(&dir).unwrap();
        let items = storage.list_history().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].bvid, "BV1xx");
        assert!(dir.join("history.json.migrated").exists());
        assert!(storage.has_migration(1).unwrap());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_history_json_does_not_block_open() {
        let dir = temp_dir();
        fs::write(session::history_path(&dir), b"{not-json").unwrap();
        let storage = Storage::open(&dir).unwrap();
        assert!(storage.list_history().unwrap().is_empty());
        assert!(storage.has_migration(1).unwrap());
        assert!(!session::history_path(&dir).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reimports_migrated_file_when_database_is_recreated() {
        let dir = temp_dir();
        session::save_history(&dir, &[sample("BV1yy")]).unwrap();
        Storage::open(&dir).unwrap();
        assert!(dir.join("history.json.migrated").exists());
        let _ = fs::remove_file(dir.join("bilidesk.db"));
        let storage = Storage::open(&dir).unwrap();
        let items = storage.list_history().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].bvid, "BV1yy");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn progress_roundtrip_and_completion_cleanup() {
        let dir = temp_dir();
        let storage = Storage::open(&dir).unwrap();
        storage.save_progress("BV1p", 1, 120.0, 600.0).unwrap();
        let record = storage.load_progress("BV1p", 1).unwrap();
        assert_eq!(record.as_ref().unwrap().position, 120.0);
        // 播完后（剩余 <15s）记录被清除
        storage.save_progress("BV1p", 1, 590.0, 600.0).unwrap();
        assert!(storage.load_progress("BV1p", 1).unwrap().is_none());
        // 太短的位置不保存
        storage.save_progress("BV1p", 2, 3.0, 600.0).unwrap();
        assert_eq!(storage.progress_count().unwrap(), 0);
        let _ = fs::remove_dir_all(&dir);
    }
}
