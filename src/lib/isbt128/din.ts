/**
 * The DIN itself: its structure rules, the barcode payload built from it, and
 * the eye-readable text printed under the barcode.
 */

import { checkCharacter } from "./check-character";

/** The DIN is 13 characters: a 5-character FIN, a 2-digit year, a 6-digit sequence. */
export const DIN_LENGTH = 13;

/**
 * ST-001 section 2.4.1 defines Data Structure 001 as "=" followed by the DIN
 * and the two flag characters.
 */
export const DIN_DATA_IDENTIFIER = "=";

/** The flag characters this app prints. "00" means no flag is in use. */
export const DEFAULT_FLAG_CHARACTERS = "00";

/**
 * ST-001 section 2.4.1: the first character of a FIN never uses "O" or "0",
 * because a person reading the label could confuse the two.
 */
const FIRST_CHARACTER = /^[A-NP-Z1-9]$/;

/**
 * IG-043 section 3.1: FIN characters 2 and 3 allow "0" but still exclude "O".
 */
const FACILITY_CHARACTER = /^[A-NP-Z0-9]$/;

/**
 * IG-043 section 3.1: the last ten characters of a DIN are digits. They are the
 * last two characters of the FIN, the two-digit year, and the six-digit
 * sequence.
 */
const TRAILING_DIGITS = /^\d{10}$/;

/**
 * ST-001 section 2.4.1 restricts each flag character to this set. It leaves out
 * "I", "O", "Q", and "Z" so a person cannot confuse them with digits.
 */
const FLAG_CHARACTER = /^[0-9A-HJ-NPR-Y]$/;

/** Why a string failed the DIN structure rules. */
export type DinInvalidReason =
  /** The string is not exactly 13 characters. */
  | "wrong-length"
  /** Character 1 is outside {A-N, P-Z, 1-9}. */
  | "bad-first-character"
  /** Character 2 or 3 is outside {A-N, P-Z, 0-9}. */
  | "bad-facility-character"
  /** One of characters 4 to 13 is not a digit. */
  | "non-digit";

/** The result of checking a string against the DIN structure rules. */
export type DinValidation =
  | { ok: true; din: string; fin: string; year: string; sequence: string }
  | { ok: false; reason: DinInvalidReason };

/** The parts of a DIN a label prints for a person to read. */
export interface EyeReadable {
  fin: string;
  year: string;
  sequence: string;
  flags: string;
  check: string;
  /** The FIN, the year, and the sequence separated by spaces, such as `W4836 26 000011`. */
  text: string;
}

/**
 * Checks `din` against the DIN structure rules in ST-001 section 2.4.1 and
 * IG-043 section 3.1, and splits a valid DIN into its parts.
 *
 * Any FIN is accepted. This app prints replicas of labels from any facility, so
 * it never checks the FIN against a list.
 */
export function validateDin(din: string): DinValidation {
  if (din.length !== DIN_LENGTH) {
    return { ok: false, reason: "wrong-length" };
  }
  if (!FIRST_CHARACTER.test(din[0])) {
    return { ok: false, reason: "bad-first-character" };
  }
  if (!FACILITY_CHARACTER.test(din[1]) || !FACILITY_CHARACTER.test(din[2])) {
    return { ok: false, reason: "bad-facility-character" };
  }
  if (!TRAILING_DIGITS.test(din.slice(3))) {
    return { ok: false, reason: "non-digit" };
  }
  return {
    ok: true,
    din,
    fin: din.slice(0, 5),
    year: din.slice(5, 7),
    sequence: din.slice(7),
  };
}

/** True when `flags` is exactly two characters and both are legal flag characters. */
export function isFlagCharacters(flags: string): boolean {
  return flags.length === 2 && FLAG_CHARACTER.test(flags[0]) && FLAG_CHARACTER.test(flags[1]);
}

/**
 * Builds the 16-character barcode payload for `din`.
 *
 * ST-001 section 2.4.1 defines the payload as "=", the 13-character DIN, and
 * two flag characters. The check character is absent by design: ST-001 section
 * 7.5 keeps K out of the data content, and ADR 0002 records why this app
 * follows that rule instead of the 15-character form the the earlier label tool
 * project prints.
 */
export function barcodePayload(din: string, flags: string = DEFAULT_FLAG_CHARACTERS): string {
  const validation = validateDin(din);
  if (!validation.ok) {
    throw new Error(`Cannot build a barcode payload from "${din}": ${validation.reason}`);
  }
  if (!isFlagCharacters(flags)) {
    throw new Error(`Cannot build a barcode payload with flag characters "${flags}"`);
  }
  return `${DIN_DATA_IDENTIFIER}${din}${flags}`;
}

/**
 * Returns the parts of the eye-readable text for `din`.
 *
 * IG-002 section 4.1.1.2 gives the United States convention for the text under
 * a DIN barcode: the FIN, a space, the two-digit year, a space, and the
 * six-digit sequence. The flag characters and the boxed check character sit
 * beside that text. The caller decides where each part goes on the label.
 *
 * `flags` takes the same values as in `barcodePayload`. A label prints the flag
 * characters that its barcode encodes, so a caller that passes flag characters
 * to one function passes the same ones to the other.
 */
export function eyeReadable(din: string, flags: string = DEFAULT_FLAG_CHARACTERS): EyeReadable {
  const validation = validateDin(din);
  if (!validation.ok) {
    throw new Error(`Cannot build eye-readable text from "${din}": ${validation.reason}`);
  }
  if (!isFlagCharacters(flags)) {
    throw new Error(`Cannot build eye-readable text with flag characters "${flags}"`);
  }
  return {
    fin: validation.fin,
    year: validation.year,
    sequence: validation.sequence,
    flags,
    check: checkCharacter(din),
    text: `${validation.fin} ${validation.year} ${validation.sequence}`,
  };
}
