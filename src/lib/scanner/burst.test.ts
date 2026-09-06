import { describe, expect, it } from "vitest";
import {
  BURST_GAP_MS,
  BURST_RESET_MS,
  EMPTY_BURST,
  MIN_BURST_LENGTH,
  stepBurst,
  type BurstOutcome,
  type BurstState,
} from "./burst";

/**
 * Types `text` one character every `gapMs` milliseconds and returns the state
 * that leaves behind, along with every outcome in order.
 */
function type(
  text: string,
  gapMs: number,
  start: BurstState = EMPTY_BURST,
  startAt = 1000,
): { state: BurstState; outcomes: BurstOutcome[] } {
  let state = start;
  const outcomes: BurstOutcome[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const step = stepBurst(state, { key: text[index]!, at: startAt + index * gapMs });
    state = step.state;
    outcomes.push(step.outcome);
  }
  return { state, outcomes };
}

/** The compliant barcode payload for a sample DIN. */
const PAYLOAD = "=W48362600001100";

describe("stepBurst", () => {
  it("reports a scan when a fast burst ends in Enter", () => {
    const typed = type(PAYLOAD, 4);
    const ended = stepBurst(typed.state, { key: "Enter", at: 1000 + PAYLOAD.length * 4 });

    expect(ended.outcome).toEqual({ kind: "scan", scan: PAYLOAD });
    expect(ended.state).toEqual(EMPTY_BURST);
  });

  it("ignores the same characters typed at human speed", () => {
    const typed = type(PAYLOAD, 120);
    const ended = stepBurst(typed.state, { key: "Enter", at: 1000 + PAYLOAD.length * 120 });

    expect(ended.outcome).toEqual({ kind: "loose" });
  });

  it("ignores a fast burst shorter than the minimum length", () => {
    const short = "1234";
    expect(short.length).toBeLessThan(MIN_BURST_LENGTH);

    const typed = type(short, 4);
    const ended = stepBurst(typed.state, { key: "Enter", at: 1000 + short.length * 4 });

    expect(ended.outcome).toEqual({ kind: "loose" });
  });

  it("reports a scan at exactly the widest gap that still counts as a burst", () => {
    const typed = type(PAYLOAD, BURST_GAP_MS);
    const ended = stepBurst(typed.state, {
      key: "Enter",
      at: 1000 + PAYLOAD.length * BURST_GAP_MS,
    });

    expect(ended.outcome).toEqual({ kind: "scan", scan: PAYLOAD });
  });

  it("stops treating a burst as a scan after one slow gap in the middle", () => {
    const first = type("=W483", 4);
    const resumed = type("62600001100", 4, first.state, first.state.lastKeyAt + BURST_GAP_MS + 1);
    const ended = stepBurst(resumed.state, { key: "Enter", at: resumed.state.lastKeyAt + 4 });

    expect(ended.outcome).toEqual({ kind: "loose" });
  });

  it("throws the buffer away after a long pause and starts again", () => {
    const abandoned = type("=W48", 4);
    const restarted = type(
      PAYLOAD,
      4,
      abandoned.state,
      abandoned.state.lastKeyAt + BURST_RESET_MS + 1,
    );
    const ended = stepBurst(restarted.state, { key: "Enter", at: restarted.state.lastKeyAt + 4 });

    expect(ended.outcome).toEqual({ kind: "scan", scan: PAYLOAD });
  });

  it("keeps characters that arrive within the reset window but not at scanner speed", () => {
    const typed = type("ABCDEFG", BURST_RESET_MS - 1);

    expect(typed.state.buffer).toBe("ABCDEFG");
    expect(typed.state.atScannerSpeed).toBe(false);
  });

  it("reports the first character of a burst as loose so the screen can act on it", () => {
    const typed = type(PAYLOAD, 4);

    expect(typed.outcomes[0]).toEqual({ kind: "loose" });
    expect(typed.outcomes[1]).toEqual({ kind: "collecting" });
  });

  it("throws the buffer away when a key that is not a character arrives", () => {
    const typed = type(PAYLOAD, 4);
    const escaped = stepBurst(typed.state, { key: "Escape", at: typed.state.lastKeyAt + 4 });

    expect(escaped.state).toEqual(EMPTY_BURST);
    expect(escaped.outcome).toEqual({ kind: "loose" });
  });

  it("ignores an Enter that arrives long after the last character", () => {
    const typed = type(PAYLOAD, 4);
    const ended = stepBurst(typed.state, { key: "Enter", at: typed.state.lastKeyAt + 5000 });

    expect(ended.outcome).toEqual({ kind: "loose" });
  });

  it("reports a scan for the legacy 15-character form as well", () => {
    const legacy = "=W483626000011N";
    const typed = type(legacy, 4);
    const ended = stepBurst(typed.state, { key: "Enter", at: typed.state.lastKeyAt + 4 });

    expect(ended.outcome).toEqual({ kind: "scan", scan: legacy });
  });
});
