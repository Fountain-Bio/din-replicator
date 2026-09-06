/**
 * The ranges the settings screen allows and the values the app falls back to.
 *
 * The Rust side stores settings and hands them back. These constants describe
 * what a person may choose, and what the app uses on the one occasion it has
 * nothing to go on: the saved settings could not be read at all.
 */

import type { Settings } from "@/lib/tauri/types";

/** The heat the printer applies, lowest and highest the printer accepts. */
export const DARKNESS_RANGE = { min: 0, max: 30 } as const;

/** How fast a label leaves the printer, in inches per second. */
export const SPEED_IPS_RANGE = { min: 2, max: 6 } as const;

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
  printMethod: "thermalTransfer",
  darkness: 16,
  speedIps: 3,
};

/** Keeps a number inside a range, rounded to a whole number. */
export function clampWhole(value: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(value)) {
    return range.min;
  }
  return Math.min(Math.max(Math.round(value), range.min), range.max);
}
