import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Clock3,
  MessageCircle,
  Pause,
  Play,
  Send,
  Share2,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from "lucide-react";
import {
  archiveCoin,
  archiveDislike,
  archiveFav,
  archiveLike,
  archiveRelation,
  archiveTriple,
  danmakuSend,
  feedSelected,
  playerOpenBackdrop,
  playerSeek,
  playerSetBounds,
  playerSetDanmaku,
  playerSetSpeed,
  playerSetVolume,
  playerStopBackdrop,
  playerTogglePause,
  replyAdd,
  replyList,
  videoView,
  watchlaterSave,
  toAppError,
} from "@/api";
import { formatDuration } from "@/components/VideoCard";
import { mediaSrc } from "@/media";
import type {
  CommentItem,
  PlaySession,
  PlayerProgress,
  VideoCard,
  VideoDetail,
} from "@/types";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { isHotkeyIgnored } from "@/lib/hotkeys";
import {
  advanceWheelNavigation,
  createWheelNavigationState,
  shouldIgnoreWheelNavigation,
} from "@/lib/wheel-navigation";
import { useLocation, useNavigate } from "react-router-dom";
import { routeSource } from "@/lib/watch";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

export function FeaturedPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const loginOpen = useAuthStore((s) => s.loginOpen);
  const onNeedLogin = () => useAuthStore.getState().setLoginOpen(true);
  const defaults = useSettingsStore.getState();
  const [items, setItems] = useState<VideoCard[]>([]);
  const [index, setIndex] = useState(0);
  const [session, setSession] = useState<PlaySession | null>(null);
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [progress, setProgress] = useState<PlayerProgress>({
    time: 0,
    duration: 0,
    paused: false,
    volume: defaults.defaultVolume,
  });
  const [error, setError] = useState("");
  const [danmaku, setDanmaku] = useState(defaults.danmakuEnabled);
  const [danmakuText, setDanmakuText] = useState("");
  const [speed, setSpeed] = useState(defaults.defaultSpeed);
  const [liked, setLiked] = useState(false);
  const [coined, setCoined] = useState(false);
  const [faved, setFaved] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [savedLater, setSavedLater] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentCount, setCommentCount] = useState(0);
  const [commentText, setCommentText] = useState("");
  const [playbackNotice, setPlaybackNotice] = useState("");
  const pageRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<VideoCard[]>([]);
  const indexRef = useRef(0);
  const freshIdxRef = useRef(1);
  const openingRef = useRef(false);
  const pendingIndexRef = useRef<number | null>(null);
  const loadMorePromiseRef = useRef<Promise<boolean> | null>(null);
  const aliveRef = useRef(true);
  const progressRef = useRef(progress);
  const speedRef = useRef(speed);
  const danmakuRef = useRef(danmaku);
  const commentsOpenRef = useRef(false);
  const sessionRef = useRef<PlaySession | null>(null);
  const pauseInFlightRef = useRef(false);
  const pausePromiseRef = useRef<Promise<void> | null>(null);
  const pauseGuardUntilRef = useRef(0);
  const playbackNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelStateRef = useRef(createWheelNavigationState());
  const playAtRef = useRef<
    (nextIndex: number, source?: VideoCard[]) => Promise<void>
  >(async () => {});
  const playRelativeRef = useRef<(offset: -1 | 1) => Promise<void>>(
    async () => {},
  );
  const togglePlaybackRef = useRef<() => Promise<void>>(async () => {});

  progressRef.current = progress;
  speedRef.current = speed;
  danmakuRef.current = danmaku;
  commentsOpenRef.current = commentsOpen;
  itemsRef.current = items;
  indexRef.current = index;
  sessionRef.current = session;

  useEffect(() => {
    document.documentElement.classList.add("featured-mode");
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (playbackNoticeTimerRef.current) {
        clearTimeout(playbackNoticeTimerRef.current);
      }
      document.documentElement.classList.remove("featured-mode");
      void playerStopBackdrop();
    };
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let frame = 0;
    const publish = () => {
      if (loginOpen) {
        void playerSetBounds({ x: -2400, y: 0, width: 16, height: 16 });
        return;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 16 || rect.height < 16) return;
      void playerSetBounds({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(publish);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [loginOpen, commentsOpen]);

  useEffect(() => {
    const aid = detail?.aid;
    if (loginOpen || !aid) return;
    let cancelled = false;
    void archiveRelation(aid)
      .then((relation) => {
        if (cancelled || !aliveRef.current) return;
        setLiked(relation.liked);
        setDisliked(relation.disliked);
        setCoined(relation.coin_count > 0);
        setFaved(relation.faved);
      })
      .catch((err) => {
        const error = toAppError(err);
        if (!cancelled && error.code !== "unauthenticated") {
          setError(error.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detail?.aid, loginOpen]);

  useEffect(() => {
    let cancelled = false;
    let unlistenProgress: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let unlistenEnded: (() => void) | undefined;
    listen<PlayerProgress>("player-progress", (event) => {
      setProgress(event.payload);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenProgress = fn;
    });
    listen<string>("player-error", (event) => {
      setError(toAppError(event.payload).message);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenError = fn;
    });
    listen("player-ended", () => {
      if (openingRef.current) {
        pendingIndexRef.current = indexRef.current + 1;
        return;
      }
      void playAtRef.current(indexRef.current + 1);
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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (useAuthStore.getState().loginOpen) return;
      if (isHotkeyIgnored(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) void togglePlaybackRef.current();
      } else if (event.code === "ArrowUp") {
        event.preventDefault();
        if (!event.repeat) void playRelativeRef.current(-1);
      } else if (event.code === "ArrowDown" || event.code === "KeyF") {
        event.preventDefault();
        if (!event.repeat) void playRelativeRef.current(1);
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        void playerSeek(Math.max(progressRef.current.time - 5, 0));
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        void playerSeek(progressRef.current.time + 5);
      } else if (event.code === "Equal" || event.code === "NumpadAdd") {
        event.preventDefault();
        void playerSetVolume(Math.min(progressRef.current.volume + 5, 130));
      } else if (event.code === "Minus" || event.code === "NumpadSubtract") {
        event.preventDefault();
        void playerSetVolume(Math.max(progressRef.current.volume - 5, 0));
      } else if (event.code === "Escape") {
        if (commentsOpenRef.current) setCommentsOpen(false);
        else navigate("/");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    wheelStateRef.current = createWheelNavigationState();
    function onWheel(event: WheelEvent) {
      if (useAuthStore.getState().loginOpen) return;
      if (shouldIgnoreWheelNavigation(event.target)) return;
      const result = advanceWheelNavigation(wheelStateRef.current, {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        now: performance.now(),
        pageHeight: pageRef.current?.clientHeight || window.innerHeight,
        ctrlKey: event.ctrlKey,
      });
      wheelStateRef.current = result.state;
      if (result.direction == null) return;
      if (result.direction < 0 && indexRef.current <= 0) {
        wheelStateRef.current = createWheelNavigationState();
        return;
      }
      event.preventDefault();
      void playRelativeRef.current(result.direction);
    }
    page.addEventListener("wheel", onWheel, { passive: false });
    return () => page.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError("");
        const feed = await feedSelected(1, 0);
        if (cancelled || !aliveRef.current) return;
        freshIdxRef.current = 1;
        setItems(feed);
        itemsRef.current = feed;
        if (feed.length === 0) {
          setError("精选暂时没有可播稿件");
          return;
        }
        await playAtRef.current(0, feed);
      } catch (err) {
        if (!cancelled) setError(toAppError(err).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function playAt(nextIndex: number, source = itemsRef.current) {
    if (nextIndex < 0) return;
    if (openingRef.current) {
      pendingIndexRef.current = nextIndex;
      return;
    }
    openingRef.current = true;
    try {
      if (pausePromiseRef.current) await pausePromiseRef.current;
      await ensureMore(nextIndex, source);
      if (!aliveRef.current) return;
      const card = itemsRef.current[nextIndex];
      if (!card) return;
      indexRef.current = nextIndex;
      setIndex(nextIndex);
      setDetail(null);
      setLiked(false);
      setCoined(false);
      setFaved(false);
      setDisliked(false);
      setSavedLater(false);
      setCommentsOpen(false);
      setPlaybackNotice("");
      setError("");
      const nextSession = await playerOpenBackdrop(
        card.bvid,
        card.cid ?? undefined,
      );
      if (!aliveRef.current) return;
      setSession(nextSession);
      await playerSetSpeed(speedRef.current);
      await playerSetDanmaku(danmakuRef.current);
      const nextDetail = await videoView(card.bvid);
      if (!aliveRef.current) return;
      setDetail(nextDetail);
      setCommentCount(nextDetail.reply ?? 0);
    } catch (err) {
      if (aliveRef.current) setError(toAppError(err).message);
    } finally {
      openingRef.current = false;
      const pending = pendingIndexRef.current;
      pendingIndexRef.current = null;
      if (aliveRef.current && pending != null && pending !== indexRef.current) {
        void playAt(pending);
      }
    }
  }
  playAtRef.current = playAt;

  async function playRelative(offset: -1 | 1) {
    await playAtRef.current(indexRef.current + offset);
  }
  playRelativeRef.current = playRelative;

  function showPlaybackNotice(message: string) {
    if (playbackNoticeTimerRef.current) {
      clearTimeout(playbackNoticeTimerRef.current);
    }
    setPlaybackNotice(message);
    playbackNoticeTimerRef.current = setTimeout(() => {
      playbackNoticeTimerRef.current = null;
      if (aliveRef.current) setPlaybackNotice("");
    }, 850);
  }

  async function toggleFeaturedPlayback() {
    const now = Date.now();
    if (
      !sessionRef.current ||
      useAuthStore.getState().loginOpen ||
      openingRef.current ||
      pauseInFlightRef.current ||
      now < pauseGuardUntilRef.current
    ) {
      return;
    }
    pauseInFlightRef.current = true;
    pauseGuardUntilRef.current = now + 240;
    const wasPaused = progressRef.current.paused;
    const request = playerTogglePause()
      .then(() => {
        if (aliveRef.current) {
          showPlaybackNotice(wasPaused ? "继续播放" : "已暂停");
        }
      })
      .catch((err) => {
        if (aliveRef.current) setError(toAppError(err).message);
      });
    pausePromiseRef.current = request;
    try {
      await request;
    } finally {
      if (pausePromiseRef.current === request) pausePromiseRef.current = null;
      pauseInFlightRef.current = false;
    }
  }
  togglePlaybackRef.current = toggleFeaturedPlayback;

  function handleStageClick(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.detail > 1) return;
    void toggleFeaturedPlayback();
  }

  async function ensureMore(nextIndex: number, source: VideoCard[]) {
    if (itemsRef.current.length === 0 && source.length > 0) {
      itemsRef.current = source;
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const len = itemsRef.current.length;
      if (len > 0 && nextIndex < len - 3) return;
      if (loadMorePromiseRef.current) {
        await loadMorePromiseRef.current;
        continue;
      }
      const promise = (async () => {
        const nextFresh = freshIdxRef.current + 1;
        const more = await feedSelected(nextFresh, 1);
        if (!aliveRef.current) return false;
        freshIdxRef.current = nextFresh;
        const seen = new Set(itemsRef.current.map((item) => item.bvid));
        const merged = [
          ...itemsRef.current,
          ...more.filter((item) => item.bvid && !seen.has(item.bvid)),
        ];
        const grew = merged.length > itemsRef.current.length;
        itemsRef.current = merged;
        setItems(merged);
        return grew;
      })();
      loadMorePromiseRef.current = promise;
      let grew = false;
      try {
        grew = await promise;
      } catch (err) {
        if (aliveRef.current) setError(toAppError(err).message);
        return;
      } finally {
        if (loadMorePromiseRef.current === promise) {
          loadMorePromiseRef.current = null;
        }
      }
      if (!grew) return;
    }
  }

  function handleInteractError(err: unknown) {
    const error = toAppError(err);
    setError(error.message);
    if (error.code === "unauthenticated") onNeedLogin();
  }

  async function toggleLike() {
    const aid = detail?.aid;
    if (!aid) return;
    const unlike = liked;
    try {
      await archiveLike(aid, unlike);
      setLiked(!unlike);
      setDetail((prev) =>
        prev
          ? { ...prev, like: Math.max(0, (prev.like ?? 0) + (unlike ? -1 : 1)) }
          : prev,
      );
    } catch (err) {
      handleInteractError(err);
    }
  }

  async function toggleDislike() {
    const aid = detail?.aid;
    if (!aid) return;
    try {
      await archiveDislike(aid, disliked);
      setDisliked(!disliked);
    } catch (err) {
      handleInteractError(err);
    }
  }

  async function addCoin() {
    const aid = detail?.aid;
    if (!aid || coined) return;
    try {
      await archiveCoin(aid);
      setCoined(true);
      setDetail((prev) =>
        prev ? { ...prev, coin: (prev.coin ?? 0) + 1 } : prev,
      );
    } catch (err) {
      handleInteractError(err);
    }
  }

  async function addFav() {
    const aid = detail?.aid;
    if (!aid || faved) return;
    try {
      await archiveFav(aid);
      setFaved(true);
      setDetail((prev) =>
        prev ? { ...prev, favorite: (prev.favorite ?? 0) + 1 } : prev,
      );
    } catch (err) {
      handleInteractError(err);
    }
  }

  async function sendTriple() {
    const aid = detail?.aid;
    if (!aid || (liked && coined && faved)) return;
    try {
      const result = await archiveTriple(aid);
      setLiked(result.like);
      setCoined(result.coin);
      setFaved(result.fav);
      if (result.like) {
        setDetail((prev) =>
          prev ? { ...prev, like: (prev.like ?? 0) + (liked ? 0 : 1) } : prev,
        );
      }
      if (result.coin) {
        setDetail((prev) =>
          prev ? { ...prev, coin: (prev.coin ?? 0) + (coined ? 0 : 1) } : prev,
        );
      }
      if (result.fav) {
        setDetail((prev) =>
          prev
            ? { ...prev, favorite: (prev.favorite ?? 0) + (faved ? 0 : 1) }
            : prev,
        );
      }
    } catch (err) {
      handleInteractError(err);
    }
  }

  async function saveWatchLater() {
    const aid = detail?.aid;
    if (!aid || savedLater) return;
    try {
      await watchlaterSave(aid);
      setSavedLater(true);
    } catch (err) {
      handleInteractError(err);
    }
  }

  async function share() {
    const bvid = session?.bvid ?? items[index]?.bvid;
    if (!bvid) return;
    try {
      await navigator.clipboard.writeText(
        `https://www.bilibili.com/video/${bvid}`,
      );
      toast.success("链接已复制");
    } catch (err) {
      handleInteractError(err);
    }
  }

  async function sendDanmaku() {
    const text = danmakuText.trim();
    const card = items[index];
    const aid = detail?.aid;
    const cid = session?.cid ?? card?.cid;
    if (!text || !aid || !cid || !card) return;
    try {
      await danmakuSend(
        aid,
        cid,
        card.bvid,
        text,
        Math.floor(progressRef.current.time * 1000),
      );
      setDanmakuText("");
    } catch (err) {
      handleInteractError(err);
    }
  }

  async function openComments() {
    const aid = detail?.aid;
    setCommentsOpen(true);
    if (!aid) return;
    try {
      const page = await replyList(aid);
      setComments(page.items);
      setCommentCount(page.all_count);
    } catch (err) {
      handleInteractError(err);
    }
  }

  async function sendComment() {
    const text = commentText.trim();
    const aid = detail?.aid;
    if (!text || !aid) return;
    try {
      await replyAdd(aid, text);
      setCommentText("");
      const page = await replyList(aid);
      setComments(page.items);
      setCommentCount(page.all_count);
    } catch (err) {
      handleInteractError(err);
    }
  }

  async function changeQuality(quality: number) {
    if (!session) return;
    const time = progress.time;
    try {
      const next = await playerOpenBackdrop(session.bvid, session.cid, quality);
      if (!aliveRef.current) return;
      setSession(next);
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

  async function changeSpeed(next: number) {
    setSpeed(next);
    try {
      await playerSetSpeed(next);
    } catch (err) {
      setError(toAppError(err).message);
    }
  }

  const card = items[index];
  const title = detail?.title ?? session?.title ?? card?.title ?? "正在打开…";
  const owner = detail?.owner ?? card?.owner ?? "";
  const face = detail?.owner_face || card?.owner_face || "";
  const season = detail?.season_title ?? "";

  return (
    <div
      ref={pageRef}
      className={`featured-page${session ? " is-playing" : ""}${commentsOpen ? " comments-open" : ""}`}
    >
      <div
        className="featured-stage"
        ref={stageRef}
        title="单击暂停或播放"
        onClick={handleStageClick}
      />
      <div className="featured-rail" data-wheel-navigation="ignore">
        <div className="featured-navigation">
          <button
            className="featured-chevron"
            disabled={index <= 0}
            aria-label="上一条"
            title="上一条"
            onClick={() => void playRelative(-1)}
          >
            <ChevronUp aria-hidden="true" />
          </button>
          <button
            className="featured-chevron"
            aria-label="下一条"
            title="下一条"
            onClick={() => void playRelative(1)}
          >
            <ChevronDown aria-hidden="true" />
          </button>
        </div>
        <div className="featured-actions">
          <ActionButton
            icon={<Sparkles aria-hidden="true" />}
            label="三连"
            active={liked && coined && faved}
            onClick={() => void sendTriple()}
          />
          <ActionButton
            icon={<ThumbsUp aria-hidden="true" />}
            label="赞"
            active={liked}
            count={detail?.like ?? 0}
            onClick={() => void toggleLike()}
          />
          <ActionButton
            icon={<ThumbsDown aria-hidden="true" />}
            label="不喜欢"
            active={disliked}
            onClick={() => void toggleDislike()}
          />
          <ActionButton
            icon={<CircleDollarSign aria-hidden="true" />}
            label="币"
            active={coined}
            count={detail?.coin ?? 0}
            onClick={() => void addCoin()}
          />
          <ActionButton
            icon={<Star aria-hidden="true" />}
            label="藏"
            active={faved}
            count={detail?.favorite ?? 0}
            onClick={() => void addFav()}
          />
          <ActionButton
            icon={<Share2 aria-hidden="true" />}
            label="转"
            count={detail?.share ?? 0}
            onClick={() => void share()}
          />
          <ActionButton
            icon={<Clock3 aria-hidden="true" />}
            label="稍后"
            active={savedLater}
            onClick={() => void saveWatchLater()}
          />
          <ActionButton
            icon={<MessageCircle aria-hidden="true" />}
            label="评"
            active={commentsOpen}
            expanded={commentsOpen}
            count={commentCount}
            onClick={() => void openComments()}
          />
        </div>
      </div>
      {commentsOpen ? (
        <aside className="featured-comments" data-wheel-navigation="ignore">
          <header>
            <strong>评论 {commentCount}</strong>
            <button
              className="ghost-btn"
              onClick={() => setCommentsOpen(false)}
            >
              关闭
            </button>
          </header>
          <div className="featured-comment-list">
            {comments.map((item) => (
              <article key={item.rpid}>
                <strong>{item.name}</strong>
                <p>{item.message}</p>
              </article>
            ))}
          </div>
          <div className="featured-comment-form">
            <input
              value={commentText}
              aria-label="发表评论"
              placeholder="说点什么"
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void sendComment();
                }
              }}
            />
            <button className="primary-btn" onClick={() => void sendComment()}>
              发送
            </button>
          </div>
        </aside>
      ) : null}
      <div className="featured-dock">
        <div className="featured-meta">
          {face ? (
            <img
              className="featured-avatar"
              src={mediaSrc(face)}
              alt=""
              onError={(event) => event.currentTarget.remove()}
            />
          ) : (
            <div className="featured-avatar" />
          )}
          <div className="featured-meta-copy">
            <button
              type="button"
              className="featured-up"
              onClick={() => {
                const mid = detail?.owner_mid;
                if (mid) {
                  navigate(`/space/${mid}`, {
                    state: {
                      from: routeSource(location),
                      fromState: location.state,
                    },
                  });
                }
              }}
              title="查看 UP 主空间"
            >
              {owner}
            </button>
            <div className="featured-title" title={title}>
              {title}
            </div>
            <div className="featured-context">
              {season ? <span>{season}</span> : null}
              <span>
                第 {Math.min(index + 1, Math.max(items.length, 1))} 条
              </span>
              <span className="featured-interaction-hint">
                滚轮切换 · 单击画面暂停/播放
              </span>
            </div>
          </div>
          <span
            className={`featured-playback-notice${playbackNotice ? " is-visible" : ""}`}
            aria-live="polite"
          >
            {playbackNotice}
          </span>
        </div>
        <div className="featured-transport" data-wheel-navigation="ignore">
          <button
            type="button"
            className="featured-play-button"
            aria-label={progress.paused ? "播放" : "暂停"}
            title={progress.paused ? "播放" : "暂停"}
            onClick={() => void toggleFeaturedPlayback()}
          >
            {progress.paused ? (
              <Play aria-hidden="true" />
            ) : (
              <Pause aria-hidden="true" />
            )}
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
            aria-label="播放进度"
            onChange={(e) => void playerSeek(Number(e.target.value))}
          />
        </div>
        <div className="featured-tools" data-wheel-navigation="ignore">
          <label
            className="featured-volume"
            title="音量"
            data-wheel-navigation="ignore"
          >
            <Volume2 aria-hidden="true" />
            <input
              type="range"
              min={0}
              max={130}
              value={progress.volume}
              aria-label="音量"
              onChange={(e) => void playerSetVolume(Number(e.target.value))}
            />
            <span>{Math.round(progress.volume)}</span>
          </label>
          <select
            value={session?.current_quality ?? ""}
            aria-label="清晰度"
            onChange={(e) => void changeQuality(Number(e.target.value))}
          >
            {(session?.qualities ?? []).map((option) => (
              <option key={option.quality} value={option.quality}>
                {option.desc}
              </option>
            ))}
          </select>
          <select
            value={String(speed)}
            aria-label="播放倍速"
            onChange={(e) => void changeSpeed(Number(e.target.value))}
          >
            {SPEEDS.map((item) => (
              <option key={item} value={item}>
                {item}x
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ghost-btn"
            aria-pressed={danmaku}
            onClick={() => void toggleDanmaku()}
          >
            弹幕 {danmaku ? "开" : "关"}
          </button>
          <div className="featured-dm-compose">
            <input
              className="featured-dm"
              value={danmakuText}
              aria-label="发弹幕"
              placeholder="发条弹幕"
              onChange={(e) => setDanmakuText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void sendDanmaku();
                }
              }}
            />
            <button
              type="button"
              className="featured-send-button"
              aria-label="发送弹幕"
              title="发送弹幕"
              onClick={() => void sendDanmaku()}
            >
              <Send aria-hidden="true" />
            </button>
          </div>
        </div>
        {error ? <p className="featured-error">{error}</p> : null}
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  count,
  active,
  expanded,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`featured-action ${active ? "active" : ""}`}
      aria-pressed={active == null ? undefined : active}
      aria-expanded={expanded}
      title={label}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      {count == null ? null : <em>{compactCount(count)}</em>}
    </button>
  );
}

function compactCount(n: number): string {
  if (n >= 10000) {
    return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
  }
  return String(n);
}
