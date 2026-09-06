/**
 * The screen an operator works on: scan a source label, check the replica,
 * print it.
 *
 * Every decision this screen makes lives in `scan-state.ts`. What is left here
 * is what the operator sees and the two controls that need their own state,
 * the manual entry box and the copy count.
 *
 * The screen has two shapes. With nothing loaded it is a prompt with the box
 * for typing a DIN under it, centred, because that is the whole screen. With a
 * DIN loaded the prompt and the box are gone and the DIN, the copy count, the
 * Print button, and the preview take their place. Anything the app has to say
 * lands in the rail above both, so an operator learns one spot to look at.
 *
 * Which printer the replicas go to lives in the window's sidebar, where it is
 * visible from every screen. What reaches this screen is only a printer
 * problem that stops the next print run.
 */

import { useState } from "react";
import { cn } from "cn";
import { AlertTriangleIcon, CheckIcon, PrinterIcon, ScanBarcodeIcon } from "lucide-react";
import { DinParts } from "@/components/din";
import { printerStateText } from "@/components/printer-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SelectedPrinter } from "@/features/printer/use-printers";
import { barcodePayload, eyeReadable } from "@/lib/isbt128";
import type { LabelFont } from "@/lib/label/fonts";
import type { LabelStock } from "@/lib/label/replica-zpl";
import { printLogUnavailableText } from "@/lib/print-log";
import { CopyCount } from "./copy-count";
import { LabelPreview } from "./label-preview";
import {
  canPrint,
  canSetCopyCount,
  type Notice,
  type ScanAction,
  type ScanState,
} from "./scan-state";

export interface ScanScreenProps {
  state: ScanState;
  dispatch: (action: ScanAction) => void;
  /** Which printer replicas go to, or why there is none to send them to. */
  printer: SelectedPrinter;
  /** The font the replica is set in, so the preview shows what will print. */
  labelFont: LabelFont;
  /** The label stock in the printer. The preview is drawn at its shape. */
  stock: LabelStock;
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
  printer,
  labelFont,
  stock,
  blockedReason,
  onPrint,
  onGoToSettings,
}: ScanScreenProps) {
  const [typedDin, setTypedDin] = useState("");

  const eye = state.din === null ? null : eyeReadable(state.din);
  const printerState = printer.kind === "found" ? printer.state : null;
  const printing = state.phase.kind === "printing";
  const verifying = state.phase.kind === "verifying";
  // The Print button and the Enter shortcut ask the same question, and the
  // copy count control and the digit shortcuts ask the other one.
  const printable = canPrint(state, printerState, blockedReason);
  const countable = canSetCopyCount(state);

  function submitTypedDin() {
    if (typedDin.trim().length === 0) {
      return;
    }
    dispatch({ type: "scanned", raw: typedDin });
    setTypedDin("");
  }

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-5 @4xl:gap-7">
      <div className="flex flex-col gap-3 empty:hidden">
        {blockedReason !== null && (
          <Banner tone="error">{printLogUnavailableText(blockedReason)}</Banner>
        )}

        <PrinterProblem printer={printer} onGoToSettings={onGoToSettings} />

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
          at the top instead, so the work stays close to the messages above it
          however tall the window is. The scroll box is the safety valve for a
          short window with a message on screen. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col">
          {state.din === null || eye === null ? (
            <ReadyPrompt
              typedDin={typedDin}
              onTypedDinChange={setTypedDin}
              onSubmit={submitTypedDin}
            />
          ) : (
            // The DIN and the print action are two segments of one panel, so
            // the number and the button that acts on it read as one piece of
            // work. The preview sits under the panel on a narrow window and
            // beside it once there is room.
            <div className="mb-auto grid max-w-4xl gap-5 @lg:grid-cols-[minmax(0,1fr)_12rem] @lg:items-start @lg:gap-x-8 @4xl:grid-cols-[minmax(0,1fr)_19rem] @4xl:gap-x-10">
              <section className="divide-y divide-border overflow-hidden rounded-lg border bg-surface">
                <div className="flex items-start justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    {/* The three groups of the DIN are separate spans rather
                        than one string with spaces in it, because a monospace
                        space is as wide as a digit and would pull the number
                        apart. The flag characters and the boxed check character
                        sit on the same baseline, in the order the label prints
                        them. */}
                    <p
                      className={cn(
                        "flex flex-wrap items-baseline gap-x-3 gap-y-2 font-mono text-3xl leading-none font-semibold tracking-tight tabular-nums transition-opacity duration-200 @xl:text-4xl @4xl:gap-x-4 @4xl:text-5xl",
                        printing && "opacity-60",
                      )}
                    >
                      <span>{eye.fin}</span>
                      <span>{eye.year}</span>
                      <span>{eye.sequence}</span>
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <DinParts din={state.din} className="text-sm" />
                      <span className="font-mono text-xs text-muted-foreground">
                        {barcodePayload(state.din)}
                      </span>
                    </div>
                  </div>
                  {/* Clearing belongs to the DIN, not to the print action, so
                      it sits with the number it throws away. */}
                  <Button
                    variant="link"
                    size="sm"
                    className="-mr-1 shrink-0 text-sm text-muted-foreground hover:text-foreground"
                    disabled={printing}
                    onClick={() => dispatch({ type: "clear" })}
                  >
                    Clear
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-3 px-5 py-4">
                  <CopyCount
                    value={state.copyCount}
                    max={state.maxCopyCount}
                    disabled={!countable}
                    onChange={(copyCount) => dispatch({ type: "set-copy-count", copyCount })}
                  />
                  <Button
                    size="lg"
                    className="h-11 min-w-32 px-6 text-base active:scale-[0.985]"
                    disabled={!printable}
                    onClick={onPrint}
                  >
                    <PrinterIcon className="size-5" />
                    {printing ? "Printing" : "Print"}
                  </Button>
                </div>
              </section>

              <LabelPreview din={state.din} labelFont={labelFont} stock={stock} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * What the screen shows while it waits for a scan, with the box for a label
 * whose barcode a scanner will not read directly under it.
 */
function ReadyPrompt({
  typedDin,
  onTypedDinChange,
  onSubmit,
}: {
  typedDin: string;
  onTypedDinChange: (typed: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="m-auto flex w-full max-w-sm flex-col items-center gap-5 text-center">
      <ScanBarcodeIcon className="size-10 text-muted-foreground/40" strokeWidth={1.25} />
      <p className="text-3xl font-medium tracking-tight @4xl:text-4xl">Scan a DIN</p>
      <div className="flex w-full items-center gap-2">
        <Input
          id="manual-din"
          value={typedDin}
          aria-label="Type a DIN"
          placeholder="Type a DIN"
          autoComplete="off"
          spellCheck={false}
          className="h-10 flex-1 text-center font-mono text-sm tracking-wide"
          onChange={(event) => onTypedDinChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
            if (event.key === "Escape") {
              onTypedDinChange("");
            }
          }}
        />
        <Button variant="outline" size="lg" className="h-10" onClick={onSubmit}>
          Load
        </Button>
      </div>
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
 * The one thing about the printer this screen still says: what is wrong with
 * it, and where to fix it.
 *
 * Nobody has chosen a printer, which a new machine starts out as. Or settings
 * hold a name the operating system no longer lists, which is what a renamed or
 * unplugged printer looks like. Or the printer is there and cannot take a job.
 * A printer that is ready says nothing here; the sidebar already shows it.
 */
function PrinterProblem({
  printer,
  onGoToSettings,
}: {
  printer: SelectedPrinter;
  onGoToSettings: () => void;
}) {
  if (printer.kind === "found") {
    if (printer.state.kind === "ready") {
      return null;
    }
    return <Banner tone="error">{printerStateText(printer.state)}</Banner>;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3">
      <AlertTriangleIcon className="size-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1 text-sm text-destructive">
        {printer.kind === "none"
          ? "No printer is chosen."
          : `${printer.name} is not connected to this computer.`}
      </p>
      <Button variant="outline" size="lg" className="h-9" onClick={onGoToSettings}>
        {printer.kind === "none" ? "Choose a printer" : "Choose another printer"}
      </Button>
    </div>
  );
}
