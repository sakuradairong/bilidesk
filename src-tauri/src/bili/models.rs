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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoCard {
    pub bvid: String,
    pub title: String,
    pub cover: String,
    pub owner: String,
    pub duration: i64,
    pub views: i64,
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
pub struct PlayerProgress {
    pub time: f64,
    pub duration: f64,
    pub paused: bool,
    pub volume: i64,
}

#[derive(Debug, Clone)]
pub struct StreamChoice {
    pub quality: i64,
    pub desc: String,
    pub codecs: String,
    pub video_url: String,
    pub audio_url: Option<String>,
}
