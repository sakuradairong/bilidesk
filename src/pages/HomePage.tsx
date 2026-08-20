import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { feedRecommend, toAppError } from "@/api";
import { VideoGridPage } from "@/pages/VideoGridPage";
import type { VideoCard } from "@/types";

export function HomePage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<VideoCard[]>([]);
  const [idx, setIdx] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (freshIdx: number, append = false) => {
    setLoading(true);
    setError("");
    try {
      const next = await feedRecommend(freshIdx);
      setItems((prev) => (append ? [...prev, ...next] : next));
      setIdx(freshIdx);
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">推荐</h1>
        <p className="text-sm text-muted-foreground">按当前登录态拉取网页端推荐流</p>
      </div>
      <VideoGridPage
        items={items}
        loading={loading}
        error={error}
        onOpen={(bvid) => navigate(`/watch/${bvid}`)}
        onMore={() => void load(idx + 1, true)}
        onRetry={() => void load(1)}
        emptyTitle="还没有推荐"
        emptyDescription="稍后再试，或先登录后再刷新"
      />
    </div>
  );
}
