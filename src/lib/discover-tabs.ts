export function normalizeDiscoverSearch(
  params: URLSearchParams,
): URLSearchParams | null {
  if (params.get("tab") !== "ranking") return null;
  const next = new URLSearchParams(params);
  next.set("tab", "region");
  const rankRid = next.get("rankRid");
  if (rankRid != null) {
    next.set("rid", rankRid);
    next.delete("rankRid");
  }
  return next;
}
