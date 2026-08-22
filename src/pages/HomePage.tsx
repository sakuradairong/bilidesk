import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { feedRecommend, toAppError } from "@/api";
import { VideoGridPage } from "@/pages/VideoGridPage";
import { PopularFeed } from "@/pages/PopularPage";
import { RegionFeed } from "@/pages/RegionPage";
import { DynamicFeedView } from "@/pages/DynamicPage";
import { openWatch } from "@/lib/watch";
import type { VideoCard } from "@/types";

const TABS = [
  { key: "recommend", label: "推荐" },
  { key: "hot", label: "热门" },
  { key: "region", label: "分区" },
  { key: "dynamic", label: "动态" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function RecommendFeed() {
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<VideoCard[]>([]);
  const [idx, setIdx] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (freshIdx: number, append = false) => {
    setLoading(true);
    setError("");
    try {
      const next = await feedRecommend(freshIdx);
      setItems((prev) => {
        if (!append) return next;
        const seen = new Set(prev.map((item) => item.bvid));
        return [
          ...prev,
          ...next.filter((item) => item.bvid && !seen.has(item.bvid)),
        ];
      });
      setIdx(freshIdx);
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  return (
    <VideoGridPage
      items={items}
      loading={loading}
      error={error}
      onOpen={(bvid) =>
        openWatch(navigate, bvid, `${location.pathname}${location.search}`)
      }
      onMore={() => void load(idx + 1, true)}
      onRetry={() => void (items.length ? load(idx + 1, true) : load(1))}
      emptyTitle="还没有推荐"
      emptyDescription="稍后再试，或先登录后再刷新"
    />
  );
}

export function HomePage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as TabKey | null;
  const tab: TabKey = TABS.some((t) => t.key === raw)
    ? (raw as TabKey)
    : "recommend";

  function switchTab(next: TabKey) {
    setParams(next === "recommend" ? {} : { tab: next }, { replace: true });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          首页
        </h1>
        <div className="pill-tabs" role="tablist" aria-label="首页内容">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={`pill-tab${tab === item.key ? " active" : ""}`}
              onClick={() => switchTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "recommend" ? <RecommendFeed /> : null}
      {tab === "hot" ? <PopularFeed /> : null}
      {tab === "region" ? <RegionFeed /> : null}
      {tab === "dynamic" ? <DynamicFeedView /> : null}
    </div>
  );
}
