import type { VideoCard } from "../types";

type Props = {
  card: VideoCard;
  onOpen: (bvid: string) => void;
};

export function VideoCardView({ card, onOpen }: Props) {
  return (
    <button className="card" onClick={() => onOpen(card.bvid)}>
      <div className="cover">
        {card.cover ? <img src={card.cover} alt="" /> : null}
        <span className="duration">{formatDuration(card.duration)}</span>
      </div>
      <div className="card-body">
        <h3>{card.title}</h3>
        <div className="meta">
          {card.owner} · {formatViews(card.views)}
        </div>
      </div>
    </button>
  );
}

export function formatDuration(total: number): string {
  if (!total || total < 0) return "00:00";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  const body = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${body}` : body;
}

export function formatViews(views: number): string {
  if (views >= 10000) {
    return `${(views / 10000).toFixed(1)}万播放`;
  }
  return `${views || 0}播放`;
}
