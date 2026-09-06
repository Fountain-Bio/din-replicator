//! The Windows print path.
//!
//! ADR 0003 rules out taking the USB device away from the Zebra driver, so
//! this module goes through the Windows spooler.
//!
//! The module splits in two because only half of it is Windows-only.
//! [`status`] turns the spooler's status flags into a `PrinterState`, which is
//! arithmetic over two integers, so it compiles everywhere and its tests run
//! under `cargo test` on the Mac the app is developed on. [`spooler`] makes the
//! Win32 calls and is compiled only on Windows.

pub mod status;

#[cfg(target_os = "windows")]
mod spooler;

#[cfg(target_os = "windows")]
pub use spooler::Spooler;
