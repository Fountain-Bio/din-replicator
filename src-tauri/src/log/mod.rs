//! The print log: every print run the app has made on this machine, and the
//! verification scan that followed it.
//!
//! ADR 0004 makes the log machine-wide. One SQLite file holds it, the app
//! opens that file once at startup, and [`Store`] hands out the only
//! connection behind a mutex. The settings the UI remembers live in the same
//! file; see [`crate::settings`].
//!
//! Nothing here talks to a printer. The command layer prints first and records
//! the print run afterwards, so the log holds what really went to the queue.
//!
//! The work is split four ways. [`error`] holds the failures a command can
//! report, [`print_run`] the shapes that travel to and from the UI, [`store`]
//! the open database, and [`storage`] the question of which file on disk the
//! log lives in. [`schema`] holds the tables. This file keeps what the
//! commands reach for: [`LogState`] and the re-exports.

pub mod error;
pub mod print_run;
pub mod schema;
pub mod storage;
pub mod store;

pub use error::LogError;
pub use print_run::{NewPrintRun, NewVerification, PrintRun, PrintRunQuery, Verification};
pub use store::Store;

use storage::StorageInfo;

/// What the log records when the operating system will not name the operator
/// or the machine. A print run with a placeholder operator is better than a
/// print run that went unrecorded.
const UNKNOWN: &str = "unknown";

/// The print log as the commands see it: either an open log, or the reason the
/// app has none.
///
/// Opening the log can fail, for instance on a machine that allows the app
/// neither the machine-wide directory nor a per-user one. The app still starts
/// in that case, so the operator reads the reason on screen instead of
/// watching a window that never appears. Every log command then returns the
/// same `storage_unavailable` error, and the UI refuses to print on the
/// strength of it. ADR 0004 keeps the log so that a replica that was printed
/// is a replica that was recorded, and a print run nobody could record must
/// not happen.
#[derive(Debug)]
pub enum LogState {
    /// The print log is open and every command works.
    Open(Store),
    /// The reason the print log could not be opened, ready to hand back to
    /// the UI as many times as it asks.
    Unavailable(String),
}

impl LogState {
    /// Opens the print log this machine should use, keeping the reason when
    /// it cannot be opened.
    pub fn for_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Self {
        match Store::open_for_app(app) {
            Ok(store) => Self::Open(store),
            Err(failure) => Self::Unavailable(failure.to_string()),
        }
    }

    /// The open log, or the failure from startup repeated word for word.
    pub fn store(&self) -> Result<&Store, LogError> {
        match self {
            Self::Open(store) => Ok(store),
            Self::Unavailable(reason) => Err(LogError::StorageUnavailable(reason.clone())),
        }
    }

    /// Which file holds the print log, or why there is none.
    pub fn storage_info(&self) -> StorageInfo {
        match self {
            Self::Open(store) => store.storage_info(),
            Self::Unavailable(reason) => StorageInfo::unavailable(reason.clone()),
        }
    }
}

/// The operator: the operating system user name and the computer name.
///
/// The computer name is the one a person sets and reads: Sharing in System
/// Settings on macOS, and the computer name on Windows. The network host name
/// is a different string that DHCP and domain policy can change under the
/// machine, which would make two print runs from one machine look like print
/// runs from two.
///
/// Either question can go unanswered. The log stores a placeholder in that
/// case rather than refusing to record the print run.
fn operator() -> (String, String) {
    (
        whoami::username().unwrap_or_else(|_| UNKNOWN.into()),
        whoami::devicename().unwrap_or_else(|_| UNKNOWN.into()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command_error::CommandError;

    #[test]
    fn every_command_reports_the_reason_when_the_log_could_not_be_opened() {
        let state = LogState::Unavailable("the disk is full".into());

        let error = state.store().unwrap_err();

        assert_eq!(error.code(), "storage_unavailable");
        assert_eq!(error.to_string(), "the disk is full");
    }

    #[test]
    fn storage_info_carries_the_reason_the_log_could_not_be_opened() {
        let state = LogState::Unavailable("the disk is full".into());

        let info = state.storage_info();

        assert_eq!(info.unavailable.as_deref(), Some("the disk is full"));
        assert_eq!(info.database_path, None);
        assert!(!info.machine_wide);
    }

    #[test]
    fn an_open_log_reports_no_reason() {
        let state = LogState::Open(Store::open_in_memory());

        assert!(state.store().is_ok());
        assert_eq!(state.storage_info().unavailable, None);
    }

    /// The operating system answers on the machine the tests run on, so this
    /// only checks the log never hands the database an empty operator.
    #[test]
    fn the_operator_is_never_empty() {
        let (user, machine) = operator();

        assert!(!user.is_empty());
        assert!(!machine.is_empty());
    }
}
