import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { feedRecommend, toAppError } from "@/api";
import { Button } from "@/components/ui/button";
import { VideoGridPage } from "@/pages/VideoGridPage";
import { PopularFeed } from "@/pages/PopularPage";
import { RegionFeed } from "@/pages/RegionPage";
import { DynamicFeedView } from "@/pages/DynamicPage";
import { RankingFeed } from "@/pages/RankingPage";
import { openWatch } from "@/lib/watch";
import type { VideoCard } from "@/types";

const TABS = [
  { key: "recommend", label: "推荐" },
  { key: "hot", label: "热门" },
  { key: "ranking", label: "排行" },
  { key: "region", label: "分区" },
  { key: "dynamic", label: "动态" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const recommendCache: {
  items: VideoCard[];
  idx: number;
  initialized: boolean;
} = {
  items: [],
  idx: 1,
  initialized: false,
};

type RecommendFeedProps = {
  items: VideoCard[];
  idx: number;
  loading: boolean;
  error: string;
  load: (freshIdx: number, append?: boolean) => Promise<void>;
};

function RecommendFeed({
  items,
  idx,
  loading,
  error,
  load,
}: RecommendFeedProps) {
  const navigate = useNavigate();
  const location = useLocation();

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
  const [items, setItems] = useState<VideoCard[]>(() => recommendCache.items);
  const [idx, setIdx] = useState(() => recommendCache.idx);
  const [loading, setLoading] = useState(() => !recommendCache.initialized);
  const [error, setError] = useState("");
  const raw = params.get("tab") as TabKey | null;
  const tab: TabKey = TABS.some((t) => t.key === raw)
    ? (raw as TabKey)
    : "recommend";

  const loadRecommend = useCallback(
    async (freshIdx: number, append = false) => {
      setLoading(true);
      setError("");
      try {
        const next = await feedRecommend(freshIdx);
        setItems((previous) => {
          const seen = new Set(previous.map((entry) => entry.bvid));
          const merged = append
            ? [
                ...previous,
                ...next.filter((item) => item.bvid && !seen.has(item.bvid)),
              ]
            : next;
          recommendCache.items = merged;
          return merged;
        });
        recommendCache.idx = freshIdx;
        setIdx(freshIdx);
      } catch (err) {
        setError(toAppError(err).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (recommendCache.initialized) return;
    recommendCache.initialized = true;
    void loadRecommend(1);
  }, [loadRecommend]);

  function switchTab(next: TabKey) {
    setParams(next === "recommend" ? {} : { tab: next }, { replace: true });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="page-heading flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="page-eyebrow">DISCOVER</p>
          <h1 className="text-3xl font-bold tracking-tight">发现好内容</h1>
        </div>
        <div className="home-heading-actions">
          {tab === "recommend" ? (
            <Button
              type="button"
              variant="outline"
              className="home-refresh-button rounded-full"
              disabled={loading}
              onClick={() => void loadRecommend(idx + 1)}
            >
              <RefreshCw
                className={`size-4${loading ? " animate-spin" : ""}`}
                aria-hidden="true"
              />
              {loading ? "刷新中…" : "刷新推荐"}
            </Button>
          ) : null}
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
      </div>
      {tab === "recommend" ? (
        <RecommendFeed
          items={items}
          idx={idx}
          loading={loading}
          error={error}
          load={loadRecommend}
        />
      ) : null}
      {tab === "hot" ? <PopularFeed /> : null}
      {tab === "ranking" ? <RankingFeed /> : null}
      {tab === "region" ? <RegionFeed /> : null}
      {tab === "dynamic" ? <DynamicFeedView /> : null}
    </div>
  );
}
