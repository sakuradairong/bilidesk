import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  playerOpen,
  playerSeek,
  playerSetBounds,
  playerSetDanmaku,
  playerSetDanmakuPrefs,
  playerSetSpeed,
  playerSetVolume,
  playerStop,
  playerTogglePause,
  toAppError,
} from "@/api";
import { formatDuration } from "@/components/VideoCard";
import { Button } from "@/components/ui/button";
import { isHotkeyIgnored } from "@/lib/hotkeys";
import { watchBack } from "@/lib/watch";
import type { PlaySession, PlayerProgress } from "@/types";
import { useSettingsStore } from "@/stores/settings";

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
  const [session, setSession] = useState<PlaySession | null>(null);
  const [progress, setProgress] = useState<PlayerProgress>({
    time: 0,
    duration: 0,
    paused: false,
    volume: defaultVolume,
  });
  const [danmaku, setDanmaku] = useState(danmakuEnabled);
  const [density, setDensity] = useState(String(danmakuMaxRows));
  const [fontSize, setFontSize] = useState(String(danmakuFontSize));
  const [error, setError] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(progress);
  const appliedDefaults = useRef<string | null>(null);
  progressRef.current = progress;

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

  useEffect(() => {
    let cancelled = false;
    let unlistenProgress: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    listen<PlayerProgress>("player-progress", (event) => {
      setProgress(event.payload);
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
    return () => {
      cancelled = true;
      unlistenProgress?.();
      unlistenError?.();
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
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
  }, []);

  useEffect(() => {
    if (!bvid) return;
    let cancelled = false;
    appliedDefaults.current = null;
    playerOpen(bvid)
      .then((next) => {
        if (!cancelled) setSession(next);
      })
      .catch((err) => {
        if (!cancelled) setError(toAppError(err).message);
      });
    return () => {
      cancelled = true;
      void playerStop();
    };
  }, [bvid]);

  useEffect(() => {
    if (!session || !loaded) return;
    const key = session.bvid;
    if (appliedDefaults.current === key) return;
    appliedDefaults.current = key;
    setDanmaku(danmakuEnabled);
    setDensity(String(danmakuMaxRows));
    setFontSize(String(danmakuFontSize));
    void playerSetVolume(defaultVolume);
    void playerSetSpeed(defaultSpeed);
    void playerSetDanmaku(danmakuEnabled);
    void playerSetDanmakuPrefs(danmakuFontSize, danmakuMaxRows);
  }, [
    session,
    loaded,
    defaultVolume,
    defaultSpeed,
    danmakuEnabled,
    danmakuFontSize,
    danmakuMaxRows,
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

  async function toggleDanmaku() {
    const next = !danmaku;
    setDanmaku(next);
    try {
      await playerSetDanmaku(next);
    } catch (err) {
      setError(toAppError(err).message);
    }
  }

  return (
    <div className="player-page">
      <header>
        <Button variant="ghost" className="text-inherit" onClick={onBack}>
          返回
        </Button>
        <div className="player-title">{session?.title ?? "正在打开…"}</div>
      </header>
      <div className="player-stage" ref={stageRef} onClick={() => void playerTogglePause()} />
      {error ? (
        <p
          role="alert"
          className="error-line"
          style={{ padding: "0 16px", margin: 0, background: "#101216", color: "#ff8f8f" }}
        >
          {error}
        </p>
      ) : null}
      <footer>
        <button className="ghost-btn" onClick={() => void playerTogglePause()}>
          {progress.paused ? "播放" : "暂停"}
        </button>
        <span className="time-label">
          {formatDuration(progress.time)} / {formatDuration(progress.duration)}
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
        <input
          type="range"
          min={0}
          max={130}
          value={progress.volume}
          aria-label="音量"
          onChange={(e) => void playerSetVolume(Number(e.target.value))}
        />
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
        <select
          value={density}
          aria-label="弹幕密度"
          onChange={(e) => {
            setDensity(e.target.value);
            void playerSetDanmakuPrefs(undefined, Number(e.target.value));
          }}
        >
          <option value="8">弹幕稀</option>
          <option value="10">弹幕中</option>
          <option value="16">弹幕密</option>
        </select>
        <select
          value={fontSize}
          aria-label="弹幕字号"
          onChange={(e) => {
            setFontSize(e.target.value);
            void playerSetDanmakuPrefs(Number(e.target.value), undefined);
          }}
        >
          <option value="36">字号小</option>
          <option value="42">字号中</option>
          <option value="56">字号大</option>
        </select>
      </footer>
    </div>
  );
}
