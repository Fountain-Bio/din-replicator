/**
 * The screen an operator works on: scan a source label, check the replica,
 * print it.
 *
 * Every decision this screen makes lives in `scan-state.ts`. What is left here
 * is what the operator sees and the two controls that need their own state,
 * the manual entry box and the copy count.
 *
 * The screen is one column of four parts, top to bottom: which printer the
 * replicas go to, anything the app has to say, the work itself, and the box
 * for typing a DIN when a scanner cannot read one. Every message lands in the
 * same place, so an operator learns one spot to look at.
 */

import { useState } from "react";
import { cn } from "cn";
import { AlertTriangleIcon, CheckIcon, PrinterIcon, ScanBarcodeIcon } from "lucide-react";
import { DinParts } from "@/components/din";
import { PrinterStatus } from "@/components/printer-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { barcodePayload, eyeReadable } from "@/lib/isbt128";
import { scanOptOutProps } from "@/lib/scanner";
import type { PrinterInfo, PrinterState } from "@/lib/tauri/types";
import { CopyCount } from "./copy-count";
import { LabelPreview } from "./label-preview";
import type { Notice, ScanAction, ScanState } from "./scan-state";

export interface ScanScreenProps {
  state: ScanState;
  dispatch: (action: ScanAction) => void;
  /** The name settings hold, whether or not that printer is installed. */
  selectedPrinterName: string | null;
  /** The chosen printer, or null when settings name none or name a missing one. */
  printer: PrinterInfo | null;
  /** The printer's state, read fresh, or null while it loads. */
  printerState: PrinterState | null;
  /**
   * Why printing is off for a reason that has nothing to do with the printer,
   * or null when nothing blocks it. The print log being unreachable is the one
   * case: a print run that cannot be recorded must not happen.
   */
  blockedReason: string | null;
  onPrint: () => void;
  onGoToSettings: () => void;
}

export function ScanScreen({
  state,
  dispatch,
  selectedPrinterName,
  printer,
  printerState,
  blockedReason,
  onPrint,
  onGoToSettings,
}: ScanScreenProps) {
  const [typedDin, setTypedDin] = useState("");

  const eye = state.din === null ? null : eyeReadable(state.din);
  const printerReady = printerState !== null && printerState.kind === "ready";
  // The screen only takes a print run, a copy count, or a clear while it is
  // idle. The keyboard shortcuts in App follow the same rule.
  const idle = state.phase.kind === "idle";
  const printing = state.phase.kind === "printing";
  const verifying = state.phase.kind === "verifying";
  const canPrint = idle && printerReady && blockedReason === null;

  function submitTypedDin() {
    if (typedDin.trim().length === 0) {
      return;
    }
    dispatch({ type: "scanned", raw: typedDin });
    setTypedDin("");
  }

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-5 @4xl:gap-7">
      <div className="flex flex-col gap-3">
        <PrinterLine
          selectedName={selectedPrinterName}
          printer={printer}
          state={printerState}
          onGoToSettings={onGoToSettings}
        />

        {blockedReason !== null && (
          <Banner tone="error">
            Printing is off because the print log cannot be opened: {blockedReason}
          </Banner>
        )}

        {/* While the app waits for a verification scan, the step it is waiting
            on replaces the message about the print run that just finished.
            Both talk about the same print run, and the step is the one that
            asks the operator for something. */}
        {verifying ? (
          <VerificationStep
            notice={state.notice}
            onSkip={() => dispatch({ type: "skip-verification" })}
          />
        ) : (
          state.notice !== null && <Banner tone={state.notice.tone}>{state.notice.text}</Banner>
        )}
      </div>

      {/* The prompt sits in the middle of whatever height is left, because
          there is nothing else on the screen to look at. A loaded DIN starts
          at the top instead, so the work stays close to the printer line and
          the messages above it however tall the window is. The scroll box is
          the safety valve for a short window with a message on screen; at the
          sizes this app runs at there is nothing to scroll. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col">
          {state.din === null || eye === null ? (
            <ReadyPrompt />
          ) : (
            // Three blocks that rearrange with the window. Stacked in one
            // column when there is no room for anything else. On a medium
            // window the DIN keeps the full width and the preview moves up
            // beside the controls. On a wide window the preview takes a column
            // of its own beside both.
            <div className="mb-auto grid gap-5 @lg:grid-cols-[minmax(0,1fr)_15rem] @lg:gap-x-8 @4xl:grid-cols-[minmax(0,1fr)_19rem] @4xl:items-start @4xl:gap-x-12 @4xl:gap-y-8">
              <div className="@lg:col-span-2 @4xl:col-span-1 @4xl:col-start-1 @4xl:row-start-1">
                <p className="text-sm text-muted-foreground">Donation identification number</p>
                {/* The three groups are separate spans rather than one string
                    with spaces in it, because a monospace space is as wide as
                    a digit and would pull the number apart. */}
                <p
                  className={cn(
                    "mt-1 flex items-baseline gap-3 font-mono text-4xl leading-none font-semibold tracking-tight tabular-nums transition-opacity duration-200 @4xl:gap-4 @4xl:text-5xl",
                    printing && "opacity-60",
                  )}
                >
                  <span>{eye.fin}</span>
                  <span>{eye.year}</span>
                  <span>{eye.sequence}</span>
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-2">
                  <DinParts din={state.din} />
                  <span className="font-mono text-xs text-muted-foreground">
                    {barcodePayload(state.din)}
                  </span>
                </div>
              </div>

              <div className="@lg:col-start-2 @lg:row-start-2 @4xl:row-span-2 @4xl:row-start-1">
                <LabelPreview din={state.din} />
              </div>

              <div className="flex flex-col gap-5 @lg:col-start-1 @lg:row-start-2 @4xl:row-start-2">
                <CopyCount
                  value={state.copies}
                  max={state.maxCopies}
                  disabled={!idle}
                  onChange={(copies) => dispatch({ type: "set-copies", copies })}
                />

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    size="lg"
                    className="h-12 min-w-44 px-8 text-base active:scale-[0.985]"
                    disabled={!canPrint}
                    onClick={onPrint}
                  >
                    <PrinterIcon className="size-5" />
                    {printing ? "Printing" : "Print"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="lg"
                    className="h-12 px-5 text-sm text-muted-foreground hover:text-foreground"
                    disabled={printing}
                    onClick={() => dispatch({ type: "clear" })}
                  >
                    Clear
                  </Button>
                  {idle && !printerReady && blockedReason === null && (
                    <span className="text-sm text-muted-foreground">
                      Printing waits for the printer.
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Label htmlFor="manual-din" className="text-sm font-normal text-muted-foreground">
          Or type a DIN
        </Label>
        <Input
          id="manual-din"
          {...scanOptOutProps}
          value={typedDin}
          placeholder="W483626000011"
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-52 font-mono text-sm tracking-wide"
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
        <Button variant="outline" size="lg" className="h-9" onClick={submitTypedDin}>
          Load
        </Button>
      </div>
    </div>
  );
}

/** What the screen shows while it waits for a scan. */
function ReadyPrompt() {
  return (
    <div className="m-auto flex flex-col items-center gap-4 text-center">
      <ScanBarcodeIcon className="size-11 text-muted-foreground/40" strokeWidth={1.25} />
      <p className="text-3xl font-medium tracking-tight @4xl:text-4xl">Scan a DIN</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Hold the scanner over the barcode on the source label. There is no box to click into first.
      </p>
    </div>
  );
}

/** The one shape every message on this screen takes. */
function Banner({ tone, children }: { tone: Notice["tone"]; children: React.ReactNode }) {
  const Icon = tone === "error" ? AlertTriangleIcon : tone === "success" ? CheckIcon : null;
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm",
        tone === "error" && "border-destructive/30 bg-destructive/8 text-destructive",
        tone === "success" && "border-ok/30 bg-ok-surface text-ok",
        tone === "info" && "border-border bg-muted text-foreground",
      )}
    >
      {Icon !== null && <Icon className="mt-px size-4 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

/**
 * The step between printing and being done: scan one of the replicas that just
 * came out so the app can compare it with what it printed.
 *
 * This is a strip inside the same message rail, not a screen of its own,
 * because the DIN and the copy count that were just printed are still on the
 * screen behind it and the operator is still in the same piece of work.
 */
function VerificationStep({ notice, onSkip }: { notice: Notice | null; onSkip: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-primary/40 bg-muted px-4 py-3">
      <ScanBarcodeIcon className="size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Scan one of the new labels to verify.</p>
        {notice !== null && <p className="text-sm text-muted-foreground">{notice.text}</p>}
      </div>
      <Button variant="outline" size="lg" className="h-9" onClick={onSkip}>
        Skip
      </Button>
    </div>
  );
}

/**
 * The printer replicas go to, with what it reports about itself.
 *
 * Two things can be wrong before a printer's state matters. Nobody has chosen
 * a printer, which a new machine starts out as. Or settings hold a name that
 * the operating system no longer lists, which is what a renamed or unplugged
 * printer looks like. The two need different wording, because only the second
 * one means something changed.
 */
function PrinterLine({
  selectedName,
  printer,
  state,
  onGoToSettings,
}: {
  selectedName: string | null;
  printer: PrinterInfo | null;
  state: PrinterState | null;
  onGoToSettings: () => void;
}) {
  if (printer === null) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3">
        <AlertTriangleIcon className="size-4 shrink-0 text-destructive" />
        <p className="min-w-0 flex-1 text-sm text-destructive">
          {selectedName === null
            ? "No printer is chosen yet."
            : `The saved printer ${selectedName} is not connected to this computer.`}
        </p>
        <Button variant="outline" size="lg" className="h-9" onClick={onGoToSettings}>
          {selectedName === null ? "Choose a printer" : "Choose another printer"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <PrinterIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="max-w-[28rem] truncate text-sm font-medium" title={printer.name}>
        {printer.name}
      </span>
      <span aria-hidden className="text-border">
        ·
      </span>
      <PrinterStatus state={state} />
    </div>
  );
}
