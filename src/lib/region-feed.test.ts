import { describe, expect, it } from "vitest";

import {
  canLoadMoreRegionFeed,
  createRegionFeedState,
  isRegionFeedLoading,
  REGION_PAGE_SIZE,
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

function fullPage(offset = 0): VideoCard[] {
  return Array.from({ length: REGION_PAGE_SIZE }, (_, index) =>
    card(index + offset),
  );
}

describe("region feed state", () => {
  it("starts in a loading state without exposing an empty page", () => {
    const state = createRegionFeedState();

    expect(state.phase).toBe("initial-loading");
    expect(isRegionFeedLoading(state)).toBe(true);
    expect(canLoadMoreRegionFeed(state)).toBe(false);
  });

  it("replaces the first page and appends later pages", () => {
    let state = regionFeedReducer(createRegionFeedState(), {
      type: "start",
      requestId: 1,
      page: 1,
    });
    state = regionFeedReducer(state, {
      type: "success",
      requestId: 1,
      page: 1,
      items: fullPage(),
    });

    expect(state.items).toHaveLength(REGION_PAGE_SIZE);
    expect(state.nextPage).toBe(2);
    expect(state.hasMore).toBe(true);
    expect(canLoadMoreRegionFeed(state)).toBe(true);

    state = regionFeedReducer(state, {
      type: "start",
      requestId: 2,
      page: 2,
    });
    state = regionFeedReducer(state, {
      type: "success",
      requestId: 2,
      page: 2,
      items: [card(100)],
    });

    expect(state.items).toHaveLength(REGION_PAGE_SIZE + 1);
    expect(state.items[state.items.length - 1]?.bvid).toBe("BV1region100");
    expect(state.nextPage).toBe(3);
    expect(state.hasMore).toBe(false);
  });

  it("stops paging when a short page still adds cards", () => {
    let state = regionFeedReducer(createRegionFeedState(), {
      type: "start",
      requestId: 1,
      page: 1,
    });
    state = regionFeedReducer(state, {
      type: "success",
      requestId: 1,
      page: 1,
      items: fullPage(),
    });
    state = regionFeedReducer(state, {
      type: "start",
      requestId: 2,
      page: 2,
    });
    state = regionFeedReducer(state, {
      type: "success",
      requestId: 2,
      page: 2,
      items: [card(100), card(101)],
    });

    expect(state.items).toHaveLength(REGION_PAGE_SIZE + 2);
    expect(state.hasMore).toBe(false);
    expect(canLoadMoreRegionFeed(state)).toBe(false);
  });

  it("keeps paging when a full overlapping page still adds cards", () => {
    const firstPage = fullPage();
    const overlappingPage = [
      firstPage[0]!,
      ...fullPage(100).slice(0, REGION_PAGE_SIZE - 1),
    ];
    let state = regionFeedReducer(createRegionFeedState(), {
      type: "start",
      requestId: 1,
      page: 1,
    });
    state = regionFeedReducer(state, {
      type: "success",
      requestId: 1,
      page: 1,
      items: firstPage,
    });
    state = regionFeedReducer(state, {
      type: "start",
      requestId: 2,
      page: 2,
    });
    state = regionFeedReducer(state, {
      type: "success",
      requestId: 2,
      page: 2,
      items: overlappingPage,
    });

    expect(overlappingPage).toHaveLength(REGION_PAGE_SIZE);
    expect(state.items).toHaveLength(REGION_PAGE_SIZE * 2 - 1);
    expect(state.items[state.items.length - 1]?.bvid).toBe(
      `BV1region${100 + REGION_PAGE_SIZE - 2}`,
    );
    expect(state.hasMore).toBe(true);
  });

  it("drops a repeated page and stops pagination", () => {
    const firstPage = fullPage();
    let state = regionFeedReducer(createRegionFeedState(), {
      type: "start",
      requestId: 1,
      page: 1,
    });
    state = regionFeedReducer(state, {
      type: "success",
      requestId: 1,
      page: 1,
      items: firstPage,
    });
    state = regionFeedReducer(state, {
      type: "start",
      requestId: 2,
      page: 2,
    });
    state = regionFeedReducer(state, {
      type: "success",
      requestId: 2,
      page: 2,
      items: firstPage,
    });

    expect(state.items).toHaveLength(REGION_PAGE_SIZE);
    expect(state.hasMore).toBe(false);
  });

  it("treats an empty successful page as normal pagination completion", () => {
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
      items: fullPage(),
    });
    state = regionFeedReducer(state, {
      type: "start",
      requestId: 2,
      page: 2,
    });
    state = regionFeedReducer(state, {
      type: "failure",
      requestId: 2,
      page: 2,
      error: "network",
    });

    expect(state.items).toHaveLength(REGION_PAGE_SIZE);
    expect(state.nextPage).toBe(2);
    expect(state.hasMore).toBe(true);
    expect(state.failedPage).toBe(2);
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
