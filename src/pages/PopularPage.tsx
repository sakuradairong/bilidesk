import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { feedPopular, toAppError } from "@/api";
import { VideoGridPage } from "@/pages/VideoGridPage";
import { openWatch } from "@/lib/watch";
import type { VideoCard } from "@/types";

export function PopularFeed() {
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<VideoCard[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(true);
  const [error, setError] = useState("");

  const loadPage = useCallback(async (nextPage: number) => {
    setLoading(true);
    setError("");
    try {
      const next = await feedPopular(nextPage);
      setItems((prev) => (nextPage === 1 ? next : [...prev, ...next]));
      setPage(nextPage);
      setMore(next.length > 0);
    } catch (err) {
      setError(toAppError(err).message);
      setMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(1);
  }, [loadPage]);

  return (
    <VideoGridPage
      items={items}
      loading={loading && items.length === 0}
      error={error}
      onOpen={(bvid) =>
        openWatch(navigate, bvid, `${location.pathname}${location.search}`)
      }
      onMore={more ? () => void loadPage(page + 1) : undefined}
      onRetry={() => void loadPage(page)}
      emptyTitle="暂时没有热门内容"
    />
  );
}
