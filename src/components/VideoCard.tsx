import { mediaSrc } from "@/media";
import type { VideoCard as VideoCardType } from "@/types";

export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = m.toString().padStart(2, "0");
    const ss = s.toString().padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatViews(views: number): string {
    if (!views) return "";
    if (views >= 10000) return `${(views / 10000).toFixed(1)}万`;
    return String(views);
}

type Props = {
    item: VideoCardType;
    onOpen: (bvid: string) => void;
    rank?: number;
};

export function VideoCard({ item, onOpen, rank }: Props) {
    const cover = item.cover ? mediaSrc(item.cover) : "";

    return (
        <button
            type="button"
            className="video-card group text-left"
            onClick={() => onOpen(item.bvid)}
            aria-label={`${rank ? `第 ${rank} 名，` : ""}${item.title}`}
        >
            <div className="relative aspect-video overflow-hidden bg-muted">
                {cover ? (
                    <img
                        src={cover}
                        alt=""
                        className="size-full object-cover transition duration-300 group-hover:scale-[1.03]"
                        loading="lazy"
                        onError={(event) => event.currentTarget.remove()}
                    />
                ) : null}
                {item.duration > 0 ? (
                    <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[11px] text-white backdrop-blur-sm">
                        {formatDuration(item.duration)}
                    </span>
                ) : null}
                {rank ? (
                    <span className={`video-rank${rank <= 3 ? " is-top" : ""}`}>
                        {rank}
                    </span>
                ) : null}
            </div>
            <div className="video-card-meta">
                {cover ? (
                    <img
                        src={cover}
                        alt=""
                        aria-hidden="true"
                        className="video-card-tint"
                    />
                ) : null}
                <div className="video-card-scrim" />
                <div className="relative flex min-h-[88px] flex-col justify-between gap-2 p-3">
                    <div className="line-clamp-2 text-sm font-semibold leading-snug">
                        {item.title}
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                        {item.owner_face ? (
                            <img
                                src={mediaSrc(item.owner_face)}
                                alt=""
                                className="size-6 shrink-0 rounded-full object-cover ring-1 ring-white/40"
                                loading="lazy"
                            />
                        ) : (
                            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-background/55 text-[10px] font-semibold">
                                {item.owner.slice(0, 1) || "UP"}
                            </span>
                        )}
                        <span className="min-w-0 flex-1 truncate text-xs text-foreground/70">
                            {item.owner || "未知 UP 主"}
                        </span>
                        {item.views > 0 ? (
                            <span className="shrink-0 text-[11px] tabular-nums text-foreground/60">
                                {formatViews(item.views)}播放
                            </span>
                        ) : null}
                    </div>
                </div>
            </div>
        </button>
    );
}
