/**
 * Tells a barcode scan apart from typing on the keyboard.
 *
 * The scanner on an operator's desk is a keyboard wedge: it types the label
 * contents and then sends its suffix key. Nothing in the keyboard event says
 * where the characters came from, so this module judges by speed. A scanner
 * emits its characters within a few milliseconds of each other, and a person
 * cannot.
 *
 * Scanners differ in how they end a scan. Some send Enter, some send Tab, and
 * some are configured with no suffix at all and simply stop. All three endings
 * are handled: `stepBurst` takes the key presses, and `flushBurst` ends a scan
 * that stopped in silence.
 *
 * The state machine here is pure. It takes one key at a time with the moment
 * it arrived and returns the next state plus what the caller should do. The
 * hook in `use-scan-listener.ts` is what supplies real keyboard events and the
 * timer that calls `flushBurst`.
 */

/**
 * Largest gap between two characters that still counts as one burst. A wedge
 * scanner sends characters a few milliseconds apart. The fastest typist needs
 * far more than 50 ms per character.
 */
export const BURST_GAP_MS = 50;

/**
 * Silence this long ends a burst. A scanner with no suffix key is finished
 * once it stops, and characters typed this far apart never belong to one scan.
 */
export const BURST_RESET_MS = 200;

/**
 * Shortest burst that can be a scan. Every form of scan this app accepts is at
 * least 13 characters, so five is a generous floor that still ignores stray
 * fast key presses such as a held-down arrow key.
 */
export const MIN_BURST_LENGTH = 5;

/**
 * Longest burst the detector holds on to. The longest scan this app accepts is
 * 16 characters, so anything past this is a person typing or a key stuck on
 * repeat. Going over the cap disqualifies the burst and keeps only the tail,
 * so the buffer cannot grow without limit while a screen has no focused field.
 */
export const MAX_BURST_LENGTH = 64;

/** The key names a scanner can be configured to send after the label. */
const TERMINATOR_KEYS = ["Enter", "Tab"];

/** What the detector has collected so far. */
export interface BurstState {
  /** The characters collected since the last reset. */
  buffer: string;
  /** When the last character arrived, in milliseconds. */
  lastKeyAt: number;
  /**
   * True while every gap inside `buffer` has been at scanner speed and the
   * buffer is still short enough to be a scan. Once false it stays false until
   * the buffer restarts.
   */
  atScannerSpeed: boolean;
}

/** A key press, reduced to the two things the detector needs. */
export interface BurstKey {
  /** The `key` of the keyboard event: one printable character, or a name such as "Enter". */
  key: string;
  /** When the key arrived, in milliseconds. `event.timeStamp` supplies this. */
  at: number;
}

/** What the caller should do with the key it just passed in. */
export type BurstOutcome =
  /** The key was swallowed into a burst that is still running. Do nothing. */
  | { kind: "collecting" }
  /** A burst ended and it is a scan. `scan` is the whole collected string. */
  | {
      kind: "scan";
      scan: string;
      /**
       * True when the key that arrived is the scanner's suffix and belongs to
       * the scan, so the caller should stop it reaching the page. False when
       * the scan ended in silence and the key starts something new.
       */
      consumedKey: boolean;
    }
  /** The key is not part of a scanner burst, so the screen may act on it. */
  | { kind: "loose" };

/** A detector with nothing collected. */
export const EMPTY_BURST: BurstState = { buffer: "", lastKeyAt: 0, atScannerSpeed: false };

/** True when `key` is a single printable character rather than a key name. */
function isPrintable(key: string): boolean {
  return key.length === 1;
}

/**
 * Key names the browser reports for modifier presses. A keyboard-wedge scanner
 * emits these between characters, so the detector ignores them.
 */
const MODIFIER_KEYS = ["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph", "Dead"];

/** True when what has been collected is long enough and fast enough to be a scan. */
function isScannable(state: BurstState): boolean {
  return state.atScannerSpeed && state.buffer.length >= MIN_BURST_LENGTH;
}

/**
 * Feeds one key to the detector.
 *
 * Enter and Tab end a burst, because a scanner can be configured to send
 * either. The burst is a scan when it holds at least `MIN_BURST_LENGTH`
 * characters, every gap inside it was at scanner speed, and the suffix key
 * itself arrived at scanner speed after the last character. Any other key
 * name, such as Escape, throws the buffer away, because a scanner never sends
 * one in the middle of a label.
 *
 * A character that arrives after a long silence also ends the burst before it.
 * A scanner with no suffix key relies on `flushBurst` and its timer for that,
 * and this is the same rule applied where the timer did not get to run, such
 * as in a window the operating system had put to sleep.
 */
export function stepBurst(
  state: BurstState,
  key: BurstKey,
): { state: BurstState; outcome: BurstOutcome } {
  const gap = state.buffer.length === 0 ? Infinity : key.at - state.lastKeyAt;

  if (TERMINATOR_KEYS.includes(key.key)) {
    const isScan = isScannable(state) && gap <= BURST_GAP_MS;
    return {
      state: EMPTY_BURST,
      outcome: isScan ? { kind: "scan", scan: state.buffer, consumedKey: true } : { kind: "loose" },
    };
  }

  // A scanner acting as a keyboard presses Shift before every capital letter
  // and some symbols, and the operating system reports that press as its own
  // key event. Modifier presses carry no character and say nothing about the
  // burst, so they leave it exactly as it was.
  if (MODIFIER_KEYS.includes(key.key)) {
    return { state, outcome: { kind: "collecting" } };
  }

  if (!isPrintable(key.key)) {
    return { state: EMPTY_BURST, outcome: { kind: "loose" } };
  }

  if (gap > BURST_RESET_MS) {
    const restarted: BurstState = { buffer: key.key, lastKeyAt: key.at, atScannerSpeed: true };
    if (isScannable(state)) {
      return {
        state: restarted,
        outcome: { kind: "scan", scan: state.buffer, consumedKey: false },
      };
    }
    // A first character, or one after a long pause, carries no speed yet, so
    // the screen should still be able to act on it.
    return { state: restarted, outcome: { kind: "loose" } };
  }

  const grown = state.buffer + key.key;
  const tooLong = grown.length > MAX_BURST_LENGTH;
  const atScannerSpeed = state.atScannerSpeed && gap <= BURST_GAP_MS && !tooLong;
  return {
    state: {
      buffer: tooLong ? grown.slice(-MAX_BURST_LENGTH) : grown,
      lastKeyAt: key.at,
      atScannerSpeed,
    },
    outcome: atScannerSpeed ? { kind: "collecting" } : { kind: "loose" },
  };
}

/**
 * Ends a burst that stopped without a suffix key.
 *
 * The caller runs this once the silence since the last character has passed
 * `BURST_RESET_MS`. It returns the scan when the burst qualifies, and leaves
 * the state alone when it does not, so calling it early is harmless.
 */
export function flushBurst(
  state: BurstState,
  at: number,
): { state: BurstState; scan: string | null } {
  if (isScannable(state) && at - state.lastKeyAt >= BURST_RESET_MS) {
    return { state: EMPTY_BURST, scan: state.buffer };
  }
  return { state, scan: null };
}
