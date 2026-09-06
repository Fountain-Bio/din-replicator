//! Windows paths and directory rights.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Where Windows keeps application data that belongs to the machine rather
/// than to one login. This is the stock location; `program_data_dir` reads
/// the real one from the environment first.
const PROGRAM_DATA_FALLBACK: &str = r"C:\ProgramData";

/// The well known security identifier of the local `Users` group, which every
/// account that can log in belongs to. The identifier is used rather than the
/// group name because the name is translated on a localized Windows.
const LOCAL_USERS_GROUP: &str = "*S-1-5-32-545";

/// Runs a helper program without opening a console window. The app is a
/// windowed program, so a console would flash on screen at startup.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The directory every account on this machine can read and write app data in.
///
/// ADR 0004 keeps the print log in one file per machine, because clinic staff
/// each have their own Windows login and the history screen has to show every
/// print run whoever is signed in.
pub fn machine_wide_data_dir() -> PathBuf {
    program_data_dir(std::env::var_os("ProgramData")).join("DIN Replicator")
}

/// Turns the value of the `ProgramData` environment variable into a path.
///
/// The variable is read rather than hard coded because a machine can put
/// ProgramData on another drive, and imaged clinic machines sometimes do.
fn program_data_dir(from_environment: Option<OsString>) -> PathBuf {
    from_environment
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(PROGRAM_DATA_FALLBACK))
}

/// Opens `path` up to every account on this machine.
///
/// A new directory under ProgramData is writable only by whoever created it,
/// so the next staff account to log in could not write the print log and would
/// end up with a private one. `icacls` grants the local `Users` group modify
/// rights, and the object and container inherit flags pass that grant down to
/// everything the app later creates in the directory.
///
/// Files need nothing of their own: the database, and the `-wal` and `-shm`
/// files SQLite creates beside it, inherit the directory's grant.
pub fn make_shared(path: &Path) -> io::Result<()> {
    if !fs::metadata(path)?.is_dir() {
        return Ok(());
    }

    let result = Command::new("icacls")
        .arg(path)
        .arg("/grant")
        .arg(format!("{LOCAL_USERS_GROUP}:(OI)(CI)M"))
        .creation_flags(CREATE_NO_WINDOW)
        .output()?;

    if result.status.success() {
        return Ok(());
    }

    Err(io::Error::other(format!(
        "icacls could not give every account rights to {}: {}",
        path.display(),
        String::from_utf8_lossy(&result.stderr).trim()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_environment_names_the_program_data_drive() {
        assert_eq!(
            program_data_dir(Some(OsString::from(r"D:\ProgramData"))),
            PathBuf::from(r"D:\ProgramData")
        );
    }

    #[test]
    fn a_missing_or_empty_variable_falls_back_to_the_c_drive() {
        assert_eq!(program_data_dir(None), PathBuf::from(r"C:\ProgramData"));
        assert_eq!(
            program_data_dir(Some(OsString::new())),
            PathBuf::from(r"C:\ProgramData")
        );
    }

    #[test]
    fn the_data_directory_is_named_after_the_app() {
        assert!(machine_wide_data_dir().ends_with("DIN Replicator"));
    }

    #[test]
    fn a_directory_the_app_just_made_can_be_shared() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("DIN Replicator");
        fs::create_dir_all(&directory).unwrap();

        make_shared(&directory).unwrap();
    }

    #[test]
    fn a_file_needs_no_grant_of_its_own() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("din-replicator.sqlite");
        fs::write(&file, b"").unwrap();

        make_shared(&file).unwrap();
    }

    #[test]
    fn sharing_something_that_is_not_there_fails() {
        let root = tempfile::tempdir().unwrap();

        assert!(make_shared(&root.path().join("missing")).is_err());
    }
}
