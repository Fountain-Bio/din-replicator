/**
 * A stand-in for the Rust side, used only by `bun run dev` in a plain browser.
 *
 * The Tauri commands do not exist in a browser tab, so every screen would fail
 * to load without this. The mock keeps printers, settings, and print runs in
 * memory for the life of the page, which is enough to click through all three
 * screens. Nothing here reaches a real printer.
 *
 * `commands.ts` only imports this module when the app is a development build
 * with no Tauri host, so a production bundle never contains it.
 */

import { FALLBACK_SETTINGS } from "@/lib/settings";
import type {
  PrinterInfo,
  PrinterState,
  PrintReceipt,
  PrintRun,
  PrintRunInput,
  PrintRunQuery,
  Settings,
  StorageInfo,
  VerificationInput,
} from "./types";

/**
 * Three printers, so the settings screen has something to choose between and
 * both a USB and a network attachment appear in the picker. Exactly one of
 * them is a label printer, which is what makes the app choose it by itself the
 * first time the window opens.
 *
 * Only the first printer reports `connection`. The other two leave it out, so
 * the fallback that reads a device URI stays exercised.
 */
const printers: PrinterInfo[] = [
  {
    name: "Label_Printer_Front_Desk_ZD411_300dpi_ZPL",
    description: "usb://Label%20Printer/ZD411-300dpi%20ZPL?serial=ABC123456789",
    connection: { kind: "usb", host: null },
    isZebra: true,
    state: { kind: "ready" },
  },
  {
    name: "Front_Office_Laser",
    description: "ipp://10.0.4.16:631/printers/front_office_laser",
    isZebra: false,
    state: { kind: "ready" },
  },
  {
    name: "Back_Room_Laser",
    description: "ipp://10.0.4.14/printers/back_room_laser",
    isZebra: false,
    state: { kind: "offline" },
  },
];

let settings: Settings = { ...FALLBACK_SETTINGS };

/**
 * Add `?log=broken` to the address to see what the screens do when the print
 * log cannot be opened. Printing is refused in that state, and there is no
 * other way to reach it without breaking a real machine's disk.
 */
const brokenLog =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("log") === "broken";

const storage: StorageInfo = brokenLog
  ? {
      databasePath: null,
      machineWide: false,
      unavailable: "the folder /Users/Shared/DIN Replicator is read only",
    }
  : {
      databasePath: "/Users/Shared/DIN Replicator/print-log.sqlite3",
      machineWide: true,
      unavailable: null,
    };

/** Print runs recorded since the page loaded, newest last. */
const printRuns: PrintRun[] = [];
let nextPrintRunId = 1;

/**
 * A history worth looking at before anything has been printed in this session.
 *
 * The DINs, the operators, and the computer names are made up. They exist so
 * the history screen can be exercised with more rows than one page holds, with
 * a verification that passed, one that failed, and print runs nobody verified.
 * Every one of them went to the label printer.
 */
const SEED_PRINT_RUNS: Array<{
  din: string;
  copies: number;
  operatorUser: string;
  hostname: string;
  /** How many minutes before the page loaded this print run happened. */
  minutesAgo: number;
  verified: "passed" | "failed" | null;
}> = [
  {
    din: "W483626000011",
    copies: 2,
    operatorUser: "r.okafor",
    hostname: "collection-room-2",
    minutesAgo: 4,
    verified: "passed",
  },
  {
    din: "W483626000010",
    copies: 1,
    operatorUser: "r.okafor",
    hostname: "collection-room-2",
    minutesAgo: 21,
    verified: "passed",
  },
  {
    din: "W483626000009",
    copies: 4,
    operatorUser: "r.okafor",
    hostname: "collection-room-2",
    minutesAgo: 55,
    verified: null,
  },
  {
    din: "G112625904418",
    copies: 1,
    operatorUser: "j.lindqvist",
    hostname: "collection-room-2",
    minutesAgo: 140,
    verified: "failed",
  },
  {
    din: "G112625904417",
    copies: 3,
    operatorUser: "j.lindqvist",
    hostname: "collection-room-2",
    minutesAgo: 168,
    verified: "passed",
  },
  {
    din: "W483626000008",
    copies: 1,
    operatorUser: "j.lindqvist",
    hostname: "collection-room-2",
    minutesAgo: 1_500,
    verified: "passed",
  },
  {
    din: "W483626000007",
    copies: 12,
    operatorUser: "a.mendes",
    hostname: "front-desk-1",
    minutesAgo: 1_620,
    verified: null,
  },
  {
    din: "N902625000442",
    copies: 2,
    operatorUser: "a.mendes",
    hostname: "front-desk-1",
    minutesAgo: 1_705,
    verified: "passed",
  },
  {
    din: "N902625000441",
    copies: 1,
    operatorUser: "a.mendes",
    hostname: "front-desk-1",
    minutesAgo: 2_880,
    verified: "passed",
  },
  {
    din: "N902625000440",
    copies: 6,
    operatorUser: "a.mendes",
    hostname: "front-desk-1",
    minutesAgo: 2_950,
    verified: null,
  },
  {
    din: "W483625998201",
    copies: 1,
    operatorUser: "r.okafor",
    hostname: "collection-room-2",
    minutesAgo: 4_320,
    verified: "passed",
  },
  {
    din: "W483625998200",
    copies: 2,
    operatorUser: "r.okafor",
    hostname: "collection-room-2",
    minutesAgo: 4_400,
    verified: "passed",
  },
  {
    din: "G112625903990",
    copies: 1,
    operatorUser: "j.lindqvist",
    hostname: "front-desk-1",
    minutesAgo: 5_760,
    verified: null,
  },
  {
    din: "G112625903989",
    copies: 8,
    operatorUser: "j.lindqvist",
    hostname: "front-desk-1",
    minutesAgo: 5_900,
    verified: "passed",
  },
];

// Oldest first, so the list matches what a real print log holds after a week
// of work and `list_print_runs` can hand back the newest rows first.
for (const seed of [...SEED_PRINT_RUNS].reverse()) {
  const printedAt = new Date(Date.now() - seed.minutesAgo * 60_000);
  printRuns.push({
    id: nextPrintRunId,
    din: seed.din,
    payload: `=${seed.din}00`,
    copies: seed.copies,
    printerName: printers[0]!.name,
    jobId: `mock-${nextPrintRunId}`,
    operatorUser: seed.operatorUser,
    hostname: seed.hostname,
    printedAt: printedAt.toISOString(),
    zpl: "^XA^XZ",
    verification:
      seed.verified === null
        ? null
        : {
            scannedPayload: seed.verified === "passed" ? `=${seed.din}00` : `=${seed.din}`,
            matched: seed.verified === "passed",
            verifiedAt: new Date(printedAt.getTime() + 30_000).toISOString(),
          },
  });
  nextPrintRunId += 1;
}

/** A rejected command carries the same `{code, message}` shape Rust sends. */
function reject(code: string, message: string): never {
  throw { code, message };
}

function findPrinter(name: string): PrinterInfo {
  const printer = printers.find((candidate) => candidate.name === name);
  if (printer === undefined) {
    reject("printer_not_found", `no printer named "${name}" is installed on this machine`);
  }
  return printer;
}

/** How a printer's state reads in the sentence a `printer_not_ready` error uses. */
function describeState(state: PrinterState): string {
  switch (state.kind) {
    case "ready":
      return "ready";
    case "paused":
      return "paused";
    case "offline":
      return "offline";
    case "error":
      return `reporting ${state.detail}`;
    case "unknown":
      return "in an unknown state";
  }
}

/**
 * Answers one command the way the Rust side would.
 *
 * The delay is there so the screens spend a moment in their loading states,
 * which is how they behave against a real printer.
 */
export async function mockInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  return runCommand(command, args ?? {}) as T;
}

function runCommand(command: string, args: Record<string, unknown>): unknown {
  switch (command) {
    case "list_printers":
      return printers;

    case "printer_state":
      return findPrinter(args.name as string).state;

    case "print_zpl": {
      const printer = findPrinter(args.name as string);
      if (printer.state.kind !== "ready") {
        reject(
          "printer_not_ready",
          `the printer is ${describeState(printer.state)}, so nothing was sent to it`,
        );
      }
      const receipt: PrintReceipt = { jobId: `mock-${nextPrintRunId}` };
      return receipt;
    }

    case "record_print_run": {
      if (storage.unavailable !== null) {
        reject("storage_unavailable", storage.unavailable);
      }
      const input = args.input as PrintRunInput;
      const run: PrintRun = {
        id: nextPrintRunId,
        din: input.din,
        payload: input.payload,
        copies: input.copies,
        printerName: input.printerName,
        jobId: input.jobId,
        operatorUser: "dev",
        hostname: "development-machine",
        printedAt: new Date().toISOString(),
        zpl: input.zpl,
        verification: null,
      };
      nextPrintRunId += 1;
      printRuns.push(run);
      return run;
    }

    case "record_verification": {
      const input = args.input as VerificationInput;
      const run = printRuns.find((candidate) => candidate.id === input.printRunId);
      if (run === undefined) {
        reject("print_run_not_found", `no print run has id ${input.printRunId}`);
      }
      run.verification = {
        scannedPayload: input.scannedPayload,
        matched: input.matched,
        verifiedAt: new Date().toISOString(),
      };
      return run;
    }

    case "list_print_runs": {
      const query = (args.query ?? {}) as PrintRunQuery;
      const prefix = (query.din ?? "").toUpperCase();
      const matching = printRuns
        .filter((run) => run.din.startsWith(prefix))
        .slice()
        .reverse();
      const offset = query.offset ?? 0;
      const limit = query.limit ?? matching.length;
      return matching.slice(offset, offset + limit);
    }

    case "get_settings":
      return settings;

    case "set_settings":
      settings = args.settings as Settings;
      return settings;

    case "storage_info":
      return storage;

    default:
      return reject("unknown_command", `the development mock does not answer "${command}"`);
  }
}
