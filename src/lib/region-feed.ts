import type { VideoCard } from "@/types";

export type RegionFeedPhase = "initial-loading" | "idle" | "loading-more";

export type RegionFeedState = {
  items: VideoCard[];
  nextPage: number;
  hasMore: boolean;
  phase: RegionFeedPhase;
  requestId: number | null;
  failedPage: number | null;
  error: string;
};

export type RegionFeedAction =
  | { type: "start"; requestId: number; page: number }
  | {
      type: "success";
      requestId: number;
      page: number;
      items: VideoCard[];
    }
  | { type: "failure"; requestId: number; page: number; error: string };

export function createRegionFeedState(): RegionFeedState {
  return {
    items: [],
    nextPage: 1,
    hasMore: false,
    phase: "initial-loading",
    requestId: null,
    failedPage: null,
    error: "",
  };
}

export function regionFeedReducer(
  state: RegionFeedState,
  action: RegionFeedAction,
): RegionFeedState {
  if (action.type === "start") {
    return {
      ...state,
      phase:
        action.page === 1 && state.items.length === 0
          ? "initial-loading"
          : "loading-more",
      requestId: action.requestId,
      failedPage: null,
      error: "",
    };
  }

  if (state.requestId !== action.requestId) return state;

  if (action.type === "failure") {
    return {
      ...state,
      phase: "idle",
      requestId: null,
      failedPage: action.page,
      error: action.error,
    };
  }

  const seen = new Set<string>();
  const items = action.items.filter((item) => {
    if (seen.has(item.bvid)) return false;
    seen.add(item.bvid);
    return true;
  });

  // ranking/v2 无分页：任意成功响应都结束加载更多。
  return {
    items,
    nextPage: action.page + 1,
    hasMore: false,
    phase: "idle",
    requestId: null,
    failedPage: null,
    error: "",
  };
}

export function isRegionFeedLoading(state: RegionFeedState): boolean {
  return state.phase !== "idle";
}

export function canLoadMoreRegionFeed(state: RegionFeedState): boolean {
  return (
    state.items.length > 0 && state.hasMore && state.failedPage === null
  );
}
