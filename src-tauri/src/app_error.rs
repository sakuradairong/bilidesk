use crate::bili::error::BiliError;
use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn message(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl From<BiliError> for AppError {
    fn from(err: BiliError) -> Self {
        Self {
            code: err.code().to_string(),
            message: err.to_string(),
        }
    }
}

impl From<String> for AppError {
    fn from(message: String) -> Self {
        Self::message(message)
    }
}

impl From<&str> for AppError {
    fn from(message: &str) -> Self {
        Self::message(message)
    }
}

pub type AppResult<T> = Result<T, AppError>;
