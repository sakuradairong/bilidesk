import { invoke } from "@tauri-apps/api/core";

import type {
  ArchiveRelation,
  CommentPage,
  HistoryItem,
  PlaySession,
  Profile,
  QrPoll,
  QrStart,
  SearchResult,
  VideoCard,
  VideoDetail,
} from "./types";

export type AppErrorPayload = {
  code?: string;
  message?: string;
};

export class AppError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AppError";
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (typeof err === "string") return new AppError("internal", err);
  if (err && typeof err === "object") {
    const payload = err as AppErrorPayload & { error?: string };
    if (payload.message) {
      return new AppError(payload.code || "internal", payload.message);
    }
    if (payload.error) {
      return new AppError("internal", payload.error);
    }
  }
  return new AppError("internal", err instanceof Error ? err.message : String(err));
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw toAppError(err);
  }
}

export async function authQrStart(): Promise<QrStart> {
  return call("auth_qr_start");
}

export async function authQrPoll(qrcodeKey: string): Promise<QrPoll> {
  return call("auth_qr_poll", { qrcodeKey });
}

export async function authLogout(): Promise<void> {
  return call("auth_logout");
}

export async function authMe(): Promise<Profile> {
  return call("auth_me");
}

export async function feedRecommend(freshIdx = 1): Promise<VideoCard[]> {
  return call("feed_recommend", { freshIdx });
}

export async function feedSelected(freshIdx = 1, freshType = 0): Promise<VideoCard[]> {
  return call("feed_selected", { freshIdx, freshType });
}

export async function feedSearch(keyword: string, page = 1): Promise<SearchResult> {
  return call("feed_search", { keyword, page });
}

export async function videoView(bvid: string): Promise<VideoDetail> {
  return call("video_view", { bvid });
}

export async function historyList(): Promise<HistoryItem[]> {
  return call("history_list");
}

export async function archiveRelation(aid: number): Promise<ArchiveRelation> {
  return call("archive_relation", { aid });
}

export async function archiveLike(aid: number, unlike = false): Promise<void> {
  return call("archive_like", { aid, unlike });
}

export async function archiveDislike(aid: number, cancel = false): Promise<void> {
  return call("archive_dislike", { aid, cancel });
}

export async function archiveCoin(aid: number): Promise<void> {
  return call("archive_coin", { aid });
}

export async function archiveFav(aid: number): Promise<void> {
  return call("archive_fav", { aid });
}

export async function danmakuSend(
  aid: number,
  cid: number,
  bvid: string,
  message: string,
  progressMs: number,
): Promise<void> {
  return call("danmaku_send", { aid, cid, bvid, message, progressMs });
}

export async function replyList(aid: number): Promise<CommentPage> {
  return call("reply_list", { aid });
}

export async function replyAdd(aid: number, message: string, parent?: number): Promise<void> {
  return call("reply_add", { aid, message, parent });
}

export async function playerOpen(
  bvid: string,
  cid?: number,
  quality?: number,
): Promise<PlaySession> {
  return call("player_open", { req: { bvid, cid, quality, scope: "player" } });
}

export async function playerOpenBackdrop(
  bvid: string,
  cid?: number,
  quality?: number,
): Promise<PlaySession> {
  return call("player_open", { req: { bvid, cid, quality, scope: "featured" } });
}

export async function playerStop(): Promise<void> {
  return call("player_stop", { scope: "player" });
}

export async function playerStopBackdrop(): Promise<void> {
  return call("player_stop", { scope: "featured" });
}

export async function playerTogglePause(): Promise<void> {
  return call("player_toggle_pause");
}

export async function playerSeek(seconds: number): Promise<void> {
  return call("player_seek", { seconds });
}

export async function playerSetVolume(volume: number): Promise<void> {
  return call("player_set_volume", { volume });
}

export async function playerSetSpeed(speed: number): Promise<void> {
  return call("player_set_speed", { speed });
}

export async function playerSetDanmaku(enabled: boolean): Promise<void> {
  return call("player_set_danmaku", { enabled });
}

export async function playerSetDanmakuPrefs(fontSize?: number, maxRows?: number): Promise<void> {
  return call("player_set_danmaku_prefs", {
    prefs: { font_size: fontSize, max_rows: maxRows },
  });
}

export async function playerSetBounds(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<void> {
  return call("player_set_bounds", { rect });
}

export async function settingsGetAll(): Promise<Record<string, string>> {
  return call("settings_get_all");
}

export async function settingsSet(key: string, value: string): Promise<void> {
  return call("settings_set", { patch: { key, value } });
}
