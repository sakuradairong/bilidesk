use super::bili::error::{BiliError, BiliResult};
use super::bili::models::StreamChoice;
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, WebviewWindow};

#[cfg(windows)]
use std::os::windows::fs::OpenOptionsExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
pub struct PlayerProgress {
    pub time: f64,
    pub duration: f64,
    pub paused: bool,
    pub volume: i64,
}

pub struct PlayerHost {
    child: Option<Child>,
    ipc: Option<File>,
    running: Arc<AtomicBool>,
    pipe_name: String,
}

impl Default for PlayerHost {
    fn default() -> Self {
        Self {
            child: None,
            ipc: None,
            running: Arc::new(AtomicBool::new(false)),
            pipe_name: String::new(),
        }
    }
}

impl Drop for PlayerHost {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

impl PlayerHost {
    pub fn stop(&mut self) -> BiliResult<()> {
        self.running.store(false, Ordering::SeqCst);
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.ipc.take();
        Ok(())
    }

    pub fn command(&mut self, cmd: serde_json::Value) -> BiliResult<()> {
        let Some(ipc) = self.ipc.as_mut() else {
            return Err(BiliError::msg("播放器未启动"));
        };
        let line = format!("{cmd}\n");
        ipc.write_all(line.as_bytes())?;
        ipc.flush()?;
        Ok(())
    }

    pub fn toggle_pause(&mut self) -> BiliResult<()> {
        self.command(serde_json::json!({"command": ["cycle", "pause"]}))
    }

    pub fn seek(&mut self, seconds: f64) -> BiliResult<()> {
        self.command(serde_json::json!({"command": ["seek", seconds, "absolute"]}))
    }

    pub fn set_volume(&mut self, volume: i64) -> BiliResult<()> {
        self.command(serde_json::json!({"command": ["set_property", "volume", volume.clamp(0, 130)]}))
    }

    pub fn set_sub_visible(&mut self, visible: bool) -> BiliResult<()> {
        self.command(serde_json::json!({"command": ["set_property", "sub-visibility", visible]}))
    }

    pub fn open(
        &mut self,
        window: &WebviewWindow,
        app: AppHandle,
        stream: &StreamChoice,
        headers: &[String],
        ass_path: Option<&Path>,
        danmaku_on: bool,
    ) -> BiliResult<()> {
        self.stop()?;
        let mpv = find_mpv().ok_or_else(|| {
            BiliError::msg("未找到 mpv。请安装 mpv 并加入 PATH，或设置环境变量 BILIDESK_MPV 指向 mpv.exe")
        })?;

        let pid = std::process::id();
        self.pipe_name = format!("bilidesk-mpv-{pid}");
        let pipe_arg = format!(r"\\.\pipe\{}", self.pipe_name);

        let mut args = vec![
            "--no-config".into(),
            "--keep-open=yes".into(),
            "--force-window=yes".into(),
            "--no-border".into(),
            "--hwdec=auto".into(),
            "--vo=gpu".into(),
            "--hr-seek=yes".into(),
            "--no-osc".into(),
            "--osd-level=0".into(),
            "--no-input-default-bindings".into(),
            "--input-vo-keyboard=no".into(),
            "--cursor-autohide=always".into(),
            "--volume=80".into(),
            format!("--input-ipc-server={pipe_arg}"),
            format!("--user-agent={}", crate::bili::session::Session::user_agent()),
            "--referrer=https://www.bilibili.com/".into(),
        ];

        if let Some(cookie) = headers.iter().find(|h| h.to_ascii_lowercase().starts_with("cookie:")) {
            args.push(format!("--http-header-fields={cookie}"));
        }
        if let Some(ass) = ass_path {
            args.push(format!("--sub-file={}", ass.display()));
            args.push(format!("--sub-visibility={}", if danmaku_on { "yes" } else { "no" }));
        }
        if let Some(audio) = &stream.audio_url {
            args.push(format!("--audio-file={audio}"));
        }
        if let Some(wid) = window_wid(window) {
            args.push(format!("--wid={wid}"));
        }
        args.push(stream.video_url.clone());

        let mut command = Command::new(&mpv);
        command.args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            if args.iter().any(|a| a.starts_with("--wid=")) {
                command.creation_flags(CREATE_NO_WINDOW);
            }
        }
        let child = command.spawn().map_err(|err| {
            BiliError::msg(format!("无法启动 mpv ({mpv}): {err}", mpv = mpv.display()))
        })?;
        self.child = Some(child);

        let ipc = connect_pipe(&self.pipe_name, 40)?;
        let mut reader_src = ipc.try_clone()?;
        self.ipc = Some(ipc);
        self.running = Arc::new(AtomicBool::new(true));
        let running = self.running.clone();
        let _ = self.command(serde_json::json!({
            "command": ["observe_property", 1, "time-pos"]
        }));
        let _ = self.command(serde_json::json!({
            "command": ["observe_property", 2, "duration"]
        }));
        let _ = self.command(serde_json::json!({
            "command": ["observe_property", 3, "pause"]
        }));
        let _ = self.command(serde_json::json!({
            "command": ["observe_property", 4, "volume"]
        }));

        thread::spawn(move || {
            let mut reader = BufReader::new(&mut reader_src);
            let mut line = String::new();
            let mut progress = PlayerProgress {
                time: 0.0,
                duration: 0.0,
                paused: false,
                volume: 80,
            };
            while running.load(Ordering::SeqCst) {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim()) {
                            apply_event(&mut progress, &value);
                            let _ = app.emit("player-progress", progress.clone());
                            if value.get("event").and_then(|e| e.as_str()) == Some("end-file")
                                && value.get("reason").and_then(|r| r.as_str()) == Some("eof")
                            {
                                let _ = app.emit("player-ended", true);
                            }
                        }
                    }
                    Err(_) => {
                        thread::sleep(Duration::from_millis(40));
                    }
                }
            }
        });
        Ok(())
    }
}

fn apply_event(progress: &mut PlayerProgress, value: &serde_json::Value) {
    if value.get("event").and_then(|e| e.as_str()) != Some("property-change") {
        return;
    }
    let name = value.get("name").and_then(|n| n.as_str()).unwrap_or("");
    match name {
        "time-pos" => progress.time = value.get("data").and_then(|d| d.as_f64()).unwrap_or(progress.time),
        "duration" => progress.duration = value.get("data").and_then(|d| d.as_f64()).unwrap_or(progress.duration),
        "pause" => progress.paused = value.get("data").and_then(|d| d.as_bool()).unwrap_or(progress.paused),
        "volume" => progress.volume = value.get("data").and_then(|d| d.as_f64()).unwrap_or(progress.volume as f64) as i64,
        _ => {}
    }
}

fn connect_pipe(name: &str, attempts: u32) -> BiliResult<File> {
    let path = format!(r"\\.\pipe\{name}");
    for i in 0..attempts {
        let mut opts = OpenOptions::new();
        opts.read(true).write(true);
        #[cfg(windows)]
        {
            opts.share_mode(0x03);
        }
        match opts.open(&path) {
            Ok(file) => return Ok(file),
            Err(err) => {
                if i + 1 == attempts {
                    return Err(BiliError::msg(format!("连接 mpv IPC 失败: {err}")));
                }
                thread::sleep(Duration::from_millis(80));
            }
        }
    }
    Err(BiliError::msg("连接 mpv IPC 失败"))
}

fn find_mpv() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("BILIDESK_MPV") {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("mpv.exe");
            if candidate.exists() {
                return Some(candidate);
            }
            let resource = dir.join("resources").join("mpv.exe");
            if resource.exists() {
                return Some(resource);
            }
        }
    }
    let path = std::env::var("PATH").ok()?;
    for dir in env_split(&path) {
        let candidate = Path::new(dir).join("mpv.exe");
        if candidate.exists() {
            return Some(candidate);
        }
        let unix = Path::new(dir).join("mpv");
        if unix.exists() {
            return Some(unix);
        }
    }
    for extra in [
        r"C:\Program Files\mpv\mpv.exe",
        r"C:\Program Files (x86)\mpv\mpv.exe",
        r"C:\mpv\mpv.exe",
    ] {
        let p = PathBuf::from(extra);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn env_split(path: &str) -> Vec<&str> {
    path.split(';').collect()
}

fn window_wid(window: &WebviewWindow) -> Option<i64> {
    #[cfg(windows)]
    {
        window.hwnd().ok().map(|hwnd| hwnd.0 as i64)
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        None
    }
}

pub fn write_ass(cid: i64, content: &str) -> BiliResult<PathBuf> {
    let path = std::env::temp_dir().join(format!("bilidesk-{cid}.ass"));
    fs::write(&path, content)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::env_split;

    #[test]
    fn path_split_windows_style() {
        assert_eq!(env_split(r"C:\a;C:\b"), vec![r"C:\a", r"C:\b"]);
    }
}
