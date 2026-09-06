/**
 * The whole app: one window, three screens, and the state they share.
 *
 * This component owns what more than one screen needs. The scan state lives
 * here rather than inside the scan screen so a scan taken while the history
 * screen is showing still loads a DIN, and so the "Print again" button on the
 * history screen can hand a DIN to the scan screen.
 *
 * The calls that reach the printer and the print log also live here, because
 * one print run touches three commands in order and the reducer has to stay
 * pure.
 */

import { useCallback, useEffect, useReducer, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { printerStateText } from "@/components/printer-state-badge";
import { HistoryScreen } from "@/features/history/history-screen";
import { ScanScreen } from "@/features/scan/scan-screen";
import { initialScanState, scanReducer } from "@/features/scan/scan-state";
import { SettingsScreen } from "@/features/settings/settings-screen";
import { barcodePayload } from "@/lib/isbt128";
import { buildReplicaZpl } from "@/lib/label/replica-zpl";
import { useScanListener } from "@/lib/scanner";
import {
  asCommandError,
  getSettings,
  listPrinters,
  printerState as readPrinterState,
  printZpl,
  recordPrintRun,
  recordVerification,
  setSettings as saveSettings,
} from "@/lib/tauri/commands";
import type { PrinterInfo, PrinterState, Settings } from "@/lib/tauri/types";

/** The copy count ceiling used until the saved settings arrive. */
const FALLBACK_MAX_COPIES = 20;

/** How often the scan screen re-reads the printer's state, in milliseconds. */
const PRINTER_POLL_MS = 15_000;

type Screen = "scan" | "history" | "settings";

const SCREENS: Array<{ id: Screen; label: string }> = [
  { id: "scan", label: "Scan" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>("scan");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(true);
  const [selectedPrinterState, setSelectedPrinterState] = useState<PrinterState | null>(null);
  const [state, dispatch] = useReducer(scanReducer, initialScanState(FALLBACK_MAX_COPIES));

  const selectedPrinterName = settings?.selectedPrinter ?? null;
  const selectedPrinter = printers.find((printer) => printer.name === selectedPrinterName) ?? null;
  // A printer that is no longer chosen has no state worth showing, and the
  // poll below leaves its last answer behind when it stops.
  const shownPrinterState = selectedPrinterName === null ? null : selectedPrinterState;

  /** Saves settings and keeps the copy this component holds in step. */
  const applySettings = useCallback(async (next: Settings) => {
    setSettings(next);
    try {
      setSettings(await saveSettings(next));
    } catch (reason) {
      toast.error(`The setting could not be saved. ${asCommandError(reason).message}`);
    }
  }, []);

  const loadPrinters = useCallback(() => {
    return listPrinters()
      .then(setPrinters, (reason: unknown) => {
        toast.error(`The printer list could not be read. ${asCommandError(reason).message}`);
      })
      .finally(() => setLoadingPrinters(false));
  }, []);

  // Read the saved settings and the printer list once, when the window opens.
  useEffect(() => {
    getSettings().then(setSettings, (reason: unknown) => {
      toast.error(`The saved settings could not be read. ${asCommandError(reason).message}`);
      setSettings({
        selectedPrinter: null,
        verifyAfterPrint: true,
        maxCopies: FALLBACK_MAX_COPIES,
      });
    });
    void loadPrinters();
  }, [loadPrinters]);

  // The copy count ceiling belongs to settings, so the reducer is told about it
  // whenever it changes.
  useEffect(() => {
    if (settings !== null) {
      dispatch({ type: "set-max-copies", maxCopies: settings.maxCopies });
    }
  }, [settings]);

  // A machine with exactly one Zebra needs no choosing. Pick it the first time
  // the app sees it, and leave every other case to the settings screen.
  useEffect(() => {
    if (settings === null || settings.selectedPrinter !== null) {
      return;
    }
    const zebras = printers.filter((printer) => printer.isZebra);
    if (zebras.length !== 1) {
      return;
    }

    let cancelled = false;
    saveSettings({ ...settings, selectedPrinter: zebras[0]!.name }).then(
      (saved) => {
        if (!cancelled) {
          setSettings(saved);
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

  // Read the chosen printer's state now and then, so the scan screen says
  // whether a print run would go through before the operator presses Print.
  useEffect(() => {
    const name = selectedPrinterName;
    if (name === null) {
      return;
    }

    let cancelled = false;
    // An arrow function assigned to a const, so the narrowing of `name` above
    // still holds inside it.
    const poll = () => {
      readPrinterState(name).then(
        (live) => {
          if (!cancelled) {
            setSelectedPrinterState(live);
          }
        },
        () => {
          if (!cancelled) {
            setSelectedPrinterState({ kind: "unknown" });
          }
        },
      );
    };

    poll();
    const timer = setInterval(poll, PRINTER_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedPrinterName]);

  /**
   * One print run: check the queue, send the ZPL, write the print run down.
   *
   * The queue is read again here even though the scan screen polls it, because
   * the polled answer can be up to fifteen seconds old and ADR 0003 wants a
   * fresh answer before every print run.
   */
  const print = useCallback(async () => {
    const din = state.din;
    if (din === null || settings === null) {
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
    const copies = state.copies;
    dispatch({ type: "print-started" });

    try {
      const live = await readPrinterState(printerName);
      setSelectedPrinterState(live);
      if (live.kind !== "ready") {
        dispatch({ type: "print-failed", message: printerStateText(live) });
        return;
      }

      const payload = barcodePayload(din);
      const zpl = buildReplicaZpl({ din, copies });
      const receipt = await printZpl(printerName, zpl, `DIN ${din} x${copies}`);
      const run = await recordPrintRun({
        din,
        payload,
        copies,
        printerName,
        jobId: receipt.jobId,
        zpl,
      });
      dispatch({
        type: "print-succeeded",
        printRunId: run.id,
        copies,
        verifyAfterPrint: settings.verifyAfterPrint,
      });
    } catch (reason) {
      dispatch({ type: "print-failed", message: asCommandError(reason).message });
    }
  }, [settings, state.copies, state.din]);

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

  // A scan is caught wherever focus happens to be, and always brings the
  // operator back to the scan screen.
  useScanListener(
    useCallback((raw: string) => {
      setScreen("scan");
      dispatch({ type: "scanned", raw });
    }, []),
    {
      onLooseKey: useCallback(
        (event: KeyboardEvent) => {
          if (screen !== "scan") {
            return;
          }
          if (event.key === "Escape") {
            dispatch(
              state.phase.kind === "verifying" ? { type: "skip-verification" } : { type: "clear" },
            );
            return;
          }
          if (event.key === "Enter" && state.din !== null && state.phase.kind === "idle") {
            event.preventDefault();
            void print();
            return;
          }
          // A digit sets the copy count outright. Two-digit counts are set with
          // the stepper or by typing in the copy count box.
          if (/^[1-9]$/.test(event.key) && state.din !== null) {
            dispatch({ type: "set-copies", copies: Number(event.key) });
          }
        },
        [screen, state.din, state.phase.kind, print],
      ),
    },
  );

  const printAgain = useCallback((din: string, copies: number) => {
    dispatch({ type: "load", din, copies });
    setScreen("scan");
  }, []);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 p-6">
      <header className="flex items-center gap-6 border-b pb-3">
        <h1 className="text-lg font-semibold">DIN Replicator</h1>
        <nav className="flex gap-1">
          {SCREENS.map((entry) => (
            <Button
              key={entry.id}
              variant={screen === entry.id ? "secondary" : "ghost"}
              size="lg"
              aria-current={screen === entry.id ? "page" : undefined}
              onClick={() => setScreen(entry.id)}
            >
              {entry.label}
            </Button>
          ))}
        </nav>
      </header>

      <main className="flex-1">
        {screen === "scan" && (
          <ScanScreen
            state={state}
            dispatch={dispatch}
            printer={selectedPrinter}
            printerState={shownPrinterState}
            onPrint={() => void print()}
            onGoToSettings={() => setScreen("settings")}
          />
        )}
        {screen === "history" && <HistoryScreen onPrintAgain={printAgain} />}
        {screen === "settings" &&
          (settings === null ? (
            <p className="text-base text-muted-foreground">Reading the saved settings</p>
          ) : (
            <SettingsScreen
              settings={settings}
              printers={printers}
              loadingPrinters={loadingPrinters}
              onChange={(next) => void applySettings(next)}
              onRefreshPrinters={() => {
                setLoadingPrinters(true);
                void loadPrinters();
              }}
            />
          ))}
      </main>

      <Toaster position="bottom-right" richColors />
    </div>
  );
}
