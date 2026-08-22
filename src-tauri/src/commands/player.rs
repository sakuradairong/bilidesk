use crate::app_error::{AppError, AppResult};
use crate::bili::models::{HistoryItem, PlayProgressRecord, PlaySession, QualityOption};
use crate::commands::{AppState, PlayerScope};
use crate::player;
use serde::Deserialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State, WebviewWindow};

#[derive(Debug, Deserialize)]
pub struct OpenPlayerReq {
    pub bvid: String,
    pub cid: Option<i64>,
    pub quality: Option<i64>,
    pub scope: Option<String>,
}

#[tauri::command]
pub async fn player_open(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    req: OpenPlayerReq,
) -> AppResult<PlaySession> {
    let scope = PlayerScope::from_raw(req.scope.as_deref());
    let (request_generation, scope_changed) = state.begin_player_request(scope)?;
    if scope_changed {
        state
            .player
            .lock()
            .map_err(|e| AppError::message(e.to_string()))?
            .stop()?;
    }
    let detail = state.bili.view(&req.bvid).await?;
    state.ensure_player_request(request_generation, scope)?;
    let cid = req
        .cid
        .or_else(|| detail.pages.first().map(|p| p.cid))
        .unwrap_or(0);
    if cid == 0 {
        return Err(AppError::message("该稿件没有可播放分P"));
    }
    let (choices, current) = state
        .bili
        .resolve_streams(&req.bvid, cid, req.quality)
        .await?;
    state.ensure_player_request(request_generation, scope)?;
    let opts = state
        .danmaku_opts
        .lock()
        .map_err(|e| AppError::message(e.to_string()))?
        .clone();
    let ass_path = match state.bili.danmaku_ass(cid, &opts).await {
        Ok(ass) => player::write_ass(cid, &ass).ok(),
        Err(_) => None,
    };
    state.ensure_player_request(request_generation, scope)?;
    let headers = state.bili.http_headers_for_mpv()?;
    let danmaku_on = *state
        .danmaku_on
        .lock()
        .map_err(|e| AppError::message(e.to_string()))?;
    let current_play = current.clone();
    // Keep libmpv in a native child HWND for every player surface. The host is
    // placed above WebView2 inside the measured stage, so the Tauri window can
    // stay fully opaque and never reveal applications behind it.
    let presentation = player::PlayerPresentation::Embedded;
    let window_play = window.clone();
    let app_play = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> AppResult<()> {
        let state = app_play.state::<AppState>();
        state.ensure_player_request(request_generation, scope)?;
        let mut player = state
            .player
            .lock()
            .map_err(|e| AppError::message(e.to_string()))?;
        state.ensure_player_request(request_generation, scope)?;
        player.open(player::PlayerOpenRequest {
            window: &window_play,
            app: app_play.clone(),
            stream: &current_play,
            headers: &headers,
            ass_path: ass_path.as_deref(),
            danmaku_on,
            presentation,
        })?;
        if let Err(err) = state.ensure_player_request(request_generation, scope) {
            let _ = player.stop();
            return Err(err);
        }
        Ok(())
    })
    .await
    .map_err(|err| AppError::message(err.to_string()))??;

    let _ = state.with_storage(|storage| {
        Ok(storage.push_history(HistoryItem {
            bvid: detail.bvid.clone(),
            title: detail.title.clone(),
            cover: detail.cover.clone(),
            owner: detail.owner.clone(),
            viewed_at: now_secs(),
        })?)
    });

    Ok(PlaySession {
        bvid: detail.bvid,
        title: detail.title,
        cid,
        pages: detail.pages,
        current_quality: current.quality,
        qualities: choices
            .into_iter()
            .map(|c| QualityOption {
                quality: c.quality,
                desc: c.desc,
                codecs: c.codecs,
            })
            .collect(),
    })
}

#[tauri::command]
pub fn player_stop(state: State<'_, AppState>, scope: Option<String>) -> AppResult<()> {
    let scope = PlayerScope::from_raw(scope.as_deref());
    if !state.cancel_player_scope(scope)? {
        return Ok(());
    }
    state
        .player
        .lock()
        .map_err(|e| AppError::message(e.to_string()))?
        .stop()?;
    Ok(())
}

#[tauri::command]
pub fn player_toggle_pause(state: State<'_, AppState>) -> AppResult<()> {
    state
        .player
        .lock()
        .map_err(|e| AppError::message(e.to_string()))?
        .toggle_pause()?;
    Ok(())
}

#[tauri::command]
pub fn player_seek(state: State<'_, AppState>, seconds: f64) -> AppResult<()> {
    state
        .player
        .lock()
        .map_err(|e| AppError::message(e.to_string()))?
        .seek(seconds)?;
    Ok(())
}

#[tauri::command]
pub fn player_set_volume(state: State<'_, AppState>, volume: i64) -> AppResult<()> {
    state
        .player
        .lock()
        .map_err(|e| AppError::message(e.to_string()))?
        .set_volume(volume)?;
    Ok(())
}

#[tauri::command]
pub fn player_set_speed(state: State<'_, AppState>, speed: f64) -> AppResult<()> {
    state
        .player
        .lock()
        .map_err(|e| AppError::message(e.to_string()))?
        .set_speed(speed)?;
    Ok(())
}

#[tauri::command]
pub fn player_set_danmaku(state: State<'_, AppState>, enabled: bool) -> AppResult<()> {
    *state
        .danmaku_on
        .lock()
        .map_err(|e| AppError::message(e.to_string()))? = enabled;
    state
        .player
        .lock()
        .map_err(|e| AppError::message(e.to_string()))?
        .set_sub_visible(enabled)?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct DanmakuPrefs {
    pub font_size: Option<u32>,
    pub max_rows: Option<usize>,
    pub opacity: Option<f64>,
    /// 滚动/顶部弹幕占用屏幕高度比例 0.25~1.0
    pub display_area: Option<f64>,
    pub bold: Option<bool>,
}

#[tauri::command]
pub fn player_set_danmaku_prefs(state: State<'_, AppState>, prefs: DanmakuPrefs) -> AppResult<()> {
    let mut opts = state
        .danmaku_opts
        .lock()
        .map_err(|e| AppError::message(e.to_string()))?;
    let mut persist: Vec<(&str, String)> = Vec::new();
    if let Some(size) = prefs.font_size {
        opts.font_size = size.clamp(28, 72);
        persist.push(("danmaku_font_size", opts.font_size.to_string()));
    }
    if let Some(rows) = prefs.max_rows {
        opts.max_rows = rows.clamp(4, 20);
        persist.push(("danmaku_max_rows", opts.max_rows.to_string()));
    }
    if let Some(opacity) = prefs.opacity {
        opts.opacity = opacity.clamp(0.1, 1.0);
        persist.push(("danmaku_opacity", format!("{:.2}", opts.opacity)));
    }
    if let Some(area) = prefs.display_area {
        opts.display_area = area.clamp(0.25, 1.0);
        persist.push(("danmaku_area", format!("{:.2}", opts.display_area)));
    }
    if let Some(bold) = prefs.bold {
        opts.bold = bold;
        persist.push(("danmaku_bold", if bold { "true" } else { "false" }.into()));
    }
    drop(opts);
    if !persist.is_empty() {
        state.with_storage(|storage| {
            for (key, value) in persist {
                storage.set_setting(key, &value)?;
            }
            Ok(())
        })?;
    }
    Ok(())
}

/// 读取断点续播位置
#[tauri::command]
pub fn player_progress_get(
    state: State<'_, AppState>,
    bvid: String,
    cid: i64,
) -> AppResult<Option<PlayProgressRecord>> {
    state.with_storage(|storage| Ok(storage.load_progress(&bvid, cid)?))
}

/// 保存播放进度（看完自动清除）
#[tauri::command]
pub fn player_progress_save(
    state: State<'_, AppState>,
    bvid: String,
    cid: i64,
    position: f64,
    duration: f64,
) -> AppResult<()> {
    state.with_storage(|storage| Ok(storage.save_progress(&bvid, cid, position, duration)?))
}

#[derive(Debug, Deserialize)]
pub struct StageRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[tauri::command]
pub fn player_set_bounds(
    window: WebviewWindow,
    state: State<'_, AppState>,
    rect: StageRect,
) -> AppResult<()> {
    let scale = window.scale_factor().unwrap_or(1.0);
    state
        .player
        .lock()
        .map_err(|e| AppError::message(e.to_string()))?
        .set_bounds(player::StageBounds {
            x: player::css_to_physical(rect.x, scale),
            y: player::css_to_physical(rect.y, scale),
            width: player::css_to_physical(rect.width, scale),
            height: player::css_to_physical(rect.height, scale),
        })?;
    Ok(())
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
