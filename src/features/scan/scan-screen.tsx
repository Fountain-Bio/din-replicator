/**
 * The screen an operator works on: scan a source label, check the replica,
 * print it.
 *
 * Every decision this screen makes lives in `scan-state.ts`. What is left here
 * is what the operator sees and the two controls that need their own state,
 * the manual entry box and the copy count.
 */

import { useState } from "react";
import { PrinterIcon, ScanBarcodeIcon } from "lucide-react";
import { PrinterStateBadge } from "@/components/printer-state-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { barcodePayload, eyeReadable } from "@/lib/isbt128";
import { scanOptOutProps } from "@/lib/scanner";
import type { PrinterInfo, PrinterState } from "@/lib/tauri/types";
import { CopyCount } from "./copy-count";
import { LabelPreview } from "./label-preview";
import type { ScanAction, ScanState } from "./scan-state";

export interface ScanScreenProps {
  state: ScanState;
  dispatch: (action: ScanAction) => void;
  /** The printer replicas go to, or null when settings name none. */
  printer: PrinterInfo | null;
  /** The printer's state, read fresh from the queue, or null while it loads. */
  printerState: PrinterState | null;
  onPrint: () => void;
  onGoToSettings: () => void;
}

/** The colours the three kinds of notice are shown in. */
const NOTICE_CLASS = {
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  success: "border-emerald-600/40 bg-emerald-50 text-emerald-800",
  info: "border-border bg-muted text-foreground",
} as const;

export function ScanScreen({
  state,
  dispatch,
  printer,
  printerState,
  onPrint,
  onGoToSettings,
}: ScanScreenProps) {
  const [typedDin, setTypedDin] = useState("");

  const eye = state.din === null ? null : eyeReadable(state.din);
  const printerReady = printerState !== null && printerState.kind === "ready";
  const printing = state.phase.kind === "printing";
  const verifying = state.phase.kind === "verifying";

  function submitTypedDin() {
    if (typedDin.trim().length === 0) {
      return;
    }
    dispatch({ type: "scanned", raw: typedDin });
    setTypedDin("");
  }

  return (
    <div className="flex flex-col gap-6">
      <PrinterLine printer={printer} state={printerState} onGoToSettings={onGoToSettings} />

      {state.notice !== null && (
        <p
          role="status"
          className={`rounded-md border px-4 py-3 text-base ${NOTICE_CLASS[state.notice.tone]}`}
        >
          {state.notice.text}
        </p>
      )}

      {verifying && (
        <Card className="border-primary">
          <CardContent className="flex items-center gap-3 py-4">
            <ScanBarcodeIcon className="size-6 shrink-0" />
            <p className="text-lg font-medium">
              Scan one of the new labels to verify, or press Escape to skip.
            </p>
            <Button
              variant="outline"
              className="ml-auto"
              onClick={() => dispatch({ type: "skip-verification" })}
            >
              Skip
            </Button>
          </CardContent>
        </Card>
      )}

      {state.din === null || eye === null ? (
        <ReadyPrompt />
      ) : (
        <div className="flex flex-wrap items-start gap-10">
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Donation identification number</p>
              <p className="font-mono text-5xl leading-tight font-bold tracking-tight tabular-nums">
                {eye.text}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Flag characters {eye.flags}, check character {eye.check}
              </p>
              <p className="mt-3 font-mono text-sm text-muted-foreground">
                Barcode payload {barcodePayload(state.din)}
              </p>
            </div>

            <CopyCount
              value={state.copies}
              max={state.maxCopies}
              disabled={printing}
              onChange={(copies) => dispatch({ type: "set-copies", copies })}
            />

            <div className="flex items-center gap-3">
              <Button
                size="lg"
                className="h-14 px-8 text-lg"
                disabled={printing || !printerReady}
                onClick={onPrint}
              >
                <PrinterIcon className="size-5" />
                {printing ? "Printing" : "Print"}
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="h-14 px-6 text-base"
                disabled={printing}
                onClick={() => dispatch({ type: "clear" })}
              >
                Clear
              </Button>
            </div>
            {!printerReady && (
              <p className="text-sm text-muted-foreground">
                Printing is off until the printer is ready.
              </p>
            )}
          </div>

          <LabelPreview din={state.din} />
        </div>
      )}

      <div className="max-w-md border-t pt-5">
        <Label htmlFor="manual-din" className="text-base">
          Or type a DIN
        </Label>
        <div className="mt-2 flex gap-2">
          <Input
            id="manual-din"
            {...scanOptOutProps}
            value={typedDin}
            placeholder="W483626000011"
            autoComplete="off"
            spellCheck={false}
            className="h-10 font-mono text-base"
            onChange={(event) => setTypedDin(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitTypedDin();
              }
              if (event.key === "Escape") {
                setTypedDin("");
              }
            }}
          />
          <Button variant="outline" className="h-10" onClick={submitTypedDin}>
            Load
          </Button>
        </div>
      </div>
    </div>
  );
}

/** What the screen shows while it waits for a scan. */
function ReadyPrompt() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed py-16">
      <ScanBarcodeIcon className="size-12 text-muted-foreground" />
      <p className="text-4xl font-semibold">Scan a DIN</p>
      <p className="text-base text-muted-foreground">
        You can scan at any time. There is no need to click into a box first.
      </p>
    </div>
  );
}

/** The printer replicas go to, with what the print queue says about it. */
function PrinterLine({
  printer,
  state,
  onGoToSettings,
}: {
  printer: PrinterInfo | null;
  state: PrinterState | null;
  onGoToSettings: () => void;
}) {
  if (printer === null) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
        <p className="text-base text-destructive">No printer is chosen yet.</p>
        <Button variant="outline" size="sm" onClick={onGoToSettings}>
          Choose a printer
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <PrinterIcon className="size-4 text-muted-foreground" />
      <span className="text-base font-medium">{printer.name}</span>
      {state === null ? (
        <span className="text-sm text-muted-foreground">Reading the print queue</span>
      ) : (
        <PrinterStateBadge state={state} />
      )}
    </div>
  );
}
