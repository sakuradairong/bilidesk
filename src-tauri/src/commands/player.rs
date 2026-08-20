use crate::app_error::{AppError, AppResult};
use crate::bili::models::{HistoryItem, PlaySession, QualityOption};
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
    let presentation = match scope {
        PlayerScope::Standard => player::PlayerPresentation::Embedded,
        PlayerScope::Featured => player::PlayerPresentation::Backdrop,
    };
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
        player.open(
            &window_play,
            app_play.clone(),
            &current_play,
            &headers,
            ass_path.as_deref(),
            danmaku_on,
            presentation,
        )?;
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
    let _ = state.with_storage(|storage| {
        Ok(storage.set_setting("danmaku_enabled", if enabled { "true" } else { "false" })?)
    });
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
}

#[tauri::command]
pub fn player_set_danmaku_prefs(
    state: State<'_, AppState>,
    prefs: DanmakuPrefs,
) -> AppResult<()> {
    let mut opts = state
        .danmaku_opts
        .lock()
        .map_err(|e| AppError::message(e.to_string()))?;
    if let Some(size) = prefs.font_size {
        opts.font_size = size.clamp(28, 72);
        let _ = state.with_storage(|storage| {
            Ok(storage.set_setting("danmaku_font_size", &opts.font_size.to_string())?)
        });
    }
    if let Some(rows) = prefs.max_rows {
        opts.max_rows = rows.clamp(4, 20);
        let _ = state.with_storage(|storage| {
            Ok(storage.set_setting("danmaku_max_rows", &opts.max_rows.to_string())?)
        });
    }
    Ok(())
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
