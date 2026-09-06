/**
 * The columns of the print run table, and the table features they need.
 *
 * Five columns is the whole table, and they are chosen so the row always fits
 * the window: when the print run happened, which DIN it carried, how many
 * replicas came out, how verification went, and the one action a row offers.
 * The printer, the operator, and the computer are real questions an auditor
 * asks, but they are long strings that would push the row off the screen, so
 * they sit on a second muted line under the DIN and in full in the details
 * panel.
 */

import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, RotateCcwIcon } from "lucide-react";
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_startsWith,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { eyeReadable } from "@/lib/isbt128";
import type { PrintRun } from "@/lib/tauri/types";

/**
 * Sorting, filtering, and paging all happen in the window over the print log
 * that the screen has already loaded. Nothing else is registered, so nothing
 * else has state.
 */
export const historyTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { startsWith: filterFn_startsWith },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

/** The id of the column the DIN search box filters. */
export const DIN_COLUMN_ID = "din";

/** The id of the column the table sorts by when it opens. */
export const PRINTED_AT_COLUMN_ID = "printedAt";

/**
 * How wide each column is and how its contents line up.
 *
 * The widths are percentages on a fixed-layout table, so the row fills the
 * window at any size and a long name is cut with an ellipsis rather than
 * pushing the action off the edge.
 */
export const COLUMN_LAYOUT: Record<string, { width: string; align?: string }> = {
  printedAt: { width: "20%" },
  din: { width: "auto" },
  copyCount: { width: "10%", align: "text-right" },
  verification: { width: "16%" },
  actions: { width: "9.5rem", align: "text-right" },
};

const helper = createColumnHelper<typeof historyTableFeatures, PrintRun>();

/** Midnight at the start of the day `time` falls in. */
function startOfDay(time: number): number {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/**
 * The print time in the reader's own time zone, with today and yesterday named
 * rather than dated. Most of what an operator looks up happened in the last
 * two days, and a word is quicker to read than a date.
 */
function printedAtText(rfc3339: string): string {
  const printedAt = new Date(rfc3339);
  if (Number.isNaN(printedAt.getTime())) {
    return rfc3339;
  }
  const clock = printedAt.toLocaleTimeString(undefined, { timeStyle: "short" });
  const daysAgo = Math.round(
    (startOfDay(Date.now()) - startOfDay(printedAt.getTime())) / 86_400_000,
  );
  if (daysAgo === 0) {
    return `Today ${clock}`;
  }
  if (daysAgo === 1) {
    return `Yesterday ${clock}`;
  }
  return `${printedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${clock}`;
}

/** The verification verdict as one word. */
function verificationText(run: PrintRun): "Passed" | "Failed" | "None" {
  if (run.verification === null) {
    return "None";
  }
  return run.verification.matched ? "Passed" : "Failed";
}

/**
 * A column heading that sorts the table when it is pressed.
 *
 * The prop asks for the two methods it calls rather than for the whole Column
 * type, because a column's full type carries every registered feature and
 * naming it here would only repeat what the header context already knows.
 */
function SortableHeader({
  column,
  children,
}: {
  column: {
    getIsSorted: () => false | "asc" | "desc";
    toggleSorting: (desc?: boolean) => void;
  };
  children: React.ReactNode;
}) {
  const sorted = column.getIsSorted();
  const Icon =
    sorted === "asc" ? ArrowUpIcon : sorted === "desc" ? ArrowDownIcon : ChevronsUpDownIcon;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2.5 h-7 font-medium text-muted-foreground hover:text-foreground"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {children}
      <Icon className={sorted === false ? "opacity-40" : undefined} />
    </Button>
  );
}

export interface HistoryColumnActions {
  /** Loads a print run's DIN and copy count onto the scan screen. */
  onPrintAgain: (run: PrintRun) => void;
}

export function historyColumns({ onPrintAgain }: HistoryColumnActions) {
  return helper.columns([
    // Sorting on the time this column shows has to compare instants, not the
    // strings the print log stores, so the accessor hands over a number.
    helper.accessor((run) => Date.parse(run.printedAt), {
      id: PRINTED_AT_COLUMN_ID,
      header: ({ column }) => <SortableHeader column={column}>When</SortableHeader>,
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {printedAtText(row.original.printedAt)}
        </span>
      ),
    }),

    helper.accessor("din", {
      id: DIN_COLUMN_ID,
      header: "DIN",
      filterFn: "startsWith",
      cell: ({ row }) => {
        const run = row.original;
        const who = `${run.operatorUser} on ${run.hostname}`;
        return (
          <div className="min-w-0">
            <div className="truncate font-mono text-sm font-medium tabular-nums">
              {eyeReadable(run.din).text}
            </div>
            {/* A printer name can run to forty characters, so it is the part
                that gives way. The operator and the computer keep their space,
                because those are what an audit question starts from. */}
            <div className="flex min-w-0 gap-1.5 text-xs text-muted-foreground">
              <span className="truncate" title={run.printerName}>
                {run.printerName}
              </span>
              <span aria-hidden>·</span>
              <span className="shrink-0">{who}</span>
            </div>
          </div>
        );
      },
    }),

    helper.accessor("copyCount", {
      id: "copyCount",
      header: () => <span className="block text-right">Copies</span>,
      cell: ({ row }) => <span className="tabular-nums">{row.original.copyCount}</span>,
    }),

    helper.accessor((run) => verificationText(run), {
      id: "verification",
      header: "Verification",
      cell: ({ row }) => {
        const verdict = verificationText(row.original);
        if (verdict === "None") {
          return <span className="text-sm text-muted-foreground">Not verified</span>;
        }
        return (
          <Badge
            variant={verdict === "Passed" ? "outline" : "destructive"}
            className={verdict === "Passed" ? "border-ok/40 bg-ok-surface text-ok" : undefined}
          >
            {verdict}
          </Badge>
        );
      },
    }),

    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            // The row itself opens the details panel, so the button has to keep
            // its click to itself.
            onClick={(event) => {
              event.stopPropagation();
              onPrintAgain(row.original);
            }}
          >
            <RotateCcwIcon />
            Print again
          </Button>
        </div>
      ),
    }),
  ]);
}
