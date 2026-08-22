import { useCallback, useEffect, useRef, useState } from "react";
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
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    if (!keyword) {
      setItems([]);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await feedSearch(keyword, 1);
      if (id !== requestId.current) return;
      setItems(result.items);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(toAppError(err).message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [keyword]);

  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

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
