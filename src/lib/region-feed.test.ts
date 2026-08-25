import { describe, expect, it } from "vitest";

import {
  canLoadMoreRegionFeed,
  createRegionFeedState,
  isRegionFeedLoading,
  regionFeedReducer,
} from "./region-feed";
import type { VideoCard } from "@/types";

function card(index: number): VideoCard {
  return {
    bvid: `BV1region${index}`,
    title: `video ${index}`,
    cover: "",
    owner: "up",
    duration: 0,
    views: 0,
  };
}

describe("region feed state", () => {
  it("starts in a loading state without exposing an empty page", () => {
    const state = createRegionFeedState();

    expect(state.phase).toBe("initial-loading");
    expect(state.hasMore).toBe(false);
    expect(isRegionFeedLoading(state)).toBe(true);
    expect(canLoadMoreRegionFeed(state)).toBe(false);
  });

  it("replaces items from a ranking response and never offers load more", () => {
    let state = regionFeedReducer(createRegionFeedState(), {
      type: "start",
      requestId: 1,
      page: 1,
    });
    state = regionFeedReducer(state, {
      type: "success",
      requestId: 1,
      page: 1,
      items: [card(1), card(2), card(1)],
    });

    expect(state.items.map((item) => item.bvid)).toEqual([
      "BV1region1",
      "BV1region2",
    ]);
    expect(state.nextPage).toBe(2);
    expect(state.hasMore).toBe(false);
    expect(canLoadMoreRegionFeed(state)).toBe(false);
  });

  it("treats an empty successful ranking response as idle completion", () => {
    let state = regionFeedReducer(createRegionFeedState(), {
      type: "start",
      requestId: 1,
      page: 1,
    });
    state = regionFeedReducer(state, {
      type: "success",
      requestId: 1,
      page: 1,
      items: [],
    });

    expect(state.items).toEqual([]);
    expect(state.error).toBe("");
    expect(state.hasMore).toBe(false);
    expect(state.phase).toBe("idle");
  });

  it("keeps the cursor and exact page when a request fails", () => {
    let state = regionFeedReducer(createRegionFeedState(), {
      type: "start",
      requestId: 1,
      page: 1,
    });
    state = regionFeedReducer(state, {
      type: "success",
      requestId: 1,
      page: 1,
      items: [card(1)],
    });
    state = regionFeedReducer(state, {
      type: "start",
      requestId: 2,
      page: 1,
    });
    state = regionFeedReducer(state, {
      type: "failure",
      requestId: 2,
      page: 1,
      error: "network",
    });

    expect(state.items).toHaveLength(1);
    expect(state.failedPage).toBe(1);
    expect(canLoadMoreRegionFeed(state)).toBe(false);
  });

  it("ignores results from a stale request id", () => {
    const active = regionFeedReducer(createRegionFeedState(), {
      type: "start",
      requestId: 2,
      page: 1,
    });
    const staleSuccess = regionFeedReducer(active, {
      type: "success",
      requestId: 1,
      page: 1,
      items: [card(1)],
    });
    const staleFailure = regionFeedReducer(active, {
      type: "failure",
      requestId: 1,
      page: 1,
      error: "stale",
    });

    expect(staleSuccess).toBe(active);
    expect(staleFailure).toBe(active);
  });
});
