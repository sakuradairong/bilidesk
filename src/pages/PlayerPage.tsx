import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Settings2, Volume2 } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  archiveTriple,
  playerOpen,
  playerProgressGet,
  playerProgressSave,
  playerSeek,
  playerSetBounds,
  playerSetDanmaku,
  playerSetDanmakuPrefs,
  playerSetSpeed,
  playerSetVolume,
  playerStop,
  playerTogglePause,
  toAppError,
  videoView,
  watchlaterSave,
} from "@/api";
import { formatDuration } from "@/components/VideoCard";
import { Button } from "@/components/ui/button";
import { mediaSrc } from "@/media";
import { isHotkeyIgnored } from "@/lib/hotkeys";
import { watchBack } from "@/lib/watch";
import type { PlaySession, PlayerProgress, VideoDetail } from "@/types";
import { useSettingsStore } from "@/stores/settings";

const SPEED_MIN = 0.5;
const SPEED_MAX = 3.0;

export function PlayerPage() {
  const { bvid = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const loaded = useSettingsStore((s) => s.loaded);
  const defaultVolume = useSettingsStore((s) => s.defaultVolume);
  const defaultSpeed = useSettingsStore((s) => s.defaultSpeed);
  const danmakuEnabled = useSettingsStore((s) => s.danmakuEnabled);
  const danmakuFontSize = useSettingsStore((s) => s.danmakuFontSize);
  const danmakuMaxRows = useSettingsStore((s) => s.danmakuMaxRows);
  const danmakuOpacity = useSettingsStore((s) => s.danmakuOpacity);
  const danmakuArea = useSettingsStore((s) => s.danmakuArea);
  const danmakuBold = useSettingsStore((s) => s.danmakuBold);
  const autoPlayNext = useSettingsStore((s) => s.autoPlayNext);
  const [session, setSession] = useState<PlaySession | null>(null);
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [progress, setProgress] = useState<PlayerProgress>({
    time: 0,
    duration: 0,
    paused: false,
    volume: defaultVolume,
  });
  const [speed, setSpeed] = useState(defaultSpeed);
  const [danmaku, setDanmaku] = useState(danmakuEnabled);
  const [density, setDensity] = useState(String(danmakuMaxRows));
  const [fontSize, setFontSize] = useState(String(danmakuFontSize));
  const [opacity, setOpacity] = useState(String(danmakuOpacity));
  const [area, setArea] = useState(String(danmakuArea));
  const [tripled, setTripled] = useState(false);
  const [savedLater, setSavedLater] = useState(false);
  const [danmakuPanelOpen, setDanmakuPanelOpen] = useState(false);
  const [countdown, setCountdown] = useState<{
    left: number;
    label: string;
  } | null>(null);
  const [error, setError] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(progress);
  const sessionRef = useRef<PlaySession | null>(null);
  const appliedDefaults = useRef<string | null>(null);
  const lastSaveRef = useRef(0);
  const endingRef = useRef(false);
  progressRef.current = progress;
  sessionRef.current = session;

  const onBack = () => watchBack(navigate, from);

  useEffect(() => {
    document.documentElement.classList.add("player-mode");
    return () => document.documentElement.classList.remove("player-mode");
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const publish = () => {
      const rect = el.getBoundingClientRect();
      void playerSetBounds({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
    };
  }, []);

  // 打开新视频时复位交互状态
  useEffect(() => {
    setTripled(false);
    setSavedLater(false);
    setDanmakuPanelOpen(false);
    setCountdown(null);
    endingRef.current = false;
  }, [bvid, session?.cid]);

  useEffect(() => {
    let cancelled = false;
    let unlistenProgress: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let unlistenEnded: (() => void) | undefined;
    listen<PlayerProgress>("player-progress", (event) => {
      setProgress(event.payload);
      // 每 10 秒节流保存断点
      const s = sessionRef.current;
      const p = event.payload;
      const now = Date.now();
      if (
        s &&
        p.duration > 0 &&
        !p.paused &&
        now - lastSaveRef.current > 10_000
      ) {
        lastSaveRef.current = now;
        void playerProgressSave(s.bvid, s.cid, p.time, p.duration).catch(
          () => {},
        );
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenProgress = fn;
    });
    listen<string>("player-error", (event) => {
      setError(event.payload);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenError = fn;
    });
    listen("player-ended", () => {
      const s = sessionRef.current;
      if (s) {
        const p = progressRef.current;
        void playerProgressSave(s.bvid, s.cid, p.duration, p.duration).catch(
          () => {},
        );
      }
      if (!useSettingsStore.getState().autoPlayNext) return;
      if (endingRef.current) return;
      const label = nextLabel();
      if (!label) return;
      endingRef.current = true;
      setCountdown({ left: 5, label });
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenEnded = fn;
    });
    return () => {
      cancelled = true;
      unlistenProgress?.();
      unlistenError?.();
      unlistenEnded?.();
    };
  }, []);

  // 自动连播：优先下一P，否则第一个相关推荐
  function nextTarget(): { cid?: number; bvid?: string; label: string } | null {
    const s = sessionRef.current;
    if (!s) return null;
    const idx = s.pages.findIndex((p) => p.cid === s.cid);
    if (idx >= 0 && idx + 1 < s.pages.length) {
      const nextPage = s.pages[idx + 1];
      return { cid: nextPage.cid, label: `P${nextPage.page} ${nextPage.part}` };
    }
    const related = detail?.related ?? [];
    const nextVideo = related.find((item) => item.bvid && item.bvid !== s.bvid);
    if (nextVideo) return { bvid: nextVideo.bvid, label: nextVideo.title };
    return null;
  }

  function nextLabel(): string | null {
    return nextTarget()?.label ?? null;
  }

  // 倒计时：每秒递减，归零后自动连播
  useEffect(() => {
    if (!countdown) return;
    if (countdown.left <= 0) {
      void playNext();
      return;
    }
    const timer = setTimeout(() => {
      setCountdown((prev) => (prev ? { ...prev, left: prev.left - 1 } : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  async function playNext() {
    setCountdown(null);
    const target = nextTarget();
    if (!target) return;
    const s = sessionRef.current;
    if (!s) return;
    if (target.cid != null) {
      try {
        const next = await playerOpen(s.bvid, target.cid, s.current_quality);
        setSession(next);
      } catch (err) {
        setError(toAppError(err).message);
      }
      return;
    }
    if (target.bvid) {
      navigate(`/watch/${target.bvid}`, {
        state: { from },
        replace: true,
      });
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.code === "Escape" && danmakuPanelOpen) {
        event.preventDefault();
        setDanmakuPanelOpen(false);
        return;
      }
      if (isHotkeyIgnored(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        void playerTogglePause();
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        void playerSeek(progressRef.current.time + 5);
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        void playerSeek(Math.max(progressRef.current.time - 5, 0));
      } else if (event.code === "ArrowUp") {
        event.preventDefault();
        void playerSetVolume(Math.min(progressRef.current.volume + 5, 130));
      } else if (event.code === "ArrowDown") {
        event.preventDefault();
        void playerSetVolume(Math.max(progressRef.current.volume - 5, 0));
      } else if (event.code === "Escape") {
        onBack();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [danmakuPanelOpen]);

  useEffect(() => {
    if (!bvid) return;
    let cancelled = false;
    appliedDefaults.current = null;
    playerOpen(bvid)
      .then(async (next) => {
        if (cancelled) return;
        setSession(next);
        // 断点续播
        const resumeEnabled = useSettingsStore.getState().resumePosition;
        if (resumeEnabled) {
          try {
            const record = await playerProgressGet(bvid, next.cid);
            if (
              !cancelled &&
              record &&
              record.position > 10 &&
              record.position < record.duration - 15
            ) {
              await playerSeek(record.position);
            }
          } catch {
            /* 续播失败忽略 */
          }
        }
        // 详情：UP 信息 / 相关推荐（自动连播用）
        try {
          const nextDetail = await videoView(bvid);
          if (!cancelled) setDetail(nextDetail);
        } catch {
          /* 详情失败不阻塞播放 */
        }
      })
      .catch((err) => {
        if (!cancelled) setError(toAppError(err).message);
      });
    return () => {
      cancelled = true;
      // 卸载时保存最后进度
      const s = sessionRef.current;
      const p = progressRef.current;
      if (s && p.duration > 0) {
        void playerProgressSave(s.bvid, s.cid, p.time, p.duration).catch(
          () => {},
        );
      }
      void playerStop();
    };
  }, [bvid]);

  useEffect(() => {
    if (!session || !loaded) return;
    const key = `${session.bvid}:${session.cid}`;
    if (appliedDefaults.current === key) return;
    appliedDefaults.current = key;
    setDanmaku(danmakuEnabled);
    setDensity(String(danmakuMaxRows));
    setFontSize(String(danmakuFontSize));
    setOpacity(String(danmakuOpacity));
    setArea(String(danmakuArea));
    setSpeed(defaultSpeed);
    void playerSetVolume(defaultVolume);
    void playerSetSpeed(defaultSpeed);
    void playerSetDanmaku(danmakuEnabled);
    void playerSetDanmakuPrefs({
      fontSize: danmakuFontSize,
      maxRows: danmakuMaxRows,
      opacity: danmakuOpacity,
      displayArea: danmakuArea,
      bold: danmakuBold,
    });
  }, [
    session,
    loaded,
    defaultVolume,
    defaultSpeed,
    danmakuEnabled,
    danmakuFontSize,
    danmakuMaxRows,
    danmakuOpacity,
    danmakuArea,
    danmakuBold,
  ]);

  const qualityOptions = useMemo(() => session?.qualities ?? [], [session]);

  async function changePage(cid: number) {
    if (!session) return;
    try {
      setError("");
      setSession(await playerOpen(session.bvid, cid, session.current_quality));
    } catch (err) {
      setError(toAppError(err).message);
    }
  }

  async function changeQuality(quality: number) {
    if (!session) return;
    try {
      const time = progress.time;
      setSession(await playerOpen(session.bvid, session.cid, quality));
      if (time > 1) await playerSeek(time);
    } catch (err) {
      setError(toAppError(err).message);
    }
  }

  async function changeSpeed(next: number) {
    const value = Math.min(
      SPEED_MAX,
      Math.max(SPEED_MIN, Number(next.toFixed(1))),
    );
    setSpeed(value);
    try {
      await playerSetSpeed(value);
    } catch (err) {
      setError(toAppError(err).message);
    }
  }

  async function toggleDanmaku() {
    const next = !danmaku;
    setDanmaku(next);
    try {
      await playerSetDanmaku(next);
    } catch (err) {
      setError(toAppError(err).message);
    }
  }

  async function sendTriple() {
    const aid = detail?.aid;
    if (!aid || tripled) return;
    try {
      await archiveTriple(aid);
      setTripled(true);
    } catch (err) {
      setError(toAppError(err).message);
    }
  }

  async function saveWatchLater() {
    const aid = detail?.aid;
    if (!aid || savedLater) return;
    try {
      await watchlaterSave(aid);
      setSavedLater(true);
      setError("已加入稍后再看");
    } catch (err) {
      setError(toAppError(err).message);
    }
  }

  function openSpace() {
    const mid = detail?.owner_mid;
    if (mid) navigate(`/space/${mid}`, { state: { from: `/watch/${bvid}` } });
  }

  return (
    <>
      {detail?.cover ? (
        <div
          className="player-backdrop"
          style={{ backgroundImage: `url(${mediaSrc(detail.cover)})` }}
        />
      ) : null}
      <div className="player-page">
        <header>
          <Button variant="ghost" className="text-inherit" onClick={onBack}>
            返回
          </Button>
          <div className="player-title">
            {session?.title ?? detail?.title ?? "正在打开…"}
          </div>
          <button
            className="ghost-btn"
            disabled={!detail?.aid || tripled}
            onClick={() => void sendTriple()}
          >
            {tripled ? "已三连" : "三连"}
          </button>
          <button
            className="ghost-btn"
            disabled={!detail?.aid || savedLater}
            onClick={() => void saveWatchLater()}
          >
            {savedLater ? "已稍后再看" : "稍后再看"}
          </button>
          {detail?.owner_mid ? (
            <button
              className="ghost-btn"
              onClick={openSpace}
              title="查看 UP 主空间"
            >
              {detail.owner}
            </button>
          ) : null}
          {autoPlayNext ? (
            <span className="player-hint">自动连播开</span>
          ) : null}
          {countdown ? (
            <span className="player-countdown" role="timer">
              {countdown.left}s 后播放：{countdown.label}
              <button type="button" onClick={() => setCountdown(null)}>
                取消
              </button>
            </span>
          ) : null}
        </header>
        <div
          className="player-stage"
          ref={stageRef}
          onClick={() => void playerTogglePause()}
        />
        {error ? (
          <p
            role="alert"
            className="error-line"
            style={{
              padding: "0 16px",
              margin: 0,
              background: "#101216",
              color: "#ff8f8f",
            }}
          >
            {error}
          </p>
        ) : null}
        <footer className="player-controls">
          <div className="player-progress-row">
            <button
              className="ghost-btn"
              onClick={() => void playerTogglePause()}
            >
              {progress.paused ? "播放" : "暂停"}
            </button>
            <span className="time-label">
              {formatDuration(progress.time)} /{" "}
              {formatDuration(progress.duration)}
            </span>
            <input
              className="progress"
              type="range"
              min={0}
              max={Math.max(progress.duration, 1)}
              step={0.1}
              value={progress.time}
              aria-label="进度"
              onChange={(e) => void playerSeek(Number(e.target.value))}
            />
          </div>
          <div className="player-actions-row">
            <label className="player-compact-slider" title="音量">
              <Volume2 className="size-4" aria-hidden="true" />
              <input
                type="range"
                min={0}
                max={130}
                value={progress.volume}
                aria-label="音量"
                onChange={(e) => void playerSetVolume(Number(e.target.value))}
              />
              <span>{progress.volume}</span>
            </label>
            <label className="player-compact-slider" title="播放倍速">
              <span className="player-control-label">倍速</span>
              <input
                type="range"
                min={SPEED_MIN}
                max={SPEED_MAX}
                step={0.1}
                value={speed}
                aria-label="播放倍速"
                onChange={(e) => void changeSpeed(Number(e.target.value))}
              />
              <span>{speed.toFixed(1)}x</span>
            </label>
            <select
              value={session?.cid ?? ""}
              aria-label="分P"
              onChange={(e) => void changePage(Number(e.target.value))}
            >
              {(session?.pages ?? []).map((page) => (
                <option key={page.cid} value={page.cid}>
                  P{page.page} {page.part}
                </option>
              ))}
            </select>
            <select
              value={session?.current_quality ?? ""}
              aria-label="清晰度"
              onChange={(e) => void changeQuality(Number(e.target.value))}
            >
              {qualityOptions.map((option) => (
                <option key={option.quality} value={option.quality}>
                  {option.desc}
                </option>
              ))}
            </select>
            <button className="ghost-btn" onClick={() => void toggleDanmaku()}>
              弹幕 {danmaku ? "开" : "关"}
            </button>
            <div className="player-settings-menu">
              <button
                type="button"
                className="ghost-btn player-settings-btn"
                aria-expanded={danmakuPanelOpen}
                aria-controls="player-danmaku-settings"
                onClick={() => setDanmakuPanelOpen((open) => !open)}
              >
                  <Settings2 className="size-4" aria-hidden="true" />
                  弹幕设置
              </button>
              {danmakuPanelOpen ? (
              <div
                id="player-danmaku-settings"
                className="player-danmaku-panel"
                role="dialog"
                aria-label="弹幕设置"
                onKeyDown={(event) => {
                  if (event.key === "Escape") setDanmakuPanelOpen(false);
                }}
              >
                <div className="player-panel-heading">
                  <strong>弹幕设置</strong>
                  <span>对下一个视频生效</span>
                </div>
                <label>
                  <span>密度</span>
                  <select
                    value={density}
                    aria-label="弹幕密度"
                    onChange={(e) => {
                      setDensity(e.target.value);
                      void playerSetDanmakuPrefs({
                        maxRows: Number(e.target.value),
                      });
                    }}
                  >
                    <option value="8">稀</option>
                    <option value="10">中</option>
                    <option value="16">密</option>
                  </select>
                </label>
                <label>
                  <span>字号</span>
                  <select
                    value={fontSize}
                    aria-label="弹幕字号"
                    onChange={(e) => {
                      setFontSize(e.target.value);
                      void playerSetDanmakuPrefs({
                        fontSize: Number(e.target.value),
                      });
                    }}
                  >
                    <option value="36">小</option>
                    <option value="42">中</option>
                    <option value="56">大</option>
                  </select>
                </label>
                <label>
                  <span>透明度</span>
                  <select
                    value={opacity}
                    aria-label="弹幕透明度"
                    onChange={(e) => {
                      setOpacity(e.target.value);
                      void playerSetDanmakuPrefs({
                        opacity: Number(e.target.value),
                      });
                    }}
                  >
                    <option value="1">不透明</option>
                    <option value="0.75">75%</option>
                    <option value="0.5">半透明</option>
                  </select>
                </label>
                <label>
                  <span>显示区域</span>
                  <select
                    value={area}
                    aria-label="弹幕显示区域"
                    onChange={(e) => {
                      setArea(e.target.value);
                      void playerSetDanmakuPrefs({
                        displayArea: Number(e.target.value),
                      });
                    }}
                  >
                    <option value="1">全屏</option>
                    <option value="0.5">半屏</option>
                    <option value="0.25">顶部 1/4</option>
                  </select>
                </label>
              </div>
              ) : null}
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
