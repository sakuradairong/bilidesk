import { describe, expect, it } from "vitest";

import {
  RANKING_REGIONS,
  REGIONS,
  regionSearchParams,
  resolveRegionRid,
} from "./regions";

describe("regionSearchParams", () => {
  it("keeps the region tab active while changing regions", () => {
    const current = new URLSearchParams("tab=region&rid=1");
    const next = regionSearchParams(current, 13);

    expect(next.toString()).toBe("tab=region&rid=13");
  });

  it("restores the region tab and preserves unrelated parameters", () => {
    const current = new URLSearchParams("rid=1&source=home");
    const next = regionSearchParams(current, 167);

    expect(next.get("tab")).toBe("region");
    expect(next.get("rid")).toBe("167");
    expect(next.get("source")).toBe("home");
  });

  it("does not mutate the original parameters", () => {
    const current = new URLSearchParams("tab=region&rid=1");
    regionSearchParams(current, 13);

    expect(current.toString()).toBe("tab=region&rid=1");
  });
});

describe("region metadata", () => {
  it("resolves only supported integer region ids", () => {
    expect(resolveRegionRid("13")).toBe(13);
    expect(resolveRegionRid("167")).toBe(167);
    expect(resolveRegionRid("168")).toBe(167);
    expect(resolveRegionRid("01")).toBe(1);
    expect(
      regionSearchParams(new URLSearchParams("tab=region&rid=01"), 1).get(
        "rid",
      ),
    ).toBe("1");

    for (const value of [
      null,
      "",
      "0",
      "unknown",
      "999999",
      "-1",
      "1.5",
      "Infinity",
    ]) {
      expect(resolveRegionRid(value)).toBe(REGIONS[0].rid);
    }
  });

  it("uses the top-level guochuang id", () => {
    expect(REGIONS.find((region) => region.name === "国创")?.rid).toBe(167);
    expect(REGIONS.some((region) => region.rid === 168)).toBe(false);
  });

  it("keeps unsupported ogv regions out of ranking", () => {
    expect(RANKING_REGIONS.some((region) => region.rid === 13)).toBe(false);
    expect(RANKING_REGIONS.some((region) => region.rid === 167)).toBe(false);
    expect(RANKING_REGIONS.some((region) => region.rid === 1)).toBe(true);
  });
});
