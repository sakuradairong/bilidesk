use super::bili::error::{BiliError, BiliResult};
use super::bili::models::StreamChoice;
use super::mpv::{self, MpvCmd, Playback};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::{AppHandle, Emitter, WebviewWindow};

#[derive(Debug, Clone, Copy, Default)]
pub struct StageBounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum PlayerPresentation {
    #[default]
    Embedded,
    Backdrop,
}

pub struct PlayerOpenRequest<'a> {
    pub window: &'a WebviewWindow,
    pub app: AppHandle,
    pub stream: &'a StreamChoice,
    pub headers: &'a [String],
    pub ass_path: Option<&'a Path>,
    pub danmaku_on: bool,
    pub presentation: PlayerPresentation,
}

impl StageBounds {
    fn is_usable(self) -> bool {
        self.width >= 16 && self.height >= 16
    }
}

pub fn css_to_physical(value: f64, scale: f64) -> i32 {
    (value * scale).round() as i32
}

#[derive(Debug, Clone, Serialize)]
pub struct PlayerProgress {
    pub time: f64,
    pub duration: f64,
    pub paused: bool,
    pub volume: i64,
}

pub struct PlayerHost {
    tx: Option<Sender<MpvCmd>>,
    worker: Option<JoinHandle<()>>,
    running: Arc<AtomicBool>,
    bounds: StageBounds,
    embed: Option<isize>,
    presentation: PlayerPresentation,
    window: Option<WebviewWindow>,
}

impl Default for PlayerHost {
    fn default() -> Self {
        Self {
            tx: None,
            worker: None,
            running: Arc::new(AtomicBool::new(false)),
            bounds: StageBounds::default(),
            embed: None,
            presentation: PlayerPresentation::Embedded,
            window: None,
        }
    }
}

impl Drop for PlayerHost {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

impl PlayerHost {
    pub fn set_bounds(&mut self, bounds: StageBounds) -> BiliResult<()> {
        self.bounds = bounds;
        self.sync_window()
    }

    pub fn sync_window(&mut self) -> BiliResult<()> {
        #[cfg(windows)]
        if let (Some(window), Some(hwnd)) = (self.window.clone(), self.embed) {
            let parent = window
                .hwnd()
                .map_err(|err| BiliError::msg(err.to_string()))?
                .0 as isize;
            let bounds = self.bounds;
            let presentation = self.presentation;
            on_window_thread(&window, hwnd, move || {
                embed::move_host(parent, hwnd, bounds, presentation)
            })??;
        }
        Ok(())
    }

    pub fn stop(&mut self) -> BiliResult<()> {
        let joined = self.shutdown_worker(Duration::from_secs(2));
        if joined {
            self.destroy_embed();
        } else {
            // worker 仍可能在用 HWND，不能销毁。
            self.embed = None;
            self.presentation = PlayerPresentation::Embedded;
            self.window = None;
        }
        Ok(())
    }

    fn shutdown_worker(&mut self, timeout: Duration) -> bool {
        self.running.store(false, Ordering::SeqCst);
        if let Some(tx) = self.tx.take() {
            let _ = tx.send(MpvCmd::Quit);
        }
        let Some(worker) = self.worker.take() else {
            return true;
        };
        let (done_tx, done_rx) = mpsc::channel();
        thread::spawn(move || {
            let _ = worker.join();
            let _ = done_tx.send(());
        });
        done_rx.recv_timeout(timeout).is_ok()
    }

    fn destroy_embed(&mut self) {
        #[cfg(windows)]
        if let (Some(window), Some(hwnd)) = (self.window.take(), self.embed.take()) {
            let _ = on_window_thread(&window, hwnd, move || {
                embed::destroy_host(hwnd);
            });
        }
        #[cfg(not(windows))]
        {
            self.embed = None;
            self.window = None;
        }
        self.presentation = PlayerPresentation::Embedded;
    }

    pub fn command(&mut self, cmd: MpvCmd) -> BiliResult<()> {
        let Some(tx) = self.tx.as_ref() else {
            return Err(BiliError::msg("播放器未启动"));
        };
        tx.send(cmd).map_err(|_| BiliError::msg("播放器已退出"))
    }

    pub fn toggle_pause(&mut self) -> BiliResult<()> {
        self.command(MpvCmd::CyclePause)
    }

    pub fn seek(&mut self, seconds: f64) -> BiliResult<()> {
        self.command(MpvCmd::Seek(seconds))
    }

    pub fn set_volume(&mut self, volume: i64) -> BiliResult<()> {
        self.command(MpvCmd::Volume(volume.clamp(0, 130)))
    }

    pub fn set_speed(&mut self, speed: f64) -> BiliResult<()> {
        self.command(MpvCmd::Speed(speed.clamp(0.25, 3.0)))
    }

    pub fn set_sub_visible(&mut self, visible: bool) -> BiliResult<()> {
        self.command(MpvCmd::SubVisible(visible))
    }

    pub fn open(&mut self, request: PlayerOpenRequest<'_>) -> BiliResult<()> {
        let PlayerOpenRequest {
            window,
            app,
            stream,
            headers,
            ass_path,
            danmaku_on,
            presentation,
        } = request;
        self.stop()?;
        self.presentation = presentation;
        self.window = Some(window.clone());
        let dll = find_libmpv().ok_or_else(|| {
            BiliError::msg(
                "未找到 libmpv-2.dll。请把 zhongfly/mpv-winbuild 的 mpv-dev-lgpl-x86_64 包里的 DLL 放到 src-tauri/vendor/mpv/，或设置 BILIDESK_MPV",
            )
        })?;

        let bounds = self.ensure_bounds(window);
        let wid = self
            .prepare_embed(window, bounds)
            .ok_or_else(|| BiliError::msg("无法创建内嵌播放窗口"))?;

        let (tx, rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        self.running = Arc::new(AtomicBool::new(true));
        let running = self.running.clone();
        let playback = Playback {
            dll,
            video_url: stream.video_url.clone(),
            audio_url: stream.audio_url.clone(),
            user_agent: crate::bili::session::Session::user_agent().to_string(),
            referrer: "https://www.bilibili.com/".into(),
            cookie: cookie_from_headers(headers),
            ass_path: ass_path.map(Path::to_path_buf),
            danmaku_on,
            wid,
        };
        self.worker = Some(thread::spawn(move || {
            if let Err(err) = mpv::run(playback, rx, running, app.clone(), ready_tx) {
                let _ = app.emit("player-error", err.to_string());
            }
        }));
        self.tx = Some(tx);
        match ready_rx.recv_timeout(Duration::from_secs(12)) {
            Ok(Ok(())) => Ok(()),
            Ok(Err(message)) => {
                let _ = self.stop();
                Err(BiliError::msg(message))
            }
            Err(_) => {
                let _ = self.stop();
                Err(BiliError::msg("libmpv 启动超时"))
            }
        }
    }

    fn ensure_bounds(&self, window: &WebviewWindow) -> StageBounds {
        if self.bounds.is_usable() {
            return self.bounds;
        }
        let size = window.inner_size().ok();
        let scale = window.scale_factor().unwrap_or(1.0);
        let width = size.map(|s| s.width as i32).unwrap_or(1280);
        let height = size.map(|s| s.height as i32).unwrap_or(800);
        StageBounds {
            x: 0,
            y: css_to_physical(56.0, scale),
            width,
            height: (height - css_to_physical(136.0, scale)).max(16),
        }
    }

    fn prepare_embed(&mut self, window: &WebviewWindow, bounds: StageBounds) -> Option<i64> {
        #[cfg(windows)]
        {
            let parent = window.hwnd().ok()?;
            let parent = parent.0 as isize;
            let presentation = self.presentation;
            let window = window.clone();
            let hwnd = on_window_thread(&window, parent, move || {
                embed::create_host(parent, bounds, presentation)
            })
            .ok()?
            .ok()?;
            self.embed = Some(hwnd);
            Some(hwnd as i64)
        }
        #[cfg(not(windows))]
        {
            let _ = (window, bounds);
            None
        }
    }
}

fn on_window_thread<T, F>(window: &WebviewWindow, hwnd: isize, f: F) -> BiliResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    #[cfg(windows)]
    {
        if embed::is_window_thread(hwnd) {
            return Ok(f());
        }
        let (tx, rx) = mpsc::sync_channel(1);
        window
            .run_on_main_thread(move || {
                let _ = tx.send(f());
            })
            .map_err(|err| BiliError::msg(err.to_string()))?;
        rx.recv_timeout(Duration::from_secs(3))
            .map_err(|_| BiliError::msg("主线程窗口操作超时"))
    }
    #[cfg(not(windows))]
    {
        let _ = (window, hwnd);
        Ok(f())
    }
}

pub(crate) fn cookie_from_headers(headers: &[String]) -> Option<String> {
    headers
        .iter()
        .find(|h| h.to_ascii_lowercase().starts_with("cookie:"))
        .cloned()
}

fn find_libmpv() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("BILIDESK_MPV") {
        let p = PathBuf::from(path);
        if let Some(dll) = dll_if_present(&p) {
            return Some(dll);
        }
    }
    known_libmpv_paths().into_iter().find(|p| p.is_file())
}

fn dll_if_present(path: &Path) -> Option<PathBuf> {
    if path.is_file() {
        let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
        if name.ends_with(".dll") {
            return Some(path.to_path_buf());
        }
        if let Some(dir) = path.parent() {
            return first_dll_in(dir);
        }
    }
    if path.is_dir() {
        return first_dll_in(path);
    }
    None
}

fn first_dll_in(dir: &Path) -> Option<PathBuf> {
    for name in ["libmpv-2.dll", "mpv-2.dll"] {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

pub(crate) fn known_libmpv_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let vendor = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/mpv");
    paths.push(vendor.join("libmpv-2.dll"));
    paths.push(vendor.join("mpv-2.dll"));
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("libmpv-2.dll"));
            paths.push(dir.join("mpv-2.dll"));
            paths.push(dir.join("resources").join("libmpv-2.dll"));
            paths.push(dir.join("vendor").join("mpv").join("libmpv-2.dll"));
        }
    }
    if let Ok(path) = std::env::var("PATH") {
        for dir in env_split(&path) {
            paths.push(Path::new(dir).join("libmpv-2.dll"));
            paths.push(Path::new(dir).join("mpv-2.dll"));
        }
    }
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let home = PathBuf::from(home);
        paths.push(home.join(r"scoop\apps\mpv\current\libmpv-2.dll"));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let local = PathBuf::from(local);
        paths.push(local.join(r"Programs\mpv\libmpv-2.dll"));
        collect_winget_libmpv(&local.join(r"Microsoft\WinGet\Packages"), &mut paths);
    }
    paths
}

fn collect_winget_libmpv(packages: &Path, paths: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(packages) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if !name.contains("mpv") {
            continue;
        }
        paths.push(entry.path().join("libmpv-2.dll"));
        if let Ok(inner) = fs::read_dir(entry.path()) {
            for child in inner.flatten() {
                paths.push(child.path().join("libmpv-2.dll"));
            }
        }
    }
}

fn env_split(path: &str) -> Vec<&str> {
    path.split(';').collect()
}

pub fn write_ass(cid: i64, content: &str) -> BiliResult<PathBuf> {
    let path = std::env::temp_dir().join(format!("bilidesk-{cid}.ass"));
    fs::write(&path, content)?;
    Ok(path)
}

#[cfg(windows)]
mod embed {
    use super::BiliError;
    use super::BiliResult;
    use super::PlayerPresentation;
    use super::StageBounds;
    use std::sync::OnceLock;
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::Graphics::Gdi::{ClientToScreen, GetStockObject, BLACK_BRUSH, HBRUSH};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, GetWindowThreadProcessId, IsIconic,
        IsWindowVisible, RegisterClassExW, SetWindowPos, CS_HREDRAW, CS_VREDRAW, HTTRANSPARENT,
        HWND_TOP, SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
        WM_NCHITTEST, WNDCLASSEXW, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT, WS_POPUP, WS_VISIBLE,
    };

    const CLASS: windows::core::PCWSTR = w!("BiliDeskMpvHost");
    static CLASS_ONCE: OnceLock<u16> = OnceLock::new();

    unsafe extern "system" fn wnd_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_NCHITTEST {
            return LRESULT(HTTRANSPARENT as isize);
        }
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }

    fn register() -> BiliResult<u16> {
        if let Some(atom) = CLASS_ONCE.get() {
            return Ok(*atom);
        }
        let instance =
            unsafe { GetModuleHandleW(None) }.map_err(|err| BiliError::msg(err.to_string()))?;
        let brush = HBRUSH(unsafe { GetStockObject(BLACK_BRUSH) }.0);
        let class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wnd_proc),
            hInstance: instance.into(),
            hbrBackground: brush,
            lpszClassName: CLASS,
            ..Default::default()
        };
        let atom = unsafe { RegisterClassExW(&class) };
        if atom == 0 {
            return Err(BiliError::msg("注册播放窗口类失败"));
        }
        let _ = CLASS_ONCE.set(atom);
        Ok(atom)
    }

    pub fn is_window_thread(hwnd: isize) -> bool {
        let hwnd = HWND(hwnd as *mut std::ffi::c_void);
        let mut pid = 0u32;
        let tid = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        tid != 0 && tid == unsafe { GetCurrentThreadId() }
    }

    pub fn create_host(
        parent: isize,
        bounds: StageBounds,
        presentation: PlayerPresentation,
    ) -> BiliResult<isize> {
        let _ = register()?;
        let parent = HWND(parent as *mut std::ffi::c_void);
        let (ex_style, style, host_parent) = match presentation {
            PlayerPresentation::Embedded => (
                WS_EX_TRANSPARENT | WS_EX_NOACTIVATE,
                WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
                Some(parent),
            ),
            PlayerPresentation::Backdrop => (
                WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                WS_POPUP | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
                None,
            ),
        };
        let hwnd = unsafe {
            CreateWindowExW(
                ex_style,
                CLASS,
                w!(""),
                style,
                bounds.x,
                bounds.y,
                bounds.width.max(16),
                bounds.height.max(16),
                host_parent,
                None,
                None,
                None,
            )
        }
        .map_err(|err| BiliError::msg(format!("创建播放窗口失败: {err}")))?;
        move_host(parent.0 as isize, hwnd.0 as isize, bounds, presentation)?;
        Ok(hwnd.0 as isize)
    }

    pub fn move_host(
        parent: isize,
        hwnd: isize,
        bounds: StageBounds,
        presentation: PlayerPresentation,
    ) -> BiliResult<()> {
        let parent = HWND(parent as *mut std::ffi::c_void);
        let hwnd = HWND(hwnd as *mut std::ffi::c_void);
        if presentation == PlayerPresentation::Backdrop
            && (unsafe { IsIconic(parent) }.as_bool()
                || !unsafe { IsWindowVisible(parent) }.as_bool())
        {
            unsafe {
                SetWindowPos(
                    hwnd,
                    None,
                    0,
                    0,
                    0,
                    0,
                    SWP_HIDEWINDOW | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
                )
            }
            .map_err(|err| BiliError::msg(format!("隐藏播放窗口失败: {err}")))?;
            return Ok(());
        }
        if !bounds.is_usable() {
            return Ok(());
        }
        match presentation {
            PlayerPresentation::Embedded => unsafe {
                SetWindowPos(
                    hwnd,
                    Some(HWND_TOP),
                    bounds.x,
                    bounds.y,
                    bounds.width.max(16),
                    bounds.height.max(16),
                    SWP_SHOWWINDOW | SWP_NOACTIVATE,
                )
            },
            PlayerPresentation::Backdrop => {
                let mut origin = POINT {
                    x: bounds.x,
                    y: bounds.y,
                };
                if !unsafe { ClientToScreen(parent, &mut origin) }.as_bool() {
                    return Err(BiliError::msg("无法换算播放窗口屏幕坐标"));
                }
                unsafe {
                    SetWindowPos(
                        hwnd,
                        Some(parent),
                        origin.x,
                        origin.y,
                        bounds.width.max(16),
                        bounds.height.max(16),
                        SWP_SHOWWINDOW | SWP_NOACTIVATE,
                    )
                }
            }
        }
        .map_err(|err| BiliError::msg(format!("调整播放窗口失败: {err}")))?;
        Ok(())
    }

    pub fn destroy_host(hwnd: isize) {
        let _ = unsafe { DestroyWindow(HWND(hwnd as *mut std::ffi::c_void)) };
    }
}

#[cfg(test)]
mod tests {
    use super::{cookie_from_headers, css_to_physical, env_split, known_libmpv_paths};

    #[test]
    fn path_split_windows_style() {
        assert_eq!(env_split(r"C:\a;C:\b"), vec![r"C:\a", r"C:\b"]);
    }

    #[test]
    fn css_pixels_scale_to_physical() {
        assert_eq!(css_to_physical(100.0, 1.5), 150);
        assert_eq!(css_to_physical(10.4, 1.0), 10);
    }

    #[test]
    fn cookie_header_is_picked_from_mpv_headers() {
        let headers = vec![
            "User-Agent: Mozilla".into(),
            "Cookie: SESSDATA=abc; bili_jct=1".into(),
        ];
        assert_eq!(
            cookie_from_headers(&headers).as_deref(),
            Some("Cookie: SESSDATA=abc; bili_jct=1")
        );
    }

    #[test]
    fn libmpv_search_starts_in_vendor() {
        let paths = known_libmpv_paths();
        let first = paths[0].to_string_lossy();
        assert!(first
            .replace('\\', "/")
            .ends_with("vendor/mpv/libmpv-2.dll"));
    }
}
