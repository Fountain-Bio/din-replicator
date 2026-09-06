/**
 * Every print run this machine has recorded, newest first.
 *
 * The print log is one SQLite file per machine (ADR 0004), so this list covers
 * every login on the computer rather than only the one in front of you.
 *
 * The print log holds the rows and answers the DIN search, because a DIN
 * printed last month is still in the file and would never be in a window the
 * screen has loaded. TanStack Table then owns what happens to the loaded
 * window: the order, the same DIN filter applied again so the rows on screen
 * match the search box while a new query is still in flight, and the page.
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
import { useTable, type ColumnFiltersState } from "@tanstack/react-table";
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
import { scanOptOutProps } from "@/lib/scanner";
import { asCommandError, listPrintRuns } from "@/lib/tauri/commands";
import type { PrintRun } from "@/lib/tauri/types";
import {
  COLUMN_LAYOUT,
  DIN_COLUMN_ID,
  historyColumns,
  historyTableFeatures,
  PRINTED_AT_COLUMN_ID,
} from "./history-columns";
import { PrintRunDetails } from "./print-run-details";

/** How many print runs one read of the print log brings back. */
const FETCH_SIZE = 50;

/** How many print runs one page of the table holds. */
const PAGE_SIZE = 10;

/** A stable empty list, so the table's models are not rebuilt on every render. */
const NO_RUNS: PrintRun[] = [];

export interface HistoryScreenProps {
  /** Loads a print run's DIN and copy count onto the scan screen. */
  onPrintAgain: (din: string, copies: number) => void;
}

export function HistoryScreen({ onPrintAgain }: HistoryScreenProps) {
  const [search, setSearch] = useState("");
  // Null until the print log has answered once. The rows already on screen
  // stay put while a narrower search is loading, so the table does not blink.
  const [runs, setRuns] = useState<PrintRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // How many rows the last read asked the print log for. It grows when the
  // operator asks to see more, so the list has no cap nobody can get past.
  const [fetchLimit, setFetchLimit] = useState(FETCH_SIZE);
  const [detailsRun, setDetailsRun] = useState<PrintRun | null>(null);

  useEffect(() => {
    let cancelled = false;

    const din = search.trim().toUpperCase();
    listPrintRuns({ din: din.length === 0 ? undefined : din, limit: fetchLimit }).then(
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
  }, [search, fetchLimit]);

  const printAgain = useCallback(
    (run: PrintRun) => {
      onPrintAgain(run.din, run.copies);
    },
    [onPrintAgain],
  );

  const columns = useMemo(() => historyColumns({ onPrintAgain: printAgain }), [printAgain]);

  // The search box owns the DIN filter. The table is told about it as a column
  // filter, and hands any change to it straight back to the search box, so
  // there is exactly one place the search text lives.
  const columnFilters = useMemo<ColumnFiltersState>(
    () => (search.trim().length === 0 ? [] : [{ id: DIN_COLUMN_ID, value: search.trim() }]),
    [search],
  );

  const table = useTable({
    features: historyTableFeatures,
    columns,
    data: runs ?? NO_RUNS,
    initialState: {
      sorting: [{ id: PRINTED_AT_COLUMN_ID, desc: true }],
      pagination: { pageIndex: 0, pageSize: PAGE_SIZE },
    },
    state: { columnFilters },
    onColumnFiltersChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnFilters) : updater;
      const dinFilter = next.find((filter) => filter.id === DIN_COLUMN_ID);
      setSearch(dinFilter === undefined ? "" : String(dinFilter.value));
    },
  });

  const rows = table.getRowModel().rows;
  const matchCount = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize } = table.state.pagination;
  const firstShown = matchCount === 0 ? 0 : pageIndex * pageSize + 1;
  const lastShown = Math.min((pageIndex + 1) * pageSize, matchCount);
  // A read that came back exactly full is the sign that the print log holds
  // more than the screen asked for.
  const mayHaveMore = runs !== null && runs.length === fetchLimit;
  const loading = runs === null && error === null;

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
              {...scanOptOutProps}
              value={search}
              placeholder="Start of a DIN"
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-64 pl-9 font-mono text-sm"
              onChange={(event) => {
                setSearch(event.currentTarget.value);
                setFetchLimit(FETCH_SIZE);
              }}
            />
          </div>
        </div>
        <p className="pb-2.5 text-sm text-muted-foreground tabular-nums">
          {loading
            ? "Reading the print log"
            : `${matchCount} ${matchCount === 1 ? "print run" : "print runs"}${mayHaveMore ? " so far" : ""}`}
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
              <col key={column.id} style={{ width: COLUMN_LAYOUT[column.id]?.width ?? "auto" }} />
            ))}
          </colgroup>
          <TableHeader className="sticky top-0 z-10 bg-surface">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={`px-4 text-muted-foreground ${COLUMN_LAYOUT[header.column.id]?.align ?? ""}`}
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
                        className={`px-4 py-2 ${COLUMN_LAYOUT[cell.column.id]?.align ?? ""}`}
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
          {matchCount === 0
            ? "No print runs"
            : `Showing ${firstShown} to ${lastShown} of ${matchCount}`}
        </p>
        <div className="flex items-center gap-2">
          {mayHaveMore && (
            <Button
              variant="ghost"
              size="lg"
              className="h-9 text-muted-foreground hover:text-foreground"
              onClick={() => setFetchLimit((limit) => limit + FETCH_SIZE)}
            >
              Read more from the print log
            </Button>
          )}
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Previous page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Next page"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
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
