//! macOS paths.

use std::path::{Path, PathBuf};

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_data_directory_sits_under_users_shared() {
        assert_eq!(
            machine_wide_data_dir(),
            PathBuf::from("/Users/Shared/DIN Replicator")
        );
    }
}
