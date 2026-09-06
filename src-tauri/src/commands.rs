//! The Tauri commands the React UI calls.
//!
//! Every command returns either its value or a [`PrinterError`], which the UI
//! receives as `{"code": "...", "message": "..."}`. The UI branches on `code`.

use crate::printer::{
    self, PrintReceipt, PrinterError, PrinterInfo, PrinterState, PrinterTransport,
};

/// Every printer installed on this machine, with its current state.
///
/// The `is_zebra` field marks the queues a replica can actually print on, so
/// the UI can put them first.
#[tauri::command]
pub fn list_printers() -> Result<Vec<PrinterInfo>, PrinterError> {
    printer::transport().list_printers()
}

/// The state of one printer, read fresh from the print queue.
#[tauri::command]
pub fn printer_state(name: String) -> Result<PrinterState, PrinterError> {
    printer::transport().printer_state(&name)
}

/// Sends one replica's ZPL to a printer.
///
/// `title` is the job name that shows up in the operating system's print
/// queue window. Putting the DIN in it lets an operator tell one job from
/// another there.
///
/// ADR 0003: the app reads the queue before every print run and refuses to
/// submit when the printer is not ready. A job handed to a paused or offline
/// queue would sit there and print later, with nobody watching to catch the
/// replica.
#[tauri::command]
pub fn print_zpl(name: String, zpl: String, title: String) -> Result<PrintReceipt, PrinterError> {
    let transport = printer::transport();

    let state = transport.printer_state(&name)?;
    if state != PrinterState::Ready {
        return Err(PrinterError::PrinterNotReady(state));
    }

    transport.print_raw(&name, zpl.as_bytes(), &title)
}
