//! The parts of the app that differ between macOS and Windows.
//!
//! Each platform gets its own file. This module picks one of them at compile
//! time and re-exports the same names from both, so the rest of the app calls
//! [`machine_wide_data_dir`] and [`make_shared`] without a `cfg` of its own.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
pub use macos::{machine_wide_data_dir, make_shared};
#[cfg(target_os = "windows")]
pub use windows::{machine_wide_data_dir, make_shared};
