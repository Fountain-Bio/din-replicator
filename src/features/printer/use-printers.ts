/**
 * The printers this computer has, and what the chosen one is doing.
 *
 * Two separate questions, so two hooks. The list comes from the operating
 * system once and again whenever the operator asks for it. The chosen
 * printer's state is read over and over, because a printer can be switched off
 * or run out of label stock while the app is open.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  asCommandError,
  listPrinters,
  printerState as readPrinterState,
} from "@/lib/tauri/commands";
import type { PrinterInfo, PrinterState } from "@/lib/tauri/types";

/** How often the app re-reads the chosen printer's state, in milliseconds. */
const PRINTER_POLL_MS = 15_000;

export interface Printers {
  /** Every printer installed on this computer. */
  printers: PrinterInfo[];
  /** True while the list is being read from the operating system. */
  loading: boolean;
  /** Reads the list again, which is what the settings screen's button does. */
  refresh: () => void;
}

/** The printer list, read when the window opens and whenever asked again. */
export function usePrinters(): Printers {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const read = useCallback(() => {
    return listPrinters()
      .then(setPrinters, (reason: unknown) => {
        toast.error(`The printer list could not be read. ${asCommandError(reason).message}`);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const refresh = useCallback(() => {
    setLoading(true);
    void read();
  }, [read]);

  return { printers, loading, refresh };
}

/**
 * Which printer the replicas go to, in the three states the scan screen has to
 * tell apart.
 *
 * Nobody has chosen one, which is what a new machine starts out as. Settings
 * hold a name the operating system no longer lists, which is what a renamed or
 * unplugged printer looks like. Or there is a printer and it reports a state.
 * The three need different wording, because only the second one means
 * something changed.
 */
export type SelectedPrinter =
  | { kind: "none" }
  | { kind: "missing"; name: string }
  | { kind: "found"; printer: PrinterInfo; state: PrinterState };

export interface SelectedPrinterHandle {
  selected: SelectedPrinter;
  /**
   * Reads the chosen printer's state now rather than waiting for the next
   * poll, and returns what it said. Null when no printer is chosen.
   */
  refreshState: () => Promise<PrinterState | null>;
}

/**
 * Follows the printer settings name, and keeps its state fresh.
 *
 * The state starts as the one the printer list carried, so the screen never
 * has a printer with nothing to say about it, and the poll replaces it from
 * then on.
 */
export function useSelectedPrinter(
  printers: PrinterInfo[],
  selectedName: string | null,
): SelectedPrinterHandle {
  // The state carries the printer it was read from, so an answer that arrives
  // after the operator has chosen a different printer is ignored rather than
  // shown against the new one.
  const [polled, setPolled] = useState<{ name: string; state: PrinterState } | null>(null);

  const refreshState = useCallback((): Promise<PrinterState | null> => {
    if (selectedName === null) {
      return Promise.resolve(null);
    }
    return (
      readPrinterState(selectedName)
        // A printer the operating system will not answer for is a printer whose
        // state the app does not know, which is a state of its own.
        .catch((): PrinterState => ({ kind: "unknown" }))
        .then((state) => {
          setPolled({ name: selectedName, state });
          return state;
        })
    );
  }, [selectedName]);

  useEffect(() => {
    if (selectedName === null) {
      return;
    }
    const poll = () => void refreshState();
    poll();
    const timer = setInterval(poll, PRINTER_POLL_MS);
    return () => clearInterval(timer);
  }, [selectedName, refreshState]);

  const printer = printers.find((candidate) => candidate.name === selectedName);
  // Until the first poll answers, the state the printer list carried stands
  // in, so a chosen printer always has something to say about itself.
  const live = polled !== null && polled.name === selectedName ? polled.state : null;
  const selected: SelectedPrinter =
    selectedName === null
      ? { kind: "none" }
      : printer === undefined
        ? { kind: "missing", name: selectedName }
        : { kind: "found", printer, state: live ?? printer.state };

  return { selected, refreshState };
}

/** The chosen printer's state, or null when no printer is chosen. */
export function selectedPrinterState(selected: SelectedPrinter): PrinterState | null {
  return selected.kind === "found" ? selected.state : null;
}
