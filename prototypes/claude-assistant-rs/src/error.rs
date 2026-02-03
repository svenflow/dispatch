//! Error types for claude-assistant

use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Contact not found: {0}")]
    ContactNotFound(String),

    #[error("Invalid chat ID: {0}")]
    InvalidChatId(String),

    #[error("Tmux error: {0}")]
    Tmux(String),

    #[error("Command failed: {0}")]
    CommandFailed(String),

    #[error("Parse error: {0}")]
    Parse(String),

    #[error("Config error: {0}")]
    Config(String),
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = Error::SessionNotFound("test-session".to_string());
        assert!(err.to_string().contains("test-session"));
    }

    #[test]
    fn test_error_from_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let err: Error = io_err.into();
        assert!(matches!(err, Error::Io(_)));
    }
}
