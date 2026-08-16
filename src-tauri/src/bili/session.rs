use super::error::BiliResult;
use super::models::HistoryItem;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const WEB_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Session {
    pub cookies: HashMap<String, String>,
}

impl Session {
    pub fn csrf(&self) -> Option<String> {
        self.cookies
            .get("bili_jct")
            .cloned()
            .filter(|value| !value.is_empty())
    }

    pub fn mid(&self) -> Option<i64> {
        self.cookies.get("DedeUserID")?.parse().ok()
    }

    pub fn cookie_header(&self) -> String {
        self.cookies
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; ")
    }

    pub fn user_agent() -> &'static str {
        WEB_UA
    }

    pub fn ensure_buvid(&mut self) {
        if !self.cookies.contains_key("buvid3") {
            let id = Uuid::new_v4().to_string().to_uppercase();
            self.cookies.insert("buvid3".into(), format!("{id}infoc"));
        }
        if !self.cookies.contains_key("buvid4") {
            self.cookies
                .insert("buvid4".into(), format!("{}-1", Uuid::new_v4().as_simple()));
        }
    }

    pub fn merge_set_cookie(&mut self, headers: impl Iterator<Item = String>) {
        for raw in headers {
            if let Some((name, value)) = parse_cookie_pair(&raw) {
                if !name.is_empty() {
                    self.cookies.insert(name, value);
                }
            }
        }
    }

    pub fn load(path: &Path) -> BiliResult<Self> {
        if !path.exists() {
            let mut session = Session::default();
            session.ensure_buvid();
            return Ok(session);
        }
        let bytes = fs::read(path)?;
        let mut session: Session = serde_json::from_slice(&bytes)?;
        session.ensure_buvid();
        Ok(session)
    }

    pub fn save(&self, path: &Path) -> BiliResult<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }

    pub fn clear_login(&mut self) {
        for key in [
            "SESSDATA",
            "bili_jct",
            "DedeUserID",
            "DedeUserID__ckMd5",
            "sid",
        ] {
            self.cookies.remove(key);
        }
    }
}

pub fn session_path(data_dir: &Path) -> PathBuf {
    data_dir.join("session.json")
}

pub fn history_path(data_dir: &Path) -> PathBuf {
    data_dir.join("history.json")
}

pub fn load_history(data_dir: &Path) -> BiliResult<Vec<HistoryItem>> {
    let path = history_path(data_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

pub fn save_history(data_dir: &Path, items: &[HistoryItem]) -> BiliResult<()> {
    fs::create_dir_all(data_dir)?;
    fs::write(history_path(data_dir), serde_json::to_vec_pretty(items)?)?;
    Ok(())
}

fn parse_cookie_pair(set_cookie: &str) -> Option<(String, String)> {
    let first = set_cookie.split(';').next()?.trim();
    let (name, value) = first.split_once('=')?;
    Some((name.trim().to_string(), value.trim().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_set_cookie_takes_first_pair() {
        let (name, value) =
            parse_cookie_pair("SESSDATA=abc123; Path=/; Domain=.bilibili.com; HttpOnly").unwrap();
        assert_eq!(name, "SESSDATA");
        assert_eq!(value, "abc123");
    }
}
