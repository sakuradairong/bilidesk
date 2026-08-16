import { invoke } from "@tauri-apps/api/core";
import type {
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

export async function authQrStart(): Promise<QrStart> {
  return invoke("auth_qr_start");
}

export async function authQrPoll(qrcodeKey: string): Promise<QrPoll> {
  return invoke("auth_qr_poll", { qrcodeKey });
}

export async function authLogout(): Promise<void> {
  return invoke("auth_logout");
}

export async function authMe(): Promise<Profile> {
  return invoke("auth_me");
}

export async function feedRecommend(freshIdx = 1): Promise<VideoCard[]> {
  return invoke("feed_recommend", { freshIdx });
}

export async function feedSelected(freshIdx = 1, freshType = 0): Promise<VideoCard[]> {
  return invoke("feed_selected", { freshIdx, freshType });
}

export async function feedSearch(keyword: string, page = 1): Promise<SearchResult> {
  return invoke("feed_search", { keyword, page });
}

export async function videoView(bvid: string): Promise<VideoDetail> {
  return invoke("video_view", { bvid });
}

export async function historyList(): Promise<HistoryItem[]> {
  return invoke("history_list");
}

export async function archiveLike(aid: number, unlike = false): Promise<void> {
  return invoke("archive_like", { aid, unlike });
}

export async function archiveDislike(aid: number, cancel = false): Promise<void> {
  return invoke("archive_dislike", { aid, cancel });
}

export async function archiveCoin(aid: number): Promise<void> {
  return invoke("archive_coin", { aid });
}

export async function archiveFav(aid: number): Promise<void> {
  return invoke("archive_fav", { aid });
}

export async function danmakuSend(
  aid: number,
  cid: number,
  bvid: string,
  message: string,
  progressMs: number,
): Promise<void> {
  return invoke("danmaku_send", { aid, cid, bvid, message, progressMs });
}

export async function replyList(aid: number): Promise<CommentPage> {
  return invoke("reply_list", { aid });
}

export async function replyAdd(aid: number, message: string, parent?: number): Promise<void> {
  return invoke("reply_add", { aid, message, parent });
}

export async function playerOpen(bvid: string, cid?: number, quality?: number): Promise<PlaySession> {
  return invoke("player_open", { req: { bvid, cid, quality } });
}

export async function playerStop(): Promise<void> {
  return invoke("player_stop");
}

export async function playerTogglePause(): Promise<void> {
  return invoke("player_toggle_pause");
}

export async function playerSeek(seconds: number): Promise<void> {
  return invoke("player_seek", { seconds });
}

export async function playerSetVolume(volume: number): Promise<void> {
  return invoke("player_set_volume", { volume });
}

export async function playerSetSpeed(speed: number): Promise<void> {
  return invoke("player_set_speed", { speed });
}

export async function playerSetDanmaku(enabled: boolean): Promise<void> {
  return invoke("player_set_danmaku", { enabled });
}

export async function playerSetDanmakuPrefs(fontSize?: number, maxRows?: number): Promise<void> {
  return invoke("player_set_danmaku_prefs", {
    prefs: { font_size: fontSize, max_rows: maxRows },
  });
}

export async function playerSetBounds(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<void> {
  return invoke("player_set_bounds", { rect });
}
