use crate::app_error::AppResult;
use crate::bili::models::{Profile, QrPoll, QrStart};
use crate::commands::AppState;
use tauri::State;

#[tauri::command]
pub async fn auth_qr_start(state: State<'_, AppState>) -> AppResult<QrStart> {
    Ok(state.bili.qr_start().await?)
}

#[tauri::command]
pub async fn auth_qr_poll(state: State<'_, AppState>, qrcode_key: String) -> AppResult<QrPoll> {
    Ok(state.bili.qr_poll(&qrcode_key).await?)
}

#[tauri::command]
pub fn auth_logout(state: State<'_, AppState>) -> AppResult<()> {
    Ok(state.bili.logout()?)
}

#[tauri::command]
pub async fn auth_me(state: State<'_, AppState>) -> AppResult<Profile> {
    Ok(state.bili.profile().await?)
}
