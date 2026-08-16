mod bili;
mod commands;
mod player;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new().expect("failed to init app state"))
        .setup(|app| {
            let state = app.state::<AppState>();
            commands::init_data_dir(app.handle(), &state)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth_qr_start,
            commands::auth_qr_poll,
            commands::auth_logout,
            commands::auth_me,
            commands::feed_recommend,
            commands::feed_search,
            commands::video_view,
            commands::history_list,
            commands::player_open,
            commands::player_stop,
            commands::player_toggle_pause,
            commands::player_seek,
            commands::player_set_volume,
            commands::player_set_danmaku,
            commands::player_set_danmaku_prefs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BiliDesk");
}
