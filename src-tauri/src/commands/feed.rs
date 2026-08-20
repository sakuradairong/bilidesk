use crate::app_error::AppResult;
use crate::bili::models::{SearchResult, VideoCard};
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
