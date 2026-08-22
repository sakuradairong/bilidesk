import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Clock3,
  MessageCircle,
  Share2,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
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
import { useNavigate } from "react-router-dom";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

export function FeaturedPage() {
  const navigate = useNavigate();
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
  const playAtRef = useRef<
    (nextIndex: number, source?: VideoCard[]) => Promise<void>
  >(async () => {});

  progressRef.current = progress;
  speedRef.current = speed;
  danmakuRef.current = danmaku;
  commentsOpenRef.current = commentsOpen;
  itemsRef.current = items;
  indexRef.current = index;

  useEffect(() => {
    document.documentElement.classList.add("featured-mode");
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
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
      setError(event.payload);
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
        void playerTogglePause();
      } else if (event.code === "ArrowUp") {
        event.preventDefault();
        void playAtRef.current(indexRef.current - 1);
      } else if (event.code === "ArrowDown" || event.code === "KeyF") {
        event.preventDefault();
        void playAtRef.current(indexRef.current + 1);
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
      setError("链接已复制");
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
      className={`featured-page${session ? " is-playing" : ""}${commentsOpen ? " comments-open" : ""}`}
    >
      <div
        className="featured-stage"
        ref={stageRef}
        onClick={() => void playerTogglePause()}
      />
      <div className="featured-rail">
        <div className="featured-navigation">
          <button
            className="featured-chevron"
            disabled={index <= 0}
            aria-label="上一条"
            title="上一条"
            onClick={() => void playAt(indexRef.current - 1)}
          >
            <ChevronUp aria-hidden="true" />
          </button>
          <button
            className="featured-chevron"
            aria-label="下一条"
            title="下一条"
            onClick={() => void playAt(indexRef.current + 1)}
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
        <aside className="featured-comments">
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
          <div>
            <button
              type="button"
              className="featured-up"
              onClick={() => {
                const mid = detail?.owner_mid;
                if (mid) navigate(`/space/${mid}`);
              }}
              title="查看 UP 主空间"
            >
              {owner}
            </button>
            <div className="featured-title">{title}</div>
            {season ? <div className="featured-season">{season}</div> : null}
          </div>
        </div>
        <div className="featured-bar">
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
            aria-label="播放进度"
            onChange={(e) => void playerSeek(Number(e.target.value))}
          />
          <input
            type="range"
            min={0}
            max={130}
            value={progress.volume}
            aria-label="音量"
            title="音量"
            onChange={(e) => void playerSetVolume(Number(e.target.value))}
          />
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
          <button className="ghost-btn" onClick={() => void toggleDanmaku()}>
            弹幕 {danmaku ? "开" : "关"}
          </button>
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
      aria-pressed={!!active}
      aria-expanded={expanded}
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
