/**
 * Every print run this machine has recorded, newest first.
 *
 * The print log is one SQLite file per machine (ADR 0004), so this list covers
 * every login on the computer rather than only the one in front of you.
 */

import { useEffect, useState } from "react";
import { RotateCcwIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { eyeReadable } from "@/lib/isbt128";
import { scanOptOutProps } from "@/lib/scanner";
import { asCommandError, listPrintRuns } from "@/lib/tauri/commands";
import type { PrintRun } from "@/lib/tauri/types";

/** How many print runs one page of the table holds. */
const PAGE_SIZE = 200;

export interface HistoryScreenProps {
  /** Loads a print run's DIN and copy count onto the scan screen. */
  onPrintAgain: (din: string, copies: number) => void;
}

/** The print time in the reader's own time zone. */
function localTime(rfc3339: string): string {
  const printedAt = new Date(rfc3339);
  return Number.isNaN(printedAt.getTime())
    ? rfc3339
    : printedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function VerificationCell({ run }: { run: PrintRun }) {
  if (run.verification === null) {
    return <span className="text-muted-foreground">None</span>;
  }
  return (
    <Badge variant={run.verification.matched ? "secondary" : "destructive"}>
      {run.verification.matched ? "Passed" : "Failed"}
    </Badge>
  );
}

export function HistoryScreen({ onPrintAgain }: HistoryScreenProps) {
  const [search, setSearch] = useState("");
  // Null until the print log has answered once. The rows already on screen
  // stay put while a narrower search is loading, so the table does not blink.
  const [runs, setRuns] = useState<PrintRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const din = search.trim().toUpperCase();
    listPrintRuns({ din: din.length === 0 ? undefined : din, limit: PAGE_SIZE }).then(
      (loaded) => {
        if (!cancelled) {
          setRuns(loaded);
          setError(null);
        }
      },
      (reason: unknown) => {
        if (!cancelled) {
          setError(asCommandError(reason).message);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [search]);

  return (
    <div className="flex flex-col gap-5">
      <div className="max-w-sm">
        <Label htmlFor="history-search" className="text-base">
          Find a DIN
        </Label>
        <Input
          id="history-search"
          {...scanOptOutProps}
          value={search}
          placeholder="Start of a DIN, such as W4836"
          autoComplete="off"
          spellCheck={false}
          className="mt-2 h-10 font-mono text-base"
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </div>

      {error !== null && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-base text-destructive">
          The print log could not be read. {error}
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Printed at</TableHead>
            <TableHead>DIN</TableHead>
            <TableHead className="text-right">Copy count</TableHead>
            <TableHead>Printer</TableHead>
            <TableHead>Operator</TableHead>
            <TableHead>Verification</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(runs ?? []).map((run) => (
            <TableRow key={run.id}>
              <TableCell className="whitespace-nowrap">{localTime(run.printedAt)}</TableCell>
              <TableCell className="font-mono text-base">{eyeReadable(run.din).text}</TableCell>
              <TableCell className="text-right tabular-nums">{run.copies}</TableCell>
              <TableCell>{run.printerName}</TableCell>
              <TableCell>
                {run.operatorUser} on {run.hostname}
              </TableCell>
              <TableCell>
                <VerificationCell run={run} />
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPrintAgain(run.din, run.copies)}
                >
                  <RotateCcwIcon />
                  Print again
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {runs !== null && runs.length === 0 && error === null && (
        <p className="py-8 text-center text-base text-muted-foreground">
          {search.trim().length === 0
            ? "Nothing has been printed on this machine yet."
            : "No print run has a DIN that starts with that."}
        </p>
      )}
    </div>
  );
}
