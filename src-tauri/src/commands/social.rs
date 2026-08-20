use crate::app_error::AppResult;
use crate::bili::models::{ArchiveRelation, CommentPage};
use crate::commands::AppState;
use tauri::State;

#[tauri::command]
pub async fn archive_relation(state: State<'_, AppState>, aid: i64) -> AppResult<ArchiveRelation> {
    Ok(state.bili.archive_relation(aid).await?)
}

#[tauri::command]
pub async fn archive_like(
    state: State<'_, AppState>,
    aid: i64,
    unlike: Option<bool>,
) -> AppResult<()> {
    Ok(state.bili.like(aid, unlike.unwrap_or(false)).await?)
}

#[tauri::command]
pub async fn archive_dislike(
    state: State<'_, AppState>,
    aid: i64,
    cancel: Option<bool>,
) -> AppResult<()> {
    Ok(state.bili.dislike(aid, cancel.unwrap_or(false)).await?)
}

#[tauri::command]
pub async fn archive_coin(state: State<'_, AppState>, aid: i64) -> AppResult<()> {
    Ok(state.bili.coin(aid).await?)
}

#[tauri::command]
pub async fn archive_fav(state: State<'_, AppState>, aid: i64) -> AppResult<()> {
    Ok(state.bili.fav_add(aid, None).await?)
}

#[tauri::command]
pub async fn danmaku_send(
    state: State<'_, AppState>,
    aid: i64,
    cid: i64,
    bvid: String,
    message: String,
    progress_ms: i64,
) -> AppResult<()> {
    Ok(state
        .bili
        .danmaku_post(aid, cid, &bvid, &message, progress_ms)
        .await?)
}

#[tauri::command]
pub async fn reply_list(state: State<'_, AppState>, aid: i64) -> AppResult<CommentPage> {
    Ok(state.bili.reply_list(aid).await?)
}

#[tauri::command]
pub async fn reply_add(
    state: State<'_, AppState>,
    aid: i64,
    message: String,
    parent: Option<i64>,
) -> AppResult<()> {
    Ok(state.bili.reply_add(aid, &message, parent).await?)
}
