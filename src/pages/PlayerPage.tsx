import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  Captions,
  Clock3,
  Pause,
  Play,
  Settings2,
  Sparkles,
  UserRound,
  Volume2,
} from "lucide-react";
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
  replyList,
  toAppError,
  videoView,
  watchlaterSave,
} from "@/api";
import { formatDuration } from "@/components/VideoCard";
import { WindowTitleBar } from "@/components/WindowTitleBar";
import { mediaSrc } from "@/media";
import { isHotkeyIgnored } from "@/lib/hotkeys";
import { watchBack } from "@/lib/watch";
import type {
  CommentItem,
  PlaySession,
  PlayerProgress,
  VideoDetail,
} from "@/types";
import { useSettingsStore } from "@/stores/settings";

const SPEED_MIN = 0.5;
const SPEED_MAX = 3.0;
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

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
  const [sideTab, setSideTab] = useState<"intro" | "comments">("intro");
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
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
    setSideTab("intro");
    setComments([]);
    endingRef.current = false;
  }, [bvid, session?.cid]);

  useEffect(() => {
    if (sideTab !== "comments" || !detail?.aid) return;
    let cancelled = false;
    setCommentsLoading(true);
    void replyList(detail.aid)
      .then((page) => {
        if (!cancelled) setComments(page.items);
      })
      .catch((err) => {
        if (!cancelled) setError(toAppError(err).message);
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detail?.aid, sideTab]);

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
    <div className="player-route-shell">
      <WindowTitleBar />
      {detail?.cover ? (
        <div
          className="player-backdrop"
          style={{ backgroundImage: `url(${mediaSrc(detail.cover)})` }}
        />
      ) : null}
      <div className="player-page">
        <section className="player-main">
        <header className="player-topbar">
          <button
            type="button"
            className="player-icon-button"
            aria-label="返回"
            title="返回"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <div className="player-heading">
            <div
              className="player-title"
              title={session?.title ?? detail?.title ?? "正在打开…"}
            >
              {session?.title ?? detail?.title ?? "正在打开…"}
            </div>
            <div className="player-subtitle">
              {detail?.owner_mid ? (
                <button type="button" onClick={openSpace} title="查看 UP 主空间">
                  <UserRound aria-hidden="true" />
                  {detail.owner}
                </button>
              ) : (
                <span>正在准备视频信息</span>
              )}
              {(session?.pages.length ?? 0) > 1 ? (
                <span>{session?.pages.length} 个分P</span>
              ) : null}
              {autoPlayNext ? <span>自动连播已开启</span> : null}
            </div>
          </div>
          {countdown ? (
            <span className="player-countdown" role="timer">
              {countdown.left}s 后播放：{countdown.label}
              <button type="button" onClick={() => setCountdown(null)}>
                取消
              </button>
            </span>
          ) : null}
          <div className="player-top-actions">
            <button
              type="button"
              className={`player-action-button${tripled ? " is-active" : ""}`}
              disabled={!detail?.aid || tripled}
              onClick={() => void sendTriple()}
            >
              <Sparkles aria-hidden="true" />
              {tripled ? "已三连" : "三连"}
            </button>
            <button
              type="button"
              className={`player-action-button${savedLater ? " is-active" : ""}`}
              disabled={!detail?.aid || savedLater}
              onClick={() => void saveWatchLater()}
            >
              <Clock3 aria-hidden="true" />
              {savedLater ? "已加入" : "稍后再看"}
            </button>
          </div>
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
          <div className="player-timeline">
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
            <span className="time-label">
              {formatDuration(progress.time)} / {formatDuration(progress.duration)}
            </span>
          </div>
          <div className="player-control-deck">
            <div className="player-control-group is-primary">
              <button
                type="button"
                className="player-play-button"
                aria-label={progress.paused ? "播放" : "暂停"}
                title={progress.paused ? "播放" : "暂停"}
                onClick={() => void playerTogglePause()}
              >
                {progress.paused ? (
                  <Play aria-hidden="true" />
                ) : (
                  <Pause aria-hidden="true" />
                )}
              </button>
              <label className="player-volume" title="音量">
                <Volume2 aria-hidden="true" />
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
            </div>
            <div className="player-control-group is-selects">
              <label className="player-select-control">
                <span>选集</span>
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
              </label>
              <label className="player-select-control">
                <span>画质</span>
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
              </label>
              <label className="player-select-control is-speed">
                <span>倍速</span>
                <select
                  value={String(speed)}
                  aria-label="播放倍速"
                  onChange={(e) => void changeSpeed(Number(e.target.value))}
                >
                  {SPEED_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}x
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="player-control-group is-secondary">
              <button
                type="button"
                className={`player-toggle-button${danmaku ? " is-active" : ""}`}
                aria-pressed={danmaku}
                onClick={() => void toggleDanmaku()}
              >
                <Captions aria-hidden="true" />
                弹幕 {danmaku ? "开" : "关"}
              </button>
            <div className="player-settings-menu">
              <button
                type="button"
                className="player-toggle-button player-settings-btn"
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
          </div>
        </footer>
        </section>
        <aside className="player-side-panel" aria-label="视频详情">
          <div className="player-side-tabs" role="tablist" aria-label="视频信息">
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === "intro"}
              className={sideTab === "intro" ? "is-active" : ""}
              onClick={() => setSideTab("intro")}
            >
              简介
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === "comments"}
              className={sideTab === "comments" ? "is-active" : ""}
              onClick={() => setSideTab("comments")}
            >
              评论 {formatMetric(detail?.reply ?? 0)}
            </button>
          </div>

          {sideTab === "intro" ? (
            <div className="player-side-scroll">
              <section className="player-owner-card">
                {detail?.owner_face ? (
                  <img src={mediaSrc(detail.owner_face)} alt="" />
                ) : (
                  <div className="player-owner-placeholder">
                    <UserRound aria-hidden="true" />
                  </div>
                )}
                <div>
                  <button type="button" onClick={openSpace}>
                    {detail?.owner ?? "UP 主"}
                  </button>
                  <span>{detail?.season_title || "视频创作者"}</span>
                </div>
              </section>

              <section className="player-intro-block">
                <h2>{detail?.title ?? "正在加载视频信息…"}</h2>
                <div className="player-stat-grid">
                  <span><strong>{formatMetric(detail?.like ?? 0)}</strong>点赞</span>
                  <span><strong>{formatMetric(detail?.coin ?? 0)}</strong>投币</span>
                  <span><strong>{formatMetric(detail?.favorite ?? 0)}</strong>收藏</span>
                  <span><strong>{formatMetric(detail?.share ?? 0)}</strong>分享</span>
                </div>
                {detail?.desc ? <p>{detail.desc}</p> : null}
              </section>

              {(session?.pages.length ?? 0) > 1 ? (
                <section className="player-side-section">
                  <div className="player-side-section-title">
                    <strong>视频选集</strong>
                    <span>{session?.pages.length} P</span>
                  </div>
                  <div className="player-episode-list">
                    {session?.pages.map((page) => (
                      <button
                        type="button"
                        key={page.cid}
                        className={page.cid === session.cid ? "is-active" : ""}
                        onClick={() => void changePage(page.cid)}
                      >
                        <span>P{page.page}</span>
                        {page.part}
                        <em>{formatDuration(page.duration)}</em>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {(detail?.related?.length ?? 0) > 0 ? (
                <section className="player-side-section">
                  <div className="player-side-section-title">
                    <strong>相关推荐</strong>
                  </div>
                  <div className="player-related-list">
                    {detail?.related?.slice(0, 8).map((item) => (
                      <button
                        type="button"
                        key={item.bvid}
                        onClick={() =>
                          navigate(`/watch/${item.bvid}`, {
                            state: { from: from ?? "/" },
                          })
                        }
                      >
                        <img src={mediaSrc(item.cover)} alt="" />
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.owner} · {formatMetric(item.views)}播放</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="player-side-scroll player-comment-list">
              {commentsLoading ? <p className="player-side-status">评论加载中…</p> : null}
              {!commentsLoading && comments.length === 0 ? (
                <p className="player-side-status">暂时没有可显示的评论</p>
              ) : null}
              {comments.map((comment) => (
                <article key={comment.rpid}>
                  <img src={mediaSrc(comment.face)} alt="" />
                  <div>
                    <strong>{comment.name}</strong>
                    <p>{comment.message}</p>
                    <span>{formatMetric(comment.like)} 赞</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function formatMetric(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`;
  return String(value);
}
