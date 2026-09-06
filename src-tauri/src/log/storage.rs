//! Decides which file on disk holds the print log.
//!
//! ADR 0004: the print log is one SQLite file per machine, so the history
//! screen shows every print run from that machine no matter which staff
//! account is logged in. The `platform` module names the machine-wide
//! directory for the operating system the app was built for.
//!
//! Some machines lock that directory down. When the app cannot write there it
//! falls back to the per-user app data directory and records that it did, so
//! the `storage_info` command can tell the operator where the log really is.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::LogError;

/// The name of the SQLite file, inside whichever directory the app settles on.
pub const DATABASE_FILE: &str = "din-replicator.sqlite";

/// The file the print log opened, and whether it is the machine-wide one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatabaseLocation {
    pub path: PathBuf,
    /// True when the file sits in the machine-wide directory ADR 0004 asks
    /// for. False when the app fell back to the per-user directory.
    pub machine_wide: bool,
}

impl DatabaseLocation {
    /// The same facts in the shape the `storage_info` command sends to the UI.
    pub fn info(&self) -> StorageInfo {
        StorageInfo {
            database_path: self.path.display().to_string(),
            machine_wide: self.machine_wide,
        }
    }
}

/// What the `storage_info` command returns.
///
/// The UI shows `databasePath` on the settings screen. When `machineWide` is
/// false the log covers only the logged-in staff account, which is worth
/// warning about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub database_path: String,
    pub machine_wide: bool,
}

/// Picks the directory to open the database in.
///
/// `machine_dir` wins whenever the app can create it and write inside it.
/// `user_dir` is the per-user fallback. The error names both paths, because
/// reaching it means neither directory took a file.
pub fn choose(machine_dir: &Path, user_dir: &Path) -> Result<DatabaseLocation, LogError> {
    if prepare(machine_dir).is_ok() {
        return Ok(DatabaseLocation {
            path: machine_dir.join(DATABASE_FILE),
            machine_wide: true,
        });
    }

    match prepare(user_dir) {
        Ok(()) => Ok(DatabaseLocation {
            path: user_dir.join(DATABASE_FILE),
            machine_wide: false,
        }),
        Err(reason) => Err(LogError::StorageUnavailable(format!(
            "could not write to {} or to {}: {reason}",
            machine_dir.display(),
            user_dir.display()
        ))),
    }
}

/// Creates `dir` if it is missing, then checks the app can write a file in it.
///
/// Creating the directory is not proof on its own. SQLite writes the journal
/// and the WAL file next to the database, so a directory that only allows
/// reads would fail later, in the middle of a print run. Writing and deleting
/// a probe file finds that out now.
fn prepare(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let probe = dir.join(".write-probe");
    fs::write(&probe, b"")?;
    let _ = fs::remove_file(&probe);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_machine_wide_directory_is_used_when_it_is_writable() {
        let machine = tempfile::tempdir().unwrap();
        let user = tempfile::tempdir().unwrap();

        let location = choose(machine.path(), user.path()).unwrap();

        assert!(location.machine_wide);
        assert_eq!(location.path, machine.path().join(DATABASE_FILE));
    }

    #[test]
    fn a_missing_machine_wide_directory_is_created() {
        let root = tempfile::tempdir().unwrap();
        let machine = root.path().join("DIN Replicator");

        let location = choose(&machine, root.path()).unwrap();

        assert!(location.machine_wide);
        assert!(machine.is_dir());
    }

    #[test]
    fn an_unwritable_machine_wide_directory_falls_back_to_the_user_directory() {
        let user = tempfile::tempdir().unwrap();
        // A file cannot become a directory, so create_dir_all fails on it.
        // That stands in for a locked-down machine-wide directory on a clinic
        // machine.
        let blocked = user.path().join("blocked");
        fs::write(&blocked, b"").unwrap();

        let location = choose(&blocked, user.path()).unwrap();

        assert!(!location.machine_wide);
        assert_eq!(location.path, user.path().join(DATABASE_FILE));
    }

    #[test]
    fn the_error_names_both_directories_when_neither_works() {
        let root = tempfile::tempdir().unwrap();
        let blocked = root.path().join("blocked");
        fs::write(&blocked, b"").unwrap();

        let error = choose(&blocked, &blocked).unwrap_err();

        assert_eq!(error.code(), "storage_unavailable");
        assert!(error.to_string().contains("blocked"));
    }

    #[test]
    fn storage_info_reports_the_path_as_a_string() {
        let location = DatabaseLocation {
            path: PathBuf::from("/Users/Shared/DIN Replicator").join(DATABASE_FILE),
            machine_wide: true,
        };

        let json = serde_json::to_value(location.info()).unwrap();

        assert_eq!(
            json["databasePath"],
            "/Users/Shared/DIN Replicator/din-replicator.sqlite"
        );
        assert_eq!(json["machineWide"], true);
    }
}
