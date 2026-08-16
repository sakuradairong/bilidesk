use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum BiliError {
    #[error("{0}")]
    Message(String),
    #[error("网络请求失败: {0}")]
    Network(String),
    #[error("接口返回异常: {0}")]
    Api(String),
    #[error("未找到可播放地址")]
    NoPlayUrl,
    #[error("IO: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
}

impl BiliError {
    pub fn msg(text: impl Into<String>) -> Self {
        Self::Message(text.into())
    }
}

impl From<reqwest::Error> for BiliError {
    fn from(err: reqwest::Error) -> Self {
        Self::Network(err.to_string())
    }
}

impl Serialize for BiliError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type BiliResult<T> = Result<T, BiliError>;
