import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { feedSearch, toAppError } from "@/api";
import { VideoGridPage } from "@/pages/VideoGridPage";
import type { VideoCard } from "@/types";

export function SearchPage() {
  const [params] = useSearchParams();
  const keyword = params.get("q")?.trim() || "";
  const navigate = useNavigate();
  const [items, setItems] = useState<VideoCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!keyword) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    feedSearch(keyword, 1)
      .then((result) => {
        if (!cancelled) setItems(result.items);
      })
      .catch((err) => {
        if (!cancelled) setError(toAppError(err).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [keyword]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">搜索</h1>
        <p className="text-sm text-muted-foreground">
          {keyword ? `关键词：${keyword}` : "在顶栏输入关键词开始搜索"}
        </p>
      </div>
      <VideoGridPage
        items={items}
        loading={loading}
        error={error}
        onOpen={(bvid) => navigate(`/watch/${bvid}`)}
        onRetry={() => navigate(`/search?q=${encodeURIComponent(keyword)}`)}
        emptyTitle={keyword ? "没有找到相关视频" : "输入关键词搜索"}
      />
    </div>
  );
}
