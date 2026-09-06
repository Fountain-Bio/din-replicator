//! macOS paths and file permissions.

use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

/// The mode a shared directory gets: every account may list it and create
/// files in it.
const SHARED_DIRECTORY_MODE: u32 = 0o777;

/// The mode a shared file gets: every account may read and write it.
const SHARED_FILE_MODE: u32 = 0o666;

/// The directory every local account on this Mac can read and write app data
/// in.
///
/// ADR 0004 keeps the print log in one file per machine. macOS has no
/// system-wide application data directory the way Windows does, so the app
/// uses `/Users/Shared`, which is the directory macOS creates for exactly
/// this: files that belong to the machine rather than to one login.
pub fn machine_wide_data_dir() -> PathBuf {
    Path::new("/Users/Shared").join("DIN Replicator")
}

/// Opens `path` up to every account on this Mac.
///
/// A file or directory is created with the permissions the process umask
/// allows, which on a stock Mac is 755 for a directory and 644 for a file.
/// Those belong to whoever launched the app first, so the next staff account
/// to log in could not write the print log and would end up with a private
/// one. Setting the mode explicitly ignores the umask and gives every account
/// the same rights.
///
/// SQLite copies the database file's mode onto the `-wal` and `-shm` files it
/// creates beside it, so relaxing the database file covers those too.
pub fn make_shared(path: &Path) -> io::Result<()> {
    let mode = if fs::metadata(path)?.is_dir() {
        SHARED_DIRECTORY_MODE
    } else {
        SHARED_FILE_MODE
    };
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The permission bits of `path`, without the file type bits that
    /// `PermissionsExt::mode` also carries.
    fn mode(path: &Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn the_data_directory_sits_under_users_shared() {
        assert_eq!(
            machine_wide_data_dir(),
            PathBuf::from("/Users/Shared/DIN Replicator")
        );
    }

    #[test]
    fn a_shared_directory_lets_every_account_create_files_in_it() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("DIN Replicator");
        fs::create_dir_all(&directory).unwrap();

        make_shared(&directory).unwrap();

        assert_eq!(mode(&directory), 0o777);
    }

    #[test]
    fn a_shared_file_lets_every_account_write_it() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("din-replicator.sqlite");
        fs::write(&file, b"").unwrap();

        make_shared(&file).unwrap();

        assert_eq!(mode(&file), 0o666);
    }

    #[test]
    fn sharing_something_that_is_not_there_fails() {
        let root = tempfile::tempdir().unwrap();

        assert!(make_shared(&root.path().join("missing")).is_err());
    }
}
