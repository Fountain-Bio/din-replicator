//! The open database: the statements the print log runs and the rows they
//! give back.

use std::sync::{Mutex, MutexGuard};

use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};

use super::storage::{self, DatabaseLocation, StorageInfo};
use super::Verification;
use super::{operator, schema, LogError, NewPrintRun, NewVerification, PrintRun, PrintRunQuery};
use crate::settings::{self, Settings};

/// How many print runs the history screen asks for when it does not say.
pub const DEFAULT_LIMIT: u32 = 100;

/// The most print runs one call may ask for. The history screen pages through
/// the log, and a query without a ceiling would pull years of print runs into
/// the UI at once.
const MAX_LIMIT: u32 = 1000;

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
        // Asked before the connection is opened, because opening it is what
        // creates the file.
        let created_here = !location.path.exists();

        let mut connection = Connection::open(&location.path).map_err(|error| {
            LogError::StorageUnavailable(format!(
                "the print log could not be opened at {}: {error}",
                location.path.display()
            ))
        })?;

        // A file this launch created belongs to the account that launched the
        // app. A machine-wide log has to stay writable by the next account to
        // log in, so its rights are opened up the same way the directory's
        // were.
        //
        // A file that was already there is left alone. The operating system
        // refuses an attempt to change the rights of a file another account
        // owns, so trying on every launch would fail for every account except
        // the one that created the log.
        //
        // Failing here does not stop this login from printing, and it is not
        // this login that suffers. The account that cannot write the file runs
        // the write probe itself, falls back to a per-user log, and says so
        // through its own storage_info. The failure is printed so it shows up
        // in a support session on this machine.
        if location.machine_wide && created_here {
            if let Err(error) = crate::platform::make_shared(&location.path) {
                eprintln!(
                    "could not open the print log at {} up to every account on this machine: {error}",
                    location.path.display()
                );
            }
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
    /// The busy timeout is set first, because the pragmas after it can be the
    /// ones that have to wait. Switching to WAL takes the database's exclusive
    /// lock, and the file is machine-wide, so two logins on one machine can
    /// each start the app for the first time and reach that switch together.
    /// With the timeout already in force the second one waits instead of
    /// failing outright.
    ///
    /// WAL then lets the history screen read while a print run is being
    /// written. Foreign keys are off by default in SQLite, so turning them on
    /// is what makes a verification's reference to its print run real.
    fn prepare(connection: &mut Connection) -> Result<(), LogError> {
        connection.execute_batch(
            "PRAGMA busy_timeout = 5000;
             PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;",
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
                 (din, payload, copy_count, printer_name, job_id,
                  operator_user, hostname, printed_at, zpl)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                input.din,
                input.payload,
                input.copy_count,
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

        // The foreign key would refuse the insert on its own, but only as a
        // database failure. Looking the print run up first is what lets the UI
        // see the print_run_not_found code instead.
        transaction
            .query_row(
                "SELECT 1 FROM print_runs WHERE id = ?1",
                [input.print_run_id],
                |_| Ok(()),
            )
            .optional()?
            .ok_or(LogError::PrintRunNotFound(input.print_run_id))?;

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

        // The rows borrow `statement`, so they are collected into a binding
        // that outlives it rather than returned straight out of the block.
        let runs = statement
            .query_map(params![pattern, limit, offset], to_print_run)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(runs)
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
    pub(super) fn open_in_memory() -> Self {
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

/// Reads one print run with its newest verification attached.
///
/// The join picks a single verification row: the one with the latest
/// `verified_at`, and the highest id when two scans share a timestamp. Print
/// runs that were never verified still come back, with no verification.
const SELECT_PRINT_RUN: &str = "
    SELECT p.id, p.din, p.payload, p.copy_count, p.printer_name, p.job_id,
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
        copy_count: row.get(3)?,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command_error::CommandError;

    /// A print run for the real label the ISBT 128 tests use, with the copy
    /// count and printer the caller wants.
    fn print_run(din: &str, copy_count: u32) -> NewPrintRun {
        NewPrintRun {
            din: din.into(),
            payload: format!("={din}00"),
            copy_count,
            printer_name: "Lab_Printer".into(),
            job_id: Some("42".into()),
            zpl: "^XA^XZ".into(),
        }
    }

    /// Records a print run and hands it back, failing the test if the log
    /// refuses it.
    fn record(store: &Store, din: &str, copy_count: u32) -> PrintRun {
        store.record_print_run(print_run(din, copy_count)).unwrap()
    }

    /// The one print run in a log that holds one, read back from the list.
    fn only_print_run(store: &Store) -> PrintRun {
        let listed = store.list_print_runs(PrintRunQuery::default()).unwrap();
        assert_eq!(listed.len(), 1);
        listed.into_iter().next().unwrap()
    }

    #[test]
    fn a_recorded_print_run_reads_back_with_what_the_caller_sent() {
        let store = Store::open_in_memory();

        let recorded = record(&store, "W483626000011", 3);

        assert_eq!(recorded.din, "W483626000011");
        assert_eq!(recorded.payload, "=W48362600001100");
        assert_eq!(recorded.copy_count, 3);
        assert_eq!(recorded.printer_name, "Lab_Printer");
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
        assert_eq!(only_print_run(&store).job_id, None);
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

        let verification = only_print_run(&store).verification.unwrap();
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
    fn settings_start_at_their_defaults_and_survive_a_write() {
        let store = Store::open_in_memory();
        assert_eq!(store.settings().unwrap(), Settings::default());

        let chosen = Settings {
            selected_printer: Some("Lab_Printer".into()),
            verify_after_print: false,
            max_copies: 8,
            ..Settings::default()
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

    /// Only the launch that created the database file may change its rights.
    /// Later launches leave the file as they find it, because the account that
    /// owns it is the only one the operating system lets change it.
    #[cfg(unix)]
    #[test]
    fn a_database_file_that_is_already_there_keeps_the_rights_it_has() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let location = DatabaseLocation {
            path: directory.path().join(storage::DATABASE_FILE),
            machine_wide: true,
        };
        Store::open(location.clone()).unwrap();
        std::fs::set_permissions(&location.path, std::fs::Permissions::from_mode(0o644)).unwrap();

        Store::open(location.clone()).unwrap();

        let mode = std::fs::metadata(&location.path)
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o644);
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
    fn a_database_file_keeps_its_print_runs_across_opens() {
        let directory = tempfile::tempdir().unwrap();
        let location = DatabaseLocation {
            path: directory.path().join(storage::DATABASE_FILE),
            machine_wide: true,
        };

        Store::open(location.clone())
            .unwrap()
            .record_print_run(print_run("W483626000011", 1))
            .unwrap();

        let reopened = Store::open(location).unwrap();
        assert_eq!(only_print_run(&reopened).din, "W483626000011");
        assert!(reopened.storage_info().machine_wide);
    }
}
