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
import { cn } from "cn";
import { toast } from "sonner";
import { printerStateText } from "@/components/printer-status";
import { Toaster } from "@/components/ui/sonner";
import { HistoryScreen } from "@/features/history/history-screen";
import { ScanScreen } from "@/features/scan/scan-screen";
import { initialScanState, scanReducer } from "@/features/scan/scan-state";
import { SettingsScreen } from "@/features/settings/settings-screen";
import { barcodePayload } from "@/lib/isbt128";
import { buildReplicaZpl } from "@/lib/label/replica-zpl";
import { useScanListener } from "@/lib/scanner";
import { FALLBACK_SETTINGS } from "@/lib/settings";
import {
  asCommandError,
  getSettings,
  listPrinters,
  printerState as readPrinterState,
  printZpl,
  recordPrintRun,
  recordVerification,
  setSettings as saveSettings,
  storageInfo,
} from "@/lib/tauri/commands";
import type { PrinterInfo, PrinterState, Settings, StorageInfo } from "@/lib/tauri/types";

/** The copy count ceiling used until the saved settings arrive. */
const FALLBACK_MAX_COPIES = FALLBACK_SETTINGS.maxCopies;

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
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [state, dispatch] = useReducer(scanReducer, initialScanState(FALLBACK_MAX_COPIES));

  const selectedPrinterName = settings?.selectedPrinter ?? null;
  const selectedPrinter = printers.find((printer) => printer.name === selectedPrinterName) ?? null;
  // A printer that is no longer chosen has no state worth showing, and the
  // poll that reads it leaves its last answer behind when it stops.
  const shownPrinterState = selectedPrinterName === null ? null : selectedPrinterState;
  // The print log is the one thing outside the printer that stops a print run.
  const blockedReason = storage?.unavailable ?? null;

  /** Saves settings and keeps the copy this component holds in step. */
  const applySettings = useCallback(async (next: Settings) => {
    setSettings(next);
    try {
      setSettings(await saveSettings(next));
    } catch (reason) {
      toast.error(`The setting could not be saved. ${asCommandError(reason).message}`);
    }
  }, []);

  const loadStorage = useCallback(() => {
    return storageInfo().then(
      (info) => {
        setStorage(info);
        setStorageError(null);
      },
      (reason: unknown) => {
        setStorageError(asCommandError(reason).message);
      },
    );
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
      setSettings(FALLBACK_SETTINGS);
    });
    void loadPrinters();
  }, [loadPrinters]);

  // The window is an application window, not a web page. The webview's own
  // menu offers Reload and Inspect Element, which do nothing an operator wants
  // and can throw away a loaded DIN. Refusing the event here leaves the app's
  // own context menus working, because those call preventDefault themselves
  // before this listener ever sees the event. Development builds keep the
  // webview menu, because that is where Inspect Element is needed.
  useEffect(() => {
    if (import.meta.env.DEV) {
      return;
    }
    const refuse = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", refuse);
    return () => document.removeEventListener("contextmenu", refuse);
  }, []);

  // A print run that cannot be recorded must not happen, so the state of the
  // print log is read again every time the operator comes back to the scan
  // screen rather than only once at startup.
  useEffect(() => {
    if (screen === "scan") {
      void loadStorage();
    }
  }, [screen, loadStorage]);

  // The copy count ceiling belongs to settings, so the reducer is told about it
  // whenever it changes.
  useEffect(() => {
    if (settings !== null) {
      dispatch({ type: "set-max-copies", maxCopies: settings.maxCopies });
    }
  }, [settings]);

  // A computer with exactly one label printer needs no choosing. Pick it the
  // first time the app sees it, and leave every other case to the settings
  // screen.
  useEffect(() => {
    if (settings === null || settings.selectedPrinter !== null) {
      return;
    }
    const labelPrinters = printers.filter((printer) => printer.isZebra);
    if (labelPrinters.length !== 1) {
      return;
    }

    let cancelled = false;
    saveSettings({ ...settings, selectedPrinter: labelPrinters[0]!.name }).then(
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
   * One print run: check the printer, send the ZPL, write the print run down.
   *
   * The printer is read again here even though the scan screen polls it,
   * because the polled answer can be up to fifteen seconds old and ADR 0003
   * wants a fresh answer before every print run.
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
      dispatch({
        type: "print-failed",
        message: `Printing is disabled because the print log cannot be opened: ${blockedReason}`,
      });
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
    const payload = barcodePayload(din);
    const zpl = buildReplicaZpl({
      din,
      copies,
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
      const live = await readPrinterState(printerName);
      setSelectedPrinterState(live);
      if (live.kind !== "ready") {
        dispatch({ type: "print-failed", message: printerStateText(live) });
        return;
      }
      jobId = (await printZpl(printerName, zpl, `DIN ${din} x${copies}`)).jobId;
    } catch (reason) {
      dispatch({ type: "print-failed", message: asCommandError(reason).message });
      return;
    }

    // The replicas are printing from here on.
    try {
      const run = await recordPrintRun({
        din,
        payload,
        copyCount: copies,
        printerName,
        jobId,
        zpl,
      });
      dispatch({
        type: "print-succeeded",
        printRunId: run.id,
        copies,
        verifyAfterPrint: settings.verifyAfterPrint,
      });
    } catch (reason) {
      dispatch({ type: "print-not-recorded", reason: asCommandError(reason).message });
      // The print log just refused a write, so read its state again to find
      // out whether it is now unreachable and printing should stop.
      void loadStorage();
    }
  }, [blockedReason, loadStorage, settings, state.copies, state.din]);

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
          // the stepper or by typing in the copy count box. The copy count only
          // moves while the screen is idle, which is the rule the copy count
          // control follows too.
          if (/^[1-9]$/.test(event.key) && state.din !== null && state.phase.kind === "idle") {
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
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b bg-surface">
        <div className="mx-auto flex w-full max-w-(--shell-width) items-center gap-6 px-5 py-3 sm:px-8">
          <h1 className="text-sm font-semibold tracking-tight">DIN Replicator</h1>
          <nav aria-label="Screens" className="flex items-center gap-1 rounded-lg bg-muted p-1">
            {SCREENS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-current={screen === entry.id ? "page" : undefined}
                onClick={() => setScreen(entry.id)}
                className={cn(
                  "h-8 rounded-md px-4 text-sm font-medium transition-colors duration-150 outline-none",
                  "focus-visible:ring-3 focus-visible:ring-ring/50",
                  screen === entry.id
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {entry.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto h-full w-full max-w-(--shell-width) px-5 py-6 sm:px-8 sm:py-8">
          {screen === "scan" && (
            <ScanScreen
              state={state}
              dispatch={dispatch}
              selectedPrinterName={selectedPrinterName}
              printer={selectedPrinter}
              printerState={shownPrinterState}
              labelFont={settings?.labelFont ?? FALLBACK_SETTINGS.labelFont}
              blockedReason={blockedReason}
              onPrint={() => void print()}
              onGoToSettings={() => setScreen("settings")}
            />
          )}
          {screen === "history" && <HistoryScreen onPrintAgain={printAgain} />}
          {screen === "settings" &&
            (settings === null ? (
              <p className="text-sm text-muted-foreground">Reading the saved settings</p>
            ) : (
              <SettingsScreen
                settings={settings}
                printers={printers}
                loadingPrinters={loadingPrinters}
                storage={storage}
                storageError={storageError}
                onChange={(next) => void applySettings(next)}
                onRefreshPrinters={() => {
                  setLoadingPrinters(true);
                  void loadPrinters();
                }}
              />
            ))}
        </div>
      </main>

      <Toaster position="bottom-right" richColors />
    </div>
  );
}
