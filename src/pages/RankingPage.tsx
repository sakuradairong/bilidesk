import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { feedRanking, toAppError } from "@/api";
import { VideoGridPage } from "@/pages/VideoGridPage";
import { openWatch } from "@/lib/watch";
import { RANKING_REGIONS } from "@/lib/regions";
import { cn } from "@/lib/utils";
import type { VideoCard } from "@/types";

export function RankingFeed() {
  const [params, setParams] = useSearchParams();
  const requestedRid = Number(params.get("rankRid"));
  const rid = RANKING_REGIONS.some((region) => region.rid === requestedRid)
    ? requestedRid
    : 0;
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<VideoCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (targetRid: number) => {
    setLoading(true);
    setError("");
    try {
      setItems(await feedRanking(targetRid));
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setItems([]);
    void load(rid);
  }, [rid, load]);

  function switchRegion(nextRid: number) {
    const next = new URLSearchParams(params);
    next.set("tab", "ranking");
    if (nextRid === 0) next.delete("rankRid");
    else next.set("rankRid", String(nextRid));
    setParams(next, { replace: true });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="section-chips" aria-label="排行榜分区">
        {RANKING_REGIONS.map((region) => (
          <button
            key={region.rid}
            type="button"
            onClick={() => switchRegion(region.rid)}
            className={cn("section-chip", region.rid === rid && "is-active")}
          >
            {region.name}
          </button>
        ))}
      </div>
      <VideoGridPage
        items={items}
        loading={loading}
        error={error}
        ranked
        onOpen={(bvid) =>
          openWatch(navigate, bvid, `${location.pathname}${location.search}`)
        }
        onRetry={() => void load(rid)}
        emptyTitle="排行榜暂时没有内容"
        emptyDescription="稍后重试，或切换到其他分区"
      />
    </div>
  );
}
