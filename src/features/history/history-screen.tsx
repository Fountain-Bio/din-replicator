/**
 * Every print run this machine has recorded, newest first.
 *
 * The print log is one SQLite file per machine (ADR 0004), so this list covers
 * every login on the computer rather than only the one in front of you.
 *
 * The print log holds the rows, answers the DIN search, and hands back one
 * page at a time, because a DIN printed last month is still in the file and
 * would never be in a window the screen has loaded. TanStack Table draws the
 * page it is given and puts those rows in the order the operator asked for.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClipboardCopyIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RotateCcwIcon,
  SearchIcon,
  ListIcon,
} from "lucide-react";
import { useTable } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { eyeReadable } from "@/lib/isbt128";
import { asCommandError, listPrintRuns } from "@/lib/tauri/commands";
import type { PrintRun } from "@/lib/tauri/types";
import {
  columnLayout,
  historyColumns,
  historyTableFeatures,
  PRINTED_AT_COLUMN_ID,
} from "./history-columns";
import { PrintRunDetails } from "./print-run-details";

/** How many print runs one page shows. */
const PAGE_SIZE = 10;

/** A stable empty list, so the table's models are not rebuilt on every render. */
const NO_RUNS: PrintRun[] = [];

export interface HistoryScreenProps {
  /** Loads a print run's DIN and copy count onto the scan screen. */
  onPrintAgain: (din: string, copyCount: number) => void;
}

export function HistoryScreen({ onPrintAgain }: HistoryScreenProps) {
  const [search, setSearch] = useState("");
  // Which page of the print log is on screen. A new search starts again at the
  // first page, because the page after it holds different print runs now.
  const [pageIndex, setPageIndex] = useState(0);
  // Null until the print log has answered once. The rows already on screen
  // stay put while a narrower search is loading, so the table does not blink.
  const [page, setPage] = useState<PrintRun[] | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detailsRun, setDetailsRun] = useState<PrintRun | null>(null);

  useEffect(() => {
    let cancelled = false;

    const din = search.trim().toUpperCase();
    // One row past the page is what says whether a next page exists. The extra
    // row is never drawn.
    listPrintRuns({
      din: din.length === 0 ? undefined : din,
      limit: PAGE_SIZE + 1,
      offset: pageIndex * PAGE_SIZE,
    }).then(
      (loaded) => {
        if (!cancelled) {
          setPage(loaded.slice(0, PAGE_SIZE));
          setHasNextPage(loaded.length > PAGE_SIZE);
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
  }, [search, pageIndex]);

  const printAgain = useCallback(
    (run: PrintRun) => {
      onPrintAgain(run.din, run.copyCount);
    },
    [onPrintAgain],
  );

  const columns = useMemo(() => historyColumns({ onPrintAgain: printAgain }), [printAgain]);

  const table = useTable({
    features: historyTableFeatures,
    columns,
    data: page ?? NO_RUNS,
    initialState: { sorting: [{ id: PRINTED_AT_COLUMN_ID, desc: true }] },
  });

  const rows = table.getRowModel().rows;
  const firstShown = pageIndex * PAGE_SIZE + 1;
  const lastShown = pageIndex * PAGE_SIZE + rows.length;
  const loading = page === null && error === null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="history-search" className="text-sm font-normal text-muted-foreground">
            Find a DIN
          </Label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="history-search"
              value={search}
              placeholder="Start of a DIN"
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-64 pl-9 font-mono text-sm"
              onChange={(event) => {
                setSearch(event.currentTarget.value);
                setPageIndex(0);
              }}
            />
          </div>
        </div>
        <p className="pb-2.5 text-sm text-muted-foreground tabular-nums">
          {loading ? "Reading the print log" : `Page ${pageIndex + 1}`}
        </p>
      </div>

      {error !== null && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          The print log could not be read. {error}
        </p>
      )}

      {/* The plain table element rather than the shadcn Table wrapper, because
          that wrapper adds its own horizontal scroll box, and a sticky heading
          row cannot stick inside one. A fixed layout with the `COLUMN_LAYOUT`
          widths means the row never needs to scroll sideways in the first place. */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            {table.getAllColumns().map((column) => (
              <col key={column.id} style={{ width: columnLayout(column.id).width }} />
            ))}
          </colgroup>
          <TableHeader className="sticky top-0 z-10 bg-surface">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={`px-4 text-muted-foreground ${columnLayout(header.column.id).align ?? ""}`}
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 5 }, (_, index) => (
                <TableRow key={`loading-${index}`} className="hover:bg-transparent">
                  {table.getAllColumns().map((column) => (
                    <TableCell key={column.id} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

            {rows.map((row) => (
              <ContextMenu key={row.id}>
                <ContextMenuTrigger asChild>
                  <TableRow
                    tabIndex={0}
                    aria-label={`Print run of ${eyeReadable(row.original.din).text}`}
                    className="cursor-default outline-none focus-visible:bg-muted/60"
                    onClick={() => setDetailsRun(row.original)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setDetailsRun(row.original);
                      }
                    }}
                  >
                    {row.getAllCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={`px-4 py-2 ${columnLayout(cell.column.id).align ?? ""}`}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem onSelect={() => printAgain(row.original)}>
                    <RotateCcwIcon />
                    Print again
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => {
                      navigator.clipboard.writeText(row.original.din).then(
                        () => toast.success(`Copied ${eyeReadable(row.original.din).text}`),
                        () => toast.error("The DIN could not be copied."),
                      );
                    }}
                  >
                    <ClipboardCopyIcon />
                    Copy DIN
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => setDetailsRun(row.original)}>
                    <ListIcon />
                    Show details
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </TableBody>
        </table>

        {!loading && rows.length === 0 && error === null && (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">
            {search.trim().length === 0
              ? "Nothing has been printed on this machine yet."
              : "No print run has a DIN that starts with that."}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground tabular-nums">
          {rows.length === 0 ? "No print runs" : `Showing ${firstShown} to ${lastShown}`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Previous page"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((index) => Math.max(index - 1, 0))}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Next page"
            disabled={!hasNextPage}
            onClick={() => setPageIndex((index) => index + 1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      <PrintRunDetails
        run={detailsRun}
        onOpenChange={(open) => {
          if (!open) {
            setDetailsRun(null);
          }
        }}
        onPrintAgain={(run) => {
          setDetailsRun(null);
          printAgain(run);
        }}
      />
    </div>
  );
}
