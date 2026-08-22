use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Profile {
    pub is_login: bool,
    pub mid: i64,
    pub name: String,
    pub face: String,
    pub vip: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrStart {
    pub url: String,
    pub qrcode_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrPoll {
    pub status: String,
    pub profile: Option<Profile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoCard {
    pub bvid: String,
    pub title: String,
    pub cover: String,
    pub owner: String,
    pub duration: i64,
    pub views: i64,
    #[serde(default)]
    pub aid: i64,
    #[serde(default)]
    pub cid: Option<i64>,
    #[serde(default)]
    pub owner_face: String,
    /// 作者 mid（动态卡片/空间跳转用，普通列表可能为 0）
    #[serde(default)]
    pub mid: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub items: Vec<VideoCard>,
    pub page: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoPage {
    pub cid: i64,
    pub page: i32,
    pub part: String,
    pub duration: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoDetail {
    pub bvid: String,
    pub aid: i64,
    pub title: String,
    pub cover: String,
    pub desc: String,
    pub owner: String,
    pub duration: i64,
    pub pages: Vec<VideoPage>,
    #[serde(default)]
    pub owner_face: String,
    #[serde(default)]
    pub owner_mid: i64,
    #[serde(default)]
    pub related: Vec<VideoCard>,
    #[serde(default)]
    pub season_title: String,
    #[serde(default)]
    pub like: i64,
    #[serde(default)]
    pub coin: i64,
    #[serde(default)]
    pub favorite: i64,
    #[serde(default)]
    pub share: i64,
    #[serde(default)]
    pub reply: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ArchiveRelation {
    pub liked: bool,
    pub disliked: bool,
    pub coin_count: i64,
    pub faved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityOption {
    pub quality: i64,
    pub desc: String,
    pub codecs: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaySession {
    pub bvid: String,
    pub title: String,
    pub cid: i64,
    pub pages: Vec<VideoPage>,
    pub qualities: Vec<QualityOption>,
    pub current_quality: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    pub bvid: String,
    pub title: String,
    pub cover: String,
    pub owner: String,
    pub viewed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentItem {
    pub rpid: i64,
    pub mid: i64,
    pub name: String,
    pub face: String,
    pub message: String,
    pub like: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentPage {
    pub items: Vec<CommentItem>,
    pub all_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavFolder {
    pub id: i64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TripleResult {
    pub like: bool,
    pub coin: bool,
    pub fav: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchLaterItem {
    pub bvid: String,
    pub aid: i64,
    pub title: String,
    pub cover: String,
    pub owner: String,
    pub duration: i64,
    pub progress: i64,
    pub add_time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSpace {
    pub mid: i64,
    pub name: String,
    pub face: String,
    pub sign: String,
    pub level: i32,
    pub fans: i64,
    pub archive_count: i64,
    pub following: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserVideoPage {
    pub items: Vec<VideoCard>,
    pub page: u32,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavResourcePage {
    pub items: Vec<VideoCard>,
    pub page: u32,
    pub total: i64,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicCard {
    pub dynamic_id: String,
    pub card: VideoCard,
    pub author_mid: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicFeedPage {
    pub items: Vec<DynamicCard>,
    pub offset: String,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayProgressRecord {
    pub position: f64,
    pub duration: f64,
}

#[derive(Debug, Clone)]
pub struct StreamChoice {
    pub quality: i64,
    pub desc: String,
    pub codecs: String,
    pub video_url: String,
    pub audio_url: Option<String>,
}
