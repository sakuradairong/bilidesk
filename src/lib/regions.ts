export function regionSearchParams(
  current: URLSearchParams,
  nextRid: number,
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set("tab", "region");
  next.set("rid", String(nextRid));
  return next;
}

/** B 站常用主分区（静态表，rid 与官网一致） */
export const REGIONS: { rid: number; name: string }[] = [
  { rid: 1, name: "动画" },
  { rid: 13, name: "番剧" },
  { rid: 167, name: "国创" },
  { rid: 3, name: "音乐" },
  { rid: 129, name: "舞蹈" },
  { rid: 4, name: "游戏" },
  { rid: 36, name: "知识" },
  { rid: 188, name: "科技" },
  { rid: 234, name: "运动" },
  { rid: 223, name: "汽车" },
  { rid: 160, name: "生活" },
  { rid: 119, name: "鬼畜" },
  { rid: 155, name: "时尚" },
  { rid: 5, name: "娱乐" },
  { rid: 181, name: "影视" },
];

/** ranking/v2 不支持的 OGV 主分区（与官方 PC / 排行页一致）。 */
const REGION_FEED_UNSUPPORTED = new Set([13, 167, 168]);

/** 分区页可用的 UGC 主分区（ranking/v2）。 */
export const REGION_FEED_REGIONS: { rid: number; name: string }[] =
  REGIONS.filter((region) => !REGION_FEED_UNSUPPORTED.has(region.rid));

export const REGION_CHIPS: { rid: number; name: string }[] = [
  { rid: 0, name: "全站" },
  ...REGION_FEED_REGIONS,
];

export function resolveRegionRid(value: string | null): number {
  const fallback = REGION_FEED_REGIONS[0]?.rid ?? REGIONS[0].rid;
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed === 0) return 0;
  if (REGION_FEED_UNSUPPORTED.has(parsed)) return fallback;
  return REGION_FEED_REGIONS.some((region) => region.rid === parsed)
    ? parsed
    : fallback;
}

/** 排行榜接口支持的全站及 UGC 主分区。 */
export const RANKING_REGIONS: { rid: number; name: string }[] = REGION_CHIPS;
