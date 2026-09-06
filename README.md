# DIN Replicator

A desktop app that scans an ISBT 128 Donation Identification Number (DIN) label and prints replica labels on a USB Zebra printer. It runs on macOS and Windows.

An operator opens the app, scans a DIN label, chooses how many replicas to print, and presses Print. The app shows a preview of the exact label before it prints. After printing, the operator can scan one of the new labels to verify it. Every print run is recorded in a local database and can be found again by DIN.

## What it prints

The replica is a DIN label that follows ICCBBA ST-001, the ISBT 128 Standard Technical Specification:

- The barcode is Code 128 and encodes `=`, the 13-character DIN, and two flag characters. The default flag characters are `00`. The barcode starts in subset B and switches to subset C for the digits, so it fits on 1.75 by 0.75 inch label stock at a 0.25 mm module width.
- The check character K is computed with ISO/IEC 7064 MOD 37,2. It is printed inside a box in the eye-readable text and is never encoded in the barcode.
- The eye-readable text shows the DIN grouped as facility, year, and sequence, then the flag characters rotated 90 degrees, then the boxed check character.

`CONTEXT.md` defines the terms used in the code and the interface. `docs/adr/` records the decisions behind the design.

## Requirements

- A Zebra label printer connected by USB and added to the operating system. On macOS, add it in System Settings under Printers. On Windows, install the Zebra driver. The app prints raw ZPL through that print queue.
- The printer loaded with 1.75 by 0.75 inch label stock and calibrated for it. The app is written for a 300 dpi printer.
- A barcode scanner that acts as a keyboard. The scanner should send Enter or Tab after each barcode. The app also accepts a scan with no suffix.

## How scans are read

The app listens for scanner input at the window level, so a scan works no matter which control has focus. It accepts these forms and reads the DIN from each:

| Form                              | Example            | Notes                                                            |
| --------------------------------- | ------------------ | ---------------------------------------------------------------- |
| Compliant barcode payload         | `=W48362600001100` | `=`, DIN, flag characters                                        |
| Bare DIN                          | `W483626000011`    | Typed by hand or from a plain-text label                         |
| Legacy 15-character form          | `=W483626000011N`  | An earlier label tool encoded the check character in the barcode |
| Legacy form with a scanner suffix | `=W483626000011N0` | The legacy form after a scanner rule appends `0`                 |

Anything else is refused with a message that names what was scanned, for example a blood group or a product code. A legacy scan whose check character does not match the DIN is refused as a damaged or misprinted label.

## Print log

Every print run is stored in a SQLite database shared by every login on the machine: `/Users/Shared/DIN Replicator/` on macOS and `%ProgramData%\DIN Replicator\` on Windows. A print run records the DIN, the copy count, the printer, the operating system user and computer name, the time, the exact ZPL sent, and the result of verification if it happened. The History screen searches by DIN and can print a run again.

## Development

The app is built with Tauri v2. The interface is React with Tailwind and shadcn. Rust handles the printer and the database.

```
bun install
bun run tauri dev      # run the app
bun test               # TypeScript tests
bun run check          # typecheck, lint, format check
bun run preview:label  # render the replica label to out/label.png
cd src-tauri && cargo test
```

Layout:

- `src/lib/isbt128/` parses scans, validates DINs, and computes the check character and barcode payload. Its tests use the published ICCBBA vectors.
- `src/lib/label/` builds the replica label ZPL and chooses the barcode module width for the DIN.
- `src/features/` holds the scan, history, and settings screens.
- `src-tauri/src/printer/` talks to the print queue, with one implementation in `macos/` and one in `windows/`.
- `src-tauri/src/log/` is the print log. `src-tauri/src/platform/` picks the shared data directory per platform.

## Standards

- ICCBBA ST-001, ISBT 128 Standard Technical Specification, version 6.2.2.
- ICCBBA IG-043, A Validation Tool for ISBT 128 Data Structures, whose section 3.1.1 vectors are in the test suite.

Facilities that use ISBT 128 must be registered with ICCBBA.
