/**
 * All the scan screen's decisions, as one pure reducer.
 *
 * The screen has to react to a scan the same way whatever caused it: the
 * scanner, the manual entry box, or a "Print again" button on the history
 * screen. Keeping the decisions here means they can be read and tested without
 * a browser, and the component is left with rendering and with the calls that
 * touch the printer and the print log.
 */

import { barcodePayload, eyeReadable, parseScan, type NotDinReason } from "@/lib/isbt128";

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
  | { kind: "verifying"; printRunId: number; din: string; copies: number };

export interface ScanState {
  /** The DIN loaded for printing, or null while the screen waits for a scan. */
  din: string | null;
  /** Copy count for the next print run. */
  copies: number;
  /** The largest copy count the operator may choose. Comes from settings. */
  maxCopies: number;
  phase: ScanPhase;
  /** The sentence under the DIN, or null when there is nothing to say. */
  notice: Notice | null;
  pendingVerification: PendingVerification | null;
}

export type ScanAction =
  /** A scan arrived, from the scanner or from the manual entry box. */
  | { type: "scanned"; raw: string }
  /** Load a DIN without scanning, which is what "Print again" does. */
  | { type: "load"; din: string; copies: number }
  | { type: "set-copies"; copies: number }
  /** The settings screen changed the ceiling on the copy count. */
  | { type: "set-max-copies"; maxCopies: number }
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
      copies: number;
      /** Settings decide whether a verification scan is asked for. */
      verifyAfterPrint: boolean;
    }
  /** Escape during the verification prompt. Nothing is written down. */
  | { type: "skip-verification" }
  /** The pending verification reached the print log. */
  | { type: "verification-recorded" };

/** The state of a screen that has never seen a scan. */
export function initialScanState(maxCopies: number): ScanState {
  return {
    din: null,
    copies: 1,
    maxCopies,
    phase: { kind: "idle" },
    notice: null,
    pendingVerification: null,
  };
}

/** The eye-readable form of a DIN, such as `W4836 26 000011`. */
export function dinText(din: string): string {
  return eyeReadable(din).text;
}

/** The sentence that names what a scan held when it was not a DIN. */
export function notDinMessage(reason: NotDinReason): string {
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
function clampCopies(copies: number, maxCopies: number): number {
  if (!Number.isFinite(copies)) {
    return 1;
  }
  return Math.min(Math.max(Math.round(copies), 1), Math.max(maxCopies, 1));
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

  return {
    ...state,
    din: result.din,
    copies: 1,
    phase: { kind: "idle" },
    notice: null,
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
        copies: clampCopies(action.copies, state.maxCopies),
        phase: { kind: "idle" },
        notice: null,
        pendingVerification: null,
      };

    case "set-copies":
      return { ...state, copies: clampCopies(action.copies, state.maxCopies) };

    case "set-max-copies":
      return {
        ...state,
        maxCopies: action.maxCopies,
        copies: clampCopies(state.copies, action.maxCopies),
      };

    case "clear":
      return initialScanState(state.maxCopies);

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
      // Q8: the DIN stays on the screen after a print run, so an operator who
      // needs a few more replicas presses Print again instead of rescanning.
      const din = state.din;
      if (din === null) {
        return state;
      }
      const replicas = action.copies === 1 ? "1 replica" : `${action.copies} replicas`;
      return {
        ...state,
        phase: action.verifyAfterPrint
          ? { kind: "verifying", printRunId: action.printRunId, din, copies: action.copies }
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

/** The barcode payload for the DIN on the screen, or null when none is loaded. */
export function loadedPayload(state: ScanState): string | null {
  return state.din === null ? null : barcodePayload(state.din);
}
