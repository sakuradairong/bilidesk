import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toAppError, watchlaterClear, watchlaterList } from "@/api";
import { Button } from "@/components/ui/button";
import { VideoGridPage } from "@/pages/VideoGridPage";
import { openWatch } from "@/lib/watch";
import type { VideoCard, WatchLaterItem } from "@/types";

export function WatchLaterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<VideoCard[]>([]);
  const [raw, setRaw] = useState<WatchLaterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await watchlaterList();
      setRaw(list);
      setItems(
        list.map((item) => ({
          bvid: item.bvid,
          title: item.title,
          cover: item.cover,
          owner: item.owner,
          duration: item.duration,
          views: 0,
        })),
      );
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function clearAll() {
    try {
      await watchlaterClear();
      setItems([]);
      setRaw([]);
    } catch (err) {
      setError(toAppError(err).message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            稍后再看
          </h1>
          <p className="text-sm text-muted-foreground">
            {raw.length > 0 ? `共 ${raw.length} 个稿件` : "云端稍后再看列表"}
          </p>
        </div>
        {raw.length > 0 ? (
          <Button variant="outline" onClick={() => void clearAll()}>
            清空
          </Button>
        ) : null}
      </div>
      <VideoGridPage
        items={items}
        loading={loading}
        error={error}
        onOpen={(bvid) =>
          openWatch(navigate, bvid, `${location.pathname}${location.search}`)
        }
        onRetry={() => void load()}
        emptyTitle="稍后再看是空的"
        emptyDescription="播放页点「稍后再看」按钮即可添加"
      />
    </div>
  );
}
