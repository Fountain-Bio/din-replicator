//! Windows paths.

use std::ffi::OsString;
use std::path::PathBuf;

/// Where Windows keeps application data that belongs to the machine rather
/// than to one login. This is the stock location; `program_data_dir` reads
/// the real one from the environment first.
const PROGRAM_DATA_FALLBACK: &str = r"C:\ProgramData";

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
}
