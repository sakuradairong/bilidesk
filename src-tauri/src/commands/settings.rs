use crate::app_error::{AppError, AppResult};
use crate::commands::AppState;
use serde::Deserialize;
use std::collections::HashMap;
use tauri::State;

const ALLOWED_KEYS: &[&str] = &[
    "theme",
    "accent_color",
    "danmaku_enabled",
    "danmaku_font_size",
    "danmaku_max_rows",
    "danmaku_opacity",
    "danmaku_area",
    "danmaku_bold",
    "default_volume",
    "default_speed",
    "auto_play_next",
    "resume_position",
];

#[tauri::command]
pub fn settings_get_all(state: State<'_, AppState>) -> AppResult<HashMap<String, String>> {
    state.with_storage(|storage| Ok(storage.all_settings()?))
}

#[derive(Debug, Deserialize)]
pub struct SettingPatch {
    pub key: String,
    pub value: String,
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, patch: SettingPatch) -> AppResult<()> {
    if !ALLOWED_KEYS.contains(&patch.key.as_str()) {
        return Err(AppError::message("不支持的设置项"));
    }
    state.with_storage(|storage| {
        storage.set_setting(&patch.key, &patch.value)?;
        Ok(())
    })?;
    if patch.key == "danmaku_enabled" {
        *state
            .danmaku_on
            .lock()
            .map_err(|e| AppError::message(e.to_string()))? = patch.value != "false";
    }
    if patch.key == "danmaku_font_size" {
        if let Ok(n) = patch.value.parse::<u32>() {
            state
                .danmaku_opts
                .lock()
                .map_err(|e| AppError::message(e.to_string()))?
                .font_size = n.clamp(28, 72);
        }
    }
    if patch.key == "danmaku_max_rows" {
        if let Ok(n) = patch.value.parse::<usize>() {
            state
                .danmaku_opts
                .lock()
                .map_err(|e| AppError::message(e.to_string()))?
                .max_rows = n.clamp(4, 20);
        }
    }
    Ok(())
}
