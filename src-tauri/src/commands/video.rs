use crate::app_error::AppResult;
use crate::bili::models::{HistoryItem, VideoDetail};
use crate::commands::AppState;
use tauri::State;

#[tauri::command]
pub async fn video_view(state: State<'_, AppState>, bvid: String) -> AppResult<VideoDetail> {
    Ok(state.bili.view(&bvid).await?)
}

#[tauri::command]
pub fn history_list(state: State<'_, AppState>) -> AppResult<Vec<HistoryItem>> {
    state.with_storage(|storage| Ok(storage.list_history()?))
}
