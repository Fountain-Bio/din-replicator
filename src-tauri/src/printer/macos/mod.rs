//! The macOS print path.
//!
//! macOS runs CUPS. This module shells out to the two CUPS tools that ship
//! with every macOS release: `lpstat` to read the queues and `lp` to submit a
//! job. Both live in `/usr/bin`, and the code names them by full path because
//! a bundled `.app` does not always inherit a useful `PATH`.
//!
//! Everything that reads CUPS output is a plain function over a string, so the
//! tests at the bottom of the file run against captured output.

use std::collections::HashMap;
use std::io::Write;
use std::process::{Command, Stdio};

use super::{fault, PrintReceipt, PrinterError, PrinterInfo, PrinterState, PrinterTransport};

const LPSTAT: &str = "/usr/bin/lpstat";
const LP: &str = "/usr/bin/lp";

/// The CUPS queues on this Mac.
pub struct Cups;

impl PrinterTransport for Cups {
    fn list_printers(&self) -> Result<Vec<PrinterInfo>, PrinterError> {
        // `lpstat -p -l` gives the name and state of every queue. `lpstat -v`
        // gives the device address each queue points at, which is the only
        // description CUPS reports on some macOS releases.
        let status = lpstat(&["-p", "-l"])?;
        let devices = parse_devices(&lpstat(&["-v"])?);

        Ok(parse_status(&status)
            .into_iter()
            .map(|stanza| {
                let device = devices
                    .get(&queue_key(&stanza.name))
                    .cloned()
                    .unwrap_or_default();
                let description = description_from_detail(&stanza.detail).unwrap_or(device);
                PrinterInfo {
                    is_zebra: super::looks_like_zebra(&[&stanza.name, &description]),
                    state: state_from_stanza(&stanza.status_line, &stanza.detail),
                    name: stanza.name,
                    description,
                }
            })
            .collect())
    }

    fn printer_state(&self, name: &str) -> Result<PrinterState, PrinterError> {
        // The queue name has to come straight after `-p`. CUPS reads the token
        // after `-p` as a name only when it does not start with a dash, so
        // `-p -l <name>` reports every queue on the machine and `-p <name> -l`
        // reports the one asked for. Asking for one keeps the answer small.
        //
        // CUPS exits non-zero for a name it does not know, which `lpstat`
        // turns into empty output, so no stanza here means no such queue.
        let status = lpstat(&["-p", name, "-l"])?;
        parse_status(&status)
            .into_iter()
            .find(|stanza| queue_key(&stanza.name) == queue_key(name))
            .map(|stanza| state_from_stanza(&stanza.status_line, &stanza.detail))
            .ok_or_else(|| PrinterError::PrinterNotFound(name.to_string()))
    }

    fn print_raw(
        &self,
        name: &str,
        bytes: &[u8],
        title: &str,
    ) -> Result<PrintReceipt, PrinterError> {
        // `-o raw` makes CUPS pass the bytes straight to the printer. A
        // normal job goes through a filter that rewrites it into the
        // printer's page language, which would destroy the ZPL. The
        // trailing `-` makes `lp` read the job from standard input.
        let mut child = Command::new(LP)
            .args(["-d", name, "-o", "raw", "-t", title, "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| PrinterError::SpoolFailed(format!("could not run {LP}: {error}")))?;

        // Taking stdin and dropping it closes the pipe, which is what tells
        // `lp` the job is complete.
        {
            let mut stdin = child.stdin.take().ok_or_else(|| {
                PrinterError::SpoolFailed("could not write the label data to lp".to_string())
            })?;
            stdin.write_all(bytes).map_err(|error| {
                PrinterError::SpoolFailed(format!("could not write the label data to lp: {error}"))
            })?;
        }

        let output = child.wait_with_output().map_err(|error| {
            PrinterError::SpoolFailed(format!("lp did not finish cleanly: {error}"))
        })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(PrinterError::SpoolFailed(stderr.trim().to_string()));
        }

        Ok(PrintReceipt {
            job_id: parse_job_id(&String::from_utf8_lossy(&output.stdout)),
        })
    }
}

/// Runs `lpstat` with `args` and returns its standard output.
///
/// CUPS exits non-zero both when the machine has no queues at all and when it
/// is asked about a name it does not know. Neither is a broken print system,
/// so both come back as empty output and the caller decides what that means.
fn lpstat(args: &[&str]) -> Result<String, PrinterError> {
    let output = Command::new(LPSTAT)
        .args(args)
        .output()
        .map_err(|error| PrinterError::QueryFailed(format!("could not run {LPSTAT}: {error}")))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let lowered = stderr.to_lowercase();
    if lowered.contains("no destinations") || lowered.contains("invalid destination name") {
        return Ok(String::new());
    }
    Err(PrinterError::QueryFailed(stderr.trim().to_string()))
}

/// One queue as `lpstat -p -l` prints it: the `printer ...` line plus the
/// indented lines under it.
#[derive(Debug, PartialEq, Eq)]
struct StatusStanza {
    /// The queue name, which is the first word after `printer`.
    name: String,
    /// The rest of that line, such as `is idle.  enabled since Wed Aug 26 ...`.
    status_line: String,
    /// The indented lines that follow, trimmed and joined by newlines. CUPS
    /// puts the description and the printer state reasons here.
    detail: String,
}

/// Splits `lpstat -p` or `lpstat -p -l` output into one stanza per queue.
///
/// The short and the long form of the command share this shape. The long form
/// adds indented lines under each queue; the short form adds none, which
/// leaves `detail` empty.
fn parse_status(text: &str) -> Vec<StatusStanza> {
    let mut stanzas: Vec<StatusStanza> = Vec::new();

    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("printer ") {
            let mut words = rest.splitn(2, char::is_whitespace);
            let name = words.next().unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            stanzas.push(StatusStanza {
                name: name.to_string(),
                status_line: words.next().unwrap_or_default().trim().to_string(),
                detail: String::new(),
            });
            continue;
        }

        // Anything else belongs to the queue named on the last header line.
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(stanza) = stanzas.last_mut() {
            if !stanza.detail.is_empty() {
                stanza.detail.push('\n');
            }
            stanza.detail.push_str(trimmed);
        }
    }

    stanzas
}

/// Reads the `Description:` line out of a stanza's indented lines.
///
/// Only the long form of `lpstat` prints one, and some macOS releases leave it
/// out even then, so this returns nothing rather often.
fn description_from_detail(detail: &str) -> Option<String> {
    detail
        .lines()
        .find_map(|line| line.trim().strip_prefix("Description:"))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// The form of a queue name that two names are compared in.
///
/// CUPS treats queue names without regard to case: `lpstat -p lab_zebra`
/// answers for the queue CUPS calls `Lab_Zebra`. An operator or a stored
/// setting can hand this app either spelling, so every comparison of two queue
/// names goes through here.
fn queue_key(name: &str) -> String {
    name.to_lowercase()
}

/// Reads the device address of every queue out of `lpstat -v` output.
///
/// Each line looks like `device for Lab_Zebra: ipp://192.0.2.14/...`.
/// The map is keyed by [`queue_key`], not by the name CUPS printed.
fn parse_devices(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter_map(|line| line.trim().strip_prefix("device for "))
        // The first colon ends the queue name. Later colons belong to the
        // address, such as the port in `ipp://192.0.2.16:631/...`.
        .filter_map(|rest| rest.split_once(':'))
        .map(|(name, uri)| (queue_key(name.trim()), uri.trim().to_string()))
        .collect()
}

/// Reads the state out of one stanza.
///
/// CUPS reports two things. The header line says whether the queue is enabled
/// and whether a job is running. The indented lines carry printer state
/// reasons such as `media-empty` or `offline-report`. A reason names the
/// actual fault, so a reason wins over the header line.
fn state_from_stanza(status_line: &str, detail: &str) -> PrinterState {
    // The description and the location are free text that an administrator
    // typed. Skipping them keeps a queue described as "paused for repairs"
    // from reading as a paused queue.
    let reasons = detail
        .lines()
        .map(str::trim)
        .filter(|line| !line.starts_with("Description:") && !line.starts_with("Location:"))
        .collect::<Vec<_>>()
        .join("\n")
        .to_lowercase();

    // CUPS names a media fault two ways depending on the driver.
    if reasons.contains("media-empty") || reasons.contains("media-needed") {
        return PrinterState::Error(fault::MEDIA_EMPTY.to_string());
    }
    if reasons.contains("media-jam") {
        return PrinterState::Error(fault::MEDIA_JAM.to_string());
    }
    if reasons.contains("door-open") || reasons.contains("cover-open") {
        return PrinterState::Error(fault::DOOR_OPEN.to_string());
    }
    if reasons.contains("offline-report") {
        return PrinterState::Offline;
    }

    // A queue can be stopped in three ways that all leave a job waiting: the
    // queue is disabled, a reason says it is paused, or it is still enabled but
    // holding every new job.
    let header = status_line.to_lowercase();
    if reasons.contains("paused")
        || header.starts_with("disabled since")
        || header.contains("holding new jobs")
    {
        return PrinterState::Paused;
    }
    // `now printing` means a job is running. The queue still takes the next
    // print run, so the printer counts as ready.
    if header.starts_with("is idle") || header.contains("now printing") {
        return PrinterState::Ready;
    }
    PrinterState::Unknown
}

/// Reads the job identifier out of what `lp` prints when it takes a job.
///
/// The line reads `request id is Lab_Zebra-42 (1 file(s))`.
fn parse_job_id(stdout: &str) -> Option<String> {
    stdout
        .split_once("request id is ")
        .map(|(_, rest)| rest)
        .and_then(|rest| rest.split_whitespace().next())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real output from a clinic Mac, with the two Zebra queues in it.
    const SHORT_STATUS: &str = "\
printer Brother_HL_L2460DW is idle.  enabled since Thu Aug 13 16:12:29 2026
printer Lab_Brother is idle.  enabled since Thu Jul 23 10:37:58 2026
printer Lab_Zebra is idle.  enabled since Wed Aug 26 14:24:51 2026
printer Zebra_Stock_Room is idle.  enabled since Thu Aug 13 14:49:03 2026
";

    /// Real `lpstat -v` output from the same Mac.
    const DEVICES: &str = "\
device for Brother_HL_L2460DW: ipp://192.0.2.16/printers/brother_stockroom_l2460
device for Lab_Brother: ipp://192.0.2.14/printers/brother_lab
device for Lab_Zebra: ipp://192.0.2.14/printers/zebra_lab
device for Zebra_Stock_Room: ipp://192.0.2.16:631/printers/zebra_stockroom
";

    /// The long form, with the indented lines CUPS adds for a queue that is
    /// stopped or reporting a fault.
    const LONG_STATUS: &str = "\
printer Lab_Zebra is idle.  enabled since Wed Aug 26 14:24:51 2026
\tDescription: Lab Zebra
\tLocation: draw room
\tAlerts: none
printer Zebra_Stock_Room disabled since Tue Sep 01 09:00:00 2026 -
\tPaused
printer Front_Desk_Zebra is idle.  enabled since Tue Sep 01 08:00:00 2026
\tDescription: Front desk Zebra
\tAlerts: media-empty-error
printer Back_Room_Zebra is idle.  enabled since Tue Sep 01 08:00:00 2026
\tAlerts: offline-report
";

    fn state_of(text: &str, name: &str) -> PrinterState {
        let stanza = parse_status(text)
            .into_iter()
            .find(|stanza| stanza.name == name)
            .expect("the sample output names this queue");
        state_from_stanza(&stanza.status_line, &stanza.detail)
    }

    #[test]
    fn every_queue_in_the_short_form_is_found() {
        let names: Vec<String> = parse_status(SHORT_STATUS)
            .into_iter()
            .map(|stanza| stanza.name)
            .collect();
        assert_eq!(
            names,
            [
                "Brother_HL_L2460DW",
                "Lab_Brother",
                "Lab_Zebra",
                "Zebra_Stock_Room"
            ]
        );
    }

    #[test]
    fn the_short_form_has_no_indented_lines() {
        for stanza in parse_status(SHORT_STATUS) {
            assert_eq!(stanza.detail, "");
        }
    }

    #[test]
    fn an_idle_queue_is_ready() {
        assert_eq!(state_of(SHORT_STATUS, "Lab_Zebra"), PrinterState::Ready);
    }

    #[test]
    fn a_disabled_queue_is_paused() {
        assert_eq!(
            state_of(LONG_STATUS, "Zebra_Stock_Room"),
            PrinterState::Paused
        );
    }

    #[test]
    fn a_media_reason_is_an_error() {
        assert_eq!(
            state_of(LONG_STATUS, "Front_Desk_Zebra"),
            PrinterState::Error(fault::MEDIA_EMPTY.into())
        );
    }

    #[test]
    fn an_offline_reason_beats_the_idle_header() {
        assert_eq!(
            state_of(LONG_STATUS, "Back_Room_Zebra"),
            PrinterState::Offline
        );
    }

    #[test]
    fn a_running_job_still_counts_as_ready() {
        let text = "printer Lab_Zebra now printing Lab_Zebra-42.  enabled since Wed Aug 26 14:24:51 2026\n";
        assert_eq!(state_of(text, "Lab_Zebra"), PrinterState::Ready);
    }

    #[test]
    fn a_header_cups_never_prints_is_unknown() {
        let text = "printer Lab_Zebra is doing something new.\n";
        assert_eq!(state_of(text, "Lab_Zebra"), PrinterState::Unknown);
    }

    /// A description an administrator typed must not be read as a state.
    #[test]
    fn words_in_the_description_do_not_change_the_state() {
        let text = "printer Lab_Zebra is idle.  enabled since Wed Aug 26 14:24:51 2026\n\tDescription: Paused for repairs, media-empty spare\n";
        assert_eq!(state_of(text, "Lab_Zebra"), PrinterState::Ready);
    }

    #[test]
    fn the_description_line_is_read_when_cups_prints_one() {
        let stanza = parse_status(LONG_STATUS)
            .into_iter()
            .find(|stanza| stanza.name == "Lab_Zebra")
            .unwrap();
        assert_eq!(
            description_from_detail(&stanza.detail).as_deref(),
            Some("Lab Zebra")
        );
    }

    #[test]
    fn a_stanza_without_a_description_line_reports_none() {
        let stanza = parse_status(SHORT_STATUS)
            .into_iter()
            .find(|stanza| stanza.name == "Lab_Zebra")
            .unwrap();
        assert_eq!(description_from_detail(&stanza.detail), None);
    }

    #[test]
    fn device_addresses_are_read_per_queue() {
        let devices = parse_devices(DEVICES);
        assert_eq!(
            devices.get("lab_zebra").map(String::as_str),
            Some("ipp://192.0.2.14/printers/zebra_lab")
        );
        // The port in this address belongs to the address. Splitting at the
        // wrong colon would cut the queue name out of the middle of it.
        assert_eq!(
            devices.get("zebra_stockroom").map(String::as_str),
            Some("ipp://192.0.2.16:631/printers/zebra_stockroom")
        );
        assert_eq!(devices.len(), 4);
    }

    /// CUPS answers for a queue whatever case the name is typed in, so the
    /// device map has to be readable the same way.
    #[test]
    fn device_addresses_are_found_whatever_the_case() {
        let devices = parse_devices(DEVICES);
        assert_eq!(
            devices.get(&queue_key("BURBANK_zebra")).map(String::as_str),
            Some("ipp://192.0.2.14/printers/zebra_lab")
        );
    }

    #[test]
    fn queue_names_are_compared_without_regard_to_case() {
        assert_eq!(queue_key("Lab_Zebra"), queue_key("lab_zebra"));
        assert_ne!(queue_key("Lab_Zebra"), queue_key("Zebra_Stock_Room"));
    }

    /// An enabled queue that holds every new job leaves a replica waiting just
    /// as a disabled one does, so ADR 0003 has to refuse the print run.
    #[test]
    fn a_queue_holding_new_jobs_is_paused() {
        let text = "printer Lab_Zebra is idle.  enabled since Wed Aug 26 14:24:51 2026 - is holding new jobs\n";
        assert_eq!(state_of(text, "Lab_Zebra"), PrinterState::Paused);
    }

    #[test]
    fn the_device_address_marks_a_queue_as_a_zebra() {
        let devices = parse_devices(DEVICES);
        let zebra = devices.get("lab_zebra").unwrap();
        assert!(super::super::looks_like_zebra(&["Lab_Zebra", zebra]));
        let brother = devices.get("lab_brother").unwrap();
        assert!(!super::super::looks_like_zebra(&[
            "Lab_Brother",
            brother
        ]));
    }

    #[test]
    fn the_job_id_is_read_from_what_lp_prints() {
        assert_eq!(
            parse_job_id("request id is Lab_Zebra-42 (1 file(s))\n").as_deref(),
            Some("Lab_Zebra-42")
        );
    }

    #[test]
    fn silent_output_from_lp_leaves_the_job_id_unset() {
        assert_eq!(parse_job_id(""), None);
    }
}
