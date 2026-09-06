import { describe, expect, it } from "vitest";
import type { PrinterState } from "@/lib/tauri/types";
import {
  canPrint,
  canSetCopyCount,
  initialScanState,
  scanReducer,
  type ScanAction,
  type ScanState,
} from "./scan-state";

/** A sample DIN. Its check character is N. */
const DIN = "W483626000011";
/** The compliant barcode payload for the sample DIN. */
const PAYLOAD = "=W48362600001100";
/** The eye-readable form of the sample DIN. */
const DIN_TEXT = "W4836 26 000011";

const READY: PrinterState = { kind: "ready" };
const PAUSED: PrinterState = { kind: "paused" };

/** Runs a list of actions from the starting state and returns where they land. */
function run(actions: ScanAction[], start: ScanState = initialScanState(20)): ScanState {
  return actions.reduce(scanReducer, start);
}

/** A screen holding the sample DIN, ready to print. */
function loaded(): ScanState {
  return run([{ type: "scanned", raw: PAYLOAD }]);
}

/** A screen that has just printed and is waiting for a verification scan. */
function verifying(copyCount = 3): ScanState {
  return run(
    [
      { type: "set-copy-count", copyCount },
      { type: "print-started" },
      { type: "print-succeeded", printRunId: 7, copyCount, verifyAfterPrint: true },
    ],
    loaded(),
  );
}

describe("scanReducer", () => {
  it("starts with no DIN and a copy count of one", () => {
    const state = initialScanState(20);

    expect(state.din).toBeNull();
    expect(state.copyCount).toBe(1);
    expect(state.notice).toBeNull();
    expect(state.scannedFlags).toBeNull();
  });

  it("loads the DIN from a compliant payload scan", () => {
    const state = loaded();

    expect(state.din).toBe(DIN);
    expect(state.copyCount).toBe(1);
    expect(state.notice).toBeNull();
  });

  it("loads the DIN from a bare DIN typed into the manual entry box", () => {
    const state = run([{ type: "scanned", raw: " w483626000011 " }]);

    expect(state.din).toBe(DIN);
  });

  it("names what was scanned when the scan is not a DIN", () => {
    const state = run([{ type: "scanned", raw: "=%A1B2" }]);

    expect(state.din).toBeNull();
    expect(state.notice?.tone).toBe("error");
    expect(state.notice?.text).toContain("blood group");
  });

  it("keeps the loaded DIN when a later scan is not a DIN", () => {
    const state = run([{ type: "scanned", raw: "=<A9999" }], loaded());

    expect(state.din).toBe(DIN);
    expect(state.notice?.text).toContain("product code");
  });

  it("gives the reason when a scan is a badly formed DIN", () => {
    const state = run([{ type: "scanned", raw: "O483626000011" }]);

    expect(state.din).toBeNull();
    expect(state.notice?.text).toContain("first character of a FIN");
  });

  it("refuses a legacy scan whose check character does not match", () => {
    // The check character of the sample DIN is N, so A disagrees with it.
    const state = run([{ type: "scanned", raw: "=W483626000011A" }]);

    expect(state.din).toBeNull();
    expect(state.notice).toEqual({
      tone: "error",
      text: "The scanned label's check character does not match. The source label looks damaged or misprinted.",
    });
  });

  it("loads a legacy scan whose check character matches", () => {
    const state = run([{ type: "scanned", raw: "=W483626000011N" }]);

    expect(state.din).toBe(DIN);
    expect(state.notice).toBeNull();
  });

  it("replaces the loaded DIN when a new source label is scanned", () => {
    const other = "W483626000023";
    const state = run(
      [
        { type: "set-copy-count", copyCount: 5 },
        { type: "scanned", raw: other },
      ],
      loaded(),
    );

    expect(state.din).toBe(other);
    // A new source label starts a new print run, so the copy count restarts.
    expect(state.copyCount).toBe(1);
  });

  it("keeps the copy count inside the range settings allow", () => {
    expect(run([{ type: "set-copy-count", copyCount: 0 }], loaded()).copyCount).toBe(1);
    expect(run([{ type: "set-copy-count", copyCount: 99 }], loaded()).copyCount).toBe(20);
    expect(
      run(
        [{ type: "set-max-copy-count", maxCopyCount: 4 }],
        run([{ type: "set-copy-count", copyCount: 20 }], loaded()),
      ).copyCount,
    ).toBe(4);
  });

  it("reports a successful print run and stays on the DIN", () => {
    const state = run(
      [
        { type: "set-copy-count", copyCount: 3 },
        { type: "print-started" },
        { type: "print-succeeded", printRunId: 7, copyCount: 3, verifyAfterPrint: false },
      ],
      loaded(),
    );

    expect(state.din).toBe(DIN);
    expect(state.phase).toEqual({ kind: "idle" });
    expect(state.notice).toEqual({ tone: "success", text: `Printed 3 replicas of ${DIN_TEXT}` });
  });

  it("uses the singular when one replica was printed", () => {
    const state = run(
      [{ type: "print-succeeded", printRunId: 7, copyCount: 1, verifyAfterPrint: false }],
      loaded(),
    );

    expect(state.notice?.text).toBe(`Printed 1 replica of ${DIN_TEXT}`);
  });

  it("shows the printer's reason when a print run fails", () => {
    const state = run(
      [
        { type: "print-started" },
        { type: "print-failed", message: "Paused. Start the printer in the operating system." },
      ],
      loaded(),
    );

    expect(state.phase).toEqual({ kind: "idle" });
    expect(state.notice).toEqual({
      tone: "error",
      text: "Paused. Start the printer in the operating system.",
    });
  });

  it("warns and records nothing when the labels printed but the log refused", () => {
    const state = run(
      [
        { type: "set-copy-count", copyCount: 3 },
        { type: "print-started" },
        { type: "print-not-recorded", reason: "the print log cannot be opened" },
      ],
      loaded(),
    );

    expect(state.notice).toEqual({
      tone: "error",
      text: "The label printed but the print run was not recorded: the print log cannot be opened. Do not print again until storage is fixed.",
    });
    // There is no print run to verify against, so no verification is asked for.
    expect(state.phase).toEqual({ kind: "idle" });
    expect(state.pendingVerification).toBeNull();
  });

  it("keeps the DIN and the copy count after a print run went unrecorded", () => {
    const state = run(
      [
        { type: "set-copy-count", copyCount: 4 },
        { type: "print-started" },
        { type: "print-not-recorded", reason: "the disk is full" },
      ],
      loaded(),
    );

    expect(state.din).toBe(DIN);
    expect(state.copyCount).toBe(4);
  });

  it("takes a new scan after a print run went unrecorded", () => {
    const other = "W483626000023";
    const state = run(
      [
        { type: "print-started" },
        { type: "print-not-recorded", reason: "the disk is full" },
        { type: "scanned", raw: other },
      ],
      loaded(),
    );

    expect(state.din).toBe(other);
    expect(state.notice).toBeNull();
  });

  it("ignores a scan that arrives while a print run is in flight", () => {
    const printing = run([{ type: "print-started" }], loaded());
    const state = scanReducer(printing, { type: "scanned", raw: "=W48362600002300" });

    expect(state).toBe(printing);
  });

  it("asks for a verification scan when settings want one", () => {
    const state = verifying();

    expect(state.phase).toEqual({ kind: "verifying", printRunId: 7, din: DIN, copyCount: 3 });
  });

  it("passes verification when a replica scans back as the printed payload", () => {
    const state = run([{ type: "scanned", raw: PAYLOAD }], verifying());

    expect(state.phase).toEqual({ kind: "idle" });
    expect(state.pendingVerification).toEqual({
      printRunId: 7,
      scannedPayload: PAYLOAD,
      matched: true,
    });
    expect(state.notice?.tone).toBe("success");
    expect(state.notice?.text).toContain(DIN_TEXT);
  });

  it("fails verification when another DIN is scanned", () => {
    const other = "=W48362600002300";
    const state = run([{ type: "scanned", raw: other }], verifying());

    expect(state.pendingVerification).toEqual({
      printRunId: 7,
      scannedPayload: other,
      matched: false,
    });
    expect(state.notice?.tone).toBe("error");
  });

  it("fails verification when the scan is the right DIN in the wrong form", () => {
    // A source label in the legacy 15-character form holds the printed DIN,
    // but it is not one of the replicas this print run produced.
    const state = run([{ type: "scanned", raw: "=W483626000011N" }], verifying());

    expect(state.pendingVerification?.matched).toBe(false);
  });

  it("fails verification when the flag characters are not the printed ones", () => {
    const state = run([{ type: "scanned", raw: "=W48362600001101" }], verifying());

    expect(state.pendingVerification?.matched).toBe(false);
  });

  it("clears the pending verification once it reaches the print log", () => {
    const state = run(
      [{ type: "scanned", raw: PAYLOAD }, { type: "verification-recorded" }],
      verifying(),
    );

    expect(state.pendingVerification).toBeNull();
  });

  it("records nothing when verification is skipped", () => {
    const state = run([{ type: "skip-verification" }], verifying());

    expect(state.phase).toEqual({ kind: "idle" });
    expect(state.pendingVerification).toBeNull();
    expect(state.din).toBe(DIN);
    expect(state.notice?.tone).toBe("info");
  });

  it("goes back to waiting for a scan when cleared", () => {
    const state = run([{ type: "clear" }], verifying());

    expect(state).toEqual(initialScanState(20));
  });

  it("loads a DIN and a copy count from a print run in the history", () => {
    const state = run([{ type: "load", din: DIN, copyCount: 6 }]);

    expect(state.din).toBe(DIN);
    expect(state.copyCount).toBe(6);
  });
});

describe("flag characters on a source label", () => {
  it("says nothing when the source label carried the flag characters replicas print", () => {
    const state = loaded();

    expect(state.scannedFlags).toBe("00");
    expect(state.notice).toBeNull();
  });

  it("warns when the source label carried other flag characters", () => {
    const state = run([{ type: "scanned", raw: "=W48362600001101" }]);

    expect(state.din).toBe(DIN);
    expect(state.scannedFlags).toBe("01");
    expect(state.notice).toEqual({
      tone: "info",
      text: "The source label carried flag characters 01; the replica prints 00 as decided in ADR 0002.",
    });
  });

  it("says nothing about a form that carries no flag characters", () => {
    const bare = run([{ type: "scanned", raw: DIN }]);
    const legacy = run([{ type: "scanned", raw: "=W483626000011N" }]);

    expect(bare.scannedFlags).toBeNull();
    expect(bare.notice).toBeNull();
    expect(legacy.scannedFlags).toBeNull();
    expect(legacy.notice).toBeNull();
  });

  it("forgets the flag characters when the screen is cleared", () => {
    const state = run([{ type: "clear" }], run([{ type: "scanned", raw: "=W48362600001101" }]));

    expect(state.scannedFlags).toBeNull();
  });

  it("carries no flag characters for a DIN loaded from the history", () => {
    const state = run(
      [{ type: "load", din: DIN, copyCount: 2 }],
      run([{ type: "scanned", raw: "=W48362600001101" }]),
    );

    expect(state.scannedFlags).toBeNull();
    expect(state.notice).toBeNull();
  });
});

describe("canSetCopyCount", () => {
  it("refuses while no DIN is loaded", () => {
    expect(canSetCopyCount(initialScanState(20))).toBe(false);
  });

  it("allows a loaded DIN on an idle screen", () => {
    expect(canSetCopyCount(loaded())).toBe(true);
  });

  it("refuses while a print run is in flight", () => {
    expect(canSetCopyCount(run([{ type: "print-started" }], loaded()))).toBe(false);
  });

  it("refuses while the app waits for a verification scan", () => {
    expect(canSetCopyCount(verifying())).toBe(false);
  });
});

describe("canPrint", () => {
  it("allows a loaded DIN with a ready printer and a working print log", () => {
    expect(canPrint(loaded(), READY, null)).toBe(true);
  });

  it("refuses while no DIN is loaded", () => {
    expect(canPrint(initialScanState(20), READY, null)).toBe(false);
  });

  it("refuses while a print run is in flight", () => {
    expect(canPrint(run([{ type: "print-started" }], loaded()), READY, null)).toBe(false);
  });

  it("refuses while the app waits for a verification scan", () => {
    expect(canPrint(verifying(), READY, null)).toBe(false);
  });

  it("refuses while the printer's state is still being read", () => {
    expect(canPrint(loaded(), null, null)).toBe(false);
  });

  it("refuses while the printer is not ready", () => {
    expect(canPrint(loaded(), PAUSED, null)).toBe(false);
  });

  it("refuses while the print log cannot be opened", () => {
    expect(canPrint(loaded(), READY, "the folder is read only")).toBe(false);
  });
});
