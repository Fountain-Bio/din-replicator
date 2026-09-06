/**
 * What the settings screen's number boxes allow.
 *
 * The Rust side owns every default and every range: `src-tauri/src/settings.rs`
 * hands back the defaults and refuses a value outside its range with the
 * `invalid_input` code. Nothing here decides what a setting may be. These
 * bounds only keep a number typed into a box from leaving it out of range, so
 * the operator sees the box correct itself rather than a rejected save.
 *
 * The printing settings take their bounds from `@/lib/label/replica-zpl`,
 * which is the module that builds the ZPL those numbers go into.
 */

import { MAX_COPIES } from "@/lib/label/replica-zpl";

/** Bounds for the settings the label module does not own. */
export const SETTINGS_BOUNDS = {
  /** The largest copy count one print run may ask for. */
  maxCopies: { min: 1, max: MAX_COPIES },
} as const;

/** Keeps a number inside a range, rounded to a whole number. */
export function clampWhole(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.round(value), min), max);
}
