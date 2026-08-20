use crate::bili::error::{BiliError, BiliResult};
use crate::bili::models::HistoryItem;
use crate::bili::session;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

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

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    fn migrate_legacy_history(&self) -> BiliResult<()> {
        let legacy = session::history_path(&self.data_dir);
        if !legacy.exists() {
            return Ok(());
        }
        let migrated_marker = self.data_dir.join("history.json.migrated");
        if migrated_marker.exists() {
            return Ok(());
        }
        let items = session::load_history(&self.data_dir)?;
        if !items.is_empty() {
            for item in items.into_iter().rev() {
                self.push_history(item)?;
            }
        }
        let _ = fs::rename(&legacy, &migrated_marker);
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
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
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
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn history_roundtrip_and_legacy_migration() {
        let dir = std::env::temp_dir().join(format!(
            "bilidesk-storage-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let legacy = vec![HistoryItem {
            bvid: "BV1xx".into(),
            title: "t".into(),
            cover: "c".into(),
            owner: "o".into(),
            viewed_at: 100,
        }];
        session::save_history(&dir, &legacy).unwrap();
        let storage = Storage::open(&dir).unwrap();
        let items = storage.list_history().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].bvid, "BV1xx");
        assert!(dir.join("history.json.migrated").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
