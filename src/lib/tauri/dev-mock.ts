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

/** Two printers, so the settings screen has something to choose between. */
const printers: PrinterInfo[] = [
  {
    name: "Zebra_ZD411",
    description: "ZDesigner ZD411-300dpi ZPL",
    isZebra: true,
    state: { kind: "ready" },
  },
  {
    name: "Front_Office_Laser",
    description: "Brother HL-L2460DW",
    isZebra: false,
    state: { kind: "offline" },
  },
];

let settings: Settings = {
  selectedPrinter: null,
  verifyAfterPrint: true,
  maxCopies: 20,
};

const storage: StorageInfo = {
  databasePath: "/Users/Shared/DIN Replicator/print-log.sqlite3",
  machineWide: true,
};

/** Print runs recorded since the page loaded, newest last. */
const printRuns: PrintRun[] = [];
let nextPrintRunId = 1;

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

/** How a print queue state reads in the sentence a `printer_not_ready` error uses. */
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
 * which is how they behave against a real print queue.
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

    case "get_print_run": {
      const run = printRuns.find((candidate) => candidate.id === args.id);
      if (run === undefined) {
        reject("print_run_not_found", `no print run has id ${String(args.id)}`);
      }
      return run;
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
