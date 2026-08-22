import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { followMod, toAppError, userCard, userVideos } from "@/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoGridPage } from "@/pages/VideoGridPage";
import { mediaSrc } from "@/media";
import { openWatch } from "@/lib/watch";
import { useAuthStore } from "@/stores/auth";
import type { UserSpace, VideoCard as VideoCardType } from "@/types";

function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

export function UserSpacePage() {
  const { mid = "" } = useParams();
  const midNum = Number(mid);
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: string } | null)?.from ?? "/featured";
  const profile = useAuthStore((s) => s.profile);
  const [space, setSpace] = useState<UserSpace | null>(null);
  const [items, setItems] = useState<VideoCardType[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSpace(null);
    setItems([]);
    setPage(1);
    setError("");
  }, [midNum]);

  useEffect(() => {
    if (!Number.isFinite(midNum) || midNum <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const card = await userCard(midNum);
        if (!cancelled) setSpace(card);
      } catch (err) {
        if (!cancelled) setError(toAppError(err).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [midNum]);

  const loadPage = useCallback(
    async (nextPage: number) => {
      if (!Number.isFinite(midNum) || midNum <= 0) return;
      setLoading(true);
      setError("");
      try {
        const result = await userVideos(midNum, nextPage);
        setItems((prev) =>
          nextPage === 1 ? result.items : [...prev, ...result.items],
        );
        setTotal(result.total);
        setPage(nextPage);
        setMore(
          result.items.length > 0 &&
            result.items.length * nextPage < result.total,
        );
      } catch (err) {
        setError(toAppError(err).message);
      } finally {
        setLoading(false);
      }
    },
    [midNum],
  );

  useEffect(() => {
    if (Number.isFinite(midNum) && midNum > 0) void loadPage(1);
  }, [loadPage]);

  async function toggleFollow() {
    if (!space) return;
    try {
      await followMod(space.mid, !space.following);
      setSpace({ ...space, following: !space.following });
    } catch (err) {
      setError(toAppError(err).message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card/70 p-5 shadow-sm">
        <Button variant="ghost" onClick={() => navigate(from)}>
          返回
        </Button>
        {space ? (
          <>
            {space.face ? (
              <img
                src={mediaSrc(space.face)}
                alt=""
                className="size-16 rounded-full object-cover ring-1 ring-border"
                onError={(event) => event.currentTarget.remove()}
              />
            ) : (
              <div className="size-16 rounded-full bg-muted" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-display text-xl font-semibold">
                  {space.name}
                </span>
                {space.level > 0 ? (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                    Lv{space.level}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {space.sign || "这个 UP 很懒，什么都没写"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                粉丝 {formatCount(space.fans)} · 投稿{" "}
                {formatCount(space.archive_count)}
              </p>
            </div>
            {profile ? (
              <Button
                variant={space.following ? "secondary" : "default"}
                onClick={() => void toggleFollow()}
              >
                {space.following ? "已关注" : "关注"}
              </Button>
            ) : null}
          </>
        ) : (
          <div className="flex flex-1 items-center gap-4">
            <Skeleton className="size-16 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
          </div>
        )}
      </div>
      <VideoGridPage
        items={items}
        loading={loading && items.length === 0}
        error={error}
        onOpen={(bvid) => openWatch(navigate, bvid, `/space/${midNum}`)}
        onMore={more ? () => void loadPage(page + 1) : undefined}
        onRetry={() => void loadPage(page)}
        emptyTitle="暂无投稿"
      />
      {items.length > 0 && !more ? (
        <EmptyState title={`共 ${total} 个投稿，已全部加载`} />
      ) : null}
    </div>
  );
}
