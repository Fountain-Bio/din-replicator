//! The print run as it travels between the UI and the print log, and the
//! checks a print run has to pass before the log will store it.

use serde::{Deserialize, Serialize};

use super::LogError;

/// One print run as the UI reads it back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintRun {
    pub id: i64,
    /// The 13-character donation identification number the replicas carry.
    pub din: String,
    /// The 16-character barcode payload that went into the barcode.
    pub payload: String,
    /// How many replicas this print run asked for.
    pub copy_count: u32,
    /// The print queue the replicas went to, as the operating system names it.
    pub printer_name: String,
    /// The queue's own job identifier. Some queues do not report one.
    pub job_id: Option<String>,
    /// The operating system user name of the operator who ran the print run.
    pub operator_user: String,
    /// The name of the computer the print run came from, as a person sees it
    /// in the operating system's settings.
    pub hostname: String,
    /// When the print run went to the queue, as an RFC 3339 timestamp in UTC.
    pub printed_at: String,
    /// The exact ZPL sent to the printer, kept so a replica can be traced back
    /// to the bytes that produced it.
    pub zpl: String,
    /// The most recent verification of this print run, or null when nobody has
    /// scanned a replica from it yet.
    pub verification: Option<Verification>,
}

/// The result of scanning a freshly printed replica.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    /// The barcode payload the scanner read off the replica.
    pub scanned_payload: String,
    /// True when the scanned payload matches the payload that was printed.
    pub matched: bool,
    /// When the scan happened, as an RFC 3339 timestamp in UTC.
    pub verified_at: String,
}

/// What `record_print_run` takes.
///
/// The operator, the machine name, and the time are missing on purpose. The
/// log fills those in itself so the UI cannot claim a print run happened at
/// another time or under another login.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPrintRun {
    pub din: String,
    pub payload: String,
    pub copy_count: u32,
    pub printer_name: String,
    pub job_id: Option<String>,
    pub zpl: String,
}

/// What `record_verification` takes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewVerification {
    pub print_run_id: i64,
    pub scanned_payload: String,
    pub matched: bool,
}

/// What `list_print_runs` takes. Every field is optional, so an empty object
/// asks for the newest [`super::store::DEFAULT_LIMIT`] print runs.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintRunQuery {
    /// Keeps only print runs whose DIN starts with this text, so the history
    /// screen narrows as the operator types part of a DIN.
    pub din: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

impl NewPrintRun {
    /// Trims the text fields and rejects a print run the log cannot describe.
    pub(super) fn checked(mut self) -> Result<Self, LogError> {
        self.din = self.din.trim().to_string();
        self.payload = self.payload.trim().to_string();
        self.printer_name = self.printer_name.trim().to_string();

        if self.din.is_empty() {
            return Err(LogError::InvalidInput("a print run needs a DIN".into()));
        }
        if self.payload.is_empty() {
            return Err(LogError::InvalidInput(
                "a print run needs the barcode payload that was printed".into(),
            ));
        }
        if self.printer_name.is_empty() {
            return Err(LogError::InvalidInput(
                "a print run needs the name of the printer it went to".into(),
            ));
        }
        if self.copy_count == 0 {
            return Err(LogError::InvalidInput(
                "a print run with a copy count of zero printed nothing".into(),
            ));
        }
        Ok(self)
    }
}

impl NewVerification {
    /// Trims the scanned payload and rejects an empty scan.
    pub(super) fn checked(mut self) -> Result<Self, LogError> {
        self.scanned_payload = self.scanned_payload.trim().to_string();

        if self.scanned_payload.is_empty() {
            return Err(LogError::InvalidInput(
                "a verification needs the payload the scanner read".into(),
            ));
        }
        Ok(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command_error::CommandError;

    /// A print run for the real label the ISBT 128 tests use.
    fn new_print_run() -> NewPrintRun {
        NewPrintRun {
            din: "W483626000011".into(),
            payload: "=W48362600001100".into(),
            copy_count: 3,
            printer_name: "Lab_Printer".into(),
            job_id: Some("42".into()),
            zpl: "^XA^XZ".into(),
        }
    }

    #[test]
    fn surrounding_space_is_trimmed_off_the_text_fields() {
        let checked = NewPrintRun {
            din: "  W483626000011 ".into(),
            payload: " =W48362600001100 ".into(),
            printer_name: " Lab_Printer ".into(),
            ..new_print_run()
        }
        .checked()
        .unwrap();

        assert_eq!(checked.din, "W483626000011");
        assert_eq!(checked.payload, "=W48362600001100");
        assert_eq!(checked.printer_name, "Lab_Printer");
    }

    #[test]
    fn a_print_run_without_a_din_is_refused() {
        let error = NewPrintRun {
            din: "   ".into(),
            ..new_print_run()
        }
        .checked()
        .unwrap_err();

        assert_eq!(error.code(), "invalid_input");
    }

    #[test]
    fn a_print_run_without_a_payload_is_refused() {
        let error = NewPrintRun {
            payload: String::new(),
            ..new_print_run()
        }
        .checked()
        .unwrap_err();

        assert_eq!(error.code(), "invalid_input");
    }

    #[test]
    fn a_print_run_without_a_printer_is_refused() {
        let error = NewPrintRun {
            printer_name: String::new(),
            ..new_print_run()
        }
        .checked()
        .unwrap_err();

        assert_eq!(error.code(), "invalid_input");
    }

    #[test]
    fn a_copy_count_of_zero_is_refused() {
        let error = NewPrintRun {
            copy_count: 0,
            ..new_print_run()
        }
        .checked()
        .unwrap_err();

        assert_eq!(error.code(), "invalid_input");
    }

    #[test]
    fn a_verification_without_a_scanned_payload_is_refused() {
        let error = NewVerification {
            print_run_id: 1,
            scanned_payload: "  ".into(),
            matched: true,
        }
        .checked()
        .unwrap_err();

        assert_eq!(error.code(), "invalid_input");
    }

    /// The UI reads the copy count as `copyCount`, so the wire name is part of
    /// what this struct promises.
    #[test]
    fn a_print_run_serialises_in_camel_case() {
        let json = serde_json::to_value(PrintRun {
            id: 1,
            din: "W483626000011".into(),
            payload: "=W48362600001100".into(),
            copy_count: 2,
            printer_name: "Lab_Printer".into(),
            job_id: Some("42".into()),
            operator_user: "operator".into(),
            hostname: "Front Desk Mac".into(),
            printed_at: "2026-09-06T12:00:00.000Z".into(),
            zpl: "^XA^XZ".into(),
            verification: None,
        })
        .unwrap();

        assert_eq!(json["din"], "W483626000011");
        assert_eq!(json["copyCount"], 2);
        assert_eq!(json["printerName"], "Lab_Printer");
        assert_eq!(json["jobId"], "42");
        assert_eq!(json["operatorUser"], "operator");
        assert_eq!(json["printedAt"], "2026-09-06T12:00:00.000Z");
        assert!(json["verification"].is_null());
    }

    #[test]
    fn a_new_print_run_is_read_from_camel_case() {
        let input: NewPrintRun = serde_json::from_value(serde_json::json!({
            "din": "W483626000011",
            "payload": "=W48362600001100",
            "copyCount": 4,
            "printerName": "Lab_Printer",
            "jobId": null,
            "zpl": "^XA^XZ",
        }))
        .unwrap();

        assert_eq!(input.copy_count, 4);
        assert_eq!(input.job_id, None);
    }

    #[test]
    fn a_verification_serialises_in_camel_case() {
        let json = serde_json::to_value(Verification {
            scanned_payload: "=W48362600001100".into(),
            matched: true,
            verified_at: "2026-09-06T12:00:01.000Z".into(),
        })
        .unwrap();

        assert_eq!(json["scannedPayload"], "=W48362600001100");
        assert_eq!(json["matched"], true);
        assert_eq!(json["verifiedAt"], "2026-09-06T12:00:01.000Z");
    }
}
