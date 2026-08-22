import { VideoCard } from "@/components/VideoCard";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { VideoCard as VideoCardType } from "@/types";

type Props = {
  items: VideoCardType[];
  loading: boolean;
  error: string;
  onOpen: (bvid: string) => void;
  onMore?: () => void;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  ranked?: boolean;
};

export function VideoGridPage({
  items,
  loading,
  error,
  onOpen,
  onMore,
  onRetry,
  emptyTitle = "暂无内容",
  emptyDescription,
  ranked = false,
}: Props) {
  if (error && items.length === 0) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }
  if (!loading && items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorState message={error} onRetry={onRetry} /> : null}
      <div className="video-grid">
        {items.map((item, index) => (
          <VideoCard
            key={`${item.bvid}-${item.cid ?? 0}-${index}`}
            item={item}
            onOpen={onOpen}
            rank={ranked ? index + 1 : undefined}
          />
        ))}
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={`sk-${i}`} className="flex flex-col gap-2">
                <Skeleton className="aspect-video w-full rounded-lg" />
                <Skeleton className="h-4 w-[80%]" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))
          : null}
      </div>
      {onMore ? (
        <div className="flex justify-center py-2">
          <Button variant="outline" disabled={loading} onClick={onMore}>
            {loading ? "加载中…" : "加载更多"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
