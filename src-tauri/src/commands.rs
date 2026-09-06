//! The Tauri commands the React UI calls.
//!
//! Every command returns either its value or an error, which the UI receives
//! as `{"code": "...", "message": "..."}`. The UI branches on `code`. Printer
//! commands fail with a [`PrinterError`] and print log commands with a
//! [`LogError`].
//!
//! The print log is Tauri managed state, taken by every log command below as
//! `log`. It holds one database opened at startup. When that open failed, the
//! app still runs and each of those commands returns the `storage_unavailable`
//! code with the reason, which the UI shows while it refuses to print.

use tauri::State;

use crate::log::storage::StorageInfo;
use crate::log::{LogError, LogState, NewPrintRun, NewVerification, PrintRun, PrintRunQuery};
use crate::printer::{
    self, PrintReceipt, PrinterError, PrinterInfo, PrinterState, PrinterTransport,
};
use crate::settings::Settings;

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

/// Records a print run that has already gone to the printer.
///
/// The UI calls `print_zpl` first and this afterwards, with the job id the
/// queue gave back. Recording after the fact keeps the log to print runs that
/// really reached a queue.
///
/// `input` carries what the UI knows: the DIN, the barcode payload, the copy
/// count, the printer, the job id, and the ZPL. The log fills in the operator,
/// the machine name, and the time.
#[tauri::command]
pub fn record_print_run(
    log: State<'_, LogState>,
    input: NewPrintRun,
) -> Result<PrintRun, LogError> {
    log.store()?.record_print_run(input)
}

/// Records the scan of a freshly printed replica against the print run that
/// produced it, and returns that print run with the verification attached.
///
/// The UI decides whether the scan matched, because comparing a scan against a
/// barcode payload is ISBT 128 work and lives in `src/lib/isbt128/`.
#[tauri::command]
pub fn record_verification(
    log: State<'_, LogState>,
    input: NewVerification,
) -> Result<PrintRun, LogError> {
    log.store()?.record_verification(input)
}

/// The print runs the history screen shows, newest first.
///
/// `query.din` narrows the list to DINs that start with the text the operator
/// typed. `query.limit` and `query.offset` page through the result.
#[tauri::command]
pub fn list_print_runs(
    log: State<'_, LogState>,
    query: PrintRunQuery,
) -> Result<Vec<PrintRun>, LogError> {
    log.store()?.list_print_runs(query)
}

/// One print run by id, for the screen that shows a single print run.
#[tauri::command]
pub fn get_print_run(log: State<'_, LogState>, id: i64) -> Result<PrintRun, LogError> {
    log.store()?.print_run(id)
}

/// The settings this machine remembers, with defaults for anything never set.
#[tauri::command]
pub fn get_settings(log: State<'_, LogState>) -> Result<Settings, LogError> {
    log.store()?.settings()
}

/// Replaces the settings this machine remembers, and returns what was stored.
#[tauri::command]
pub fn set_settings(log: State<'_, LogState>, settings: Settings) -> Result<Settings, LogError> {
    log.store()?.set_settings(settings)
}

/// Which file holds the print log, and whether it is the machine-wide one.
///
/// ADR 0004 wants one log per machine. When `machineWide` is false the app
/// could not write to the machine-wide directory and fell back to a per-user
/// file, so the history screen shows only this login's print runs. The UI says
/// so, and the path tells a support person where to look.
///
/// When `unavailable` is set there is no print log at all and it holds the
/// reason. The UI shows that reason and refuses to print, because a print run
/// that cannot be recorded must not happen. This command answers in every
/// case, so the UI can always say what is wrong.
#[tauri::command]
pub fn storage_info(log: State<'_, LogState>) -> StorageInfo {
    log.storage_info()
}
