mod auth;
mod feed;
mod player;
mod settings;
mod social;
mod video;

pub use auth::*;
pub use feed::*;
pub use player::*;
pub use settings::*;
pub use social::*;
pub use video::*;

use crate::app_error::{AppError, AppResult};
use crate::bili::client::BiliClient;
use crate::bili::danmaku::DanmakuOptions;
use crate::player::PlayerHost;
use crate::storage::Storage;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PlayerScope {
    Standard,
    Featured,
}

impl PlayerScope {
    pub(crate) fn from_raw(raw: Option<&str>) -> Self {
        if raw == Some("featured") {
            Self::Featured
        } else {
            Self::Standard
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct PlayerRequests {
    generation: u64,
    current: Option<PlayerScope>,
}

impl PlayerRequests {
    pub(crate) fn begin(&mut self, scope: PlayerScope) -> (u64, bool) {
        let scope_changed = self.current.is_some() && self.current != Some(scope);
        self.generation = self.generation.wrapping_add(1).max(1);
        self.current = Some(scope);
        (self.generation, scope_changed)
    }

    pub(crate) fn is_current(&self, generation: u64, scope: PlayerScope) -> bool {
        self.generation == generation && self.current == Some(scope)
    }

    pub(crate) fn cancel(&mut self, scope: PlayerScope) -> bool {
        if self.current != Some(scope) {
            return false;
        }
        self.generation = self.generation.wrapping_add(1).max(1);
        self.current = None;
        true
    }
}

pub struct AppState {
    pub bili: BiliClient,
    pub storage: Mutex<Option<Storage>>,
    pub player: Mutex<PlayerHost>,
    pub(crate) player_requests: Mutex<PlayerRequests>,
    pub danmaku_on: Mutex<bool>,
    pub danmaku_opts: Mutex<DanmakuOptions>,
}

impl AppState {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            bili: BiliClient::new().map_err(|e| e.to_string())?,
            storage: Mutex::new(None),
            player: Mutex::new(PlayerHost::default()),
            player_requests: Mutex::new(PlayerRequests::default()),
            danmaku_on: Mutex::new(true),
            danmaku_opts: Mutex::new(DanmakuOptions::default()),
        })
    }

    pub(crate) fn begin_player_request(&self, scope: PlayerScope) -> AppResult<(u64, bool)> {
        Ok(self
            .player_requests
            .lock()
            .map_err(|e| AppError::message(e.to_string()))?
            .begin(scope))
    }

    pub(crate) fn ensure_player_request(
        &self,
        generation: u64,
        scope: PlayerScope,
    ) -> AppResult<()> {
        let ok = self
            .player_requests
            .lock()
            .map_err(|e| AppError::message(e.to_string()))?
            .is_current(generation, scope);
        if ok {
            Ok(())
        } else {
            Err(AppError::new("cancelled", "播放请求已取消"))
        }
    }

    pub(crate) fn cancel_player_scope(&self, scope: PlayerScope) -> AppResult<bool> {
        Ok(self
            .player_requests
            .lock()
            .map_err(|e| AppError::message(e.to_string()))?
            .cancel(scope))
    }

    pub(crate) fn with_storage<T>(&self, f: impl FnOnce(&Storage) -> AppResult<T>) -> AppResult<T> {
        let guard = self
            .storage
            .lock()
            .map_err(|e| AppError::message(e.to_string()))?;
        let storage = guard
            .as_ref()
            .ok_or_else(|| AppError::message("存储尚未初始化"))?;
        f(storage)
    }
}

pub fn init_data_dir(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    state
        .bili
        .set_data_dir(dir.clone())
        .map_err(|e| e.to_string())?;
    let storage = Storage::open(&dir).map_err(|e| e.to_string())?;
    if let Ok(Some(v)) = storage.get_setting("danmaku_enabled") {
        *state.danmaku_on.lock().map_err(|e| e.to_string())? = v != "false";
    }
    {
        let mut opts = state.danmaku_opts.lock().map_err(|e| e.to_string())?;
        if let Ok(Some(v)) = storage.get_setting("danmaku_font_size") {
            if let Ok(n) = v.parse::<u32>() {
                opts.font_size = n.clamp(28, 72);
            }
        }
        if let Ok(Some(v)) = storage.get_setting("danmaku_max_rows") {
            if let Ok(n) = v.parse::<usize>() {
                opts.max_rows = n.clamp(4, 20);
            }
        }
        if let Ok(Some(v)) = storage.get_setting("danmaku_opacity") {
            if let Ok(n) = v.parse::<f64>() {
                opts.opacity = n.clamp(0.1, 1.0);
            }
        }
        if let Ok(Some(v)) = storage.get_setting("danmaku_area") {
            if let Ok(n) = v.parse::<f64>() {
                opts.display_area = n.clamp(0.25, 1.0);
            }
        }
        if let Ok(Some(v)) = storage.get_setting("danmaku_bold") {
            opts.bold = v != "false";
        }
    }
    *state.storage.lock().map_err(|e| e.to_string())? = Some(storage);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{PlayerRequests, PlayerScope};

    #[test]
    fn stale_featured_stop_cannot_cancel_standard_playback() {
        let mut requests = PlayerRequests::default();
        let (featured, scope_changed) = requests.begin(PlayerScope::Featured);
        assert!(!scope_changed);
        assert!(requests.is_current(featured, PlayerScope::Featured));

        let (standard, scope_changed) = requests.begin(PlayerScope::Standard);
        assert!(scope_changed);
        assert!(!requests.is_current(featured, PlayerScope::Featured));
        assert!(requests.is_current(standard, PlayerScope::Standard));
        assert!(!requests.cancel(PlayerScope::Featured));
        assert!(requests.is_current(standard, PlayerScope::Standard));
        assert!(requests.cancel(PlayerScope::Standard));
        assert!(!requests.is_current(standard, PlayerScope::Standard));
    }
}
