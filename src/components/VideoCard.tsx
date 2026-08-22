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
};

export function VideoCard({ item, onOpen }: Props) {
    return (
        <button
            type="button"
            className="group flex flex-col gap-2 text-left transition-transform duration-200 hover:-translate-y-0.5"
            onClick={() => onOpen(item.bvid)}
        >
            <div className="relative aspect-video overflow-hidden rounded-2xl bg-muted shadow-md shadow-black/5 ring-1 ring-border/50">
                {item.cover ? (
                    <img
                        src={mediaSrc(item.cover)}
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
            </div>
            <div className="flex flex-col gap-0.5 px-0.5">
                <div className="line-clamp-2 text-sm font-medium leading-snug">
                    {item.title}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                    {item.owner}
                    {item.views > 0 ? ` · ${formatViews(item.views)}播放` : ""}
                </div>
            </div>
        </button>
    );
}
