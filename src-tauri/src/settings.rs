//! The choices the app remembers between runs: which printer to send replicas
//! to, whether to ask the operator to verify a replica after printing, and the
//! largest copy count the UI offers.
//!
//! Settings live in the `settings` table of the print log database, one row
//! per setting. That table is machine-wide like the rest of the file, so every
//! staff account on a clinic machine gets the same printer already chosen.
//! Reading a setting that has no row gives the default, so a fresh install and
//! an install that never touched the settings screen behave the same.

use std::collections::HashMap;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// The row key for each setting. Changing one of these strings orphans the row
/// an installed machine already wrote, so treat them as fixed.
const SELECTED_PRINTER: &str = "selected_printer";
const VERIFY_AFTER_PRINT: &str = "verify_after_print";
const MAX_COPIES: &str = "max_copies";

/// Ask the operator to scan a replica after every print run unless they turn
/// it off. Verification is the point of the app, so it starts on.
const DEFAULT_VERIFY_AFTER_PRINT: bool = true;

/// The largest copy count the UI offers. One roll of label stock is far
/// bigger, so this is a guard against a typed digit, not a supply limit.
const DEFAULT_MAX_COPIES: u32 = 20;

/// The largest value `max_copies` may be set to.
///
/// A print run sends one job per replica, so a ceiling keeps a mistyped
/// setting from filling the print queue. This is the settings screen's own
/// limit and has nothing to do with how many print runs the history screen
/// reads at a time.
pub const MAX_COPIES_CEILING: u32 = 1000;

/// What `get_settings` returns and `set_settings` takes.
///
/// Every field is always present on the wire. `selectedPrinter` is null until
/// an operator picks a printer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// The name of the print queue replicas go to, as the operating system
    /// lists it. Null when no printer has been chosen yet.
    pub selected_printer: Option<String>,
    /// True when the app asks the operator to scan a replica after a print
    /// run and compares the scan against the barcode payload it printed.
    pub verify_after_print: bool,
    /// The largest copy count one print run may ask for.
    pub max_copies: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            selected_printer: None,
            verify_after_print: DEFAULT_VERIFY_AFTER_PRINT,
            max_copies: DEFAULT_MAX_COPIES,
        }
    }
}

impl Settings {
    /// Rejects settings the app cannot work with. The message says what is
    /// wrong, in words the settings screen can show as it stands.
    pub fn check(&self) -> Result<(), String> {
        if self.max_copies == 0 {
            return Err("the largest copy count must be at least 1".into());
        }
        if self.max_copies > MAX_COPIES_CEILING {
            return Err(format!(
                "the largest copy count must be {MAX_COPIES_CEILING} or fewer"
            ));
        }
        Ok(())
    }
}

/// Reads every setting, filling in the default for any that has no row.
///
/// A row holding text the app cannot parse, such as a hand-edited
/// `max_copies`, also falls back to the default. A settings file nobody can
/// read would leave the operator unable to print at all.
pub fn read(connection: &Connection) -> rusqlite::Result<Settings> {
    let mut statement = connection.prepare("SELECT key, value FROM settings")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let stored: HashMap<String, String> = rows.collect::<rusqlite::Result<_>>()?;
    let defaults = Settings::default();

    Ok(Settings {
        selected_printer: stored.get(SELECTED_PRINTER).cloned(),
        verify_after_print: stored
            .get(VERIFY_AFTER_PRINT)
            .and_then(|value| value.parse().ok())
            .unwrap_or(defaults.verify_after_print),
        max_copies: stored
            .get(MAX_COPIES)
            .and_then(|value| value.parse().ok())
            .unwrap_or(defaults.max_copies),
    })
}

/// Writes every setting, then reads them back so the caller sees what the
/// database now holds.
///
/// All the rows go in together. A half-written settings table would leave the
/// app pointing at one printer with another one's copy limit.
///
/// A null `selected_printer` deletes the row rather than storing an empty
/// string, so "no printer chosen" reads back the same way it was written.
pub fn write(connection: &mut Connection, settings: &Settings) -> rusqlite::Result<Settings> {
    let transaction = connection.transaction()?;

    match &settings.selected_printer {
        Some(printer) => put(&transaction, SELECTED_PRINTER, printer)?,
        None => {
            transaction.execute("DELETE FROM settings WHERE key = ?1", [SELECTED_PRINTER])?;
        }
    }
    put(
        &transaction,
        VERIFY_AFTER_PRINT,
        &settings.verify_after_print.to_string(),
    )?;
    put(&transaction, MAX_COPIES, &settings.max_copies.to_string())?;

    transaction.commit()?;
    read(connection)
}

/// Stores one setting, replacing whatever the key held before.
fn put(connection: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::log::schema;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        schema::migrate(&mut connection).unwrap();
        connection
    }

    #[test]
    fn an_untouched_database_reads_back_the_defaults() {
        let connection = database();

        let settings = read(&connection).unwrap();

        assert_eq!(settings.selected_printer, None);
        assert!(settings.verify_after_print);
        assert_eq!(settings.max_copies, 20);
    }

    #[test]
    fn settings_survive_a_write_and_a_read() {
        let mut connection = database();
        let chosen = Settings {
            selected_printer: Some("Zebra_ZD411".into()),
            verify_after_print: false,
            max_copies: 5,
        };

        let returned = write(&mut connection, &chosen).unwrap();

        assert_eq!(returned, chosen);
        assert_eq!(read(&connection).unwrap(), chosen);
    }

    #[test]
    fn clearing_the_printer_removes_its_row() {
        let mut connection = database();
        write(
            &mut connection,
            &Settings {
                selected_printer: Some("Zebra_ZD411".into()),
                ..Settings::default()
            },
        )
        .unwrap();

        let returned = write(&mut connection, &Settings::default()).unwrap();

        assert_eq!(returned.selected_printer, None);
        let rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key = 'selected_printer'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn a_row_the_app_cannot_parse_reads_back_as_the_default() {
        let connection = database();
        connection
            .execute(
                "INSERT INTO settings (key, value) VALUES ('max_copies', 'lots')",
                [],
            )
            .unwrap();

        assert_eq!(read(&connection).unwrap().max_copies, 20);
    }

    #[test]
    fn the_defaults_pass_their_own_check() {
        assert_eq!(Settings::default().check(), Ok(()));
    }

    #[test]
    fn a_largest_copy_count_outside_the_range_is_refused() {
        for refused in [0, MAX_COPIES_CEILING + 1] {
            let settings = Settings {
                max_copies: refused,
                ..Settings::default()
            };

            assert!(settings.check().is_err(), "{refused} should be refused");
        }

        let settings = Settings {
            max_copies: MAX_COPIES_CEILING,
            ..Settings::default()
        };
        assert_eq!(settings.check(), Ok(()));
    }

    #[test]
    fn settings_serialise_in_camel_case() {
        let json = serde_json::to_value(Settings {
            selected_printer: Some("Zebra_ZD411".into()),
            verify_after_print: true,
            max_copies: 20,
        })
        .unwrap();

        assert_eq!(json["selectedPrinter"], "Zebra_ZD411");
        assert_eq!(json["verifyAfterPrint"], true);
        assert_eq!(json["maxCopies"], 20);
    }
}
