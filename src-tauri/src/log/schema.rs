//! The tables the print log stores, and how an older file catches up to them.
//!
//! The app ships one list of migrations. Each entry moves the database forward
//! by one step, and its position in the list is its version number. A
//! `schema_version` table records the versions already applied, so opening a
//! database only runs the entries it has not seen. Never edit a published
//! entry. Add a new one to the end instead, or a machine that already ran the
//! old text will not pick the change up.
//!
//! A step is a Rust function so that it can look at the database before it
//! decides what to do. Most of them only run a batch of SQL.

use rusqlite::{Connection, Transaction, TransactionBehavior};

/// One step forward, run inside the transaction that records it.
type Migration = fn(&Transaction<'_>) -> rusqlite::Result<()>;

/// The migrations, oldest first. Entry `n` is schema version `n + 1`.
const MIGRATIONS: &[Migration] = &[create_the_print_log, rename_copies_to_copy_count];

/// Version 1: the print log and the settings the UI remembers.
fn create_the_print_log(transaction: &Transaction<'_>) -> rusqlite::Result<()> {
    transaction.execute_batch(
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
    )
}

/// Version 2: the print run column that counts replicas is named `copy_count`,
/// the term CONTEXT.md gives it.
///
/// A few databases already have the column under that name. Version 1 carried
/// the new name for a short while before this migration existed, so a database
/// created in that window ran a version 1 that is not the one printed here.
/// Asking the table which columns it has, rather than trusting the version
/// number, is what keeps the rename from failing on those.
fn rename_copies_to_copy_count(transaction: &Transaction<'_>) -> rusqlite::Result<()> {
    if has_column(transaction, "print_runs", "copy_count")? {
        return Ok(());
    }
    transaction.execute_batch("ALTER TABLE print_runs RENAME COLUMN copies TO copy_count")
}

/// True when `table` already has a column called `column`.
fn has_column(transaction: &Transaction<'_>, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut found = false;
    // `table_info` gives one row per column, with the name in the second
    // field.
    transaction.pragma(None, "table_info", table, |row| {
        if row.get::<_, String>(1)? == column {
            found = true;
        }
        Ok(())
    })?;
    Ok(found)
}

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

    for (index, migration) in MIGRATIONS.iter().enumerate() {
        let version = index as i64 + 1;
        if version <= applied {
            continue;
        }

        migration(&transaction)?;
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
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    }

    /// The names of the columns `table` has, in the order the table declares
    /// them.
    fn column_names(connection: &Connection, table: &str) -> Vec<String> {
        let mut names = Vec::new();
        connection
            .pragma(None, "table_info", table, |row| {
                names.push(row.get::<_, String>(1)?);
                Ok(())
            })
            .unwrap();
        names
    }

    /// A database as the first release of the app left it: version 1 with the
    /// print run column still called `copies`, and one print run in it.
    fn database_from_the_first_release() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        let transaction = connection.transaction().unwrap();
        create_the_print_log(&transaction).unwrap();
        transaction
            .execute_batch(
                "CREATE TABLE schema_version (version INTEGER NOT NULL);
                 INSERT INTO schema_version (version) VALUES (1);
                 INSERT INTO print_runs
                     (din, payload, copies, printer_name, job_id,
                      operator_user, hostname, printed_at, zpl)
                 VALUES ('W483626000011', '=W48362600001100', 3, 'Lab_Printer',
                         '42', 'operator', 'Front Desk Mac',
                         '2026-09-06T12:00:00.000Z', '^XA^XZ');",
            )
            .unwrap();
        transaction.commit().unwrap();
        connection
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

    /// The machines that ran the first release hold a print log whose column
    /// is called `copies`. Version 2 renames it, and the print runs already in
    /// the log come through the rename.
    #[test]
    fn a_database_from_the_first_release_gains_the_new_column_name() {
        let mut connection = database_from_the_first_release();

        migrate(&mut connection).unwrap();

        let columns = column_names(&connection, "print_runs");
        assert!(columns.contains(&"copy_count".to_string()));
        assert!(!columns.contains(&"copies".to_string()));

        let (din, copy_count): (String, u32) = connection
            .query_row("SELECT din, copy_count FROM print_runs", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(din, "W483626000011");
        assert_eq!(copy_count, 3);

        let version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 2);
    }

    /// A database made in the window when version 1 itself created the column
    /// as `copy_count`. The rename would fail on it, so version 2 checks the
    /// columns and does nothing.
    #[test]
    fn a_database_whose_first_version_already_used_the_new_name_still_migrates() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE print_runs (
                     id         INTEGER PRIMARY KEY,
                     copy_count INTEGER NOT NULL
                 );
                 CREATE TABLE schema_version (version INTEGER NOT NULL);
                 INSERT INTO schema_version (version) VALUES (1);",
            )
            .unwrap();

        migrate(&mut connection).unwrap();

        assert_eq!(
            column_names(&connection, "print_runs"),
            ["id", "copy_count"]
        );
        let version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 2);
    }

    /// A database the app creates today runs both migrations in one go and
    /// ends up with the same columns as one that was migrated.
    #[test]
    fn a_fresh_database_reaches_the_newest_version_with_the_new_column_name() {
        let mut connection = Connection::open_in_memory().unwrap();

        migrate(&mut connection).unwrap();

        let columns = column_names(&connection, "print_runs");
        assert!(columns.contains(&"copy_count".to_string()));
        assert!(!columns.contains(&"copies".to_string()));

        let version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
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
