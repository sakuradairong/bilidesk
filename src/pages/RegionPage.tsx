import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { feedRegion, toAppError } from "@/api";
import { VideoGridPage } from "@/pages/VideoGridPage";
import { openWatch, routeSource } from "@/lib/watch";
import { REGIONS, regionSearchParams } from "@/lib/regions";
import { cn } from "@/lib/utils";
import type { VideoCard } from "@/types";

export function RegionFeed() {
  const [params, setParams] = useSearchParams();
  const rid = Number(params.get("rid")) || REGIONS[0].rid;
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<VideoCard[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(true);
  const [error, setError] = useState("");

  const loadPage = useCallback(async (targetRid: number, nextPage: number) => {
    setLoading(true);
    setError("");
    try {
      const next = await feedRegion(targetRid, nextPage);
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
    setItems([]);
    setMore(true);
    void loadPage(rid, 1);
  }, [rid, loadPage]);

  function switchRegion(nextRid: number) {
    setParams(regionSearchParams(params, nextRid), { replace: true });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="section-chips" aria-label="视频分区">
        {REGIONS.map((region) => (
          <button
            key={region.rid}
            type="button"
            onClick={() => switchRegion(region.rid)}
            className={cn(
              "section-chip",
              region.rid === rid && "is-active",
            )}
          >
            {region.name}
          </button>
        ))}
      </div>
      <VideoGridPage
        items={items}
        loading={loading && items.length === 0}
        error={error}
        onOpen={(bvid) => openWatch(navigate, bvid, routeSource(location))}
        onMore={more ? () => void loadPage(rid, page + 1) : undefined}
        onRetry={() => void loadPage(rid, page)}
        emptyTitle="该分区暂时没有稿件"
      />
    </div>
  );
}
