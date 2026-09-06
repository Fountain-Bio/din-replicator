/**
 * Turns the raw string a barcode scanner delivers into a bare DIN.
 *
 * A scan reaches this app in whatever form the source label and the scanner
 * rules produce. ADR 0002 lists the forms this app accepts. When the scan is
 * not a DIN, the result names the ISBT 128 structure it found instead, so the
 * UI can tell the operator what they scanned. This module reports what it
 * found and never decides whether to refuse a scan.
 */

import { checkCharacter, isCheckCharacter } from "./check-character";
import { DIN_LENGTH, isFlagCharacters, validateDin, type DinInvalidReason } from "./din";

/** ST-001 section 2.4.1: Data Structure 001 starts with "=". */
const DIN_DATA_IDENTIFIER = "=";

/** The length of "=" plus the DIN plus one check character, the the earlier label tool form. */
const LEGACY_CHECK_LENGTH = 1 + DIN_LENGTH + 1;

/** The length of "=" plus the DIN plus two more characters, the compliant form. */
const PAYLOAD_LENGTH = 1 + DIN_LENGTH + 2;

/** Which of the accepted forms the scan arrived in. */
export type ScanForm =
  /** The 13-character DIN on its own, with no data identifier. */
  | "bare"
  /** The compliant 16-character payload: "=", the DIN, and two flag characters. */
  | "payload"
  /** The 15-character form the the earlier label tool project prints: "=", the DIN, and K. */
  | "legacy-check"
  /** The the earlier label tool form after a scanner rule appended a "0". */
  | "legacy-check-suffixed";

/** Why a scan did not yield a DIN. */
export type NotDinReason =
  /** The scan looked like a DIN structure but broke a DIN structure rule. */
  | DinInvalidReason
  /** The scan held nothing once whitespace was removed. */
  | "empty"
  /** ISBT 128 blood groups, data identifier "=%". */
  | "blood-group"
  /** ISBT 128 product code, data identifier "=<". */
  | "product-code"
  /** ISBT 128 expiration date or date and time, data identifier "=>" or "&>". */
  | "expiration"
  /** Some other ISBT 128 structure, such as one starting with "&,". */
  | "other-isbt128-structure"
  /** Nothing about the scan resembles ISBT 128. */
  | "unrecognized";

/** What a scan turned out to be. */
export type ScanResult =
  | {
      kind: "din";
      /** The bare 13-character DIN, uppercase. */
      din: string;
      form: ScanForm;
      /** The two flag characters, present only for the compliant payload form. */
      flags?: string;
      /** The check character the scan carried, present only for the two legacy forms. */
      scannedCheck?: string;
      /** Whether `scannedCheck` equals the check character computed from `din`. */
      checkMatches?: boolean;
    }
  | { kind: "not-din"; reason: NotDinReason };

/**
 * Normalizes `raw` and reports the DIN inside it, or names what else it holds.
 *
 * Whitespace, including the carriage return and line feed a scanner sends as a
 * terminator, is removed from both ends. The rest is uppercased, because ISBT
 * 128 uses uppercase characters only.
 */
export function parseScan(raw: string): ScanResult {
  const scan = raw.trim().toUpperCase();
  if (scan.length === 0) {
    return { kind: "not-din", reason: "empty" };
  }

  // ISBT 128 structures start with "=" or "&". The character after the marker
  // names the structure, except for the DIN, whose data identifier is the "="
  // alone and whose first FIN character follows it directly.
  if (scan.startsWith(DIN_DATA_IDENTIFIER) || scan.startsWith("&")) {
    const structure = scan.slice(1, 2);
    if (structure === "%") {
      return { kind: "not-din", reason: "blood-group" };
    }
    if (structure === "<") {
      return { kind: "not-din", reason: "product-code" };
    }
    if (structure === ">") {
      return { kind: "not-din", reason: "expiration" };
    }
    if (
      scan.startsWith(DIN_DATA_IDENTIFIER) &&
      (scan.length === LEGACY_CHECK_LENGTH || scan.length === PAYLOAD_LENGTH)
    ) {
      return parseDinStructure(scan);
    }
    return { kind: "not-din", reason: "other-isbt128-structure" };
  }

  if (scan.length === DIN_LENGTH) {
    const validation = validateDin(scan);
    return validation.ok
      ? { kind: "din", din: scan, form: "bare" }
      : { kind: "not-din", reason: validation.reason };
  }

  return { kind: "not-din", reason: "unrecognized" };
}

/**
 * Reads a scan that starts with "=" and is either 15 or 16 characters long.
 *
 * Both the compliant payload and the suffixed the earlier label tool form are 16
 * characters, so the two trailing characters decide which one arrived. The scan
 * is the compliant payload when both trailing characters are legal flag
 * characters and the pair is not the check character followed by "0".
 *
 * One pair stays ambiguous. A compliant payload whose flag characters happen to
 * be the check character followed by "0" looks exactly like the the earlier label tool
 * form after the scanner rule appended its "0". Both readings give the same
 * DIN, so the DIN this app prints is the same either way. The only difference
 * is that this function compares the check character instead of reporting flag
 * characters.
 */
function parseDinStructure(scan: string): ScanResult {
  const din = scan.slice(1, 1 + DIN_LENGTH);
  const validation = validateDin(din);
  if (!validation.ok) {
    return { kind: "not-din", reason: validation.reason };
  }

  const trailing = scan.slice(1 + DIN_LENGTH);
  const check = checkCharacter(din);

  if (trailing.length === 1) {
    if (!isCheckCharacter(trailing)) {
      return { kind: "not-din", reason: "other-isbt128-structure" };
    }
    return {
      kind: "din",
      din,
      form: "legacy-check",
      scannedCheck: trailing,
      checkMatches: trailing === check,
    };
  }

  const [first, second] = trailing;
  if (isFlagCharacters(trailing) && !(first === check && second === "0")) {
    return { kind: "din", din, form: "payload", flags: trailing };
  }
  if (second === "0" && isCheckCharacter(first)) {
    return {
      kind: "din",
      din,
      form: "legacy-check-suffixed",
      scannedCheck: first,
      checkMatches: first === check,
    };
  }
  return { kind: "not-din", reason: "other-isbt128-structure" };
}
