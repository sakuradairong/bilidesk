import { VideoCardView } from "../components/VideoCard";
import type { VideoCard } from "../types";

type Props = {
  items: VideoCard[];
  loading: boolean;
  error: string;
  onOpen: (bvid: string) => void;
  onMore?: () => void;
};

export function VideoGridPage({ items, loading, error, onOpen, onMore }: Props) {
  return (
    <div>
      {error ? <p className="error-line">{error}</p> : null}
      {loading && items.length === 0 ? <p className="status-line">加载中…</p> : null}
      <div className="grid">
        {items.map((card, index) => (
          <VideoCardView key={`${card.bvid}-${index}`} card={card} onOpen={onOpen} />
        ))}
      </div>
      {onMore ? (
        <div style={{ marginTop: 16 }}>
          <button className="ghost-btn" onClick={onMore} disabled={loading}>
            {loading ? "加载中…" : "加载更多"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
