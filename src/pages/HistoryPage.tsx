import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { historyList, toAppError } from "@/api";
import { VideoGridPage } from "@/pages/VideoGridPage";
import type { HistoryItem, VideoCard } from "@/types";

export function HistoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<VideoCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const history: HistoryItem[] = await historyList();
      setItems(
        history.map((item) => ({
          bvid: item.bvid,
          title: item.title,
          cover: item.cover,
          owner: item.owner,
          duration: 0,
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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">历史</h1>
        <p className="text-sm text-muted-foreground">本地观看记录，保存在 SQLite</p>
      </div>
      <VideoGridPage
        items={items}
        loading={loading}
        error={error}
        onOpen={(bvid) => navigate(`/watch/${bvid}`)}
        onRetry={() => void load()}
        emptyTitle="还没有观看记录"
        emptyDescription="打开任意视频后会出现在这里"
      />
    </div>
  );
}
