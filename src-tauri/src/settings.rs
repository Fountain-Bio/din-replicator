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
use std::ops::RangeInclusive;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// The row key for each setting. Changing one of these strings orphans the row
/// an installed machine already wrote, so treat them as fixed.
const SELECTED_PRINTER: &str = "selected_printer";
const VERIFY_AFTER_PRINT: &str = "verify_after_print";
const MAX_COPIES: &str = "max_copies";
const PRINT_METHOD: &str = "print_method";
const DARKNESS: &str = "darkness";
const SPEED_IPS: &str = "speed_ips";
const LABEL_FONT: &str = "label_font";
const VERTICAL_OFFSET_DOTS: &str = "vertical_offset_dots";
const HORIZONTAL_OFFSET_DOTS: &str = "horizontal_offset_dots";

/// Ask the operator to scan a replica after every print run unless they turn
/// it off. Verification is the point of the app, so it starts on.
const DEFAULT_VERIFY_AFTER_PRINT: bool = true;

/// The largest copy count the UI offers. One roll of label stock is far
/// bigger, so this is a guard against a typed digit, not a supply limit.
const DEFAULT_MAX_COPIES: u32 = 20;

/// The largest value `max_copies` may be set to.
///
/// A print run sends one job per replica, so a ceiling keeps a mistyped
/// setting from filling the print queue. The label module refuses a copy count
/// above the same number: `src/lib/label/replica-zpl.ts` holds it as
/// `MAX_COPIES`, and the two must agree or the settings screen would offer a
/// copy count that no replica can be built for.
///
/// This is the settings screen's own limit and has nothing to do with how many
/// print runs the history screen reads at a time.
pub const MAX_COPIES_CEILING: u32 = 999;

/// How dark the printer burns, on the scale the printer itself uses. 16 is the
/// middle of the range and prints a readable barcode on the label stock the
/// clinics use, so it is where an operator starts before adjusting.
const DEFAULT_DARKNESS: u8 = 16;

/// The darkness values the printer accepts. Below the range the barcode comes
/// out too faint for a scanner; above it the ink spreads and the bars merge.
const DARKNESS_RANGE: RangeInclusive<u8> = 0..=30;

/// How fast the label moves through the printer, in inches per second. Slower
/// than the printer's top speed, because a barcode printed slowly has cleaner
/// bar edges and scans more reliably.
const DEFAULT_SPEED_IPS: u8 = 2;

/// The print speeds the printer accepts, in inches per second.
const SPEED_IPS_RANGE: RangeInclusive<u8> = 2..=6;

/// How far the printed content is moved on the label stock, in dots at 300
/// dpi. Zero prints where the label format puts the content, which is right
/// for a printer whose media sensor is calibrated.
///
/// The range is narrower than the printer accepts. A hundred dots is a third
/// of an inch, which is more than any correctly loaded roll is out by, and a
/// larger shift would push the bar code off the label.
const DEFAULT_OFFSET_DOTS: i16 = 0;
const OFFSET_DOTS_RANGE: RangeInclusive<i16> = -100..=100;

/// How the printer makes its mark on the label stock.
///
/// The two ways need different stock and different printer settings, so the
/// operator tells the app which one this printer is loaded for.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PrintMethod {
    /// The printer melts ink off a ribbon onto the label. The mark lasts, so
    /// this is what a label that has to stay readable through storage uses.
    #[default]
    ThermalTransfer,
    /// The printer heats the label itself, which darkens where it is heated.
    /// No ribbon is needed, and the mark fades with heat and light.
    DirectThermal,
}

impl PrintMethod {
    /// The text stored in the settings table, and the same word the UI reads
    /// on the wire, so the row says plainly which method is chosen.
    fn stored(self) -> &'static str {
        match self {
            Self::ThermalTransfer => "thermalTransfer",
            Self::DirectThermal => "directThermal",
        }
    }

    /// Reads back what [`PrintMethod::stored`] wrote. Anything else gives
    /// None, and the caller falls back to the default.
    fn from_stored(value: &str) -> Option<Self> {
        match value {
            "thermalTransfer" => Some(Self::ThermalTransfer),
            "directThermal" => Some(Self::DirectThermal),
            _ => None,
        }
    }
}

/// Which font the eye-readable line on a replica is printed in.
///
/// The printer's own font is what the source labels are set in. The other two
/// travel to the printer with each label, and the app decides what they are;
/// `src/lib/label/fonts.ts` holds them and names the same three values.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LabelFont {
    /// The printer's built-in scalable font, which is how this app has always
    /// printed and what an operator comparing a replica to its source sees.
    #[default]
    Printer,
    /// A bundled sans serif face.
    Sans,
    /// A bundled monospaced sans serif face, where every character is the same
    /// width so a DIN lines up column by column.
    Mono,
}

impl LabelFont {
    /// The text stored in the settings table, and the same word the UI reads
    /// on the wire, so the row says plainly which font is chosen.
    fn stored(self) -> &'static str {
        match self {
            Self::Printer => "printer",
            Self::Sans => "sans",
            Self::Mono => "mono",
        }
    }

    /// Reads back what [`LabelFont::stored`] wrote. Anything else gives None,
    /// and the caller falls back to the default.
    fn from_stored(value: &str) -> Option<Self> {
        match value {
            "printer" => Some(Self::Printer),
            "sans" => Some(Self::Sans),
            "mono" => Some(Self::Mono),
            _ => None,
        }
    }
}

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
    /// Which way the printer marks the label stock it is loaded with.
    pub print_method: PrintMethod,
    /// How dark the printer burns, on the printer's own 0 to 30 scale.
    pub darkness: u8,
    /// How fast the label moves through the printer, in inches per second.
    pub speed_ips: u8,
    /// Which font the eye-readable line on a replica is printed in.
    pub label_font: LabelFont,
    /// How far down the label the printed content is moved, in dots. A
    /// negative number moves it up.
    pub vertical_offset_dots: i16,
    /// How far right along the label the printed content is moved, in dots. A
    /// negative number moves it left.
    pub horizontal_offset_dots: i16,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            selected_printer: None,
            verify_after_print: DEFAULT_VERIFY_AFTER_PRINT,
            max_copies: DEFAULT_MAX_COPIES,
            print_method: PrintMethod::default(),
            darkness: DEFAULT_DARKNESS,
            speed_ips: DEFAULT_SPEED_IPS,
            label_font: LabelFont::default(),
            vertical_offset_dots: DEFAULT_OFFSET_DOTS,
            horizontal_offset_dots: DEFAULT_OFFSET_DOTS,
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
        if !DARKNESS_RANGE.contains(&self.darkness) {
            return Err(format!(
                "darkness must be from {} to {}",
                DARKNESS_RANGE.start(),
                DARKNESS_RANGE.end()
            ));
        }
        if !SPEED_IPS_RANGE.contains(&self.speed_ips) {
            return Err(format!(
                "print speed must be from {} to {} inches per second",
                SPEED_IPS_RANGE.start(),
                SPEED_IPS_RANGE.end()
            ));
        }
        for (name, offset) in [
            ("the vertical position", self.vertical_offset_dots),
            ("the horizontal position", self.horizontal_offset_dots),
        ] {
            if !OFFSET_DOTS_RANGE.contains(&offset) {
                return Err(format!(
                    "{name} must be from {} to {} dots",
                    OFFSET_DOTS_RANGE.start(),
                    OFFSET_DOTS_RANGE.end()
                ));
            }
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
        print_method: stored
            .get(PRINT_METHOD)
            .and_then(|value| PrintMethod::from_stored(value))
            .unwrap_or(defaults.print_method),
        darkness: stored
            .get(DARKNESS)
            .and_then(|value| value.parse().ok())
            .unwrap_or(defaults.darkness),
        speed_ips: stored
            .get(SPEED_IPS)
            .and_then(|value| value.parse().ok())
            .unwrap_or(defaults.speed_ips),
        label_font: stored
            .get(LABEL_FONT)
            .and_then(|value| LabelFont::from_stored(value))
            .unwrap_or(defaults.label_font),
        vertical_offset_dots: stored
            .get(VERTICAL_OFFSET_DOTS)
            .and_then(|value| value.parse().ok())
            .unwrap_or(defaults.vertical_offset_dots),
        horizontal_offset_dots: stored
            .get(HORIZONTAL_OFFSET_DOTS)
            .and_then(|value| value.parse().ok())
            .unwrap_or(defaults.horizontal_offset_dots),
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
    put(&transaction, PRINT_METHOD, settings.print_method.stored())?;
    put(&transaction, DARKNESS, &settings.darkness.to_string())?;
    put(&transaction, SPEED_IPS, &settings.speed_ips.to_string())?;
    put(&transaction, LABEL_FONT, settings.label_font.stored())?;
    put(
        &transaction,
        VERTICAL_OFFSET_DOTS,
        &settings.vertical_offset_dots.to_string(),
    )?;
    put(
        &transaction,
        HORIZONTAL_OFFSET_DOTS,
        &settings.horizontal_offset_dots.to_string(),
    )?;

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
        assert_eq!(settings.print_method, PrintMethod::ThermalTransfer);
        assert_eq!(settings.darkness, 16);
        assert_eq!(settings.speed_ips, 2);
        assert_eq!(settings.label_font, LabelFont::Printer);
        assert_eq!(settings.vertical_offset_dots, 0);
        assert_eq!(settings.horizontal_offset_dots, 0);
    }

    #[test]
    fn settings_survive_a_write_and_a_read() {
        let mut connection = database();
        // Every field is set away from its default, so a field that failed to
        // store would read back as the default and fail the comparison.
        let chosen = Settings {
            selected_printer: Some("Zebra_ZD411".into()),
            verify_after_print: false,
            max_copies: 5,
            print_method: PrintMethod::DirectThermal,
            darkness: 24,
            speed_ips: 2,
            label_font: LabelFont::Mono,
            vertical_offset_dots: -12,
            horizontal_offset_dots: 8,
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
        for (key, value) in [
            ("max_copies", "lots"),
            ("print_method", "engraving"),
            ("darkness", "very"),
            ("speed_ips", "brisk"),
            ("label_font", "copperplate"),
            ("vertical_offset_dots", "a bit down"),
            ("horizontal_offset_dots", "a bit across"),
        ] {
            connection
                .execute(
                    "INSERT INTO settings (key, value) VALUES (?1, ?2)",
                    [key, value],
                )
                .unwrap();
        }

        assert_eq!(read(&connection).unwrap(), Settings::default());
    }

    #[test]
    fn a_print_method_survives_the_trip_through_a_row() {
        let mut connection = database();

        for method in [PrintMethod::ThermalTransfer, PrintMethod::DirectThermal] {
            let chosen = Settings {
                print_method: method,
                ..Settings::default()
            };

            assert_eq!(
                write(&mut connection, &chosen).unwrap().print_method,
                method
            );
        }
    }

    #[test]
    fn a_label_font_survives_the_trip_through_a_row() {
        let mut connection = database();

        for font in [LabelFont::Printer, LabelFont::Sans, LabelFont::Mono] {
            let chosen = Settings {
                label_font: font,
                ..Settings::default()
            };

            assert_eq!(write(&mut connection, &chosen).unwrap().label_font, font);
        }
    }

    #[test]
    fn a_darkness_outside_the_printer_scale_is_refused() {
        for refused in [31, 200] {
            let settings = Settings {
                darkness: refused,
                ..Settings::default()
            };

            assert!(settings.check().is_err(), "{refused} should be refused");
        }

        for accepted in [0, 16, 30] {
            let settings = Settings {
                darkness: accepted,
                ..Settings::default()
            };

            assert_eq!(settings.check(), Ok(()), "{accepted} should be accepted");
        }
    }

    #[test]
    fn a_print_speed_outside_the_printer_range_is_refused() {
        for refused in [0, 1, 7] {
            let settings = Settings {
                speed_ips: refused,
                ..Settings::default()
            };

            assert!(settings.check().is_err(), "{refused} should be refused");
        }

        for accepted in [2, 4, 6] {
            let settings = Settings {
                speed_ips: accepted,
                ..Settings::default()
            };

            assert_eq!(settings.check(), Ok(()), "{accepted} should be accepted");
        }
    }

    #[test]
    fn a_print_position_outside_the_range_the_app_allows_is_refused() {
        for refused in [-101, 101, i16::MAX] {
            assert!(
                Settings {
                    vertical_offset_dots: refused,
                    ..Settings::default()
                }
                .check()
                .is_err(),
                "{refused} should be refused as a vertical position"
            );
            assert!(
                Settings {
                    horizontal_offset_dots: refused,
                    ..Settings::default()
                }
                .check()
                .is_err(),
                "{refused} should be refused as a horizontal position"
            );
        }

        for accepted in [-100, 0, 100] {
            assert_eq!(
                Settings {
                    vertical_offset_dots: accepted,
                    horizontal_offset_dots: accepted,
                    ..Settings::default()
                }
                .check(),
                Ok(())
            );
        }
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
            print_method: PrintMethod::DirectThermal,
            darkness: 16,
            speed_ips: 3,
            label_font: LabelFont::Sans,
            vertical_offset_dots: -4,
            horizontal_offset_dots: 4,
        })
        .unwrap();

        assert_eq!(json["selectedPrinter"], "Zebra_ZD411");
        assert_eq!(json["verifyAfterPrint"], true);
        assert_eq!(json["maxCopies"], 20);
        assert_eq!(json["printMethod"], "directThermal");
        assert_eq!(json["darkness"], 16);
        assert_eq!(json["speedIps"], 3);
        assert_eq!(json["labelFont"], "sans");
        assert_eq!(json["verticalOffsetDots"], -4);
        assert_eq!(json["horizontalOffsetDots"], 4);
    }

    #[test]
    fn the_default_print_method_is_the_one_that_lasts() {
        let json = serde_json::to_value(Settings::default()).unwrap();

        assert_eq!(json["printMethod"], "thermalTransfer");
    }

    #[test]
    fn the_default_label_font_is_the_printers_own() {
        let json = serde_json::to_value(Settings::default()).unwrap();

        assert_eq!(json["labelFont"], "printer");
    }
}
