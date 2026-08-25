import { describe, expect, it } from "vitest";

import {
  RANKING_REGIONS,
  REGION_CHIPS,
  REGION_FEED_REGIONS,
  REGIONS,
  regionSearchParams,
  resolveRegionRid,
} from "./regions";

describe("regionSearchParams", () => {
  it("keeps the region tab active while changing regions", () => {
    const current = new URLSearchParams("tab=region&rid=1");
    const next = regionSearchParams(current, 4);

    expect(next.toString()).toBe("tab=region&rid=4");
  });

  it("restores the region tab and preserves unrelated parameters", () => {
    const current = new URLSearchParams("rid=1&source=home");
    const next = regionSearchParams(current, 3);

    expect(next.get("tab")).toBe("region");
    expect(next.get("rid")).toBe("3");
    expect(next.get("source")).toBe("home");
  });

  it("does not mutate the original parameters", () => {
    const current = new URLSearchParams("tab=region&rid=1");
    regionSearchParams(current, 4);

    expect(current.toString()).toBe("tab=region&rid=1");
  });
});

describe("region metadata", () => {
  it("resolves only ranking-supported integer region ids", () => {
    expect(resolveRegionRid("1")).toBe(1);
    expect(resolveRegionRid("4")).toBe(4);
    expect(resolveRegionRid("01")).toBe(1);
    expect(resolveRegionRid("13")).toBe(1);
    expect(resolveRegionRid("167")).toBe(1);
    expect(resolveRegionRid("168")).toBe(1);
    expect(
      regionSearchParams(new URLSearchParams("tab=region&rid=01"), 1).get(
        "rid",
      ),
    ).toBe("1");

    for (const value of [
      null,
      "",
      "unknown",
      "999999",
      "-1",
      "1.5",
      "Infinity",
    ]) {
      expect(resolveRegionRid(value)).toBe(REGION_FEED_REGIONS[0].rid);
    }
  });

  it("puts 全站 first in REGION_CHIPS", () => {
    expect(REGION_CHIPS[0]).toEqual({ rid: 0, name: "全站" });
    expect(REGION_CHIPS.slice(1)).toEqual(REGION_FEED_REGIONS);
  });

  it("resolves explicit rid=0 as 全站", () => {
    expect(resolveRegionRid("0")).toBe(0);
  });

  it("defaults empty rid to first UGC chip, not 全站", () => {
    expect(resolveRegionRid(null)).toBe(REGION_FEED_REGIONS[0].rid);
    expect(resolveRegionRid("")).toBe(REGION_FEED_REGIONS[0].rid);
  });

  it("keeps ogv ids in the static catalog but out of region feed chips", () => {
    expect(REGIONS.find((region) => region.name === "国创")?.rid).toBe(167);
    expect(REGIONS.some((region) => region.rid === 168)).toBe(false);
    expect(REGION_FEED_REGIONS.some((region) => region.rid === 13)).toBe(
      false,
    );
    expect(REGION_FEED_REGIONS.some((region) => region.rid === 167)).toBe(
      false,
    );
    expect(REGION_FEED_REGIONS.some((region) => region.rid === 1)).toBe(true);
  });

  it("keeps unsupported ogv regions out of ranking", () => {
    expect(RANKING_REGIONS.some((region) => region.rid === 13)).toBe(false);
    expect(RANKING_REGIONS.some((region) => region.rid === 167)).toBe(false);
    expect(RANKING_REGIONS.some((region) => region.rid === 1)).toBe(true);
    expect(RANKING_REGIONS[0]?.rid).toBe(0);
  });
});
