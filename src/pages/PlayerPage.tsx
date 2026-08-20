import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useNavigate, useParams } from "react-router-dom";
import {
  playerOpen,
  playerSeek,
  playerSetBounds,
  playerSetDanmaku,
  playerSetDanmakuPrefs,
  playerSetVolume,
  playerStop,
  playerTogglePause,
  toAppError,
} from "@/api";
import { formatDuration } from "@/components/VideoCard";
import { Button } from "@/components/ui/button";
import type { PlaySession, PlayerProgress } from "@/types";
import { useSettingsStore } from "@/stores/settings";

export function PlayerPage() {
  const { bvid = "" } = useParams();
  const navigate = useNavigate();
  const defaultVolume = useSettingsStore((s) => s.defaultVolume);
  const danmakuEnabled = useSettingsStore((s) => s.danmakuEnabled);
  const [session, setSession] = useState<PlaySession | null>(null);
  const [progress, setProgress] = useState<PlayerProgress>({
    time: 0,
    duration: 0,
    paused: false,
    volume: defaultVolume,
  });
  const [danmaku, setDanmaku] = useState(danmakuEnabled);
  const [error, setError] = useState("");
  const [density, setDensity] = useState(String(useSettingsStore.getState().danmakuMaxRows));
  const stageRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  const onBack = () => navigate(-1);

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
    let unlistenProgress: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    listen<PlayerProgress>("player-progress", (event) => {
      setProgress(event.payload);
    }).then((fn) => {
      unlistenProgress = fn;
    });
    listen<string>("player-error", (event) => {
      setError(event.payload);
    }).then((fn) => {
      unlistenError = fn;
    });
    return () => {
      unlistenProgress?.();
      unlistenError?.();
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.code === "Space") {
        event.preventDefault();
        void playerTogglePause();
      } else if (event.code === "ArrowRight") {
        void playerSeek(progressRef.current.time + 5);
      } else if (event.code === "ArrowLeft") {
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
    playerOpen(bvid)
      .then(async (next) => {
        if (cancelled) return;
        setSession(next);
        await playerSetVolume(defaultVolume);
        await playerSetDanmaku(danmakuEnabled);
        setDanmaku(danmakuEnabled);
      })
      .catch((err) => {
        if (!cancelled) setError(toAppError(err).message);
      });
    return () => {
      cancelled = true;
      void playerStop();
    };
  }, [bvid, defaultVolume, danmakuEnabled]);

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
      {error ? <p className="error-line" style={{ padding: "0 16px", margin: 0, background: "#101216", color: "#ff8f8f" }}>{error}</p> : null}
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
          onChange={(e) => void playerSeek(Number(e.target.value))}
        />
        <input
          type="range"
          min={0}
          max={130}
          value={progress.volume}
          onChange={(e) => void playerSetVolume(Number(e.target.value))}
          title="音量"
        />
        <select value={session?.cid ?? ""} onChange={(e) => void changePage(Number(e.target.value))}>
          {(session?.pages ?? []).map((page) => (
            <option key={page.cid} value={page.cid}>
              P{page.page} {page.part}
            </option>
          ))}
        </select>
        <select
          value={session?.current_quality ?? ""}
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
          onChange={(e) => {
            setDensity(e.target.value);
            void playerSetDanmakuPrefs(undefined, Number(e.target.value));
          }}
        >
          <option value="8">弹幕稀</option>
          <option value="12">弹幕中</option>
          <option value="18">弹幕密</option>
        </select>
        <select
          defaultValue="48"
          onChange={(e) => void playerSetDanmakuPrefs(Number(e.target.value), undefined)}
        >
          <option value="36">字号小</option>
          <option value="48">字号中</option>
          <option value="64">字号大</option>
        </select>
      </footer>
    </div>
  );
}
