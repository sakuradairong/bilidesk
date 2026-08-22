use super::bili::error::{BiliError, BiliResult};
use super::player::PlayerProgress;
use libloading::{Library, Symbol};
use std::ffi::{c_char, c_void, CStr, CString};
#[cfg(windows)]
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

const MPV_FORMAT_FLAG: i32 = 3;
const MPV_FORMAT_INT64: i32 = 4;
const MPV_FORMAT_DOUBLE: i32 = 5;
const MPV_EVENT_SHUTDOWN: i32 = 1;
const MPV_EVENT_END_FILE: i32 = 7;
const MPV_EVENT_FILE_LOADED: i32 = 8;
const MPV_EVENT_PROPERTY_CHANGE: i32 = 22;
const MPV_END_FILE_REASON_EOF: i32 = 0;
const MPV_END_FILE_REASON_ERROR: i32 = 4;

pub enum MpvCmd {
    CyclePause,
    Seek(f64),
    Volume(i64),
    Speed(f64),
    SubVisible(bool),
    Quit,
}

pub struct Playback {
    pub dll: PathBuf,
    pub video_url: String,
    pub audio_url: Option<String>,
    pub user_agent: String,
    pub referrer: String,
    pub cookie: Option<String>,
    pub ass_path: Option<PathBuf>,
    pub danmaku_on: bool,
    pub wid: i64,
}

#[repr(C)]
struct MpvEvent {
    event_id: i32,
    error: i32,
    reply_userdata: u64,
    data: *mut c_void,
}

#[repr(C)]
struct MpvEventProperty {
    name: *const c_char,
    format: i32,
    data: *mut c_void,
}

#[repr(C)]
struct MpvEventEndFile {
    reason: i32,
    error: i32,
    _playlist_entry_id: i64,
}

type FnCreate = unsafe extern "C" fn() -> *mut c_void;
type FnInitialize = unsafe extern "C" fn(*mut c_void) -> i32;
type FnSetOptionString = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> i32;
type FnSetOption = unsafe extern "C" fn(*mut c_void, *const c_char, i32, *mut c_void) -> i32;
type FnCommandAsync = unsafe extern "C" fn(*mut c_void, u64, *const *const c_char) -> i32;
type FnSetPropertyString = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> i32;
type FnObserveProperty = unsafe extern "C" fn(*mut c_void, u64, *const c_char, i32) -> i32;
type FnWaitEvent = unsafe extern "C" fn(*mut c_void, f64) -> *mut MpvEvent;
type FnTerminateDestroy = unsafe extern "C" fn(*mut c_void);
type FnErrorString = unsafe extern "C" fn(i32) -> *const c_char;

struct Api {
    create: FnCreate,
    initialize: FnInitialize,
    set_option_string: FnSetOptionString,
    set_option: FnSetOption,
    command_async: FnCommandAsync,
    set_property_string: FnSetPropertyString,
    observe_property: FnObserveProperty,
    wait_event: FnWaitEvent,
    terminate_destroy: FnTerminateDestroy,
    error_string: FnErrorString,
}

impl Api {
    unsafe fn load(lib: &Library) -> BiliResult<Self> {
        unsafe {
            Ok(Self {
                create: load_fn(lib, b"mpv_create\0")?,
                initialize: load_fn(lib, b"mpv_initialize\0")?,
                set_option_string: load_fn(lib, b"mpv_set_option_string\0")?,
                set_option: load_fn(lib, b"mpv_set_option\0")?,
                command_async: load_fn(lib, b"mpv_command_async\0")?,
                set_property_string: load_fn(lib, b"mpv_set_property_string\0")?,
                observe_property: load_fn(lib, b"mpv_observe_property\0")?,
                wait_event: load_fn(lib, b"mpv_wait_event\0")?,
                terminate_destroy: load_fn(lib, b"mpv_terminate_destroy\0")?,
                error_string: load_fn(lib, b"mpv_error_string\0")?,
            })
        }
    }

    fn fail(&self, code: i32, what: &str) -> BiliError {
        BiliError::msg(format!("{what}: {}", error_text(self.error_string, code)))
    }

    fn check(&self, code: i32, what: &str) -> BiliResult<()> {
        if code < 0 {
            Err(self.fail(code, what))
        } else {
            Ok(())
        }
    }

    fn set_str(&self, ctx: *mut c_void, name: &str, value: &str) -> BiliResult<()> {
        let name = cstr(name)?;
        let value = cstr(value)?;
        let code = unsafe { (self.set_option_string)(ctx, name.as_ptr(), value.as_ptr()) };
        self.check(code, name.to_str().unwrap_or("option"))
    }

    fn try_set_str(&self, ctx: *mut c_void, name: &str, value: &str) {
        let _ = self.set_str(ctx, name, value);
    }

    fn set_i64(&self, ctx: *mut c_void, name: &str, value: i64) -> BiliResult<()> {
        let name = cstr(name)?;
        let mut data = value;
        let code = unsafe {
            (self.set_option)(
                ctx,
                name.as_ptr(),
                MPV_FORMAT_INT64,
                (&mut data as *mut i64).cast(),
            )
        };
        self.check(code, name.to_str().unwrap_or("option"))
    }

    fn command_async(&self, ctx: *mut c_void, userdata: u64, args: &[&str]) -> BiliResult<()> {
        let owned = args
            .iter()
            .map(|s| cstr(s))
            .collect::<BiliResult<Vec<_>>>()?;
        let mut ptrs: Vec<*const c_char> = owned.iter().map(|s| s.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        let code = unsafe { (self.command_async)(ctx, userdata, ptrs.as_ptr()) };
        self.check(code, args.first().copied().unwrap_or("command_async"))
    }

    fn set_property(&self, ctx: *mut c_void, name: &str, value: &str) -> BiliResult<()> {
        let name = cstr(name)?;
        let value = cstr(value)?;
        let code = unsafe { (self.set_property_string)(ctx, name.as_ptr(), value.as_ptr()) };
        self.check(code, "set_property")
    }

    fn observe(&self, ctx: *mut c_void, id: u64, name: &str, format: i32) -> BiliResult<()> {
        let name = cstr(name)?;
        let code = unsafe { (self.observe_property)(ctx, id, name.as_ptr(), format) };
        self.check(code, "observe_property")
    }
}

unsafe fn load_fn<T: Copy>(lib: &Library, name: &[u8]) -> BiliResult<T> {
    let symbol: Symbol<T> = unsafe { lib.get(name) }.map_err(|err| {
        let symbol = name.split(|b| *b == 0).next().unwrap_or(name);
        BiliError::msg(format!(
            "libmpv 缺少符号 {}: {err}",
            String::from_utf8_lossy(symbol)
        ))
    })?;
    Ok(*symbol)
}

fn cstr(value: &str) -> BiliResult<CString> {
    CString::new(value).map_err(|_| BiliError::msg("mpv 参数包含空字符"))
}

fn error_text(fn_error: FnErrorString, code: i32) -> String {
    let ptr = unsafe { fn_error(code) };
    if ptr.is_null() {
        return format!("mpv error {code}");
    }
    unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned()
}

pub fn run(
    playback: Playback,
    rx: Receiver<MpvCmd>,
    running: Arc<AtomicBool>,
    app: AppHandle,
    ready: Sender<Result<(), String>>,
) -> BiliResult<()> {
    let started = run_inner(playback, rx, running, &app, &ready);
    if let Err(err) = &started {
        let _ = ready.send(Err(err.to_string()));
    }
    started
}

fn run_inner(
    playback: Playback,
    rx: Receiver<MpvCmd>,
    running: Arc<AtomicBool>,
    app: &AppHandle,
    ready: &Sender<Result<(), String>>,
) -> BiliResult<()> {
    #[cfg(windows)]
    prepend_dll_dir(&playback.dll);
    let lib = unsafe { Library::new(&playback.dll) }.map_err(|err| {
        BiliError::msg(format!(
            "无法加载 libmpv ({path}): {err}",
            path = playback.dll.display()
        ))
    })?;
    let api = unsafe { Api::load(&lib)? };
    let ctx = unsafe { (api.create)() };
    if ctx.is_null() {
        return Err(BiliError::msg("mpv_create 失败"));
    }
    let prepared = prepare_session(&api, ctx, &playback);
    if let Err(err) = &prepared {
        // SAFETY: ctx from mpv_create on this thread; initialize may have failed.
        unsafe { (api.terminate_destroy)(ctx) };
        drop(lib);
        return Err(BiliError::msg(err.to_string()));
    }
    let _ = ready.send(Ok(()));
    let result = event_loop(&api, ctx, &playback, rx, running, app);
    // SAFETY: all libmpv calls stayed on this worker; no other thread uses ctx.
    unsafe { (api.terminate_destroy)(ctx) };
    drop(lib);
    result
}

fn prepare_session(api: &Api, ctx: *mut c_void, playback: &Playback) -> BiliResult<()> {
    api.set_i64(ctx, "wid", playback.wid)?;
    // Do not inherit a machine-wide mpv.conf. Options such as video-unscaled
    // make low-resolution Featured clips render at their source pixel size.
    api.try_set_str(ctx, "config", "no");
    api.try_set_str(ctx, "vo", "gpu");
    api.try_set_str(ctx, "gpu-context", "d3d11");
    api.try_set_str(ctx, "gpu-api", "d3d11");
    api.try_set_str(ctx, "hwdec", "auto");
    api.try_set_str(ctx, "video-unscaled", "no");
    api.try_set_str(ctx, "keepaspect", "yes");
    api.try_set_str(ctx, "video-zoom", "0");
    api.try_set_str(ctx, "keep-open", "yes");
    api.try_set_str(ctx, "osc", "no");
    api.try_set_str(ctx, "osd-level", "0");
    api.try_set_str(ctx, "osd-bar", "no");
    api.try_set_str(ctx, "input-default-bindings", "no");
    api.try_set_str(ctx, "input-vo-keyboard", "no");
    api.try_set_str(ctx, "cursor-autohide", "always");
    api.try_set_str(ctx, "hr-seek", "yes");
    api.try_set_str(ctx, "volume", "80");
    api.set_str(ctx, "user-agent", &playback.user_agent)?;
    api.set_str(ctx, "referrer", &playback.referrer)?;
    if let Some(cookie) = &playback.cookie {
        api.set_str(ctx, "http-header-fields", cookie)?;
    }
    api.check(unsafe { (api.initialize)(ctx) }, "mpv_initialize")?;
    api.observe(ctx, 1, "time-pos", MPV_FORMAT_DOUBLE)?;
    api.observe(ctx, 2, "duration", MPV_FORMAT_DOUBLE)?;
    api.observe(ctx, 3, "pause", MPV_FORMAT_FLAG)?;
    api.observe(ctx, 4, "volume", MPV_FORMAT_DOUBLE)?;
    Ok(())
}

fn event_loop(
    api: &Api,
    ctx: *mut c_void,
    playback: &Playback,
    rx: Receiver<MpvCmd>,
    running: Arc<AtomicBool>,
    app: &AppHandle,
) -> BiliResult<()> {
    api.command_async(ctx, 10, &["loadfile", &playback.video_url, "replace"])?;
    let mut tracks_added = false;
    let mut progress = PlayerProgress {
        time: 0.0,
        duration: 0.0,
        paused: false,
        volume: 80,
    };
    while running.load(Ordering::SeqCst) {
        while let Ok(cmd) = rx.try_recv() {
            match cmd {
                MpvCmd::Quit => return Ok(()),
                MpvCmd::CyclePause => {
                    let _ = api.command_async(ctx, 20, &["cycle", "pause"]);
                }
                MpvCmd::Seek(seconds) => {
                    let value = seconds.to_string();
                    let _ = api.command_async(ctx, 21, &["seek", &value, "absolute"]);
                }
                MpvCmd::Volume(volume) => {
                    let value = volume.clamp(0, 130).to_string();
                    let _ = api.set_property(ctx, "volume", &value);
                }
                MpvCmd::Speed(speed) => {
                    let value = speed.clamp(0.25, 3.0).to_string();
                    let _ = api.set_property(ctx, "speed", &value);
                }
                MpvCmd::SubVisible(visible) => {
                    let _ =
                        api.set_property(ctx, "sub-visibility", if visible { "yes" } else { "no" });
                }
            }
        }
        // SAFETY: wait_event returns an internal pointer valid until the next wait_event.
        let event = unsafe { (api.wait_event)(ctx, 0.05) };
        if event.is_null() {
            continue;
        }
        let event = unsafe { &*event };
        match event.event_id {
            MPV_EVENT_SHUTDOWN => return Ok(()),
            MPV_EVENT_FILE_LOADED if !tracks_added => {
                tracks_added = true;
                if let Some(audio) = &playback.audio_url {
                    let _ = api.command_async(ctx, 11, &["audio-add", audio]);
                }
                if let Some(ass) = &playback.ass_path {
                    let path = ass.to_string_lossy();
                    let _ = api.command_async(ctx, 12, &["sub-add", path.as_ref()]);
                    let _ = api.set_property(
                        ctx,
                        "sub-visibility",
                        if playback.danmaku_on { "yes" } else { "no" },
                    );
                }
            }
            MPV_EVENT_END_FILE => handle_end_file(event, app),
            MPV_EVENT_PROPERTY_CHANGE if apply_property(event, &mut progress) => {
                let _ = app.emit("player-progress", progress.clone());
            }
            _ => {}
        }
    }
    Ok(())
}

fn handle_end_file(event: &MpvEvent, app: &AppHandle) {
    if event.data.is_null() {
        return;
    }
    let data = unsafe { &*event.data.cast::<MpvEventEndFile>() };
    match data.reason {
        MPV_END_FILE_REASON_EOF => {
            let _ = app.emit("player-ended", true);
        }
        MPV_END_FILE_REASON_ERROR => {
            let _ = app.emit(
                "player-error",
                format!("播放失败（mpv {code}）", code = data.error),
            );
        }
        _ => {}
    }
}

fn apply_property(event: &MpvEvent, progress: &mut PlayerProgress) -> bool {
    if event.data.is_null() {
        return false;
    }
    let prop = unsafe { &*event.data.cast::<MpvEventProperty>() };
    if prop.data.is_null() {
        return false;
    }
    let name = if prop.name.is_null() {
        ""
    } else {
        unsafe { CStr::from_ptr(prop.name) }.to_str().unwrap_or("")
    };
    match (name, prop.format) {
        ("time-pos", MPV_FORMAT_DOUBLE) => {
            progress.time = unsafe { *prop.data.cast::<f64>() };
            true
        }
        ("duration", MPV_FORMAT_DOUBLE) => {
            progress.duration = unsafe { *prop.data.cast::<f64>() };
            true
        }
        ("pause", MPV_FORMAT_FLAG) => {
            progress.paused = unsafe { *prop.data.cast::<i32>() } != 0;
            true
        }
        ("volume", MPV_FORMAT_DOUBLE) => {
            progress.volume = unsafe { *prop.data.cast::<f64>() } as i64;
            true
        }
        ("volume", MPV_FORMAT_INT64) => {
            progress.volume = unsafe { *prop.data.cast::<i64>() };
            true
        }
        _ => false,
    }
}

#[cfg(windows)]
fn prepend_dll_dir(dll: &Path) {
    let Some(dir) = dll.parent().and_then(Path::to_str) else {
        return;
    };
    let mut path = String::from(dir);
    path.push(';');
    if let Ok(existing) = std::env::var("PATH") {
        path.push_str(&existing);
    }
    std::env::set_var("PATH", path);
}
