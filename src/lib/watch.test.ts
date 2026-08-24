import { describe, expect, it, vi } from "vitest";

import { openWatch, routeSource, watchBack } from "./watch";

describe("watch navigation", () => {
  it("builds a route source from the complete path and query", () => {
    expect(
      routeSource({ pathname: "/", search: "?tab=region&rid=13" }),
    ).toBe("/?tab=region&rid=13");
    expect(routeSource({ pathname: "/settings", search: "" })).toBe(
      "/settings",
    );
    expect(
      routeSource({ pathname: "/search", search: "?q=test", hash: "#results" }),
    ).toBe("/search?q=test#results");
  });

  it("keeps the origin route when opening a video", () => {
    const navigate = vi.fn();
    const from = routeSource({
      pathname: "/",
      search: "?tab=region&rid=13",
    });
    openWatch(navigate, "BV1test", from);
    expect(navigate).toHaveBeenCalledWith("/watch/BV1test", {
      state: { from: "/?tab=region&rid=13" },
    });
  });

  it("preserves nested return state across detours", () => {
    const navigate = vi.fn();
    const fromState = { from: "/featured" };
    openWatch(navigate, "BV1nested", "/space/42", fromState);
    watchBack(navigate, "/watch/BV1nested", fromState);

    expect(navigate).toHaveBeenNthCalledWith(1, "/watch/BV1nested", {
      state: { from: "/space/42", fromState },
    });
    expect(navigate).toHaveBeenNthCalledWith(2, "/watch/BV1nested", {
      state: fromState,
    });
  });

  it("returns to the exact origin and falls back to home", () => {
    const navigate = vi.fn();
    watchBack(navigate, "/settings");
    watchBack(navigate, "/featured");
    watchBack(navigate);
    expect(navigate).toHaveBeenNthCalledWith(1, "/settings");
    expect(navigate).toHaveBeenNthCalledWith(2, "/featured");
    expect(navigate).toHaveBeenNthCalledWith(3, "/");
  });
});
