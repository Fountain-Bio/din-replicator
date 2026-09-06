/**
 * Everything the print log holds about one print run.
 *
 * The table row carries only what an operator scans for. The rest of the
 * record, which is what someone answering a question about a label needs,
 * lives here: the exact barcode payload, the printer, who ran it, on which
 * computer, and what the verification scan read.
 */

import { RotateCcwIcon } from "lucide-react";
import { CheckCharacterBox } from "@/components/din";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { eyeReadable } from "@/lib/isbt128";
import type { PrintRun } from "@/lib/tauri/types";

export interface PrintRunDetailsProps {
  /** The print run to describe, or null when the panel is closed. */
  run: PrintRun | null;
  onOpenChange: (open: boolean) => void;
  onPrintAgain: (run: PrintRun) => void;
}

/** The full date and time, for the one place that has room for it. */
function fullTime(rfc3339: string): string {
  const at = new Date(rfc3339);
  return Number.isNaN(at.getTime())
    ? rfc3339
    : at.toLocaleString(undefined, { dateStyle: "full", timeStyle: "medium" });
}

export function PrintRunDetails({ run, onOpenChange, onPrintAgain }: PrintRunDetailsProps) {
  return (
    <Sheet open={run !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md">
        {run !== null && <Body run={run} onPrintAgain={onPrintAgain} />}
      </SheetContent>
    </Sheet>
  );
}

function Body({ run, onPrintAgain }: { run: PrintRun; onPrintAgain: (run: PrintRun) => void }) {
  const eye = eyeReadable(run.din);

  return (
    <>
      <SheetHeader className="gap-2 p-6 pb-4">
        <SheetTitle className="font-mono text-2xl tracking-tight tabular-nums">
          {eye.text}
        </SheetTitle>
        <SheetDescription className="flex items-center gap-2">
          Flag characters <span className="font-mono text-foreground">{eye.flags}</span>
          <span className="text-border">/</span>
          check character
          <CheckCharacterBox check={eye.check} className="size-5 text-xs" />
        </SheetDescription>
      </SheetHeader>

      <Separator />

      <dl className="flex flex-col gap-4 overflow-y-auto px-6 py-5">
        <Field label="Barcode payload">
          <span className="font-mono break-all">{run.payload}</span>
        </Field>
        <Field label="Copy count">
          <span className="tabular-nums">
            {run.copyCount} {run.copyCount === 1 ? "replica" : "replicas"}
          </span>
        </Field>
        <Field label="Printed at">{fullTime(run.printedAt)}</Field>
        <Field label="Printer">
          <span className="break-all">{run.printerName}</span>
        </Field>
        <Field label="Operator">{run.operatorUser}</Field>
        <Field label="Computer">{run.hostname}</Field>
        <Field label="Verification">
          {run.verification === null ? (
            <span className="text-muted-foreground">Not verified</span>
          ) : (
            <div className="flex flex-col gap-1">
              <span className={run.verification.matched ? "text-ok" : "text-destructive"}>
                {run.verification.matched ? "Passed" : "Failed"}
              </span>
              <span className="font-mono text-xs break-all text-muted-foreground">
                {run.verification.scannedPayload}
              </span>
              <span className="text-xs text-muted-foreground">
                {fullTime(run.verification.verifiedAt)}
              </span>
            </div>
          )}
        </Field>
      </dl>

      <SheetFooter className="p-6 pt-4">
        <Button size="lg" className="h-10" onClick={() => onPrintAgain(run)}>
          <RotateCcwIcon />
          Print again
        </Button>
      </SheetFooter>
    </>
  );
}

/** One labelled fact about the print run. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}
