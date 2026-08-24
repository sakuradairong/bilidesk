import { describe, expect, it } from "vitest";

import { regionSearchParams } from "./regions";

describe("regionSearchParams", () => {
  it("keeps the region tab active while changing regions", () => {
    const current = new URLSearchParams("tab=region&rid=1");
    const next = regionSearchParams(current, 13);

    expect(next.toString()).toBe("tab=region&rid=13");
  });

  it("restores the region tab and preserves unrelated parameters", () => {
    const current = new URLSearchParams("rid=1&source=home");
    const next = regionSearchParams(current, 168);

    expect(next.get("tab")).toBe("region");
    expect(next.get("rid")).toBe("168");
    expect(next.get("source")).toBe("home");
  });

  it("does not mutate the original parameters", () => {
    const current = new URLSearchParams("tab=region&rid=1");
    regionSearchParams(current, 13);

    expect(current.toString()).toBe("tab=region&rid=1");
  });
});
