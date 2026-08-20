mod app_error;
mod bili;
mod commands;
mod storage;
mod mpv;
mod player;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new().expect("failed to init app state"))
        .register_asynchronous_uri_scheme_protocol("biliimg", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let uri = request.uri().to_string();
            tauri::async_runtime::spawn(async move {
                let client = app.state::<AppState>().bili.clone();
                responder.respond(bili::media::serve(&client, &uri).await);
            });
        })
        .setup(|app| {
            let state = app.state::<AppState>();
            commands::init_data_dir(app.handle(), &state)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            use tauri::WindowEvent;
            if window.label() == "main"
                && matches!(
                    event,
                    WindowEvent::Moved(_)
                        | WindowEvent::Resized(_)
                        | WindowEvent::Focused(_)
                        | WindowEvent::ScaleFactorChanged { .. }
                )
            {
                let state = window.app_handle().state::<AppState>();
                let player = state.player.try_lock();
                if let Ok(mut player) = player {
                    let _ = player.sync_window();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth_qr_start,
            commands::auth_qr_poll,
            commands::auth_logout,
            commands::auth_me,
            commands::feed_recommend,
            commands::feed_selected,
            commands::feed_search,
            commands::video_view,
            commands::history_list,
            commands::archive_relation,
            commands::archive_like,
            commands::archive_dislike,
            commands::archive_coin,
            commands::archive_fav,
            commands::danmaku_send,
            commands::reply_list,
            commands::reply_add,
            commands::player_open,
            commands::player_stop,
            commands::player_toggle_pause,
            commands::player_seek,
            commands::player_set_volume,
            commands::player_set_speed,
            commands::player_set_danmaku,
            commands::player_set_danmaku_prefs,
            commands::player_set_bounds,
            commands::settings_get_all,
            commands::settings_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BiliDesk");
}
