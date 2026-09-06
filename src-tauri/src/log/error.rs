//! What a print log command hands back when it cannot do what was asked.

use crate::command_error::CommandError;

/// Everything that can go wrong while reading or writing the print log.
///
/// Serialises as `{"code": "...", "message": "..."}`, the shape every command
/// error shares. See [`crate::command_error`].
#[derive(Debug, thiserror::Error)]
pub enum LogError {
    /// The app has no database file to record print runs in. The message
    /// says which directories it tried and what stopped it.
    #[error("{0}")]
    StorageUnavailable(String),
    /// No print run in the log has that id.
    #[error("no print run in the log has the id {0}")]
    PrintRunNotFound(i64),
    /// The command was called with a value the log will not store, such as a
    /// copy count of zero.
    #[error("{0}")]
    InvalidInput(String),
    /// SQLite refused a statement, or the file is unreadable.
    #[error("the print log could not be read or written: {0}")]
    DatabaseFailed(String),
}

impl CommandError for LogError {
    /// The stable string the UI branches on. Message text may change; these
    /// do not.
    fn code(&self) -> &'static str {
        match self {
            Self::StorageUnavailable(_) => "storage_unavailable",
            Self::PrintRunNotFound(_) => "print_run_not_found",
            Self::InvalidInput(_) => "invalid_input",
            Self::DatabaseFailed(_) => "database_failed",
        }
    }
}

crate::serialize_as_command_error!(LogError);

impl From<rusqlite::Error> for LogError {
    fn from(error: rusqlite::Error) -> Self {
        Self::DatabaseFailed(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_serialise_as_a_code_and_a_message() {
        let json = serde_json::to_value(LogError::PrintRunNotFound(7)).unwrap();

        assert_eq!(json["code"], "print_run_not_found");
        assert_eq!(json["message"], "no print run in the log has the id 7");
    }
}
