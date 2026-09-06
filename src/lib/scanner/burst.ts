/**
 * Tells a barcode scan apart from typing on the keyboard.
 *
 * The scanner on an operator's desk is a keyboard wedge: it types the label
 * contents and then presses Enter. Nothing in the keyboard event says where
 * the characters came from, so this module judges by speed. A scanner emits
 * its characters within a few milliseconds of each other, and a person cannot.
 *
 * The state machine here is pure. It takes one key at a time with the moment
 * it arrived and returns the next state plus what the caller should do. The
 * hook in `use-scan-listener.ts` is what supplies real keyboard events.
 */

/**
 * Largest gap between two characters that still counts as one burst. A wedge
 * scanner sends characters a few milliseconds apart. The fastest typist needs
 * far more than 50 ms per character.
 */
export const BURST_GAP_MS = 50;

/**
 * A pause this long throws away whatever has been collected. It stops
 * characters typed minutes apart from ever joining into one string.
 */
export const BURST_RESET_MS = 200;

/**
 * Shortest burst that can be a scan. Every form of scan this app accepts is at
 * least 13 characters, so five is a generous floor that still ignores stray
 * fast key presses such as a held-down arrow key.
 */
export const MIN_BURST_LENGTH = 5;

/** What the detector has collected so far. */
export interface BurstState {
  /** The characters collected since the last reset. */
  buffer: string;
  /** When the last character arrived, in milliseconds. */
  lastKeyAt: number;
  /**
   * True while every gap inside `buffer` has been at scanner speed. One slow
   * gap turns this off, and it stays off until the buffer restarts.
   */
  atScannerSpeed: boolean;
}

/** A key press, reduced to the two things the detector needs. */
export interface BurstKey {
  /** The `key` of the keyboard event: one printable character, or a name such as "Enter". */
  key: string;
  /** When the key arrived, in milliseconds. `performance.now()` supplies this. */
  at: number;
}

/** What the caller should do with the key it just passed in. */
export type BurstOutcome =
  /** The key was swallowed into a burst that is still running. Do nothing. */
  | { kind: "collecting" }
  /** A burst ended and it is a scan. `scan` is the whole collected string. */
  | { kind: "scan"; scan: string }
  /** The key is not part of a scanner burst, so the screen may act on it. */
  | { kind: "loose" };

/** A detector with nothing collected. */
export const EMPTY_BURST: BurstState = { buffer: "", lastKeyAt: 0, atScannerSpeed: false };

/** True when `key` is a single printable character rather than a key name. */
function isPrintable(key: string): boolean {
  return key.length === 1;
}

/**
 * Feeds one key to the detector.
 *
 * Enter ends a burst. The burst is a scan when it holds at least
 * `MIN_BURST_LENGTH` characters, every gap inside it was at scanner speed, and
 * the Enter itself arrived at scanner speed after the last character. Any
 * other key name, such as Escape or Tab, throws the buffer away, because a
 * scanner never sends one in the middle of a label.
 */
export function stepBurst(
  state: BurstState,
  key: BurstKey,
): { state: BurstState; outcome: BurstOutcome } {
  const gap = state.buffer.length === 0 ? Infinity : key.at - state.lastKeyAt;

  if (key.key === "Enter") {
    const isScan =
      state.atScannerSpeed && state.buffer.length >= MIN_BURST_LENGTH && gap <= BURST_GAP_MS;
    return {
      state: EMPTY_BURST,
      outcome: isScan ? { kind: "scan", scan: state.buffer } : { kind: "loose" },
    };
  }

  if (!isPrintable(key.key)) {
    return { state: EMPTY_BURST, outcome: { kind: "loose" } };
  }

  // A first character, or one after a long pause, starts a fresh buffer. It is
  // reported loose because a single character carries no speed yet, and the
  // screen should still be able to act on it.
  if (gap > BURST_RESET_MS) {
    return {
      state: { buffer: key.key, lastKeyAt: key.at, atScannerSpeed: true },
      outcome: { kind: "loose" },
    };
  }

  const atScannerSpeed = state.atScannerSpeed && gap <= BURST_GAP_MS;
  return {
    state: { buffer: state.buffer + key.key, lastKeyAt: key.at, atScannerSpeed },
    outcome: atScannerSpeed ? { kind: "collecting" } : { kind: "loose" },
  };
}
