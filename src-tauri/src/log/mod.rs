//! The print log: every print run the app has made on this machine, and the
//! verification scan that followed it.
//!
//! ADR 0004 makes the log machine-wide. One SQLite file holds it, the app
//! opens that file once at startup, and [`Store`] hands out the only
//! connection behind a mutex. The settings the UI remembers live in the same
//! file; see [`crate::settings`].
//!
//! Nothing here talks to a printer. The command layer prints first and records
//! the print run afterwards, so the log holds what really went to the queue.

pub mod schema;
pub mod storage;

use std::sync::{Mutex, MutexGuard};

use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::command_error::CommandError;
use crate::settings::{self, Settings};
use storage::{DatabaseLocation, StorageInfo};

/// How many print runs the history screen asks for when it does not say.
const DEFAULT_LIMIT: u32 = 100;

/// The most print runs one call may ask for. The history screen pages through
/// the log, and a query without a ceiling would pull years of print runs into
/// the UI at once.
const MAX_LIMIT: u32 = 1000;

/// What the log records when the operating system will not name the operator
/// or the machine. A print run with a placeholder operator is better than a
/// print run that went unrecorded.
const UNKNOWN: &str = "unknown";

/// Everything that can go wrong while reading or writing the print log.
///
/// Serialises as `{"code": "...", "message": "..."}`, the shape every command
/// error shares. See [`crate::command_error`].
#[derive(Debug, thiserror::Error)]
pub enum LogError {
    /// The app has no database file to record print runs in. The message
    /// says which directories it tried and what stopped it.
    #[error("{0}")]
    StorageUnavailable(String),
    /// No print run in the log has that id.
    #[error("no print run in the log has the id {0}")]
    PrintRunNotFound(i64),
    /// The command was called with a value the log will not store, such as a
    /// copy count of zero.
    #[error("{0}")]
    InvalidInput(String),
    /// SQLite refused a statement, or the file is unreadable.
    #[error("the print log could not be read or written: {0}")]
    DatabaseFailed(String),
}

impl CommandError for LogError {
    /// The stable string the UI branches on. Message text may change; these
    /// do not.
    fn code(&self) -> &'static str {
        match self {
            Self::StorageUnavailable(_) => "storage_unavailable",
            Self::PrintRunNotFound(_) => "print_run_not_found",
            Self::InvalidInput(_) => "invalid_input",
            Self::DatabaseFailed(_) => "database_failed",
        }
    }
}

crate::serialize_as_command_error!(LogError);

impl From<rusqlite::Error> for LogError {
    fn from(error: rusqlite::Error) -> Self {
        Self::DatabaseFailed(error.to_string())
    }
}

/// One print run as the UI reads it back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintRun {
    pub id: i64,
    /// The 13-character donation identification number the replicas carry.
    pub din: String,
    /// The 16-character barcode payload that went into the barcode.
    pub payload: String,
    /// The copy count: how many replicas this print run asked for.
    pub copies: u32,
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
    pub copies: u32,
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
/// asks for the newest [`DEFAULT_LIMIT`] print runs.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintRunQuery {
    /// Keeps only print runs whose DIN starts with this text, so the history
    /// screen narrows as the operator types part of a DIN.
    pub din: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// The open print log. Tauri holds one of these as managed state.
///
/// SQLite allows one writer at a time, and the app has one database file, so
/// the connection sits behind a mutex and every command takes it in turn.
/// Print runs happen at the speed a person presses a button, so the wait never
/// shows.
#[derive(Debug)]
pub struct Store {
    connection: Mutex<Connection>,
    location: DatabaseLocation,
}

impl Store {
    /// Opens the database file at `location`, creating it if it is missing,
    /// and brings its schema up to date.
    pub fn open(location: DatabaseLocation) -> Result<Self, LogError> {
        let mut connection = Connection::open(&location.path).map_err(|error| {
            LogError::StorageUnavailable(format!(
                "the print log could not be opened at {}: {error}",
                location.path.display()
            ))
        })?;

        // The file has just been created under the account that launched the
        // app first. A machine-wide log has to stay writable by the next
        // account to log in, so its rights are opened up the same way the
        // directory's were. A per-user log is left alone: nobody else needs
        // it.
        if location.machine_wide {
            let _ = crate::platform::make_shared(&location.path);
        }

        Self::prepare(&mut connection)?;

        Ok(Self {
            connection: Mutex::new(connection),
            location,
        })
    }

    /// Opens the print log the app should use on this machine.
    ///
    /// The machine-wide directory comes from the platform module. Tauri's
    /// per-user app data directory is the fallback for a machine that will
    /// not let the app write machine-wide.
    pub fn open_for_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Self, LogError> {
        use tauri::Manager;

        let user_dir = app.path().app_data_dir().map_err(|error| {
            LogError::StorageUnavailable(format!(
                "the print log has nowhere to live: there is no per-user data \
                 directory to fall back to: {error}"
            ))
        })?;

        Self::open(storage::choose(
            &crate::platform::machine_wide_data_dir(),
            &user_dir,
        )?)
    }

    /// Sets up a connection the way every connection to this database is set
    /// up, then runs any migrations it has not seen.
    ///
    /// WAL lets the history screen read while a print run is being written.
    /// Foreign keys are off by default in SQLite, so turning them on is what
    /// makes a verification's reference to its print run real. The busy
    /// timeout matters because the file is machine-wide: two logins on one
    /// machine can each have the app open, and a locked database should wait
    /// rather than fail.
    fn prepare(connection: &mut Connection) -> Result<(), LogError> {
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;
        schema::migrate(connection)?;
        Ok(())
    }

    /// Which file this log is stored in, and whether it is machine-wide.
    pub fn storage_info(&self) -> StorageInfo {
        self.location.info()
    }

    /// Records a print run that has already gone to the printer, and reads it
    /// back with the operator, machine name, and time the log filled in.
    pub fn record_print_run(&self, input: NewPrintRun) -> Result<PrintRun, LogError> {
        let input = input.checked()?;
        let (operator_user, hostname) = operator();

        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO print_runs
                 (din, payload, copies, printer_name, job_id,
                  operator_user, hostname, printed_at, zpl)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                input.din,
                input.payload,
                input.copies,
                input.printer_name,
                input.job_id,
                operator_user,
                hostname,
                now(),
                input.zpl,
            ],
        )?;

        read_print_run(&connection, connection.last_insert_rowid())
    }

    /// Records the scan of a replica against the print run that produced it,
    /// and reads that print run back with the new verification attached.
    ///
    /// A print run can be verified more than once, for instance when the first
    /// scan misread. Every scan is kept and the newest one is the one the UI
    /// sees.
    pub fn record_verification(&self, input: NewVerification) -> Result<PrintRun, LogError> {
        let input = input.checked()?;

        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;

        let known = transaction
            .query_row(
                "SELECT 1 FROM print_runs WHERE id = ?1",
                [input.print_run_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !known {
            return Err(LogError::PrintRunNotFound(input.print_run_id));
        }

        transaction.execute(
            "INSERT INTO verifications
                 (print_run_id, scanned_payload, matched, verified_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                input.print_run_id,
                input.scanned_payload,
                input.matched,
                now(),
            ],
        )?;
        transaction.commit()?;

        read_print_run(&connection, input.print_run_id)
    }

    /// The print runs the history screen shows, newest first.
    pub fn list_print_runs(&self, query: PrintRunQuery) -> Result<Vec<PrintRun>, LogError> {
        let limit = query.limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);
        let offset = query.offset.unwrap_or(0);
        let pattern = prefix_pattern(query.din.as_deref().unwrap_or("").trim());

        let connection = self.connection()?;
        let mut statement = connection.prepare(&format!(
            "{SELECT_PRINT_RUN}
             WHERE p.din LIKE ?1 ESCAPE '\\'
             ORDER BY p.printed_at DESC, p.id DESC
             LIMIT ?2 OFFSET ?3"
        ))?;

        let runs = statement
            .query_map(params![pattern, limit, offset], to_print_run)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(runs)
    }

    /// One print run by id.
    pub fn print_run(&self, id: i64) -> Result<PrintRun, LogError> {
        let connection = self.connection()?;
        read_print_run(&connection, id)
    }

    /// The settings this machine remembers.
    pub fn settings(&self) -> Result<Settings, LogError> {
        let connection = self.connection()?;
        Ok(settings::read(&connection)?)
    }

    /// Replaces the settings this machine remembers, and reads them back.
    pub fn set_settings(&self, chosen: Settings) -> Result<Settings, LogError> {
        chosen.check().map_err(LogError::InvalidInput)?;

        let mut connection = self.connection()?;
        Ok(settings::write(&mut connection, &chosen)?)
    }

    /// Takes the one connection.
    ///
    /// The lock is poisoned only if an earlier command panicked while holding
    /// it. The connection may then be mid-statement, so this reports a failure
    /// rather than handing it out.
    fn connection(&self) -> Result<MutexGuard<'_, Connection>, LogError> {
        self.connection.lock().map_err(|_| {
            LogError::DatabaseFailed(
                "an earlier failure left the print log in an unknown state; restart the app".into(),
            )
        })
    }

    /// A print log held in memory, for tests. Nothing is written to disk and
    /// the log disappears with the [`Store`].
    #[cfg(test)]
    fn open_in_memory() -> Self {
        let mut connection = Connection::open_in_memory().unwrap();
        Self::prepare(&mut connection).unwrap();
        Self {
            connection: Mutex::new(connection),
            location: DatabaseLocation {
                path: std::path::PathBuf::from(":memory:"),
                machine_wide: false,
            },
        }
    }
}

/// The print log as the commands see it: either an open log, or the reason the
/// app has none.
///
/// Opening the log can fail, for instance on a machine that allows the app
/// neither the machine-wide directory nor a per-user one. The app still starts
/// in that case, so the operator reads the reason on screen instead of
/// watching a window that never appears. Every log command then returns the
/// same `storage_unavailable` error, and the UI refuses to print on the
/// strength of it. ADR 0004 keeps the log so that a replica that was printed
/// is a replica that was recorded, and a print run nobody could record must
/// not happen.
#[derive(Debug)]
pub enum LogState {
    /// The print log is open and every command works.
    Open(Store),
    /// The reason the print log could not be opened, ready to hand back to
    /// the UI as many times as it asks.
    Unavailable(String),
}

impl LogState {
    /// Opens the print log this machine should use, keeping the reason when
    /// it cannot be opened.
    pub fn for_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Self {
        match Store::open_for_app(app) {
            Ok(store) => Self::Open(store),
            Err(failure) => Self::Unavailable(failure.to_string()),
        }
    }

    /// The open log, or the failure from startup repeated word for word.
    pub fn store(&self) -> Result<&Store, LogError> {
        match self {
            Self::Open(store) => Ok(store),
            Self::Unavailable(reason) => Err(LogError::StorageUnavailable(reason.clone())),
        }
    }

    /// Which file holds the print log, or why there is none.
    pub fn storage_info(&self) -> StorageInfo {
        match self {
            Self::Open(store) => store.storage_info(),
            Self::Unavailable(reason) => StorageInfo::unavailable(reason.clone()),
        }
    }
}

/// Reads one print run with its newest verification attached.
///
/// The join picks a single verification row: the one with the latest
/// `verified_at`, and the highest id when two scans share a timestamp. Print
/// runs that were never verified still come back, with no verification.
const SELECT_PRINT_RUN: &str = "
    SELECT p.id, p.din, p.payload, p.copies, p.printer_name, p.job_id,
           p.operator_user, p.hostname, p.printed_at, p.zpl,
           v.scanned_payload, v.matched, v.verified_at
    FROM print_runs p
    LEFT JOIN verifications v ON v.id = (
        SELECT id FROM verifications
        WHERE print_run_id = p.id
        ORDER BY verified_at DESC, id DESC
        LIMIT 1
    )
";

fn read_print_run(connection: &Connection, id: i64) -> Result<PrintRun, LogError> {
    connection
        .query_row(
            &format!("{SELECT_PRINT_RUN} WHERE p.id = ?1"),
            [id],
            to_print_run,
        )
        .optional()?
        .ok_or(LogError::PrintRunNotFound(id))
}

/// Turns one row of [`SELECT_PRINT_RUN`] into a [`PrintRun`].
fn to_print_run(row: &Row<'_>) -> rusqlite::Result<PrintRun> {
    // The left join fills the last three columns only when the print run has
    // a verification, so the scanned payload says whether there is one.
    let scanned_payload: Option<String> = row.get(10)?;
    let verification = match scanned_payload {
        Some(scanned_payload) => Some(Verification {
            scanned_payload,
            matched: row.get(11)?,
            verified_at: row.get(12)?,
        }),
        None => None,
    };

    Ok(PrintRun {
        id: row.get(0)?,
        din: row.get(1)?,
        payload: row.get(2)?,
        copies: row.get(3)?,
        printer_name: row.get(4)?,
        job_id: row.get(5)?,
        operator_user: row.get(6)?,
        hostname: row.get(7)?,
        printed_at: row.get(8)?,
        zpl: row.get(9)?,
        verification,
    })
}

/// Builds the LIKE pattern that matches DINs starting with `din`.
///
/// `%`, `_`, and `\` mean something to LIKE, so they are escaped. A DIN holds
/// none of them, but the history screen passes whatever the operator typed.
fn prefix_pattern(din: &str) -> String {
    let mut pattern = String::with_capacity(din.len() + 1);
    for character in din.chars() {
        if matches!(character, '\\' | '%' | '_') {
            pattern.push('\\');
        }
        pattern.push(character);
    }
    pattern.push('%');
    pattern
}

/// The current time as an RFC 3339 timestamp in UTC, to the millisecond.
///
/// UTC keeps the log readable across a clock change, and the format sorts the
/// same as it reads, so ordering by the text column orders by time.
fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// The operator: the operating system user name and the computer name.
///
/// The computer name is the one a person sets and reads: Sharing in System
/// Settings on macOS, and the computer name on Windows. The network host name
/// is a different string that DHCP and domain policy can change under the
/// machine, which would make two print runs from one machine look like print
/// runs from two.
///
/// Either question can go unanswered. The log stores a placeholder in that
/// case rather than refusing to record the print run.
fn operator() -> (String, String) {
    (
        whoami::username().unwrap_or_else(|_| UNKNOWN.into()),
        whoami::devicename().unwrap_or_else(|_| UNKNOWN.into()),
    )
}

impl NewPrintRun {
    /// Trims the text fields and rejects a print run the log cannot describe.
    fn checked(mut self) -> Result<Self, LogError> {
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
        if self.copies == 0 {
            return Err(LogError::InvalidInput(
                "a print run with a copy count of zero printed nothing".into(),
            ));
        }
        Ok(self)
    }
}

impl NewVerification {
    /// Trims the scanned payload and rejects an empty scan.
    fn checked(mut self) -> Result<Self, LogError> {
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

    /// A print run for the real label the ISBT 128 tests use, with the copy
    /// count and printer the caller wants.
    fn print_run(din: &str, copies: u32) -> NewPrintRun {
        NewPrintRun {
            din: din.into(),
            payload: format!("={din}00"),
            copies,
            printer_name: "Zebra_ZD411".into(),
            job_id: Some("42".into()),
            zpl: "^XA^XZ".into(),
        }
    }

    /// Records a print run and hands it back, failing the test if the log
    /// refuses it.
    fn record(store: &Store, din: &str, copies: u32) -> PrintRun {
        store.record_print_run(print_run(din, copies)).unwrap()
    }

    #[test]
    fn a_recorded_print_run_reads_back_with_what_the_caller_sent() {
        let store = Store::open_in_memory();

        let recorded = record(&store, "W483626000011", 3);

        assert_eq!(recorded.din, "W483626000011");
        assert_eq!(recorded.payload, "=W48362600001100");
        assert_eq!(recorded.copies, 3);
        assert_eq!(recorded.printer_name, "Zebra_ZD411");
        assert_eq!(recorded.job_id.as_deref(), Some("42"));
        assert_eq!(recorded.zpl, "^XA^XZ");
        assert_eq!(recorded.verification, None);
    }

    #[test]
    fn the_log_fills_in_the_operator_and_the_time_itself() {
        let store = Store::open_in_memory();

        let recorded = record(&store, "W483626000011", 1);

        assert!(!recorded.operator_user.is_empty());
        assert!(!recorded.hostname.is_empty());
        // RFC 3339 in UTC, which is what the printed_at column promises.
        assert!(recorded.printed_at.ends_with('Z'));
        assert!(chrono::DateTime::parse_from_rfc3339(&recorded.printed_at).is_ok());
    }

    #[test]
    fn a_print_run_without_a_job_id_is_still_recorded() {
        let store = Store::open_in_memory();
        let mut input = print_run("W483626000011", 1);
        input.job_id = None;

        let recorded = store.record_print_run(input).unwrap();

        assert_eq!(recorded.job_id, None);
        assert_eq!(store.print_run(recorded.id).unwrap().job_id, None);
    }

    #[test]
    fn a_copy_count_of_zero_is_refused() {
        let store = Store::open_in_memory();

        let error = store
            .record_print_run(print_run("W483626000011", 0))
            .unwrap_err();

        assert_eq!(error.code(), "invalid_input");
    }

    #[test]
    fn a_print_run_without_a_din_is_refused() {
        let store = Store::open_in_memory();
        let mut input = print_run("W483626000011", 1);
        input.din = "   ".into();

        assert_eq!(
            store.record_print_run(input).unwrap_err().code(),
            "invalid_input"
        );
    }

    #[test]
    fn the_list_puts_the_newest_print_run_first() {
        let store = Store::open_in_memory();
        let first = record(&store, "W483626000011", 1);
        let second = record(&store, "W483626000029", 1);

        let listed = store.list_print_runs(PrintRunQuery::default()).unwrap();

        assert_eq!(
            listed.iter().map(|run| run.id).collect::<Vec<_>>(),
            vec![second.id, first.id]
        );
    }

    #[test]
    fn a_din_narrows_the_list_by_its_start() {
        let store = Store::open_in_memory();
        record(&store, "W483626000011", 1);
        record(&store, "W483626000029", 1);
        record(&store, "A123426000029", 1);

        let listed = store
            .list_print_runs(PrintRunQuery {
                din: Some("W4836".into()),
                ..PrintRunQuery::default()
            })
            .unwrap();

        assert_eq!(listed.len(), 2);
        assert!(listed.iter().all(|run| run.din.starts_with("W4836")));
    }

    #[test]
    fn a_din_that_matches_nothing_lists_nothing() {
        let store = Store::open_in_memory();
        record(&store, "W483626000011", 1);

        let listed = store
            .list_print_runs(PrintRunQuery {
                din: Some("Z".into()),
                ..PrintRunQuery::default()
            })
            .unwrap();

        assert!(listed.is_empty());
    }

    #[test]
    fn a_din_holding_a_like_wildcard_matches_nothing_rather_than_everything() {
        let store = Store::open_in_memory();
        record(&store, "W483626000011", 1);

        let listed = store
            .list_print_runs(PrintRunQuery {
                din: Some("%".into()),
                ..PrintRunQuery::default()
            })
            .unwrap();

        assert!(listed.is_empty());
    }

    #[test]
    fn the_limit_and_the_offset_page_through_the_list() {
        let store = Store::open_in_memory();
        let mut recorded = Vec::new();
        for sequence in 0..5 {
            recorded.push(record(&store, &format!("W48362600001{sequence}"), 1).id);
        }
        recorded.reverse();

        let page = store
            .list_print_runs(PrintRunQuery {
                din: None,
                limit: Some(2),
                offset: Some(2),
            })
            .unwrap();

        assert_eq!(
            page.iter().map(|run| run.id).collect::<Vec<_>>(),
            recorded[2..4].to_vec()
        );
    }

    #[test]
    fn a_limit_above_the_ceiling_is_brought_down_to_it() {
        let store = Store::open_in_memory();
        record(&store, "W483626000011", 1);

        // The ceiling is far above the one print run in the log, so this only
        // shows the query is accepted rather than refused.
        let listed = store
            .list_print_runs(PrintRunQuery {
                din: None,
                limit: Some(50_000),
                offset: None,
            })
            .unwrap();

        assert_eq!(listed.len(), 1);
    }

    #[test]
    fn a_verification_attaches_to_its_print_run() {
        let store = Store::open_in_memory();
        let recorded = record(&store, "W483626000011", 1);

        let verified = store
            .record_verification(NewVerification {
                print_run_id: recorded.id,
                scanned_payload: "=W48362600001100".into(),
                matched: true,
            })
            .unwrap();

        let verification = verified.verification.unwrap();
        assert_eq!(verification.scanned_payload, "=W48362600001100");
        assert!(verification.matched);
        assert!(chrono::DateTime::parse_from_rfc3339(&verification.verified_at).is_ok());
    }

    #[test]
    fn a_failed_verification_is_recorded_too() {
        let store = Store::open_in_memory();
        let recorded = record(&store, "W483626000011", 1);

        let verified = store
            .record_verification(NewVerification {
                print_run_id: recorded.id,
                scanned_payload: "=W48362600002900".into(),
                matched: false,
            })
            .unwrap();

        assert!(!verified.verification.unwrap().matched);
    }

    #[test]
    fn the_newest_verification_is_the_one_the_list_shows() {
        let store = Store::open_in_memory();
        let recorded = record(&store, "W483626000011", 1);
        store
            .record_verification(NewVerification {
                print_run_id: recorded.id,
                scanned_payload: "misread".into(),
                matched: false,
            })
            .unwrap();

        store
            .record_verification(NewVerification {
                print_run_id: recorded.id,
                scanned_payload: "=W48362600001100".into(),
                matched: true,
            })
            .unwrap();

        let listed = store.list_print_runs(PrintRunQuery::default()).unwrap();
        let verification = listed[0].verification.clone().unwrap();
        assert_eq!(verification.scanned_payload, "=W48362600001100");
        assert!(verification.matched);
    }

    #[test]
    fn verifying_a_print_run_that_is_not_in_the_log_is_refused() {
        let store = Store::open_in_memory();

        let error = store
            .record_verification(NewVerification {
                print_run_id: 404,
                scanned_payload: "=W48362600001100".into(),
                matched: true,
            })
            .unwrap_err();

        assert_eq!(error.code(), "print_run_not_found");
    }

    #[test]
    fn asking_for_a_print_run_that_is_not_in_the_log_is_refused() {
        let store = Store::open_in_memory();

        assert_eq!(
            store.print_run(404).unwrap_err().code(),
            "print_run_not_found"
        );
    }

    #[test]
    fn settings_start_at_their_defaults_and_survive_a_write() {
        let store = Store::open_in_memory();
        assert_eq!(store.settings().unwrap(), Settings::default());

        let chosen = Settings {
            selected_printer: Some("Zebra_ZD411".into()),
            verify_after_print: false,
            max_copies: 8,
        };
        assert_eq!(store.set_settings(chosen.clone()).unwrap(), chosen);
        assert_eq!(store.settings().unwrap(), chosen);
    }

    #[test]
    fn a_largest_copy_count_of_zero_is_refused() {
        let store = Store::open_in_memory();

        let error = store
            .set_settings(Settings {
                max_copies: 0,
                ..Settings::default()
            })
            .unwrap_err();

        assert_eq!(error.code(), "invalid_input");
        // The refused write left the stored settings alone.
        assert_eq!(store.settings().unwrap(), Settings::default());
    }

    #[test]
    fn a_print_run_serialises_in_camel_case_with_a_null_verification() {
        let store = Store::open_in_memory();
        let recorded = record(&store, "W483626000011", 2);

        let json = serde_json::to_value(&recorded).unwrap();

        assert_eq!(json["din"], "W483626000011");
        assert_eq!(json["copies"], 2);
        assert_eq!(json["printerName"], "Zebra_ZD411");
        assert_eq!(json["jobId"], "42");
        assert!(json["operatorUser"].is_string());
        assert!(json["printedAt"].is_string());
        assert!(json["verification"].is_null());
    }

    #[test]
    fn every_command_reports_the_reason_when_the_log_could_not_be_opened() {
        let state = LogState::Unavailable("the disk is full".into());

        let error = state.store().unwrap_err();

        assert_eq!(error.code(), "storage_unavailable");
        assert_eq!(error.to_string(), "the disk is full");
    }

    #[test]
    fn storage_info_carries_the_reason_the_log_could_not_be_opened() {
        let state = LogState::Unavailable("the disk is full".into());

        let info = state.storage_info();

        assert_eq!(info.unavailable.as_deref(), Some("the disk is full"));
        assert_eq!(info.database_path, None);
        assert!(!info.machine_wide);
    }

    #[test]
    fn an_open_log_reports_no_reason() {
        let state = LogState::Open(Store::open_in_memory());

        assert!(state.store().is_ok());
        assert_eq!(state.storage_info().unavailable, None);
    }

    /// The defect this guards against: the database file used to inherit the
    /// umask and come out 644, owned by whoever started the app first. The
    /// next staff account to log in could not write it and silently got a
    /// private log instead of the machine-wide one ADR 0004 asks for.
    ///
    /// The WAL and SHM files are checked too, because SQLite creates them
    /// with the database file's mode rather than the umask, which is what
    /// lets one relaxed mode cover all three.
    #[cfg(unix)]
    #[test]
    fn a_machine_wide_database_stays_writable_by_every_account() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let location = DatabaseLocation {
            path: directory.path().join(storage::DATABASE_FILE),
            machine_wide: true,
        };

        let store = Store::open(location.clone()).unwrap();
        record(&store, "W483626000011", 1);

        let mode =
            |path: &std::path::Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&location.path), 0o666, "the database file");
        assert_eq!(
            mode(&location.path.with_extension("sqlite-wal")),
            0o666,
            "the WAL file"
        );
        assert_eq!(
            mode(&location.path.with_extension("sqlite-shm")),
            0o666,
            "the SHM file"
        );
    }

    /// A per-user log has no second account to share with, so it keeps the
    /// permissions any new file gets on this machine. The comparison is made
    /// against a file created beside it rather than against a fixed mode,
    /// because the umask decides what that is.
    #[cfg(unix)]
    #[test]
    fn a_per_user_database_is_left_as_the_umask_made_it() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let location = DatabaseLocation {
            path: directory.path().join(storage::DATABASE_FILE),
            machine_wide: false,
        };

        let store = Store::open(location.clone()).unwrap();
        record(&store, "W483626000011", 1);

        let ordinary = directory.path().join("ordinary-file");
        std::fs::write(&ordinary, b"").unwrap();

        let mode =
            |path: &std::path::Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&location.path), mode(&ordinary));
    }

    #[test]
    fn errors_serialise_as_a_code_and_a_message() {
        let json = serde_json::to_value(LogError::PrintRunNotFound(7)).unwrap();

        assert_eq!(json["code"], "print_run_not_found");
        assert_eq!(json["message"], "no print run in the log has the id 7");
    }

    #[test]
    fn a_database_file_keeps_its_print_runs_across_opens() {
        let directory = tempfile::tempdir().unwrap();
        let location = DatabaseLocation {
            path: directory.path().join(storage::DATABASE_FILE),
            machine_wide: true,
        };

        let recorded = Store::open(location.clone())
            .unwrap()
            .record_print_run(print_run("W483626000011", 1))
            .unwrap();

        let reopened = Store::open(location).unwrap();
        assert_eq!(
            reopened.print_run(recorded.id).unwrap().din,
            "W483626000011"
        );
        assert!(reopened.storage_info().machine_wide);
    }
}
