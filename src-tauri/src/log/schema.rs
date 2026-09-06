//! The tables the print log stores, and how an older file catches up to them.
//!
//! The app ships one list of migrations. Each entry is the SQL that moves the
//! database forward by one step, and its position in the list is its version
//! number. A `schema_version` table records the versions already applied, so
//! opening a database only runs the entries it has not seen. Never edit a
//! published entry. Add a new one to the end instead, or a machine that
//! already ran the old text will not pick the change up.

use rusqlite::{Connection, TransactionBehavior};

/// The migrations, oldest first. Entry `n` is schema version `n + 1`.
const MIGRATIONS: &[&str] = &[
    // Version 1: the print log and the settings the UI remembers.
    "
    CREATE TABLE print_runs (
        id            INTEGER PRIMARY KEY,
        din           TEXT    NOT NULL,
        payload       TEXT    NOT NULL,
        copies        INTEGER NOT NULL,
        printer_name  TEXT    NOT NULL,
        job_id        TEXT    NULL,
        operator_user TEXT    NOT NULL,
        hostname      TEXT    NOT NULL,
        printed_at    TEXT    NOT NULL,
        zpl           TEXT    NOT NULL
    );

    -- The history screen searches by DIN and lists newest first.
    CREATE INDEX print_runs_din ON print_runs (din);
    CREATE INDEX print_runs_printed_at ON print_runs (printed_at);

    CREATE TABLE verifications (
        id              INTEGER PRIMARY KEY,
        print_run_id    INTEGER NOT NULL REFERENCES print_runs (id),
        scanned_payload TEXT    NOT NULL,
        matched         INTEGER NOT NULL,
        verified_at     TEXT    NOT NULL
    );

    CREATE INDEX verifications_print_run_id ON verifications (print_run_id);

    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    ",
];

/// Brings `connection` up to the newest schema version.
///
/// Reading the applied versions and applying the missing ones happen inside
/// one `BEGIN IMMEDIATE` transaction. Immediate takes the database's write
/// lock at the start rather than at the first write, which matters on a fresh
/// machine: two staff accounts can be logged in and both start the app for the
/// first time. Both would otherwise read version 0 and then run
/// `CREATE TABLE print_runs`, and the second one would fail. With the write
/// lock held from the start, the second app waits out the busy timeout, then
/// reads the versions the first one wrote and finds nothing left to do.
///
/// Every migration and the rows that record them go in together, so a
/// migration that fails part way leaves the database at the version it
/// started on and the next attempt runs it again.
pub fn migrate(connection: &mut Connection) -> rusqlite::Result<()> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;

    transaction
        .execute_batch("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")?;

    let applied: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version",
        [],
        |row| row.get(0),
    )?;

    for (index, statements) in MIGRATIONS.iter().enumerate() {
        let version = index as i64 + 1;
        if version <= applied {
            continue;
        }

        transaction.execute_batch(statements)?;
        transaction.execute(
            "INSERT INTO schema_version (version) VALUES (?1)",
            [version],
        )?;
    }

    transaction.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_names(connection: &Connection) -> Vec<String> {
        let mut statement = connection
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap();
        let names = statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        names
    }

    #[test]
    fn migrating_an_empty_database_creates_every_table() {
        let mut connection = Connection::open_in_memory().unwrap();

        migrate(&mut connection).unwrap();

        let names = table_names(&connection);
        for expected in ["print_runs", "verifications", "settings", "schema_version"] {
            assert!(names.contains(&expected.to_string()), "missing {expected}");
        }
    }

    #[test]
    fn the_version_rows_match_the_migration_list() {
        let mut connection = Connection::open_in_memory().unwrap();

        migrate(&mut connection).unwrap();

        let version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
    }

    #[test]
    fn migrating_twice_changes_nothing_the_second_time() {
        let mut connection = Connection::open_in_memory().unwrap();

        migrate(&mut connection).unwrap();
        migrate(&mut connection).unwrap();

        let rows: i64 = connection
            .query_row("SELECT COUNT(*) FROM schema_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, MIGRATIONS.len() as i64);
    }

    #[test]
    fn a_migrated_database_keeps_the_rows_it_already_held() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        connection
            .execute(
                "INSERT INTO settings (key, value) VALUES ('max_copies', '5')",
                [],
            )
            .unwrap();

        migrate(&mut connection).unwrap();

        let value: String = connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'max_copies'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "5");
    }
}
