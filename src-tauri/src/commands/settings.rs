use crate::app_error::AppResult;
use crate::commands::AppState;
use serde::Deserialize;
use std::collections::HashMap;
use tauri::State;

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
    state.with_storage(|storage| {
        storage.set_setting(&patch.key, &patch.value)?;
        Ok(())
    })?;
    if patch.key == "danmaku_enabled" {
        *state
            .danmaku_on
            .lock()
            .map_err(|e| crate::app_error::AppError::message(e.to_string()))? = patch.value != "false";
    }
    if patch.key == "danmaku_font_size" {
        if let Ok(n) = patch.value.parse::<u32>() {
            state
                .danmaku_opts
                .lock()
                .map_err(|e| crate::app_error::AppError::message(e.to_string()))?
                .font_size = n.clamp(28, 72);
        }
    }
    if patch.key == "danmaku_max_rows" {
        if let Ok(n) = patch.value.parse::<usize>() {
            state
                .danmaku_opts
                .lock()
                .map_err(|e| crate::app_error::AppError::message(e.to_string()))?
                .max_rows = n.clamp(4, 20);
        }
    }
    Ok(())
}
