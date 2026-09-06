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
import {
  DEFAULT_FLAG_CHARACTERS,
  DIN_DATA_IDENTIFIER,
  DIN_LENGTH,
  isFlagCharacters,
  validateDin,
  type DinInvalidReason,
} from "./din";

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
  /**
   * The scan is "=" and a valid DIN followed by two characters that ST-001 does
   * not allow as flag characters and that are not a check character followed by
   * the "0" a scanner rule appends.
   */
  | "bad-flag-characters"
  /** Some other ISBT 128 structure, such as one starting with "&,". */
  | "other-isbt128-structure"
  /** Nothing about the scan resembles ISBT 128. */
  | "unrecognized";

/**
 * What a scan turned out to be. The `form` decides which fields a DIN result
 * carries, so a UI that switches on `form` reads them without optional access.
 */
export type ScanResult =
  /** The bare DIN, with nothing else to report. */
  | { kind: "din"; din: string; form: "bare" }
  /** The compliant payload, which carries the two flag characters it encoded. */
  | { kind: "din"; din: string; form: "payload"; flags: string }
  /** A the earlier label tool form, which carries the check character the scan held. */
  | {
      kind: "din";
      din: string;
      form: "legacy-check" | "legacy-check-suffixed";
      /** The check character the scan carried. */
      scannedCheck: string;
      /** Whether `scannedCheck` equals the check character computed from `din`. */
      checkMatches: boolean;
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
 * is the suffixed the earlier label tool form when the trailing pair is the check
 * character of the DIN followed by "0". Anything else that is a legal pair of
 * flag characters is the compliant payload.
 *
 * Two pairs need care.
 *
 * A payload whose flag characters happen to be the check character followed by
 * "0" is indistinguishable from the the earlier label tool form after a scanner rule
 * appended its "0". Both readings give the same DIN, so the replica this app
 * prints is the same either way. The only difference is that the result reports
 * a check character comparison instead of flag characters.
 *
 * "00" is the exception, because it is the payload this app prints itself. One
 * DIN in thirty-seven has "0" as its check character, and reading those scans
 * as the the earlier label tool form would misreport this app's own replicas. A
 * trailing "00" is always the compliant payload.
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
  const looksLikeLegacySuffix =
    first === check && second === "0" && trailing !== DEFAULT_FLAG_CHARACTERS;

  if (looksLikeLegacySuffix) {
    // The check character is what made this pair the suffixed form, so it
    // always matches the DIN.
    return {
      kind: "din",
      din,
      form: "legacy-check-suffixed",
      scannedCheck: first,
      checkMatches: true,
    };
  }
  if (isFlagCharacters(trailing)) {
    return { kind: "din", din, form: "payload", flags: trailing };
  }
  return { kind: "not-din", reason: "bad-flag-characters" };
}
