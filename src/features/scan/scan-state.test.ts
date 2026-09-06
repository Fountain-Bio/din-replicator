import { describe, expect, it } from "vitest";
import {
  initialScanState,
  loadedPayload,
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

/** Runs a list of actions from the starting state and returns where they land. */
function run(actions: ScanAction[], start: ScanState = initialScanState(20)): ScanState {
  return actions.reduce(scanReducer, start);
}

/** A screen holding the sample DIN, ready to print. */
function loaded(): ScanState {
  return run([{ type: "scanned", raw: PAYLOAD }]);
}

/** A screen that has just printed and is waiting for a verification scan. */
function verifying(copies = 3): ScanState {
  return run(
    [
      { type: "set-copies", copies },
      { type: "print-started" },
      { type: "print-succeeded", printRunId: 7, copies, verifyAfterPrint: true },
    ],
    loaded(),
  );
}

describe("scanReducer", () => {
  it("starts with no DIN and a copy count of one", () => {
    const state = initialScanState(20);

    expect(state.din).toBeNull();
    expect(state.copies).toBe(1);
    expect(state.notice).toBeNull();
    expect(loadedPayload(state)).toBeNull();
  });

  it("loads the DIN from a compliant payload scan", () => {
    const state = loaded();

    expect(state.din).toBe(DIN);
    expect(state.copies).toBe(1);
    expect(state.notice).toBeNull();
    expect(loadedPayload(state)).toBe(PAYLOAD);
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
        { type: "set-copies", copies: 5 },
        { type: "scanned", raw: other },
      ],
      loaded(),
    );

    expect(state.din).toBe(other);
    // A new source label starts a new print run, so the copy count restarts.
    expect(state.copies).toBe(1);
  });

  it("keeps the copy count inside the range settings allow", () => {
    expect(run([{ type: "set-copies", copies: 0 }], loaded()).copies).toBe(1);
    expect(run([{ type: "set-copies", copies: 99 }], loaded()).copies).toBe(20);
    expect(
      run(
        [{ type: "set-max-copies", maxCopies: 4 }],
        run([{ type: "set-copies", copies: 20 }], loaded()),
      ).copies,
    ).toBe(4);
  });

  it("reports a successful print run and stays on the DIN", () => {
    const state = run(
      [
        { type: "set-copies", copies: 3 },
        { type: "print-started" },
        { type: "print-succeeded", printRunId: 7, copies: 3, verifyAfterPrint: false },
      ],
      loaded(),
    );

    expect(state.din).toBe(DIN);
    expect(state.phase).toEqual({ kind: "idle" });
    expect(state.notice).toEqual({ tone: "success", text: `Printed 3 replicas of ${DIN_TEXT}` });
  });

  it("uses the singular when one replica was printed", () => {
    const state = run(
      [{ type: "print-succeeded", printRunId: 7, copies: 1, verifyAfterPrint: false }],
      loaded(),
    );

    expect(state.notice?.text).toBe(`Printed 1 replica of ${DIN_TEXT}`);
  });

  it("shows the printer's reason when a print run fails", () => {
    const state = run(
      [
        { type: "print-started" },
        { type: "print-failed", message: "the printer is paused, so nothing was sent to it" },
      ],
      loaded(),
    );

    expect(state.phase).toEqual({ kind: "idle" });
    expect(state.notice).toEqual({
      tone: "error",
      text: "the printer is paused, so nothing was sent to it",
    });
  });

  it("warns and records nothing when the labels printed but the log refused", () => {
    const state = run(
      [
        { type: "set-copies", copies: 3 },
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
        { type: "set-copies", copies: 4 },
        { type: "print-started" },
        { type: "print-not-recorded", reason: "the disk is full" },
      ],
      loaded(),
    );

    expect(state.din).toBe(DIN);
    expect(state.copies).toBe(4);
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

    expect(state.phase).toEqual({ kind: "verifying", printRunId: 7, din: DIN, copies: 3 });
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
    const state = run([{ type: "load", din: DIN, copies: 6 }]);

    expect(state.din).toBe(DIN);
    expect(state.copies).toBe(6);
    expect(loadedPayload(state)).toBe(PAYLOAD);
  });
});
