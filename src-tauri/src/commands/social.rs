use crate::app_error::AppResult;
use crate::bili::models::{
    ArchiveRelation, CommentPage, TripleResult, UserSpace, UserVideoPage, WatchLaterItem,
};
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

/// 一键三连：赞 + 1 币 + 收藏（默认收藏夹）
#[tauri::command]
pub async fn archive_triple(state: State<'_, AppState>, aid: i64) -> AppResult<TripleResult> {
    Ok(state.bili.triple(aid).await?)
}

#[tauri::command]
pub async fn watchlater_list(state: State<'_, AppState>) -> AppResult<Vec<WatchLaterItem>> {
    Ok(state.bili.watchlater_list().await?)
}

#[tauri::command]
pub async fn watchlater_save(state: State<'_, AppState>, aid: i64) -> AppResult<()> {
    Ok(state.bili.watchlater_save(aid).await?)
}

#[tauri::command]
pub async fn watchlater_remove(state: State<'_, AppState>, aid: i64) -> AppResult<()> {
    Ok(state.bili.watchlater_remove(aid).await?)
}

#[tauri::command]
pub async fn watchlater_clear(state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.bili.watchlater_clear().await?)
}

/// 用户名片（空间信息 + 关注状态）
#[tauri::command]
pub async fn user_card(state: State<'_, AppState>, mid: i64) -> AppResult<UserSpace> {
    Ok(state.bili.user_card(mid).await?)
}

/// 用户投稿列表
#[tauri::command]
pub async fn user_videos(
    state: State<'_, AppState>,
    mid: i64,
    page: Option<u32>,
) -> AppResult<UserVideoPage> {
    Ok(state.bili.user_videos(mid, page.unwrap_or(1)).await?)
}

/// 关注 / 取关
#[tauri::command]
pub async fn follow_mod(state: State<'_, AppState>, mid: i64, follow: bool) -> AppResult<()> {
    Ok(state.bili.follow_mod(mid, follow).await?)
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
