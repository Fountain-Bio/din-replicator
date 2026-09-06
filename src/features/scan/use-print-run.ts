/**
 * One print run, from the DIN on the screen to the row in the print log.
 *
 * The reducer in `scan-state.ts` holds every decision the scan screen makes
 * and stays pure. This hook is the part that talks to the printer and the
 * print log, because one print run touches two commands in order and the
 * verification that follows touches a third.
 */

import { useCallback, useEffect, useReducer } from "react";
import { toast } from "sonner";
import { printerStateText } from "@/components/printer-status";
import { barcodePayload } from "@/lib/isbt128";
import { buildReplicaZpl, MAX_COPIES } from "@/lib/label/replica-zpl";
import { printLogUnavailableText } from "@/lib/print-log";
import { asCommandError, printZpl, recordPrintRun, recordVerification } from "@/lib/tauri/commands";
import type { PrinterState, Settings } from "@/lib/tauri/types";
import { initialScanState, scanReducer, type ScanAction, type ScanState } from "./scan-state";

export interface PrintRunOptions {
  /** The operator's saved choices, or null until they have been read. */
  settings: Settings | null;
  /**
   * Why printing is off for a reason that has nothing to do with the printer,
   * or null when nothing blocks it.
   */
  blockedReason: string | null;
  /**
   * Reads the chosen printer's state now. The pipeline calls this after the
   * printer refuses a print run, so the status line and the message the
   * operator reads say the same thing.
   */
  refreshPrinterState: () => Promise<PrinterState | null>;
  /** Reads where the print log stands. Called after the log refuses a write. */
  refreshStorage: () => void;
}

/**
 * The one place a refused print run turns into a sentence.
 *
 * A printer that would leave the job waiting comes back as
 * `printer_not_ready`, and the reason is the printer's state. The state is
 * read again and put through the same wording the status line uses, so the
 * message and the line above it agree. Every other refusal already carries a
 * sentence of its own.
 */
async function printFailureText(
  reason: unknown,
  refreshPrinterState: () => Promise<PrinterState | null>,
): Promise<string> {
  const error = asCommandError(reason);
  if (error.code !== "printer_not_ready") {
    return error.message;
  }
  const live = await refreshPrinterState();
  return live === null ? error.message : printerStateText(live);
}

export interface PrintRunHandle {
  state: ScanState;
  dispatch: (action: ScanAction) => void;
  /** Sends the loaded DIN to the printer and records the print run. */
  print: () => void;
  /** Puts a DIN and a copy count on the screen, which is what "Print again" does. */
  loadAgain: (din: string, copyCount: number) => void;
}

export function usePrintRun({
  settings,
  blockedReason,
  refreshPrinterState,
  refreshStorage,
}: PrintRunOptions): PrintRunHandle {
  // The copy count ceiling belongs to settings. Until they arrive, the label
  // module's own ceiling stands in, because that is the largest copy count a
  // replica can be built for at all.
  const [state, dispatch] = useReducer(scanReducer, initialScanState(MAX_COPIES));

  useEffect(() => {
    if (settings !== null) {
      dispatch({ type: "set-max-copy-count", maxCopyCount: settings.maxCopies });
    }
  }, [settings]);

  /**
   * Sends the ZPL, then writes the print run down.
   *
   * ADR 0003 makes `print_zpl` the one gate: the Rust command reads the queue
   * itself and refuses with the `printer_not_ready` code, so nothing is
   * checked here first. Reading the printer beforehand would only add an
   * answer that can be stale by the time the job is sent.
   *
   * The sending and the recording are two separate steps on purpose. Once
   * `print_zpl` returns, the labels are coming out of the printer and nothing
   * can call them back. A failure after that point is not a failed print run,
   * it is a print run nobody wrote down, and the operator has to be told which
   * of the two happened.
   */
  const print = useCallback(async () => {
    const din = state.din;
    if (din === null || settings === null) {
      return;
    }
    if (blockedReason !== null) {
      dispatch({ type: "print-failed", message: printLogUnavailableText(blockedReason) });
      return;
    }
    if (settings.selectedPrinter === null) {
      dispatch({
        type: "print-failed",
        message: "No printer is chosen. Pick one on the Settings screen.",
      });
      return;
    }

    const printerName = settings.selectedPrinter;
    const copyCount = state.copyCount;
    const payload = barcodePayload(din);
    const zpl = buildReplicaZpl({
      din,
      copies: copyCount,
      printSettings: {
        printMethod: settings.printMethod,
        darkness: settings.darkness,
        speedIps: settings.speedIps,
        verticalOffsetDots: settings.verticalOffsetDots,
        horizontalOffsetDots: settings.horizontalOffsetDots,
      },
      labelFont: settings.labelFont,
    });
    dispatch({ type: "print-started" });

    let jobId: string | null;
    try {
      jobId = (await printZpl(printerName, zpl, `DIN ${din} x${copyCount}`)).jobId;
    } catch (reason) {
      dispatch({
        type: "print-failed",
        message: await printFailureText(reason, refreshPrinterState),
      });
      return;
    }

    // The replicas are printing from here on.
    try {
      const run = await recordPrintRun({
        din,
        payload,
        copyCount,
        printerName,
        jobId,
        zpl,
      });
      dispatch({
        type: "print-succeeded",
        printRunId: run.id,
        copyCount,
        verifyAfterPrint: settings.verifyAfterPrint,
      });
    } catch (reason) {
      dispatch({ type: "print-not-recorded", reason: asCommandError(reason).message });
      // The print log just refused a write, so read its state again to find
      // out whether it is now unreachable and printing should stop.
      refreshStorage();
    }
  }, [blockedReason, refreshPrinterState, refreshStorage, settings, state.copyCount, state.din]);

  const startPrint = useCallback(() => void print(), [print]);

  // The reducer works out whether a verification scan matched. Writing that
  // verdict to the print log is a command call, so it happens here.
  useEffect(() => {
    const pending = state.pendingVerification;
    if (pending === null) {
      return;
    }
    recordVerification(pending)
      .catch((reason: unknown) => {
        toast.error(`The verification could not be recorded. ${asCommandError(reason).message}`);
      })
      .finally(() => dispatch({ type: "verification-recorded" }));
  }, [state.pendingVerification]);

  const loadAgain = useCallback((din: string, copyCount: number) => {
    dispatch({ type: "load", din, copyCount });
  }, []);

  return { state, dispatch, print: startPrint, loadAgain };
}
