/**
 * Catching barcode scans anywhere in the window. `burst.ts` holds the pure
 * speed test and `use-scan-listener.ts` wires it to real keyboard events.
 */

export {
  BURST_GAP_MS,
  BURST_RESET_MS,
  EMPTY_BURST,
  MIN_BURST_LENGTH,
  stepBurst,
  type BurstKey,
  type BurstOutcome,
  type BurstState,
} from "./burst";
export {
  SCAN_OPT_OUT_ATTRIBUTE,
  scanOptOutProps,
  useScanListener,
  type ScanListenerOptions,
} from "./use-scan-listener";
