/**
 * The ranges the settings screen allows and the values the app falls back to.
 *
 * The Rust side stores settings and hands them back. These constants describe
 * what a person may choose, and what the app uses on the one occasion it has
 * nothing to go on: the saved settings could not be read at all.
 */

import { DEFAULT_LABEL_FONT } from "@/lib/label/fonts";
import {
  DARKNESS_MAX,
  DARKNESS_MIN,
  DEFAULT_PRINT_SETTINGS,
  OFFSET_DOTS_MAX,
  OFFSET_DOTS_MIN,
  SPEED_IPS_MAX,
  SPEED_IPS_MIN,
} from "@/lib/label/replica-zpl";
import type { Settings } from "@/lib/tauri/types";

/** The heat the printer applies, lowest and highest the printer accepts. */
export const DARKNESS_RANGE = { min: DARKNESS_MIN, max: DARKNESS_MAX } as const;

/** How fast a label leaves the printer, in inches per second. */
export const SPEED_IPS_RANGE = { min: SPEED_IPS_MIN, max: SPEED_IPS_MAX } as const;

/** How far the printed content may be moved on the label stock, in dots. */
export const OFFSET_DOTS_RANGE = { min: OFFSET_DOTS_MIN, max: OFFSET_DOTS_MAX } as const;

/**
 * What the app uses when the saved settings cannot be read.
 *
 * The printing values are the ones the label stock and the printer in use were
 * set up with, so an operator who never opens the Printing section gets labels
 * that scan.
 */
export const FALLBACK_SETTINGS: Settings = {
  selectedPrinter: null,
  verifyAfterPrint: true,
  maxCopies: 20,
  labelFont: DEFAULT_LABEL_FONT,
  ...DEFAULT_PRINT_SETTINGS,
};

/** Keeps a number inside a range, rounded to a whole number. */
export function clampWhole(value: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(value)) {
    return range.min;
  }
  return Math.min(Math.max(Math.round(value), range.min), range.max);
}
