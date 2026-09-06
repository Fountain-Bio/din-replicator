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
            database_path: Some(self.path.display().to_string()),
            machine_wide: self.machine_wide,
            unavailable: None,
        }
    }
}

/// What the `storage_info` command returns.
///
/// The UI shows `databasePath` on the settings screen. When `machineWide` is
/// false the log covers only the logged-in staff account, which is worth
/// warning about. When `unavailable` is set there is no log at all, and the
/// UI refuses to print, because a print run that cannot be recorded must not
/// happen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    /// The database file the app is using, or null when it has none.
    pub database_path: Option<String>,
    pub machine_wide: bool,
    /// Null while the print log works. Otherwise the reason it could not be
    /// opened, in words the UI can show as they are.
    pub unavailable: Option<String>,
}

impl StorageInfo {
    /// Reports that the app could not open a print log at all.
    pub fn unavailable(reason: String) -> Self {
        Self {
            database_path: None,
            machine_wide: false,
            unavailable: Some(reason),
        }
    }
}

/// Picks the directory to open the database in.
///
/// `machine_dir` wins whenever the app can create it and write inside it.
/// `user_dir` is the per-user fallback. The error names both paths, because
/// reaching it means neither directory took a file.
pub fn choose(machine_dir: &Path, user_dir: &Path) -> Result<DatabaseLocation, LogError> {
    if prepare(machine_dir, Sharing::EveryAccount).is_ok() {
        return Ok(DatabaseLocation {
            path: machine_dir.join(DATABASE_FILE),
            machine_wide: true,
        });
    }

    match prepare(user_dir, Sharing::ThisAccountOnly) {
        Ok(()) => Ok(DatabaseLocation {
            path: user_dir.join(DATABASE_FILE),
            machine_wide: false,
        }),
        Err(reason) => Err(LogError::StorageUnavailable(format!(
            "the print log has nowhere to live: could not write to {} or to {}: {reason}",
            machine_dir.display(),
            user_dir.display()
        ))),
    }
}

/// Who a directory is prepared for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Sharing {
    /// Every account on the machine, which is what the machine-wide directory
    /// is for.
    EveryAccount,
    /// Only the account running the app, which is all the per-user fallback
    /// ever serves.
    ThisAccountOnly,
}

/// Creates `dir` if it is missing, then checks the app can write a file in it.
///
/// A directory the app creates belongs to whoever launched the app first, so
/// for the machine-wide directory [`crate::platform::make_shared`] opens it up
/// to every account. Without that the next staff account to log in would fail
/// the probe and get its own private log, which is the failure ADR 0004 exists
/// to prevent, so a machine-wide directory the app just made and cannot share
/// counts as a directory that did not work.
///
/// Sharing runs only on the launch that created the directory. Widening a
/// directory another account owns is refused by the operating system, so an
/// app that tried it on every launch would fail here for every account except
/// the one that got there first, and hand all the others a private log. A
/// directory that is already there and already takes the probe file is one
/// this account can write, which is all the print log needs from it.
///
/// The per-user fallback is never shared. It holds one account's log by
/// design, so a machine where sharing fails would otherwise lose its last
/// working directory and the app would refuse to print for no good reason.
///
/// Creating the directory is not proof on its own. SQLite writes the journal
/// and the WAL file next to the database, so a directory that only allows
/// reads would fail later, in the middle of a print run. Writing and deleting
/// a probe file finds that out now.
fn prepare(dir: &Path, sharing: Sharing) -> io::Result<()> {
    let already_there = dir.is_dir();
    fs::create_dir_all(dir)?;
    if !already_there && sharing == Sharing::EveryAccount {
        crate::platform::make_shared(dir)?;
    }
    let probe = dir.join(probe_name());
    fs::write(&probe, b"")?;
    let _ = fs::remove_file(&probe);
    Ok(())
}

/// The name of the probe file this process writes to prove it can write in a
/// directory.
///
/// The process id is in the name so that each running app gets a name of its
/// own. A probe left behind by another account, by an app that was killed
/// between the write and the delete, belongs to that account and cannot be
/// overwritten by this one. A shared name would turn that leftover file into a
/// permanent false report that the directory is unwritable.
fn probe_name() -> String {
    format!(".write-probe-{}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command_error::CommandError;

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

    /// The permission bits of `path`, without the file type bits.
    #[cfg(unix)]
    fn mode(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;

        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[cfg(unix)]
    #[test]
    fn the_machine_wide_directory_is_opened_up_to_every_account() {
        let root = tempfile::tempdir().unwrap();
        let machine = root.path().join("DIN Replicator");

        let location = choose(&machine, &root.path().join("user")).unwrap();

        assert!(location.machine_wide);
        assert_eq!(mode(&machine), 0o777);
    }

    /// The second account to log in finds the directory already there. Its
    /// rights belong to the account that created it, and an attempt to widen
    /// them from another account is refused, so the app leaves them alone and
    /// lets the write probe answer the only question it has.
    #[cfg(unix)]
    #[test]
    fn a_machine_wide_directory_that_is_already_there_keeps_the_rights_it_has() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().unwrap();
        let machine = root.path().join("DIN Replicator");
        fs::create_dir_all(&machine).unwrap();
        fs::set_permissions(&machine, fs::Permissions::from_mode(0o755)).unwrap();

        let location = choose(&machine, &root.path().join("user")).unwrap();

        assert!(location.machine_wide);
        assert_eq!(mode(&machine), 0o755);
    }

    /// A probe file is deleted as soon as it is written, but an app that is
    /// killed in between leaves one behind. The next account cannot overwrite
    /// a file another account owns, so the name has to differ per process.
    #[test]
    fn a_probe_left_behind_by_another_process_does_not_block_the_check() {
        let machine = tempfile::tempdir().unwrap();
        let user = tempfile::tempdir().unwrap();
        let stale = machine.path().join(".write-probe-1");
        fs::write(&stale, b"").unwrap();
        // Read-only stands in for a file owned by another account, which this
        // account may not write either.
        let mut rights = fs::metadata(&stale).unwrap().permissions();
        rights.set_readonly(true);
        fs::set_permissions(&stale, rights).unwrap();

        let location = choose(machine.path(), user.path()).unwrap();

        assert!(location.machine_wide);
    }

    #[test]
    fn the_write_probe_is_named_after_this_process_and_is_removed_again() {
        let directory = tempfile::tempdir().unwrap();

        prepare(directory.path(), Sharing::ThisAccountOnly).unwrap();

        assert!(probe_name().contains(&std::process::id().to_string()));
        // The directory is empty again, so nothing was left for the next
        // account to trip over.
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn the_per_user_directory_keeps_the_permissions_a_new_directory_gets() {
        let root = tempfile::tempdir().unwrap();
        // A file cannot become a directory, so the machine-wide attempt fails
        // and the fallback runs.
        let blocked = root.path().join("blocked");
        fs::write(&blocked, b"").unwrap();
        let user = root.path().join("user");

        let location = choose(&blocked, &user).unwrap();

        assert!(!location.machine_wide);
        // A directory made the ordinary way, to compare against, because the
        // umask decides what permissions that gets.
        let ordinary = root.path().join("ordinary-directory");
        fs::create_dir_all(&ordinary).unwrap();
        assert_eq!(mode(&user), mode(&ordinary));
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
        // The expected string is built from the same PathBuf, because the two
        // platforms join paths with different separators.
        let path = PathBuf::from("/Users/Shared/DIN Replicator").join(DATABASE_FILE);
        let location = DatabaseLocation {
            path: path.clone(),
            machine_wide: true,
        };

        let json = serde_json::to_value(location.info()).unwrap();

        assert_eq!(json["databasePath"], path.display().to_string());
        assert_eq!(json["machineWide"], true);
        assert!(json["unavailable"].is_null());
    }

    #[test]
    fn storage_info_reports_a_log_the_app_could_not_open() {
        let json =
            serde_json::to_value(StorageInfo::unavailable("the disk is full".into())).unwrap();

        assert!(json["databasePath"].is_null());
        assert_eq!(json["machineWide"], false);
        assert_eq!(json["unavailable"], "the disk is full");
    }
}
