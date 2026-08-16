export type Profile = {
  is_login: boolean;
  mid: number;
  name: string;
  face: string;
  vip: boolean;
};

export type QrStart = {
  url: string;
  qrcode_key: string;
};

export type QrPoll = {
  status: "pending" | "scanned" | "confirmed" | "expired" | string;
  profile: Profile | null;
};

export type VideoCard = {
  bvid: string;
  title: string;
  cover: string;
  owner: string;
  duration: number;
  views: number;
};

export type SearchResult = {
  items: VideoCard[];
  page: number;
};

export type VideoPage = {
  cid: number;
  page: number;
  part: string;
  duration: number;
};

export type VideoDetail = {
  bvid: string;
  aid: number;
  title: string;
  cover: string;
  desc: string;
  owner: string;
  duration: number;
  pages: VideoPage[];
};

export type QualityOption = {
  quality: number;
  desc: string;
  codecs: string;
};

export type PlaySession = {
  bvid: string;
  title: string;
  cid: number;
  pages: VideoPage[];
  qualities: QualityOption[];
  current_quality: number;
};

export type HistoryItem = {
  bvid: string;
  title: string;
  cover: string;
  owner: string;
  viewed_at: number;
};

export type PlayerProgress = {
  time: number;
  duration: number;
  paused: boolean;
  volume: number;
};

export type PageId = "home" | "search" | "history";
