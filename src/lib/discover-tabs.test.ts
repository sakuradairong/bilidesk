import { describe, expect, it } from "vitest";

import { normalizeDiscoverSearch } from "./discover-tabs";

describe("normalizeDiscoverSearch", () => {
  it("rewrites ranking tab onto region and maps rankRid", () => {
    const next = normalizeDiscoverSearch(
      new URLSearchParams("tab=ranking&rankRid=4"),
    );
    expect(next?.toString()).toBe("tab=region&rid=4");
  });

  it("leaves non-ranking params alone", () => {
    expect(
      normalizeDiscoverSearch(new URLSearchParams("tab=region&rid=1")),
    ).toBeNull();
  });
});
