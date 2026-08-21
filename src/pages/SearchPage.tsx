import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { feedSearch, toAppError } from "@/api";
import { VideoGridPage } from "@/pages/VideoGridPage";
import { openWatch } from "@/lib/watch";
import type { VideoCard } from "@/types";

export function SearchPage() {
  const [params] = useSearchParams();
  const keyword = params.get("q")?.trim() || "";
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<VideoCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!keyword) {
      setItems([]);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await feedSearch(keyword, 1);
      setItems(result.items);
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setLoading(false);
    }
  }, [keyword]);

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
        onOpen={(bvid) => openWatch(navigate, bvid, `${location.pathname}${location.search}`)}
        onRetry={() => void load()}
        emptyTitle={keyword ? "没有找到相关视频" : "输入关键词搜索"}
      />
    </div>
  );
}
