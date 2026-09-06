/**
 * What the settings screen's number boxes allow, and the one place that turns
 * saved settings into the label stock the label module lays a replica out on.
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

import {
  LABEL_HEIGHT_INCHES_MAX,
  LABEL_HEIGHT_INCHES_MIN,
  LABEL_WIDTH_INCHES_MAX,
  LABEL_WIDTH_INCHES_MIN,
  MAX_COPIES,
  type LabelStock,
} from "@/lib/label/replica-zpl";
import type { Settings } from "@/lib/tauri/types";

/** Bounds for the settings the label module does not own. */
export const SETTINGS_BOUNDS = {
  /** The largest copy count one print run may ask for. */
  maxCopies: { min: 1, max: MAX_COPIES },
  /** Width of one label, in inches. */
  labelWidthInches: { min: LABEL_WIDTH_INCHES_MIN, max: LABEL_WIDTH_INCHES_MAX },
  /** Height of one label, in inches. */
  labelHeightInches: { min: LABEL_HEIGHT_INCHES_MIN, max: LABEL_HEIGHT_INCHES_MAX },
} as const;

/**
 * The stock and printer resolution the saved settings describe.
 *
 * Settings keep the three numbers flat, because that is the shape Rust stores
 * and sends. The label module wants them as one object. This is the only place
 * that turns one into the other, so the preview and the print run cannot end
 * up laying a label out for different stock.
 */
export function labelStock(settings: Settings): LabelStock {
  return {
    widthInches: settings.labelWidthInches,
    heightInches: settings.labelHeightInches,
    dotsPerInch: settings.printerDotsPerInch,
  };
}

/** Keeps a number inside a range, rounded to `decimals` places after the point. */
export function clampDecimal(value: number, min: number, max: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  const scale = 10 ** decimals;
  const rounded = Math.round(value * scale) / scale;
  return Math.min(Math.max(rounded, min), max);
}

/** Keeps a number inside a range, rounded to a whole number. */
export function clampWhole(value: number, min: number, max: number): number {
  return clampDecimal(value, min, max, 0);
}
