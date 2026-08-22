use crate::app_error::AppResult;
use crate::bili::models::{DynamicFeedPage, FavFolder, FavResourcePage, SearchResult, VideoCard};
use crate::commands::AppState;
use tauri::State;

#[tauri::command]
pub async fn feed_recommend(
    state: State<'_, AppState>,
    fresh_idx: Option<u32>,
) -> AppResult<Vec<VideoCard>> {
    Ok(state.bili.recommend(fresh_idx.unwrap_or(1)).await?)
}

#[tauri::command]
pub async fn feed_search(
    state: State<'_, AppState>,
    keyword: String,
    page: Option<u32>,
) -> AppResult<SearchResult> {
    Ok(state.bili.search(&keyword, page.unwrap_or(1)).await?)
}

#[tauri::command]
pub async fn feed_selected(
    state: State<'_, AppState>,
    fresh_idx: Option<u32>,
    fresh_type: Option<u32>,
) -> AppResult<Vec<VideoCard>> {
    Ok(state
        .bili
        .selected(fresh_idx.unwrap_or(1), fresh_type.unwrap_or(0))
        .await?)
}

/// 热门视频排行榜
#[tauri::command]
pub async fn feed_popular(
    state: State<'_, AppState>,
    page: Option<u32>,
) -> AppResult<Vec<VideoCard>> {
    Ok(state.bili.popular(page.unwrap_or(1)).await?)
}

/// 分区最新稿件
#[tauri::command]
pub async fn feed_region(
    state: State<'_, AppState>,
    rid: u32,
    page: Option<u32>,
) -> AppResult<Vec<VideoCard>> {
    Ok(state.bili.region_dynamic(rid, page.unwrap_or(1)).await?)
}

/// 收藏夹列表（用于选择）
#[tauri::command]
pub async fn fav_folders(state: State<'_, AppState>) -> AppResult<Vec<FavFolder>> {
    Ok(state.bili.fav_folders().await?)
}

/// 收藏夹内容
#[tauri::command]
pub async fn fav_resource_list(
    state: State<'_, AppState>,
    media_id: Option<i64>,
    page: Option<u32>,
) -> AppResult<FavResourcePage> {
    Ok(state
        .bili
        .fav_resource_list(media_id, page.unwrap_or(1))
        .await?)
}

/// 动态首页（仅视频动态）
#[tauri::command]
pub async fn dynamic_feed(
    state: State<'_, AppState>,
    offset: Option<String>,
) -> AppResult<DynamicFeedPage> {
    Ok(state.bili.dynamic_feed(offset.as_deref()).await?)
}
