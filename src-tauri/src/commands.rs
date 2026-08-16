use crate::bili::client::BiliClient;
use crate::bili::danmaku::DanmakuOptions;
use crate::bili::models::*;
use crate::player::{self, PlayerHost};
use serde::Deserialize;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State, WebviewWindow};

pub struct AppState {
    pub bili: BiliClient,
    pub player: Mutex<PlayerHost>,
    pub danmaku_on: Mutex<bool>,
    pub danmaku_opts: Mutex<DanmakuOptions>,
}

impl AppState {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            bili: BiliClient::new().map_err(|e| e.to_string())?,
            player: Mutex::new(PlayerHost::default()),
            danmaku_on: Mutex::new(true),
            danmaku_opts: Mutex::new(DanmakuOptions::default()),
        })
    }
}

#[tauri::command]
pub async fn auth_qr_start(state: State<'_, AppState>) -> Result<QrStart, String> {
    state.bili.qr_start().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auth_qr_poll(
    state: State<'_, AppState>,
    qrcode_key: String,
) -> Result<QrPoll, String> {
    state
        .bili
        .qr_poll(&qrcode_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn auth_logout(state: State<'_, AppState>) -> Result<(), String> {
    state.bili.logout().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn auth_me(state: State<'_, AppState>) -> Result<Profile, String> {
    state.bili.profile().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn feed_recommend(
    state: State<'_, AppState>,
    fresh_idx: Option<u32>,
) -> Result<Vec<VideoCard>, String> {
    state
        .bili
        .recommend(fresh_idx.unwrap_or(1))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn feed_search(
    state: State<'_, AppState>,
    keyword: String,
    page: Option<u32>,
) -> Result<SearchResult, String> {
    state
        .bili
        .search(&keyword, page.unwrap_or(1))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn video_view(state: State<'_, AppState>, bvid: String) -> Result<VideoDetail, String> {
    state.bili.view(&bvid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_list(state: State<'_, AppState>) -> Result<Vec<HistoryItem>, String> {
    state.bili.history().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn feed_selected(
    state: State<'_, AppState>,
    fresh_idx: Option<u32>,
    fresh_type: Option<u32>,
) -> Result<Vec<VideoCard>, String> {
    state
        .bili
        .selected(fresh_idx.unwrap_or(1), fresh_type.unwrap_or(0))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn archive_like(
    state: State<'_, AppState>,
    aid: i64,
    unlike: Option<bool>,
) -> Result<(), String> {
    state
        .bili
        .like(aid, unlike.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn archive_dislike(
    state: State<'_, AppState>,
    aid: i64,
    cancel: Option<bool>,
) -> Result<(), String> {
    state
        .bili
        .dislike(aid, cancel.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn archive_coin(state: State<'_, AppState>, aid: i64) -> Result<(), String> {
    state.bili.coin(aid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn archive_fav(state: State<'_, AppState>, aid: i64) -> Result<(), String> {
    state
        .bili
        .fav_add(aid, None)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn danmaku_send(
    state: State<'_, AppState>,
    aid: i64,
    cid: i64,
    bvid: String,
    message: String,
    progress_ms: i64,
) -> Result<(), String> {
    state
        .bili
        .danmaku_post(aid, cid, &bvid, &message, progress_ms)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reply_list(state: State<'_, AppState>, aid: i64) -> Result<CommentPage, String> {
    state.bili.reply_list(aid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reply_add(
    state: State<'_, AppState>,
    aid: i64,
    message: String,
    parent: Option<i64>,
) -> Result<(), String> {
    state
        .bili
        .reply_add(aid, &message, parent)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct OpenPlayerReq {
    pub bvid: String,
    pub cid: Option<i64>,
    pub quality: Option<i64>,
}

#[tauri::command]
pub async fn player_open(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    req: OpenPlayerReq,
) -> Result<PlaySession, String> {
    let detail = state
        .bili
        .view(&req.bvid)
        .await
        .map_err(|e| e.to_string())?;
    let cid = req
        .cid
        .or_else(|| detail.pages.first().map(|p| p.cid))
        .unwrap_or(0);
    if cid == 0 {
        return Err("该稿件没有可播放分P".into());
    }
    let (choices, current) = state
        .bili
        .resolve_streams(&req.bvid, cid, req.quality)
        .await
        .map_err(|e| e.to_string())?;
    let opts = state
        .danmaku_opts
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let ass_path = match state.bili.danmaku_ass(cid, &opts).await {
        Ok(ass) => player::write_ass(cid, &ass).ok(),
        Err(_) => None,
    };
    let headers = state
        .bili
        .http_headers_for_mpv()
        .map_err(|e| e.to_string())?;
    let danmaku_on = *state.danmaku_on.lock().map_err(|e| e.to_string())?;
    let current_play = current.clone();
    let window_play = window.clone();
    let app_play = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_play.state::<AppState>();
        let mut player = state.player.lock().map_err(|e| e.to_string())?;
        player
            .open(
                &window_play,
                app_play.clone(),
                &current_play,
                &headers,
                ass_path.as_deref(),
                danmaku_on,
            )
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|err| err.to_string())??;
    let _ = state.bili.push_history(HistoryItem {
        bvid: detail.bvid.clone(),
        title: detail.title.clone(),
        cover: detail.cover.clone(),
        owner: detail.owner.clone(),
        viewed_at: now_secs(),
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
pub fn player_stop(state: State<'_, AppState>) -> Result<(), String> {
    state
        .player
        .lock()
        .map_err(|e| e.to_string())?
        .stop()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn player_toggle_pause(state: State<'_, AppState>) -> Result<(), String> {
    state
        .player
        .lock()
        .map_err(|e| e.to_string())?
        .toggle_pause()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn player_seek(state: State<'_, AppState>, seconds: f64) -> Result<(), String> {
    state
        .player
        .lock()
        .map_err(|e| e.to_string())?
        .seek(seconds)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn player_set_volume(state: State<'_, AppState>, volume: i64) -> Result<(), String> {
    state
        .player
        .lock()
        .map_err(|e| e.to_string())?
        .set_volume(volume)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn player_set_speed(state: State<'_, AppState>, speed: f64) -> Result<(), String> {
    state
        .player
        .lock()
        .map_err(|e| e.to_string())?
        .set_speed(speed)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn player_set_danmaku(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    *state.danmaku_on.lock().map_err(|e| e.to_string())? = enabled;
    state
        .player
        .lock()
        .map_err(|e| e.to_string())?
        .set_sub_visible(enabled)
        .map_err(|e| e.to_string())
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
) -> Result<(), String> {
    let mut opts = state.danmaku_opts.lock().map_err(|e| e.to_string())?;
    if let Some(size) = prefs.font_size {
        opts.font_size = size.clamp(28, 72);
    }
    if let Some(rows) = prefs.max_rows {
        opts.max_rows = rows.clamp(4, 20);
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
) -> Result<(), String> {
    let scale = window.scale_factor().unwrap_or(1.0);
    state
        .player
        .lock()
        .map_err(|e| e.to_string())?
        .set_bounds(player::StageBounds {
            x: player::css_to_physical(rect.x, scale),
            y: player::css_to_physical(rect.y, scale),
            width: player::css_to_physical(rect.width, scale),
            height: player::css_to_physical(rect.height, scale),
        })
        .map_err(|e| e.to_string())
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn init_data_dir(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    state.bili.set_data_dir(dir).map_err(|e| e.to_string())
}
