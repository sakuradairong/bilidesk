import { describe, expect, it, vi } from "vitest";

import { openWatch, watchBack } from "./watch";

describe("watch navigation", () => {
  it("keeps the origin route when opening a video", () => {
    const navigate = vi.fn();
    openWatch(navigate, "BV1test", "/?tab=popular");
    expect(navigate).toHaveBeenCalledWith("/watch/BV1test", {
      state: { from: "/?tab=popular" },
    });
  });

  it("returns to the origin and falls back to home", () => {
    const navigate = vi.fn();
    watchBack(navigate, "/favorites");
    watchBack(navigate);
    expect(navigate).toHaveBeenNthCalledWith(1, "/favorites");
    expect(navigate).toHaveBeenNthCalledWith(2, "/");
  });
});
