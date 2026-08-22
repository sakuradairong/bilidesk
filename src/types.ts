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
  aid?: number;
  cid?: number | null;
  owner_face?: string;
  mid?: number;
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
  owner_face?: string;
  owner_mid?: number;
  related?: VideoCard[];
  season_title?: string;
  like?: number;
  coin?: number;
  favorite?: number;
  share?: number;
  reply?: number;
};

export type ArchiveRelation = {
  liked: boolean;
  disliked: boolean;
  coin_count: number;
  faved: boolean;
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

export type CommentItem = {
  rpid: number;
  mid: number;
  name: string;
  face: string;
  message: string;
  like: number;
};

export type CommentPage = {
  items: CommentItem[];
  all_count: number;
};

export type FavFolder = {
  id: number;
  title: string;
};

export type TripleResult = {
  like: boolean;
  coin: boolean;
  fav: boolean;
};

export type WatchLaterItem = {
  bvid: string;
  aid: number;
  title: string;
  cover: string;
  owner: string;
  duration: number;
  progress: number;
  add_time: number;
};

export type UserSpace = {
  mid: number;
  name: string;
  face: string;
  sign: string;
  level: number;
  fans: number;
  archive_count: number;
  following: boolean;
};

export type UserVideoPage = {
  items: VideoCard[];
  page: number;
  total: number;
};

export type FavResourcePage = {
  items: VideoCard[];
  page: number;
  total: number;
  has_more: boolean;
};

export type DynamicCard = {
  dynamic_id: string;
  card: VideoCard;
  author_mid: number;
};

export type DynamicFeedPage = {
  items: DynamicCard[];
  offset: string;
  has_more: boolean;
};

export type PlayProgressRecord = {
  position: number;
  duration: number;
};

export type ThemeMode = "light" | "dark" | "system";
