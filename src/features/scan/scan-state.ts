/**
 * All the scan screen's decisions, as one pure reducer.
 *
 * The screen has to react to a scan the same way whatever caused it: the
 * scanner, the manual entry box, or a "Print again" button on the history
 * screen. Keeping the decisions here means they can be read and tested without
 * a browser, and the component is left with rendering and with the calls that
 * touch the printer and the print log.
 *
 * `canPrint` and `canSetCopyCount` are the two rules the screen and the
 * keyboard shortcuts share, so the Print button and the Enter key can never
 * disagree about whether a print run may start.
 */

import { eyeReadable, parseScan, type NotDinReason } from "@/lib/isbt128";
import type { PrinterState } from "@/lib/tauri/types";

/** The flag characters this app prints and expects to read back. */
const PRINTED_FLAGS = "00";

/** A sentence shown under the DIN, with how the screen should colour it. */
export interface Notice {
  tone: "error" | "success" | "info";
  text: string;
}

/**
 * A verification the screen still has to write to the print log.
 *
 * The reducer works out whether a verification scan matched, but writing it
 * down is a command call. The verdict waits here until the screen has sent it
 * and dispatches `verification-recorded`.
 */
export interface PendingVerification {
  printRunId: number;
  /** The raw string the scanner delivered. */
  scannedPayload: string;
  matched: boolean;
}

/** What the screen is doing right now. */
export type ScanPhase =
  /** Waiting for a scan, or holding a DIN that is ready to print. */
  | { kind: "idle" }
  /** A print run is on its way to the printer. */
  | { kind: "printing" }
  /**
   * A print run finished and the app is waiting for the operator to scan one
   * of the new labels.
   */
  | { kind: "verifying"; printRunId: number; din: string; copyCount: number };

export interface ScanState {
  /** The DIN loaded for printing, or null while the screen waits for a scan. */
  din: string | null;
  /**
   * The flag characters the scanned barcode carried, or null when the scan
   * carried none. A source label that is not flagged carries `00`, which is
   * what the replica prints whatever the source said.
   */
  scannedFlags: string | null;
  /** Copy count for the next print run. */
  copyCount: number;
  /** The largest copy count the operator may choose. Comes from settings. */
  maxCopyCount: number;
  phase: ScanPhase;
  /** The sentence under the DIN, or null when there is nothing to say. */
  notice: Notice | null;
  pendingVerification: PendingVerification | null;
}

export type ScanAction =
  /** A scan arrived, from the scanner or from the manual entry box. */
  | { type: "scanned"; raw: string }
  /** Load a DIN without scanning, which is what "Print again" does. */
  | { type: "load"; din: string; copyCount: number }
  | { type: "set-copy-count"; copyCount: number }
  /** The settings screen changed the ceiling on the copy count. */
  | { type: "set-max-copy-count"; maxCopyCount: number }
  /** Clear button or Escape: go back to waiting for a scan. */
  | { type: "clear" }
  | { type: "print-started" }
  /** Nothing reached the printer, so no replica came out. */
  | { type: "print-failed"; message: string }
  /**
   * The replicas printed but the print log would not take the print run. The
   * labels exist and nothing recorded them.
   */
  | { type: "print-not-recorded"; reason: string }
  | {
      type: "print-succeeded";
      printRunId: number;
      copyCount: number;
      /** Settings decide whether a verification scan is asked for. */
      verifyAfterPrint: boolean;
    }
  /** Escape during the verification prompt. Nothing is written down. */
  | { type: "skip-verification" }
  /** The pending verification reached the print log. */
  | { type: "verification-recorded" };

/** The state of a screen that has never seen a scan. */
export function initialScanState(maxCopyCount: number): ScanState {
  return {
    din: null,
    scannedFlags: null,
    copyCount: 1,
    maxCopyCount,
    phase: { kind: "idle" },
    notice: null,
    pendingVerification: null,
  };
}

/** The eye-readable form of a DIN, such as `W4836 26 000011`. */
export function dinText(din: string): string {
  return eyeReadable(din).text;
}

/**
 * True when the screen will take a change to the copy count.
 *
 * The stepper, the copy count box, and the digit shortcuts all follow this one
 * rule: there is a DIN to print and no print run is in flight.
 */
export function canSetCopyCount(state: ScanState): boolean {
  return state.din !== null && state.phase.kind === "idle";
}

/**
 * True when pressing Print, or Enter, would start a print run.
 *
 * The Print button and the Enter shortcut both ask this, so the two can never
 * disagree. A print run needs a DIN on the screen, no print run already in
 * flight, a printer that reports itself ready, and a print log that can record
 * what comes out.
 */
export function canPrint(
  state: ScanState,
  printerState: PrinterState | null,
  blockedReason: string | null,
): boolean {
  return (
    canSetCopyCount(state) &&
    printerState !== null &&
    printerState.kind === "ready" &&
    blockedReason === null
  );
}

/** The sentence that names what a scan held when it was not a DIN. */
function notDinMessage(reason: NotDinReason): string {
  switch (reason) {
    case "empty":
      return "The scan was empty. Scan the DIN barcode again.";
    case "blood-group":
      return "That is a blood group barcode, not a DIN. Scan the DIN barcode.";
    case "product-code":
      return "That is a product code barcode, not a DIN. Scan the DIN barcode.";
    case "expiration":
      return "That is an expiration date barcode, not a DIN. Scan the DIN barcode.";
    case "other-isbt128-structure":
      return "That is another ISBT 128 barcode, not a DIN. Scan the DIN barcode.";
    case "bad-flag-characters":
      return "That barcode holds a DIN followed by two characters ISBT 128 does not allow as flag characters.";
    case "wrong-length":
      return "That is not a DIN. A DIN is 13 characters long.";
    case "bad-first-character":
      return "That is not a DIN. The first character of a FIN cannot be O or 0.";
    case "bad-facility-character":
      return "That is not a DIN. Characters 2 and 3 of a FIN cannot be O.";
    case "non-digit":
      return "That is not a DIN. The last ten characters of a DIN are digits.";
    case "unrecognized":
      return "That is not a DIN. Scan the DIN barcode on the source label.";
  }
}

/** Keeps a copy count inside the range the stepper allows. */
function clampCopyCount(copyCount: number, maxCopyCount: number): number {
  if (!Number.isFinite(copyCount)) {
    return 1;
  }
  return Math.min(Math.max(Math.round(copyCount), 1), Math.max(maxCopyCount, 1));
}

/**
 * Decides whether a verification scan proves the replica came out right.
 *
 * A replica this app printed carries the compliant barcode payload, so the
 * scan has to read back as that payload and no other form. A bare DIN or the
 * legacy 15-character form would mean the operator scanned a source label
 * rather than one of the new replicas.
 */
function verificationMatches(raw: string, printedDin: string): boolean {
  const result = parseScan(raw);
  return (
    result.kind === "din" &&
    result.din === printedDin &&
    result.form === "payload" &&
    result.flags === PRINTED_FLAGS
  );
}

/** Handles a scan that arrived while the app was waiting for a verification. */
function reduceVerificationScan(
  state: ScanState,
  phase: Extract<ScanPhase, { kind: "verifying" }>,
  raw: string,
): ScanState {
  const matched = verificationMatches(raw, phase.din);
  const text = dinText(phase.din);
  return {
    ...state,
    din: phase.din,
    phase: { kind: "idle" },
    pendingVerification: { printRunId: phase.printRunId, scannedPayload: raw, matched },
    notice: matched
      ? { tone: "success", text: `Verified. The replica reads as ${text}.` }
      : {
          tone: "error",
          text: `That scan does not read as ${text}. Check the replica before you use it.`,
        },
  };
}

/** Handles a scan that should load a DIN onto the screen. */
function reduceSourceScan(state: ScanState, raw: string): ScanState {
  const result = parseScan(raw);

  if (result.kind === "not-din") {
    return { ...state, notice: { tone: "error", text: notDinMessage(result.reason) } };
  }

  // The legacy 15-character form carries a check character, so the app can
  // tell that the source label disagrees with its own DIN. ADR 0002 and the
  // check character rule in ST-001 section 7.5 make that a reason to stop:
  // copying a damaged label would spread the damage.
  if ("checkMatches" in result && !result.checkMatches) {
    return {
      ...state,
      notice: {
        tone: "error",
        text: "The scanned label's check character does not match. The source label looks damaged or misprinted.",
      },
    };
  }

  // Only the compliant 16-character payload carries flag characters. The other
  // forms say nothing about them, which reads the same as the `00` a replica
  // prints.
  const scannedFlags = result.form === "payload" ? result.flags : null;

  return {
    ...state,
    din: result.din,
    scannedFlags,
    copyCount: 1,
    phase: { kind: "idle" },
    // ADR 0002 fixes the replica's flag characters at `00`, so a source label
    // that was flagged prints as a label that is not. The operator is told,
    // because the replica and its source then differ in a way that is visible
    // to a scanner.
    notice:
      scannedFlags === null || scannedFlags === PRINTED_FLAGS
        ? null
        : {
            tone: "info",
            text: `The source label carried flag characters ${scannedFlags}; the replica prints ${PRINTED_FLAGS} as decided in ADR 0002.`,
          },
    pendingVerification: null,
  };
}

export function scanReducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case "scanned":
      // A print run is in flight, so a scan now would race the print log.
      if (state.phase.kind === "printing") {
        return state;
      }
      if (state.phase.kind === "verifying") {
        return reduceVerificationScan(state, state.phase, action.raw);
      }
      return reduceSourceScan(state, action.raw);

    case "load":
      return {
        ...state,
        din: action.din,
        // A print run from the history carries the DIN alone. The flag
        // characters of the label it came from are not part of the record.
        scannedFlags: null,
        copyCount: clampCopyCount(action.copyCount, state.maxCopyCount),
        phase: { kind: "idle" },
        notice: null,
        pendingVerification: null,
      };

    case "set-copy-count":
      return { ...state, copyCount: clampCopyCount(action.copyCount, state.maxCopyCount) };

    case "set-max-copy-count":
      return {
        ...state,
        maxCopyCount: action.maxCopyCount,
        copyCount: clampCopyCount(state.copyCount, action.maxCopyCount),
      };

    case "clear":
      return initialScanState(state.maxCopyCount);

    case "print-started":
      return { ...state, phase: { kind: "printing" }, notice: null };

    case "print-failed":
      return {
        ...state,
        phase: { kind: "idle" },
        notice: { tone: "error", text: action.message },
      };

    case "print-not-recorded":
      // There is no print run id, so there is nothing a verification scan
      // could be attached to. The screen goes straight back to idle and warns
      // that the count of printed replicas is now wrong.
      return {
        ...state,
        phase: { kind: "idle" },
        notice: {
          tone: "error",
          text: `The label printed but the print run was not recorded: ${action.reason}. Do not print again until storage is fixed.`,
        },
      };

    case "print-succeeded": {
      // The DIN stays on the screen after a print run, so an operator who
      // needs a few more replicas presses Print again instead of rescanning.
      const din = state.din;
      if (din === null) {
        return state;
      }
      const replicas = action.copyCount === 1 ? "1 replica" : `${action.copyCount} replicas`;
      return {
        ...state,
        phase: action.verifyAfterPrint
          ? { kind: "verifying", printRunId: action.printRunId, din, copyCount: action.copyCount }
          : { kind: "idle" },
        notice: { tone: "success", text: `Printed ${replicas} of ${dinText(din)}` },
      };
    }

    case "skip-verification":
      if (state.phase.kind !== "verifying") {
        return state;
      }
      return {
        ...state,
        phase: { kind: "idle" },
        notice: { tone: "info", text: "Verification skipped. Nothing was recorded." },
      };

    case "verification-recorded":
      return { ...state, pendingVerification: null };
  }
}
