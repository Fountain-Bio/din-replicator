/**
 * The operator's saved choices: reading them, saving them, and picking the
 * printer on a machine that has only one to pick.
 *
 * The Rust side owns every default and every range. Nothing here fills a
 * setting in. When the saved settings cannot be read at all, `settings` stays
 * null and `error` says why, and the screens that need a setting show that
 * sentence instead of guessing.
 *
 * Settings live in the print log database, so settings that cannot be read
 * mean a print log that cannot record a print run. That is why the error also
 * stops printing.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { asCommandError, getSettings, setSettings } from "@/lib/tauri/commands";
import type { PrinterInfo, Settings } from "@/lib/tauri/types";

export interface SettingsHandle {
  /** The saved choices, or null until they have been read. */
  settings: Settings | null;
  /** Why the saved choices could not be read, or null when they were. */
  error: string | null;
  /** Saves a whole set of choices and keeps the copy on screen in step. */
  save: (next: Settings) => void;
}

/**
 * Reads the saved choices once, and saves every change as it is made.
 *
 * `printers` is here for one job: a computer with exactly one label printer
 * needs no choosing, so that printer is picked the first time the app sees it.
 * Every other case is left to the settings screen.
 */
export function useSettings(printers: PrinterInfo[]): SettingsHandle {
  const [settings, setLocalSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then(
      (saved) => {
        setLocalSettings(saved);
        setError(null);
      },
      (reason: unknown) => {
        setError(asCommandError(reason).message);
      },
    );
  }, []);

  // The screen shows the new value straight away, then the stored answer
  // replaces it. Rust may adjust what it stores, and what it stored is what
  // the app has to show.
  const save = useCallback((next: Settings) => {
    setLocalSettings(next);
    setSettings(next).then(setLocalSettings, (reason: unknown) => {
      toast.error(`The setting could not be saved. ${asCommandError(reason).message}`);
    });
  }, []);

  useEffect(() => {
    if (settings === null || settings.selectedPrinter !== null) {
      return;
    }
    const labelPrinters = printers.filter((printer) => printer.isZebra);
    if (labelPrinters.length !== 1) {
      return;
    }

    let cancelled = false;
    setSettings({ ...settings, selectedPrinter: labelPrinters[0]!.name }).then(
      (saved) => {
        if (!cancelled) {
          setLocalSettings(saved);
        }
      },
      (reason: unknown) => {
        toast.error(`The printer could not be saved. ${asCommandError(reason).message}`);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [printers, settings]);

  return { settings, error, save };
}
