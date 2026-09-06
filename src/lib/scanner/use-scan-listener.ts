/**
 * A window-wide listener that catches barcode scans wherever focus happens to
 * be.
 *
 * An operator holds a scanner in one hand and never clicks into a field first,
 * so the app cannot rely on a focused input to receive a scan. This hook
 * listens on the window instead and uses the speed test in `burst.ts` to tell
 * a scan from typing.
 *
 * A scanner configured with no suffix key ends its scan by stopping. The timer
 * here covers that: every character arms it, and it fires once the silence has
 * passed `BURST_RESET_MS`.
 */

import { useEffect, useRef } from "react";
import { BURST_RESET_MS, EMPTY_BURST, flushBurst, stepBurst, type BurstState } from "./burst";

/**
 * Marks an element whose ordinary typing belongs to the element alone.
 *
 * The history search box carries this, so the letters someone types there do
 * not reach the scan screen's keyboard shortcuts. A scanner burst inside the
 * box is still caught, and the burst characters are taken back out of the box
 * afterwards.
 */
export const SCAN_OPT_OUT_ATTRIBUTE = "data-scan-opt-out";

/** Spread this onto an input that should keep its own typing. */
export const scanOptOutProps = { [SCAN_OPT_OUT_ATTRIBUTE]: "true" } as const;

export interface ScanListenerOptions {
  /**
   * Called for a key press that is not part of a scanner burst and did not
   * land in a form field. The scan screen uses it for the copy count digits,
   * Enter, and Escape.
   */
  onLooseKey?: (event: KeyboardEvent) => void;
  /** Set to false to stop listening, for example while a screen is loading. */
  enabled?: boolean;
}

/** True when keys aimed at `target` belong to the element rather than the app. */
function keepsItsOwnKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.hasAttribute(SCAN_OPT_OUT_ATTRIBUTE)) {
    return true;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

/**
 * Removes the characters a scanner just typed from the end of a field's value.
 *
 * A burst that lands in a focused text box leaves the label contents sitting
 * in it. React owns the value of a controlled input, so setting `value`
 * directly would be undone on the next render. Calling the prototype setter
 * and dispatching an `input` event is what makes React see the change and run
 * its `onChange`.
 */
function takeBackBurstText(target: EventTarget | null, burst: string): void {
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
    return;
  }
  const field = target;
  if (!field.value.endsWith(burst)) {
    return;
  }
  const prototype =
    field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setValue === undefined) {
    return;
  }
  setValue.call(field, field.value.slice(0, field.value.length - burst.length));
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Calls `onScan` with the raw string every time the scanner reads a label.
 *
 * The string is passed on untouched. `parseScan` is what decides whether it
 * holds a DIN.
 */
export function useScanListener(
  onScan: (scan: string) => void,
  options: ScanListenerOptions = {},
): void {
  const { onLooseKey, enabled = true } = options;

  // The callbacks change on most renders. Keeping them in refs lets the
  // listener stay attached for the life of the screen, so a burst is never
  // split across two listeners. The refs are refreshed after every render,
  // which is before any key press can reach the listener.
  const onScanRef = useRef(onScan);
  const onLooseKeyRef = useRef(onLooseKey);
  useEffect(() => {
    onScanRef.current = onScan;
    onLooseKeyRef.current = onLooseKey;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let burst: BurstState = EMPTY_BURST;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    // Where the characters of the burst being collected are landing, so they
    // can be taken back out of it once the burst turns out to be a scan.
    let burstTarget: EventTarget | null = null;

    function armFlush() {
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        const collected = burst.buffer;
        const target = burstTarget;
        // The timer was armed to fire one reset window after the last key, so
        // that is the moment the silence reached its length. Using it instead
        // of the clock keeps the decision free of timer drift.
        const flushed = flushBurst(burst, burst.lastKeyAt + BURST_RESET_MS);
        burst = flushed.state;
        if (flushed.scan !== null) {
          takeBackBurstText(target, collected);
          onScanRef.current(flushed.scan);
        }
      }, BURST_RESET_MS);
    }

    function handleKeyDown(event: KeyboardEvent) {
      // A shortcut such as Ctrl+C is never part of a scan and never a screen
      // key, so it goes to the browser untouched.
      if (event.ctrlKey || event.metaKey || event.altKey) {
        clearTimeout(flushTimer);
        burst = EMPTY_BURST;
        burstTarget = null;
        return;
      }

      const collected = burst.buffer;
      const collectedTarget = burstTarget;
      const step = stepBurst(burst, { key: event.key, at: event.timeStamp });
      burst = step.state;
      clearTimeout(flushTimer);

      // A buffer that is one character long restarted on this key, so it
      // belongs to whatever has focus now. A longer one kept the element its
      // first character went to.
      burstTarget =
        burst.buffer.length === 0
          ? null
          : burst.buffer.length === 1
            ? event.target
            : collectedTarget;
      if (burst.buffer.length > 0) {
        armFlush();
      }

      switch (step.outcome.kind) {
        case "collecting":
          return;

        case "scan":
          if (step.outcome.consumedKey) {
            // Swallow the suffix key so a form under the scanner does not
            // submit and focus does not move on.
            event.preventDefault();
          }
          takeBackBurstText(collectedTarget, collected);
          onScanRef.current(step.outcome.scan);
          return;

        case "loose":
          if (!keepsItsOwnKeys(event.target)) {
            onLooseKeyRef.current?.(event);
          }
          return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(flushTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled]);
}
