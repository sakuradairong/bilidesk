use super::error::BiliResult;
#[cfg(test)]
use super::models::HistoryItem;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const WEB_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ENCRYPTED_SESSION_MAGIC: &[u8] = b"BILIDESK_SESSION_V1\0";

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
        let (json, needs_migration) = match bytes.strip_prefix(ENCRYPTED_SESSION_MAGIC) {
            Some(encrypted) => (unprotect_session(encrypted)?, false),
            None => (bytes, true),
        };
        let mut session: Session = serde_json::from_slice(&json)?;
        session.ensure_buvid();
        if needs_migration {
            session.save(path)?;
        }
        Ok(session)
    }

    pub fn save(&self, path: &Path) -> BiliResult<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_vec(self)?;
        let encrypted = protect_session(&json)?;
        let mut output = Vec::with_capacity(ENCRYPTED_SESSION_MAGIC.len() + encrypted.len());
        output.extend_from_slice(ENCRYPTED_SESSION_MAGIC);
        output.extend_from_slice(&encrypted);
        fs::write(path, output)?;
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

#[cfg(windows)]
fn protect_session(bytes: &[u8]) -> BiliResult<Vec<u8>> {
    use windows::core::w;
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input_len =
        u32::try_from(bytes.len()).map_err(|_| super::error::BiliError::msg("会话数据过大"))?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: input_len,
        pbData: bytes.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            w!("BiliDesk session"),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|err| super::error::BiliError::msg(format!("加密登录会话失败: {err}")))?;
    }
    copy_and_free_blob(output)
}

#[cfg(windows)]
fn unprotect_session(bytes: &[u8]) -> BiliResult<Vec<u8>> {
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input_len =
        u32::try_from(bytes.len()).map_err(|_| super::error::BiliError::msg("会话数据过大"))?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: input_len,
        pbData: bytes.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|err| super::error::BiliError::msg(format!("解密登录会话失败: {err}")))?;
    }
    copy_and_free_blob(output)
}

#[cfg(windows)]
fn copy_and_free_blob(
    blob: windows::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB,
) -> BiliResult<Vec<u8>> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};

    if blob.pbData.is_null() {
        return Err(super::error::BiliError::msg("Windows 返回了空的会话数据"));
    }
    let bytes = unsafe { std::slice::from_raw_parts(blob.pbData, blob.cbData as usize).to_vec() };
    unsafe {
        LocalFree(Some(HLOCAL(blob.pbData.cast())));
    }
    Ok(bytes)
}

#[cfg(not(windows))]
fn protect_session(bytes: &[u8]) -> BiliResult<Vec<u8>> {
    Ok(bytes.to_vec())
}

#[cfg(not(windows))]
fn unprotect_session(bytes: &[u8]) -> BiliResult<Vec<u8>> {
    Ok(bytes.to_vec())
}

pub fn session_path(data_dir: &Path) -> PathBuf {
    data_dir.join("session.json")
}

pub fn history_path(data_dir: &Path) -> PathBuf {
    data_dir.join("history.json")
}

#[cfg(test)]
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

    #[test]
    fn saved_session_does_not_contain_plaintext_cookie() {
        let dir = std::env::temp_dir().join(format!("bilidesk-session-{}", Uuid::new_v4()));
        let path = session_path(&dir);
        let mut session = Session::default();
        session
            .cookies
            .insert("SESSDATA".into(), "sensitive-value".into());

        session.save(&path).unwrap();
        let raw = fs::read(&path).unwrap();
        assert!(raw.starts_with(ENCRYPTED_SESSION_MAGIC));
        #[cfg(windows)]
        assert!(!raw
            .windows(b"sensitive-value".len())
            .any(|part| part == b"sensitive-value"));
        assert_eq!(
            Session::load(&path).unwrap().cookies.get("SESSDATA"),
            Some(&"sensitive-value".to_string())
        );

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn plaintext_session_is_migrated_on_load() {
        let dir = std::env::temp_dir().join(format!("bilidesk-session-migrate-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = session_path(&dir);
        fs::write(&path, br#"{"cookies":{"SESSDATA":"legacy"}}"#).unwrap();

        let loaded = Session::load(&path).unwrap();
        assert_eq!(loaded.cookies.get("SESSDATA"), Some(&"legacy".to_string()));
        assert!(fs::read(&path)
            .unwrap()
            .starts_with(ENCRYPTED_SESSION_MAGIC));

        fs::remove_dir_all(dir).unwrap();
    }
}
