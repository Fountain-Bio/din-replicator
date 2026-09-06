# DIN Replicator

A desktop tool that reads an existing ISBT 128 donation label and prints more labels that carry the same donation number. This glossary fixes the words the code, the UI, and the documents use.

## Identifiers

**DIN**:
The 13-character Donation Identification Number that ISBT 128 assigns to one collection event. Made of a FIN, a two-digit year, and a six-digit sequence.
_Avoid_: donation number, sample number, unit number, barcode number

**FIN**:
The five-character Facility Identification Number at the start of a DIN. It names the organization that assigned the DIN.
_Avoid_: facility code, site code, prefix

**Check character**:
The single character K that ISO 7064 MOD 37,2 derives from the 13 DIN characters. It confirms a DIN typed by hand and appears only in the eye-readable text, inside a box.
_Avoid_: checksum, check digit, K digit

**Flag characters**:
The two characters that follow the DIN inside the barcode. `00` means no flag is in use.
_Avoid_: suffix, trailing digits

**Barcode payload**:
The 16-character string a DIN barcode encodes: `=`, the DIN, and the flag characters.
_Avoid_: barcode data, barcode content, scan string

## Labels

**Source label**:
An existing label that carries the DIN the operator scans.
_Avoid_: original, master, the blood establishment computer system label

**Replica**:
A label printed by this app that carries the same barcode payload and eye-readable text as its source label.
_Avoid_: reprint, duplicate, copy

**Copy count**:
The number of replicas printed in one print run.
_Avoid_: copies, quantity

**Eye-readable text**:
The DIN, the flag characters, and the boxed check character printed under the barcode for a person to read.
_Avoid_: human readable, HRI, label text, caption

**Label font**:
The font the eye-readable text is printed in. Either the printer's own font, which is the font the source labels use, or one of the two fonts the app carries and sends to the printer with the label.
_Avoid_: typeface, font family, bundled font

**Label stock**:
The 1.75 by 0.75 inch media loaded in the printer.
_Avoid_: media, roll, sticker

## Workflow

**Scan**:
The raw string a barcode scanner delivers, in whatever form the scanner and its rules produce.
_Avoid_: input, read, keystrokes

**Print run**:
One print action: a DIN, a copy count, a printer, a time, an operator, and the result of verification if it happened.
_Avoid_: job, print, history entry, record

**Verification**:
Scanning a freshly printed replica so the app can confirm its barcode payload matches the DIN that was printed.
_Avoid_: check, validation, readback

**Operator**:
The person using the app, identified by the operating system user name and the computer name.
_Avoid_: user, staff, technician

**Printer**:
The Zebra print queue the app sends replicas to.
_Avoid_: device, Zebra, queue

## Surrounding systems

**the blood establishment computer system**:
The blood establishment computer system that assigns DINs and prints the source labels.

**ICCBBA**:
The organization that owns the ISBT 128 standard, assigns FINs, and licenses facilities to use the standard.
