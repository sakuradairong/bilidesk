import { useCallback, useEffect, useReducer, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { feedRegion, toAppError } from "@/api";
import { VideoGridPage } from "@/pages/VideoGridPage";
import {
  canLoadMoreRegionFeed,
  createRegionFeedState,
  isRegionFeedLoading,
  regionFeedReducer,
} from "@/lib/region-feed";
import {
  REGIONS,
  regionSearchParams,
  resolveRegionRid,
} from "@/lib/regions";
import { describeRegionFeedError } from "@/lib/errors";
import { openWatch, routeSource } from "@/lib/watch";
import { cn } from "@/lib/utils";

type RegionFeedContentProps = {
  rid: number;
};

function RegionFeedContent({ rid }: RegionFeedContentProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, dispatch] = useReducer(
    regionFeedReducer,
    undefined,
    createRegionFeedState,
  );
  const requestCounterRef = useRef(0);
  const activeRequestRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(false);

  const requestPage = useCallback(
    async (page: number) => {
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      const requestId = ++requestCounterRef.current;
      activeRequestRef.current = requestId;
      dispatch({ type: "start", requestId, page });

      try {
        const items = await feedRegion(rid, page);
        if (!mountedRef.current || activeRequestRef.current !== requestId) return;
        dispatch({ type: "success", requestId, page, items });
      } catch (err) {
        if (!mountedRef.current || activeRequestRef.current !== requestId) return;
        dispatch({
          type: "failure",
          requestId,
          page,
          error: describeRegionFeedError(toAppError(err)),
        });
      } finally {
        if (activeRequestRef.current === requestId) {
          activeRequestRef.current = null;
          inFlightRef.current = false;
        }
      }
    },
    [rid],
  );

  useEffect(() => {
    mountedRef.current = true;
    void requestPage(1);
    return () => {
      mountedRef.current = false;
    };
  }, [requestPage]);

  const loading = isRegionFeedLoading(state);
  const canLoadMore = canLoadMoreRegionFeed(state);
  const retryPage = state.failedPage;

  return (
    <VideoGridPage
      items={state.items}
      loading={loading}
      error={state.error}
      onOpen={(bvid) => openWatch(navigate, bvid, routeSource(location))}
      onMore={
        canLoadMore ? () => void requestPage(state.nextPage) : undefined
      }
      onRetry={
        retryPage == null ? undefined : () => void requestPage(retryPage)
      }
      emptyTitle="该分区暂时没有稿件"
    />
  );
}

export function RegionFeed() {
  const [params, setParams] = useSearchParams();
  const rawRid = params.get("rid");
  const rid = resolveRegionRid(rawRid);

  useEffect(() => {
    if (rawRid === String(rid) && params.get("tab") === "region") return;
    setParams(regionSearchParams(params, rid), { replace: true });
  }, [params, rawRid, rid, setParams]);

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
      <RegionFeedContent key={rid} rid={rid} />
    </div>
  );
}
