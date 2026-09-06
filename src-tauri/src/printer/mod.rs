//! Talks to the print queue that the Zebra printer is installed on.
//!
//! ADR 0003 decided that replicas go out as raw ZPL through the operating
//! system print queue: the CUPS queue on macOS and the spooler with the RAW
//! datatype on Windows. Nothing here opens the USB device, so the vendor
//! driver stays in charge of it.
//!
//! One trait, [`PrinterTransport`], covers both platforms. [`transport`]
//! returns the implementation for the platform the app was built for.

use std::fmt;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

// Platform code lives in a directory named for the platform.
#[cfg(target_os = "macos")]
mod macos;

// The Windows module is declared on every platform, and gates its own Win32
// half. The other half is the status-flag mapping, which is plain arithmetic
// and is tested wherever the app is built. Declaring the module publicly is
// what makes that mapping reachable on macOS.
pub mod windows;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
compile_error!("DIN Replicator prints through the macOS CUPS queue or the Windows spooler, so it builds only for those two platforms.");

/// The fault names that [`PrinterState::Error`] carries.
///
/// CUPS and the Windows spooler describe faults in their own vocabularies.
/// Both platform implementations translate into this one set, so the UI has a
/// single list of strings to write messages for.
pub mod fault {
    /// The printer has run out of label stock.
    pub const MEDIA_EMPTY: &str = "media-empty";
    /// Label stock is jammed inside the printer.
    pub const MEDIA_JAM: &str = "media-jam";
    /// The printer's cover is open.
    pub const DOOR_OPEN: &str = "door-open";
    /// The queue reports a fault but does not say which one.
    pub const OTHER: &str = "printer-error";
}

/// What the print queue reports about a printer right now.
///
/// Serialises as an object the UI can branch on, such as `{"kind": "ready"}`
/// or `{"kind": "error", "detail": "media-empty"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "snake_case")]
pub enum PrinterState {
    /// The queue takes jobs and the printer reports no fault.
    Ready,
    /// Someone stopped the queue. A job sent now would sit in it and wait.
    Paused,
    /// The queue cannot reach the printer.
    Offline,
    /// The printer reports a fault. The string is one of the [`fault`] names.
    Error(String),
    /// The queue answered in a form this app does not recognise.
    Unknown,
}

impl fmt::Display for PrinterState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Ready => write!(f, "ready"),
            Self::Paused => write!(f, "paused"),
            Self::Offline => write!(f, "offline"),
            Self::Error(reason) => write!(f, "reporting {reason}"),
            Self::Unknown => write!(f, "in an unknown state"),
        }
    }
}

/// One printer as the operating system lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PrinterInfo {
    /// The queue name. This is what every other call in this module takes.
    pub name: String,
    /// What the queue says the printer is, taken from whatever field the
    /// platform fills in. Can be empty.
    pub description: String,
    /// True when the name or the description names Zebra or the ZD411 model.
    /// A replica only comes out right on a Zebra, so the UI lists these first.
    pub is_zebra: bool,
    pub state: PrinterState,
}

/// What the queue gave back after it took a print run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PrintReceipt {
    /// The queue's own job identifier. Some queues do not report one.
    pub job_id: Option<String>,
}

/// Everything that can go wrong while reading or using a print queue.
///
/// Serialises as `{"code": "...", "message": "..."}`. The UI branches on
/// `code` and shows `message`.
#[derive(Debug, thiserror::Error)]
pub enum PrinterError {
    /// No queue on this machine goes by that name.
    #[error("no printer named \"{0}\" is installed on this machine")]
    PrinterNotFound(String),
    /// The queue exists but is in a state that would leave a replica sitting
    /// in the queue. ADR 0003 says the app refuses the print run.
    #[error("the printer is {0}, so nothing was sent to it")]
    PrinterNotReady(PrinterState),
    /// Asking the operating system for the list of printers, or for one
    /// printer's state, failed.
    #[error("could not read the print queue: {0}")]
    QueryFailed(String),
    /// The queue rejected the label data.
    #[error("the print queue would not take the job: {0}")]
    SpoolFailed(String),
}

impl PrinterError {
    /// The stable string the UI branches on. Message text may change; these
    /// do not.
    pub fn code(&self) -> &'static str {
        match self {
            Self::PrinterNotFound(_) => "printer_not_found",
            Self::PrinterNotReady(_) => "printer_not_ready",
            Self::QueryFailed(_) => "query_failed",
            Self::SpoolFailed(_) => "spool_failed",
        }
    }
}

impl Serialize for PrinterError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut object = serializer.serialize_struct("PrinterError", 2)?;
        object.serialize_field("code", self.code())?;
        object.serialize_field("message", &self.to_string())?;
        object.end()
    }
}

/// Reading and using the print queues on one machine.
///
/// None of these methods decides whether printing is allowed. The command
/// layer checks [`PrinterTransport::printer_state`] first and refuses the
/// print run when the printer is not [`PrinterState::Ready`].
pub trait PrinterTransport {
    /// Every printer the operating system knows about, in the order the
    /// operating system lists them.
    fn list_printers(&self) -> Result<Vec<PrinterInfo>, PrinterError>;

    /// The state of one printer, read fresh from the queue.
    fn printer_state(&self, name: &str) -> Result<PrinterState, PrinterError>;

    /// Hands `bytes` to the queue untouched, under the job name `title`.
    ///
    /// The bytes are ZPL. The queue must pass them through without turning
    /// them into anything else, which is what "raw" means on both platforms.
    ///
    /// The caller reads the state first and only then prints, so the printer
    /// can fault in the gap between the two. The app accepts that race. The
    /// gap is two operating system calls wide, and an operator is standing at
    /// the printer waiting for the replica, so a fault that lands inside it
    /// shows up as a label that did not come out.
    fn print_raw(
        &self,
        name: &str,
        bytes: &[u8],
        title: &str,
    ) -> Result<PrintReceipt, PrinterError>;
}

/// The print queue of the machine this build runs on.
#[cfg(target_os = "macos")]
pub fn transport() -> impl PrinterTransport {
    macos::Cups
}

/// The print queue of the machine this build runs on.
#[cfg(target_os = "windows")]
pub fn transport() -> impl PrinterTransport {
    windows::Spooler
}

/// True when any of `fields` names Zebra or the ZD411 model.
///
/// Callers pass whatever text the platform gives them: the queue name, a
/// description, a driver name, a device address. Queues on the clinic
/// machines are named things like `Lab_Zebra`, and both platforms report
/// the model somewhere, so a plain substring test finds them.
pub(crate) fn looks_like_zebra(fields: &[&str]) -> bool {
    fields.iter().any(|field| {
        let lowered = field.to_lowercase();
        lowered.contains("zebra") || lowered.contains("zd411")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zebra_is_found_by_queue_name() {
        assert!(looks_like_zebra(&["Lab_Zebra", ""]));
        assert!(looks_like_zebra(&["Zebra_Stock_Room", ""]));
    }

    #[test]
    fn zebra_is_found_by_model_in_a_description() {
        assert!(looks_like_zebra(&[
            "Label_Printer",
            "ZDesigner ZD411-300dpi ZPL"
        ]));
    }

    #[test]
    fn other_printers_are_not_zebras() {
        assert!(!looks_like_zebra(&[
            "Brother_HL_L2460DW",
            "ipp://192.0.2.16/printers/brother_stockroom_l2460"
        ]));
    }

    #[test]
    fn errors_serialise_as_a_code_and_a_message() {
        let error = PrinterError::PrinterNotReady(PrinterState::Error(fault::MEDIA_EMPTY.into()));
        let json: serde_json::Value = serde_json::to_value(&error).unwrap();
        assert_eq!(json["code"], "printer_not_ready");
        assert_eq!(
            json["message"],
            "the printer is reporting media-empty, so nothing was sent to it"
        );
    }

    #[test]
    fn states_serialise_with_a_kind_the_ui_can_branch_on() {
        assert_eq!(
            serde_json::to_value(PrinterState::Ready).unwrap(),
            serde_json::json!({ "kind": "ready" })
        );
        assert_eq!(
            serde_json::to_value(PrinterState::Error(fault::DOOR_OPEN.into())).unwrap(),
            serde_json::json!({ "kind": "error", "detail": "door-open" })
        );
    }
}
