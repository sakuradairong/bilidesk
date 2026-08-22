import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { dynamicFeed, toAppError } from "@/api";
import { VideoGridPage } from "@/pages/VideoGridPage";
import { openWatch } from "@/lib/watch";
import type { VideoCard } from "@/types";

type Row = {
  key: string;
  card: VideoCard;
};

export function DynamicFeedView() {
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<Row[]>([]);
  const [offset, setOffset] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadPage = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError("");
    try {
      const result = await dynamicFeed(cursor || undefined);
      setItems((prev) => {
        const seen = new Set(prev.map((row) => row.key));
        const merged = [...prev];
        for (const item of result.items) {
          const key = `${item.dynamic_id}:${item.card.bvid}`;
          if (!seen.has(key)) {
            seen.add(key);
            merged.push({ key, card: item.card });
          }
        }
        return merged;
      });
      setOffset(result.offset);
      setHasMore(result.has_more && result.offset !== "");
    } catch (err) {
      setError(toAppError(err).message);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  return (
    <VideoGridPage
      items={items.map((row) => row.card)}
      loading={loading && items.length === 0}
      error={error}
      onOpen={(bvid) =>
        openWatch(navigate, bvid, `${location.pathname}${location.search}`)
      }
      onMore={hasMore ? () => void loadPage(offset) : undefined}
      onRetry={() => void loadPage(offset)}
      emptyTitle="没有视频动态"
      emptyDescription="登录并关注一些 UP 主后，这里会展示他们的最新投稿"
    />
  );
}
