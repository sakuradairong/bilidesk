import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { favResourceList, favFolders, toAppError } from "@/api";
import { VideoGridPage } from "@/pages/VideoGridPage";
import { openWatch } from "@/lib/watch";
import { cn } from "@/lib/utils";
import type { FavFolder, VideoCard } from "@/types";

export function FavoritesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [folders, setFolders] = useState<FavFolder[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [items, setItems] = useState<VideoCard[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await favFolders();
        if (cancelled) return;
        setFolders(list);
        setFolderId((prev) => prev ?? list[0]?.id ?? null);
      } catch (err) {
        if (!cancelled) setError(toAppError(err).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPage = useCallback(
    async (targetFolder: number, nextPage: number) => {
      setLoading(true);
      setError("");
      try {
        const result = await favResourceList(targetFolder, nextPage);
        setItems((prev) =>
          nextPage === 1 ? result.items : [...prev, ...result.items],
        );
        setTotal(result.total);
        setPage(nextPage);
        setHasMore(result.has_more);
      } catch (err) {
        setError(toAppError(err).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (folderId == null) return;
    void loadPage(folderId, 1);
  }, [folderId, loadPage]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          收藏
        </h1>
        <p className="text-sm text-muted-foreground">
          {total > 0 ? `共 ${total} 个稿件` : "云端收藏夹内容"}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {folders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            onClick={() => setFolderId(folder.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              folder.id === folderId
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "border-border bg-card/70 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {folder.title}
          </button>
        ))}
      </div>
      <VideoGridPage
        items={items}
        loading={loading && items.length === 0}
        error={error}
        onOpen={(bvid) =>
          openWatch(navigate, bvid, `${location.pathname}${location.search}`)
        }
        onMore={hasMore ? () => void loadPage(folderId!, page + 1) : undefined}
        onRetry={() => folderId != null && void loadPage(folderId, page)}
        emptyTitle="收藏夹是空的"
        emptyDescription="在播放页或精选模式点收藏即可加入默认收藏夹"
      />
    </div>
  );
}
