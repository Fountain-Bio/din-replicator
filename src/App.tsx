/**
 * The whole app: one window, three screens, and the state they share.
 *
 * This component is the shell. It holds which screen is showing, wires the
 * hooks that own the printers, the settings, and the print run to the screens
 * that need them, and turns key presses into actions.
 *
 * The scan state lives here rather than inside the scan screen so a scan taken
 * while the history screen is showing still loads a DIN, and so the "Print
 * again" button on the history screen can hand a DIN to the scan screen.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "cn";
import { Toaster } from "@/components/ui/sonner";
import { HistoryScreen } from "@/features/history/history-screen";
import {
  selectedPrinterState,
  usePrinters,
  useSelectedPrinter,
} from "@/features/printer/use-printers";
import { ScanScreen } from "@/features/scan/scan-screen";
import { canPrint, canSetCopyCount } from "@/features/scan/scan-state";
import { usePrintRun } from "@/features/scan/use-print-run";
import { SettingsScreen } from "@/features/settings/settings-screen";
import { useSettings } from "@/features/settings/use-settings";
import { DEFAULT_LABEL_FONT } from "@/lib/label/fonts";
import { DEFAULT_LABEL_STOCK } from "@/lib/label/replica-zpl";
import { useScanListener } from "@/lib/scanner";
import { labelStock } from "@/lib/settings";
import { asCommandError, storageInfo } from "@/lib/tauri/commands";
import type { StorageInfo } from "@/lib/tauri/types";

type Screen = "scan" | "history" | "settings";

const SCREENS: Array<{ id: Screen; label: string }> = [
  { id: "scan", label: "Scan" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>("scan");
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  const { printers, loading: loadingPrinters, refresh: refreshPrinters } = usePrinters();
  const { settings, error: settingsError, save: saveSettings } = useSettings(printers);
  const { selected, refreshState } = useSelectedPrinter(
    printers,
    settings?.selectedPrinter ?? null,
  );
  const printerState = selectedPrinterState(selected);

  // Two things outside the printer stop a print run, and both are the print
  // log. Its own state says it cannot be opened, or the settings it holds
  // could not be read, which means the same file is out of reach.
  const blockedReason = storage?.unavailable ?? settingsError;

  const refreshStorage = useCallback(() => {
    storageInfo().then(
      (info) => {
        setStorage(info);
        setStorageError(null);
      },
      (reason: unknown) => {
        setStorageError(asCommandError(reason).message);
      },
    );
  }, []);

  const { state, dispatch, print, loadAgain } = usePrintRun({
    settings,
    blockedReason,
    refreshPrinterState: refreshState,
    refreshStorage,
  });

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
      refreshStorage();
    }
  }, [screen, refreshStorage]);

  // A scan is caught wherever focus happens to be, and always brings the
  // operator back to the scan screen.
  useScanListener(
    useCallback(
      (raw: string) => {
        setScreen("scan");
        dispatch({ type: "scanned", raw });
      },
      [dispatch],
    ),
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
          // Enter follows the same rule as the Print button, so the two can
          // never disagree about whether a print run may start.
          if (event.key === "Enter" && canPrint(state, printerState, blockedReason)) {
            event.preventDefault();
            print();
            return;
          }
          // A digit sets the copy count outright. Two-digit counts are set with
          // the stepper or by typing in the copy count box. The copy count only
          // moves while the screen is idle, which is the rule the copy count
          // control follows too.
          if (/^[1-9]$/.test(event.key) && canSetCopyCount(state)) {
            dispatch({ type: "set-copy-count", copyCount: Number(event.key) });
          }
        },
        [blockedReason, dispatch, print, printerState, screen, state],
      ),
    },
  );

  const printAgain = useCallback(
    (din: string, copyCount: number) => {
      loadAgain(din, copyCount);
      setScreen("scan");
    },
    [loadAgain],
  );

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
              printer={selected}
              labelFont={settings?.labelFont ?? DEFAULT_LABEL_FONT}
              stock={settings === null ? DEFAULT_LABEL_STOCK : labelStock(settings)}
              blockedReason={blockedReason}
              onPrint={print}
              onGoToSettings={() => setScreen("settings")}
            />
          )}
          {screen === "history" && <HistoryScreen onPrintAgain={printAgain} />}
          {screen === "settings" && (
            <SettingsScreen
              settings={settings}
              settingsError={settingsError}
              printers={printers}
              loadingPrinters={loadingPrinters}
              storage={storage}
              storageError={storageError}
              onChange={saveSettings}
              onRefreshPrinters={refreshPrinters}
            />
          )}
        </div>
      </main>

      <Toaster position="bottom-right" richColors />
    </div>
  );
}
