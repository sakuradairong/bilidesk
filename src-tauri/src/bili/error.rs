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
        let mut msg = err.to_string();
        let mut source = std::error::Error::source(&err);
        while let Some(inner) = source {
            msg.push_str(" <- ");
            msg.push_str(&inner.to_string());
            source = inner.source();
        }
        Self::Network(msg)
    }
}

impl Serialize for BiliError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type BiliResult<T> = Result<T, BiliError>;
