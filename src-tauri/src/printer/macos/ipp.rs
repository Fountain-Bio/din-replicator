//! Asks CUPS what a queue is doing, in IPP.
//!
//! ADR 0003 makes the app read the queue before every print run and refuse to
//! print when the printer is not ready, so the state has to carry media faults
//! and an unreachable printer. `lpstat -p -l` used to print those as reason
//! lines under each queue. On macOS 26 it prints none, which leaves an empty
//! roll and an offline printer looking exactly like an idle one.
//!
//! CUPS still answers the question over IPP. `ipptool` ships with macOS, and
//! the `get-printer-attributes.test` file that ships beside it asks the local
//! CUPS for everything it knows about one queue. Three of those attributes say
//! what this app needs:
//!
//! - `printer-state`, which is `idle`, `processing`, or `stopped`.
//! - `printer-state-reasons`, which names the fault, such as `media-empty` or
//!   `offline-report`, and is `none` when there is nothing to report.
//! - `printer-is-accepting-jobs`, which is false for a queue that holds every
//!   new job.
//!
//! Everything that reads the output is a plain function over a string, so the
//! tests at the bottom of the file run against captured output.

use std::process::Command;

use crate::printer::{fault, PrinterState};

/// The IPP test client macOS ships. Named by full path because a bundled
/// `.app` does not always inherit a useful `PATH`.
const IPPTOOL: &str = "/usr/bin/ipptool";

/// The canned request that ships with CUPS. `ipptool` finds it in
/// `/usr/share/cups/ipptool` whatever the working directory is. It asks for
/// every attribute the queue has, which includes the three this app reads.
const GET_PRINTER_ATTRIBUTES: &str = "get-printer-attributes.test";

/// What CUPS says about the queue named `queue`, or `None` when `ipptool`
/// could not answer.
///
/// No answer means the program is missing, it could not reach CUPS, or the
/// queue does not exist. None of those is worth an error of its own: the
/// caller falls back to reading `lpstat`, which knows whether the queue is
/// there.
pub fn printer_state(queue: &str) -> Option<PrinterState> {
    // The queue name goes straight into the URI. CUPS queue names hold no
    // spaces, slashes, or `#`, because CUPS refuses to create a queue whose
    // name has one, so there is nothing here to escape.
    let uri = format!("ipp://localhost/printers/{queue}");
    let output = Command::new(IPPTOOL)
        .args(["-tv", &uri, GET_PRINTER_ATTRIBUTES])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }
    state_from_attributes(&String::from_utf8_lossy(&output.stdout))
}

/// The state CUPS reports, read out of `ipptool` output.
///
/// Returns `None` when the output carries no `printer-state`, which is what a
/// failed request looks like: `ipptool` prints the attributes it expected and
/// did not get, rather than values.
fn state_from_attributes(text: &str) -> Option<PrinterState> {
    let queue_state = QueueState::from(attribute(text, "printer-state")?);
    let reasons = attribute(text, "printer-state-reasons")
        .unwrap_or("none")
        .to_lowercase();
    // A queue that does not say is taken to be accepting jobs. Only an
    // explicit `false` holds a print run back.
    let accepting = attribute(text, "printer-is-accepting-jobs").unwrap_or("true") != "false";

    // A reason names the actual fault, so the reasons are read before the
    // state. CUPS adds a severity to each one, such as `media-empty-error` or
    // `offline-report`, so each name is looked for inside the value rather
    // than compared to it. Several reasons arrive as one comma-separated list.
    if reasons.contains("media-empty") || reasons.contains("media-needed") {
        return Some(PrinterState::Error(fault::MEDIA_EMPTY.to_string()));
    }
    if reasons.contains("media-jam") {
        return Some(PrinterState::Error(fault::MEDIA_JAM.to_string()));
    }
    if reasons.contains("cover-open") || reasons.contains("door-open") {
        return Some(PrinterState::Error(fault::DOOR_OPEN.to_string()));
    }
    if reasons.contains("offline") {
        return Some(PrinterState::Offline);
    }

    // Three ways a queue leaves a print run waiting: a reason says it is
    // paused, CUPS stopped it, or it is running but taking no new jobs.
    if reasons.contains("paused") || queue_state == QueueState::Stopped || !accepting {
        return Some(PrinterState::Paused);
    }

    Some(match queue_state {
        // A queue that is printing something else still takes the next print
        // run, so the printer counts as ready.
        QueueState::Idle | QueueState::Processing => PrinterState::Ready,
        QueueState::Stopped | QueueState::Other => PrinterState::Unknown,
    })
}

/// The three values IPP gives `printer-state`, and anything else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QueueState {
    Idle,
    Processing,
    Stopped,
    Other,
}

impl QueueState {
    /// Reads the attribute value.
    ///
    /// `ipptool` prints the keyword for the enumeration, such as `idle`. The
    /// numbers IPP defines for the same three values are accepted as well, so
    /// a build that prints the raw enumeration is still understood.
    fn from(value: &str) -> Self {
        match value.trim() {
            "idle" | "3" => Self::Idle,
            "processing" | "4" => Self::Processing,
            "stopped" | "5" => Self::Stopped,
            _ => Self::Other,
        }
    }
}

/// Reads the value of one attribute out of `ipptool` output.
///
/// Every attribute line reads `<name> (<syntax>) = <value>`, indented under
/// the operation it belongs to. The request is echoed before the response, so
/// the last line naming the attribute is the one the printer answered with.
///
/// The syntax in parentheses is what keeps one attribute name from matching
/// another that starts with it, such as `printer-state` against
/// `printer-state-reasons`.
fn attribute<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    text.lines().rev().find_map(|line| {
        let rest = line.trim().strip_prefix(name)?.strip_prefix(" (")?;
        let (_syntax, value) = rest.split_once(") = ")?;
        Some(value.trim())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real `ipptool` output from the Zebra wired to this Mac by USB, cut off
    /// after the attributes this module reads. The full response runs to some
    /// twenty thousand more bytes of supported media sizes and formats.
    const USB_ZEBRA: &str = r#""/usr/share/cups/ipptool/get-printer-attributes.test":
    Get-Printer-Attributes:
        attributes-charset (charset) = utf-8
        attributes-natural-language (naturalLanguage) = en
        printer-uri (uri) = ipp://localhost:631/printers/Zebra_Technologies_ZTC_ZD411_300dpi_ZPL
        requested-attributes (1setOf keyword) = all,media-col-database
    Get printer attributes using get-printer-attributes                  [PASS]
        RECEIVED: 23159 bytes in response
        status-code = successful-ok (successful-ok)
        attributes-charset (charset) = utf-8
        attributes-natural-language (naturalLanguage) = en
        marker-change-time (integer) = 0
        printer-config-change-date-time (dateTime) = 2026-09-06T18:39:51Z
        printer-config-change-time (integer) = 1788719991
        printer-current-time (dateTime) = 2026-09-06T19:19:54Z
        printer-dns-sd-name (no-value) = no-value
        printer-icons (uri) = http://localhost:631/icons/Zebra_Technologies_ZTC_ZD411_300dpi_ZPL.png
        printer-is-accepting-jobs (boolean) = true
        printer-is-shared (boolean) = false
        printer-is-temporary (boolean) = false
        printer-more-info (uri) = http://localhost:631/printers/Zebra_Technologies_ZTC_ZD411_300dpi_ZPL
        printer-state (enum) = idle
        printer-state-change-date-time (dateTime) = 2026-09-06T18:37:06Z
        printer-state-change-time (integer) = 1788719826
        printer-state-message (textWithoutLanguage) =
        printer-state-reasons (keyword) = none
        printer-type (enum) = 2134084
        printer-up-time (integer) = 1788722394
"#;

    /// The same command against a queue that reaches its Zebra over the
    /// network, cut off the same way. The queue name is an invented one.
    const NETWORK_ZEBRA: &str = r#""/usr/share/cups/ipptool/get-printer-attributes.test":
    Get-Printer-Attributes:
        attributes-charset (charset) = utf-8
        attributes-natural-language (naturalLanguage) = en
        printer-uri (uri) = ipp://localhost:631/printers/Lab_Printer
        requested-attributes (1setOf keyword) = all,media-col-database
    Get printer attributes using get-printer-attributes                  [PASS]
        RECEIVED: 22978 bytes in response
        status-code = successful-ok (successful-ok)
        attributes-charset (charset) = utf-8
        attributes-natural-language (naturalLanguage) = en
        marker-change-time (integer) = 0
        printer-config-change-date-time (dateTime) = 2026-08-26T21:19:38Z
        printer-config-change-time (integer) = 1787779178
        printer-current-time (dateTime) = 2026-09-06T19:25:38Z
        printer-dns-sd-name (no-value) = no-value
        printer-icons (uri) = http://localhost:631/icons/Lab_Printer.png
        printer-is-accepting-jobs (boolean) = true
        printer-is-shared (boolean) = false
        printer-is-temporary (boolean) = false
        printer-more-info (uri) = http://localhost:631/printers/Lab_Printer
        printer-state (enum) = idle
        printer-state-change-date-time (dateTime) = 2026-08-26T21:24:51Z
        printer-state-change-time (integer) = 1787779491
        printer-state-message (textWithoutLanguage) =
        printer-state-reasons (keyword) = none
        printer-type (enum) = 2134084
        printer-up-time (integer) = 1788722738
"#;

    /// What `ipptool` prints for a queue that is not installed. It lists the
    /// attributes the test file expected and never got a value for, which is
    /// why an expectation must not be read as an attribute.
    const NO_SUCH_QUEUE: &str = r#""/usr/share/cups/ipptool/get-printer-attributes.test":
    Get-Printer-Attributes:
        attributes-charset (charset) = utf-8
        attributes-natural-language (naturalLanguage) = en
        printer-uri (uri) = ipp://localhost:631/printers/No_Such_Queue
        requested-attributes (1setOf keyword) = all,media-col-database
    Get printer attributes using get-printer-attributes                  [FAIL]
        RECEIVED: 183 bytes in response
        status-code = client-error-not-found (The printer or class does not exist.)
        attributes-charset (charset) = utf-8
        attributes-natural-language (naturalLanguage) = en
        status-message (textWithoutLanguage) = The printer or class does not exist.
        EXPECTED: printer-is-accepting-jobs
        EXPECTED: printer-state
        EXPECTED: printer-state-reasons
"#;

    /// Builds output in the shape `ipptool` prints, with the three attributes
    /// this module reads set to whatever a test needs.
    fn answer(state: &str, reasons: &str, accepting: bool) -> String {
        [
            "    Get printer attributes using get-printer-attributes    [PASS]".to_string(),
            format!("        printer-is-accepting-jobs (boolean) = {accepting}"),
            format!("        printer-state (enum) = {state}"),
            format!("        printer-state-reasons (keyword) = {reasons}"),
        ]
        .join("\n")
    }

    #[test]
    fn the_wired_zebra_on_this_machine_reads_as_ready() {
        assert_eq!(state_from_attributes(USB_ZEBRA), Some(PrinterState::Ready));
    }

    #[test]
    fn a_network_queue_reads_as_ready() {
        assert_eq!(
            state_from_attributes(NETWORK_ZEBRA),
            Some(PrinterState::Ready)
        );
    }

    /// The request is echoed above the response, so the value read has to be
    /// the one the printer answered with.
    #[test]
    fn the_response_is_read_rather_than_the_echoed_request() {
        assert_eq!(
            attribute(USB_ZEBRA, "printer-uri"),
            Some("ipp://localhost:631/printers/Zebra_Technologies_ZTC_ZD411_300dpi_ZPL")
        );
        assert_eq!(attribute(USB_ZEBRA, "printer-state"), Some("idle"));
    }

    /// `printer-state` is the start of `printer-state-reasons`, and reading
    /// one for the other would turn every fault into an unknown state.
    #[test]
    fn an_attribute_name_does_not_match_a_longer_one() {
        assert_eq!(attribute(USB_ZEBRA, "printer-state"), Some("idle"));
        assert_eq!(attribute(USB_ZEBRA, "printer-state-reasons"), Some("none"));
    }

    #[test]
    fn an_attribute_that_is_not_there_reads_as_nothing() {
        assert_eq!(attribute(USB_ZEBRA, "printer-alert"), None);
    }

    #[test]
    fn a_queue_that_is_not_installed_gives_no_state() {
        assert_eq!(state_from_attributes(NO_SUCH_QUEUE), None);
    }

    #[test]
    fn a_queue_printing_something_else_is_still_ready() {
        assert_eq!(
            state_from_attributes(&answer("processing", "none", true)),
            Some(PrinterState::Ready)
        );
    }

    #[test]
    fn an_empty_roll_is_a_media_fault() {
        assert_eq!(
            state_from_attributes(&answer("stopped", "media-empty-error", true)),
            Some(PrinterState::Error(fault::MEDIA_EMPTY.into()))
        );
        assert_eq!(
            state_from_attributes(&answer("stopped", "media-needed-error", true)),
            Some(PrinterState::Error(fault::MEDIA_EMPTY.into()))
        );
    }

    #[test]
    fn a_jam_is_a_media_jam() {
        assert_eq!(
            state_from_attributes(&answer("stopped", "media-jam-error", true)),
            Some(PrinterState::Error(fault::MEDIA_JAM.into()))
        );
    }

    /// CUPS calls the same fault `cover-open` on one driver and `door-open` on
    /// another, and the app has one name for it.
    #[test]
    fn an_open_cover_and_an_open_door_are_the_same_fault() {
        for reason in ["cover-open-warning", "door-open-report"] {
            assert_eq!(
                state_from_attributes(&answer("stopped", reason, true)),
                Some(PrinterState::Error(fault::DOOR_OPEN.into())),
                "reason {reason}"
            );
        }
    }

    #[test]
    fn a_printer_cups_cannot_reach_is_offline() {
        assert_eq!(
            state_from_attributes(&answer("stopped", "offline-report", true)),
            Some(PrinterState::Offline)
        );
    }

    /// The reason that names a fault wins over one that only says the queue
    /// stopped, because the fault is what an operator has to fix.
    #[test]
    fn a_fault_wins_over_the_paused_reason_beside_it() {
        assert_eq!(
            state_from_attributes(&answer("stopped", "media-empty-error,paused", true)),
            Some(PrinterState::Error(fault::MEDIA_EMPTY.into()))
        );
    }

    #[test]
    fn a_stopped_queue_with_nothing_to_report_is_paused() {
        assert_eq!(
            state_from_attributes(&answer("stopped", "none", true)),
            Some(PrinterState::Paused)
        );
        assert_eq!(
            state_from_attributes(&answer("stopped", "paused", true)),
            Some(PrinterState::Paused)
        );
    }

    /// A queue that takes no new jobs leaves a replica waiting just as a
    /// stopped one does, so ADR 0003 has to refuse the print run.
    #[test]
    fn a_queue_that_is_not_accepting_jobs_is_paused() {
        assert_eq!(
            state_from_attributes(&answer("idle", "none", false)),
            Some(PrinterState::Paused)
        );
    }

    /// IPP defines these three states as numbers, and the keywords `ipptool`
    /// prints are a convenience of its own.
    #[test]
    fn the_state_numbers_ipp_defines_are_understood_too() {
        assert_eq!(
            state_from_attributes(&answer("3", "none", true)),
            Some(PrinterState::Ready)
        );
        assert_eq!(
            state_from_attributes(&answer("4", "none", true)),
            Some(PrinterState::Ready)
        );
        assert_eq!(
            state_from_attributes(&answer("5", "none", true)),
            Some(PrinterState::Paused)
        );
    }

    #[test]
    fn a_state_ipp_does_not_define_is_unknown() {
        assert_eq!(
            state_from_attributes(&answer("something-new", "none", true)),
            Some(PrinterState::Unknown)
        );
    }
}
