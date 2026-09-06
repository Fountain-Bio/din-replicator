import { describe, expect, it } from "vitest";
import {
  BURST_GAP_MS,
  BURST_RESET_MS,
  EMPTY_BURST,
  flushBurst,
  MAX_BURST_LENGTH,
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

/** How fast a wedge scanner sends its characters. */
const SCANNER_GAP_MS = 4;

describe("stepBurst", () => {
  it("reports a scan when a fast burst ends in Enter", () => {
    const typed = type(PAYLOAD, SCANNER_GAP_MS);
    const ended = stepBurst(typed.state, { key: "Enter", at: typed.state.lastKeyAt + 4 });

    expect(ended.outcome).toEqual({ kind: "scan", scan: PAYLOAD, consumedKey: true });
    expect(ended.state).toEqual(EMPTY_BURST);
  });

  it("reports a scan when a fast burst ends in Tab", () => {
    const typed = type(PAYLOAD, SCANNER_GAP_MS);
    const ended = stepBurst(typed.state, { key: "Tab", at: typed.state.lastKeyAt + 4 });

    expect(ended.outcome).toEqual({ kind: "scan", scan: PAYLOAD, consumedKey: true });
    expect(ended.state).toEqual(EMPTY_BURST);
  });

  it("keeps the burst when Shift presses arrive between characters", () => {
    // A wedge scanner presses Shift before every capital letter, and the
    // browser reports that press as a key event of its own.
    let state = EMPTY_BURST;
    let at = 1000;
    for (const character of PAYLOAD) {
      if (character !== character.toLowerCase()) {
        state = stepBurst(state, { key: "Shift", at }).state;
        at += 2;
      }
      state = stepBurst(state, { key: character, at }).state;
      at += SCANNER_GAP_MS;
    }
    const ended = stepBurst(state, { key: "Enter", at });

    expect(ended.outcome).toEqual({ kind: "scan", scan: PAYLOAD, consumedKey: true });
  });

  it("ignores the same characters typed at human speed", () => {
    const typed = type(PAYLOAD, 120);
    const ended = stepBurst(typed.state, { key: "Enter", at: typed.state.lastKeyAt + 120 });

    expect(ended.outcome).toEqual({ kind: "loose" });
  });

  it("ignores a fast burst shorter than the minimum length", () => {
    const short = "1234";
    expect(short.length).toBeLessThan(MIN_BURST_LENGTH);

    const typed = type(short, SCANNER_GAP_MS);
    const ended = stepBurst(typed.state, { key: "Enter", at: typed.state.lastKeyAt + 4 });

    expect(ended.outcome).toEqual({ kind: "loose" });
  });

  it("reports a scan at exactly the widest gap that still counts as a burst", () => {
    const typed = type(PAYLOAD, BURST_GAP_MS);
    const ended = stepBurst(typed.state, {
      key: "Enter",
      at: typed.state.lastKeyAt + BURST_GAP_MS,
    });

    expect(ended.outcome).toEqual({ kind: "scan", scan: PAYLOAD, consumedKey: true });
  });

  it("stops treating a burst as a scan after one slow gap in the middle", () => {
    const first = type("=W483", SCANNER_GAP_MS);
    const resumed = type(
      "62600001100",
      SCANNER_GAP_MS,
      first.state,
      first.state.lastKeyAt + BURST_GAP_MS + 1,
    );
    const ended = stepBurst(resumed.state, { key: "Enter", at: resumed.state.lastKeyAt + 4 });

    expect(ended.outcome).toEqual({ kind: "loose" });
  });

  it("keeps characters that arrive within the reset window but not at scanner speed", () => {
    const typed = type("ABCDEFG", BURST_RESET_MS - 1);

    expect(typed.state.buffer).toBe("ABCDEFG");
    expect(typed.state.atScannerSpeed).toBe(false);
  });

  it("reports the first character of a burst as loose so the screen can act on it", () => {
    const typed = type(PAYLOAD, SCANNER_GAP_MS);

    expect(typed.outcomes[0]).toEqual({ kind: "loose" });
    expect(typed.outcomes[1]).toEqual({ kind: "collecting" });
  });

  it("throws the buffer away when a key that is not a character arrives", () => {
    const typed = type(PAYLOAD, SCANNER_GAP_MS);
    const escaped = stepBurst(typed.state, { key: "Escape", at: typed.state.lastKeyAt + 4 });

    expect(escaped.state).toEqual(EMPTY_BURST);
    expect(escaped.outcome).toEqual({ kind: "loose" });
  });

  it("ignores an Enter that arrives long after the last character", () => {
    const typed = type(PAYLOAD, SCANNER_GAP_MS);
    const ended = stepBurst(typed.state, { key: "Enter", at: typed.state.lastKeyAt + 5000 });

    expect(ended.outcome).toEqual({ kind: "loose" });
  });

  it("reports a scan for the legacy 15-character form as well", () => {
    const legacy = "=W483626000011N";
    const typed = type(legacy, SCANNER_GAP_MS);
    const ended = stepBurst(typed.state, { key: "Enter", at: typed.state.lastKeyAt + 4 });

    expect(ended.outcome).toEqual({ kind: "scan", scan: legacy, consumedKey: true });
  });

  it("ends an unsuffixed scan when the next burst starts after the silence", () => {
    const first = type(PAYLOAD, SCANNER_GAP_MS);
    const next = stepBurst(first.state, {
      key: "=",
      at: first.state.lastKeyAt + BURST_RESET_MS + 1,
    });

    // The key that arrived starts the next burst rather than ending this one,
    // so the caller must let it through to the page.
    expect(next.outcome).toEqual({ kind: "scan", scan: PAYLOAD, consumedKey: false });
    expect(next.state.buffer).toBe("=");
    expect(next.state.atScannerSpeed).toBe(true);
  });

  it("reads two unsuffixed scans in a row", () => {
    const second = "=W48362600002300";

    const first = type(PAYLOAD, SCANNER_GAP_MS);
    const firstEnd = flushBurst(first.state, first.state.lastKeyAt + BURST_RESET_MS);
    expect(firstEnd.scan).toBe(PAYLOAD);

    const secondTyped = type(second, SCANNER_GAP_MS, firstEnd.state, first.state.lastKeyAt + 400);
    const secondEnd = flushBurst(secondTyped.state, secondTyped.state.lastKeyAt + BURST_RESET_MS);

    expect(secondEnd.scan).toBe(second);
    expect(secondEnd.state).toEqual(EMPTY_BURST);
  });

  it("reads two suffixed scans in a row", () => {
    const second = "=W48362600002300";

    const first = type(PAYLOAD, SCANNER_GAP_MS);
    const firstEnd = stepBurst(first.state, { key: "Enter", at: first.state.lastKeyAt + 4 });
    expect(firstEnd.outcome).toEqual({ kind: "scan", scan: PAYLOAD, consumedKey: true });

    const secondTyped = type(second, SCANNER_GAP_MS, firstEnd.state, first.state.lastKeyAt + 30);
    const secondEnd = stepBurst(secondTyped.state, {
      key: "Enter",
      at: secondTyped.state.lastKeyAt + 4,
    });

    expect(secondEnd.outcome).toEqual({ kind: "scan", scan: second, consumedKey: true });
  });

  it("stops the buffer growing when a key repeats at scanner speed", () => {
    const held = "x".repeat(MAX_BURST_LENGTH + 40);
    const typed = type(held, SCANNER_GAP_MS);

    expect(typed.state.buffer.length).toBe(MAX_BURST_LENGTH);
    expect(typed.state.atScannerSpeed).toBe(false);

    const ended = stepBurst(typed.state, { key: "Enter", at: typed.state.lastKeyAt + 4 });
    expect(ended.outcome).toEqual({ kind: "loose" });
  });

  it("stops the buffer growing while a person types", () => {
    const typed = type("y".repeat(MAX_BURST_LENGTH + 40), BURST_RESET_MS - 1);

    expect(typed.state.buffer.length).toBe(MAX_BURST_LENGTH);
    expect(typed.state.atScannerSpeed).toBe(false);
  });
});

describe("flushBurst", () => {
  it("ends a scan that arrived with no suffix key", () => {
    const typed = type(PAYLOAD, SCANNER_GAP_MS);
    const flushed = flushBurst(typed.state, typed.state.lastKeyAt + BURST_RESET_MS);

    expect(flushed.scan).toBe(PAYLOAD);
    expect(flushed.state).toEqual(EMPTY_BURST);
  });

  it("leaves the burst alone while the silence is still short", () => {
    const typed = type(PAYLOAD, SCANNER_GAP_MS);
    const flushed = flushBurst(typed.state, typed.state.lastKeyAt + BURST_RESET_MS - 1);

    expect(flushed.scan).toBeNull();
    expect(flushed.state).toEqual(typed.state);
  });

  it("does not turn typing into a scan", () => {
    const typed = type(PAYLOAD, 120);
    const flushed = flushBurst(typed.state, typed.state.lastKeyAt + BURST_RESET_MS);

    expect(flushed.scan).toBeNull();
  });

  it("does not turn a short burst into a scan", () => {
    const typed = type("1234", SCANNER_GAP_MS);
    const flushed = flushBurst(typed.state, typed.state.lastKeyAt + BURST_RESET_MS);

    expect(flushed.scan).toBeNull();
  });
});
