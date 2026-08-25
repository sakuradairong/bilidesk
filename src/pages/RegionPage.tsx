import { useCallback, useEffect, useReducer, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { feedRegion, toAppError } from "@/api";
import { VideoGridPage } from "@/pages/VideoGridPage";
import {
  createRegionFeedState,
  isRegionFeedLoading,
  regionFeedReducer,
} from "@/lib/region-feed";
import { isHotkeyIgnored } from "@/lib/hotkeys";
import {
  adjacentRegionRid,
  regionRidForDigit,
} from "@/lib/region-hotkeys";
import {
  REGION_CHIPS,
  regionSearchParams,
  resolveRegionRid,
} from "@/lib/regions";
import { describeRegionFeedError } from "@/lib/errors";
import { openWatch, routeSource } from "@/lib/watch";
import { cn } from "@/lib/utils";

type RegionFeedContentProps = {
  rid: number;
  onLoadingChange?: (loading: boolean) => void;
};

function RegionFeedContent({ rid, onLoadingChange }: RegionFeedContentProps) {
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
  const retryPage = state.failedPage;

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  return (
    <VideoGridPage
      items={state.items}
      loading={loading}
      error={state.error}
      ranked
      onOpen={(bvid) => openWatch(navigate, bvid, routeSource(location))}
      onRetry={
        retryPage == null ? undefined : () => void requestPage(retryPage)
      }
      emptyTitle="该分区暂时没有排行内容"
      emptyDescription="稍后重试，或切换到其他分区"
    />
  );
}

type RegionFeedProps = {
  refreshNonce?: number;
  onRefreshRequest?: () => void;
  onLoadingChange?: (loading: boolean) => void;
};

export function RegionFeed({
  refreshNonce = 0,
  onRefreshRequest,
  onLoadingChange,
}: RegionFeedProps = {}) {
  const [params, setParams] = useSearchParams();
  const rawRid = params.get("rid");
  const rid = resolveRegionRid(rawRid);

  useEffect(() => {
    if (params.get("tab") === "ranking") return;
    if (params.get("rankRid") != null && rawRid == null) return;
    if (rawRid === String(rid) && params.get("tab") === "region") return;
    setParams(regionSearchParams(params, rid), { replace: true });
  }, [params, rawRid, rid, setParams]);

  const switchRegion = useCallback(
    (nextRid: number) => {
      setParams(regionSearchParams(params, nextRid), { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isHotkeyIgnored(event.target)) return;
      if (event.repeat) return;

      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        onRefreshRequest?.();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        switchRegion(adjacentRegionRid(REGION_CHIPS, rid, -1));
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        switchRegion(adjacentRegionRid(REGION_CHIPS, rid, 1));
        return;
      }

      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        const next = regionRidForDigit(REGION_CHIPS, digit);
        if (next != null) {
          event.preventDefault();
          switchRegion(next);
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRefreshRequest, rid, switchRegion]);

  return (
    <div className="flex flex-col gap-4">
      <div className="section-chips" aria-label="视频分区">
        {REGION_CHIPS.map((region) => (
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
      <RegionFeedContent
        key={`${rid}-${refreshNonce}`}
        rid={rid}
        onLoadingChange={onLoadingChange}
      />
    </div>
  );
}
