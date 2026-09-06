//! Turns the Windows spooler's status flags into a [`PrinterState`].
//!
//! The Win32 calls that read those flags only exist on Windows, but the
//! mapping is arithmetic on two integers. It lives here, apart from the calls,
//! so it compiles and runs under `cargo test` on macOS as well.
//!
//! The flag values are copied from the `windows` crate. `spooler.rs` asserts
//! at compile time that the copies still match, so the Windows build fails if
//! they ever drift.

use super::{fault, PrinterState};

/// An operator or the system paused the queue.
pub const PRINTER_STATUS_PAUSED: u32 = 0x0000_0001;
/// The printer reports a fault it does not describe further.
pub const PRINTER_STATUS_ERROR: u32 = 0x0000_0002;
/// Label stock is jammed inside the printer.
pub const PRINTER_STATUS_PAPER_JAM: u32 = 0x0000_0008;
/// The printer has run out of label stock.
pub const PRINTER_STATUS_PAPER_OUT: u32 = 0x0000_0010;
/// The spooler cannot reach the printer.
pub const PRINTER_STATUS_OFFLINE: u32 = 0x0000_0080;
/// The printer's cover is open.
pub const PRINTER_STATUS_DOOR_OPEN: u32 = 0x0040_0000;
/// Set in the printer's attributes, not its status, when someone ticked "Use
/// Printer Offline" in Windows. Jobs pile up in the queue while it is set.
pub const PRINTER_ATTRIBUTE_WORK_OFFLINE: u32 = 0x0000_0400;

/// Reads a printer's state out of the `Status` and `Attributes` fields of a
/// `PRINTER_INFO_2W`.
///
/// The spooler can set several flags at once. The order here reports the
/// condition an operator has to fix first: a printer nobody can reach, then a
/// specific fault at the printer, then a paused queue. Any flag this function
/// does not name leaves the printer ready, because the rest of the flag set
/// describes normal work such as printing, warming up, or waiting.
pub fn state_from_flags(status: u32, attributes: u32) -> PrinterState {
    if status & PRINTER_STATUS_OFFLINE != 0 || attributes & PRINTER_ATTRIBUTE_WORK_OFFLINE != 0 {
        return PrinterState::Offline;
    }
    if status & PRINTER_STATUS_PAPER_OUT != 0 {
        return PrinterState::Error(fault::MEDIA_EMPTY.to_string());
    }
    if status & PRINTER_STATUS_PAPER_JAM != 0 {
        return PrinterState::Error(fault::MEDIA_JAM.to_string());
    }
    if status & PRINTER_STATUS_DOOR_OPEN != 0 {
        return PrinterState::Error(fault::DOOR_OPEN.to_string());
    }
    if status & PRINTER_STATUS_ERROR != 0 {
        return PrinterState::Error(fault::OTHER.to_string());
    }
    if status & PRINTER_STATUS_PAUSED != 0 {
        return PrinterState::Paused;
    }
    PrinterState::Ready
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A healthy Zebra sitting idle: the spooler clears every flag.
    #[test]
    fn no_flags_means_ready() {
        assert_eq!(state_from_flags(0, 0), PrinterState::Ready);
    }

    /// PRINTER_STATUS_PRINTING (0x0400) is set while a job runs. That is
    /// normal work, so the printer stays ready for the next print run.
    #[test]
    fn printing_is_still_ready() {
        assert_eq!(state_from_flags(0x0000_0400, 0), PrinterState::Ready);
    }

    #[test]
    fn paused_status_maps_to_paused() {
        assert_eq!(
            state_from_flags(PRINTER_STATUS_PAUSED, 0),
            PrinterState::Paused
        );
    }

    #[test]
    fn offline_status_maps_to_offline() {
        assert_eq!(
            state_from_flags(PRINTER_STATUS_OFFLINE, 0),
            PrinterState::Offline
        );
    }

    #[test]
    fn the_work_offline_attribute_maps_to_offline() {
        assert_eq!(
            state_from_flags(0, PRINTER_ATTRIBUTE_WORK_OFFLINE),
            PrinterState::Offline
        );
    }

    #[test]
    fn media_faults_map_to_the_shared_fault_names() {
        assert_eq!(
            state_from_flags(PRINTER_STATUS_PAPER_OUT, 0),
            PrinterState::Error(fault::MEDIA_EMPTY.into())
        );
        assert_eq!(
            state_from_flags(PRINTER_STATUS_PAPER_JAM, 0),
            PrinterState::Error(fault::MEDIA_JAM.into())
        );
        assert_eq!(
            state_from_flags(PRINTER_STATUS_DOOR_OPEN, 0),
            PrinterState::Error(fault::DOOR_OPEN.into())
        );
        assert_eq!(
            state_from_flags(PRINTER_STATUS_ERROR, 0),
            PrinterState::Error(fault::OTHER.into())
        );
    }

    /// Windows sets PRINTER_STATUS_PAUSED alongside a fault often enough that
    /// the order matters. The fault is what an operator has to go and fix.
    #[test]
    fn a_fault_outranks_a_paused_queue() {
        assert_eq!(
            state_from_flags(PRINTER_STATUS_PAUSED | PRINTER_STATUS_PAPER_OUT, 0),
            PrinterState::Error(fault::MEDIA_EMPTY.into())
        );
    }

    /// An unplugged printer reports offline and a fault at the same time.
    /// Nothing can be diagnosed at the printer until it is reachable again.
    #[test]
    fn offline_outranks_a_fault() {
        assert_eq!(
            state_from_flags(PRINTER_STATUS_OFFLINE | PRINTER_STATUS_ERROR, 0),
            PrinterState::Offline
        );
    }
}
