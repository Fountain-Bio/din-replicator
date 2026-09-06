/**
 * A stand-in for the Rust side, used only by `bun run dev` in a plain browser.
 *
 * The Tauri commands do not exist in a browser tab, so every screen would fail
 * to load without this. The mock keeps printers, settings, and print runs in
 * memory for the life of the page, which is enough to click through all three
 * screens. Nothing here reaches a real printer.
 *
 * Every printer, address, DIN, operator, and computer name below is invented.
 * The network addresses come from the ranges RFC 5737 reserves for writing
 * about networks, so none of them can be a real machine.
 *
 * `commands.ts` only imports this module when the app is a development build
 * with no Tauri host, so a production bundle never contains it.
 */

import { printerStateText } from "@/components/printer-status";
import { DEFAULT_LABEL_FONT } from "@/lib/label/fonts";
import {
  DARKNESS_MAX,
  DARKNESS_MIN,
  DEFAULT_PRINT_SETTINGS,
  MAX_COPIES,
  OFFSET_DOTS_MAX,
  OFFSET_DOTS_MIN,
  SPEED_IPS_MAX,
  SPEED_IPS_MIN,
} from "@/lib/label/replica-zpl";
import type { Commands } from "./commands";
import type { PrinterInfo, PrintRun, Settings, StorageInfo } from "./types";

/**
 * Three printers, so the settings screen has something to choose between and
 * both a USB and a network attachment appear in the picker. Exactly one of
 * them is a label printer, which is what makes the app choose it by itself the
 * first time the window opens.
 */
const printers: PrinterInfo[] = [
  {
    name: "Label_Printer_Front_Desk_ZD411_300dpi_ZPL",
    description: "usb://Label%20Printer/ZD411-300dpi%20ZPL?serial=MOCK000000001",
    connection: { kind: "usb", host: null },
    isZebra: true,
    state: { kind: "ready" },
  },
  {
    name: "Front_Office_Laser",
    description: "ipp://192.0.2.31:631/printers/front_office_laser",
    connection: { kind: "network", host: "192.0.2.31" },
    isZebra: false,
    state: { kind: "ready" },
  },
  {
    name: "Back_Room_Laser",
    description: "ZDesigner Office Laser",
    connection: { kind: "other", host: null },
    isZebra: false,
    state: { kind: "offline" },
  },
];

/**
 * Where a machine that has never opened the settings screen starts.
 *
 * Rust owns the defaults. These literals mirror `Settings::default()` in
 * `src-tauri/src/settings.rs`, and the printing values come from the label
 * module, which is the module that builds the ZPL they go into. A default
 * changed in Rust has to be changed here as well, or the mock stops showing
 * what a fresh machine shows.
 */
let settings: Settings = {
  selectedPrinter: null,
  verifyAfterPrint: true,
  maxCopies: 20,
  labelFont: DEFAULT_LABEL_FONT,
  ...DEFAULT_PRINT_SETTINGS,
};

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
  copyCount: number;
  operatorUser: string;
  hostname: string;
  /** How many minutes before the page loaded this print run happened. */
  minutesAgo: number;
  verified: "passed" | "failed" | null;
}> = [
  {
    din: "W483626000011",
    copyCount: 2,
    operatorUser: "r.okafor",
    hostname: "collection-room-2",
    minutesAgo: 4,
    verified: "passed",
  },
  {
    din: "W483626000010",
    copyCount: 1,
    operatorUser: "r.okafor",
    hostname: "collection-room-2",
    minutesAgo: 21,
    verified: "passed",
  },
  {
    din: "W483626000009",
    copyCount: 4,
    operatorUser: "r.okafor",
    hostname: "collection-room-2",
    minutesAgo: 55,
    verified: null,
  },
  {
    din: "G112625904418",
    copyCount: 1,
    operatorUser: "j.lindqvist",
    hostname: "collection-room-2",
    minutesAgo: 140,
    verified: "failed",
  },
  {
    din: "G112625904417",
    copyCount: 3,
    operatorUser: "j.lindqvist",
    hostname: "collection-room-2",
    minutesAgo: 168,
    verified: "passed",
  },
  {
    din: "W483626000008",
    copyCount: 1,
    operatorUser: "j.lindqvist",
    hostname: "collection-room-2",
    minutesAgo: 1_500,
    verified: "passed",
  },
  {
    din: "W483626000007",
    copyCount: 12,
    operatorUser: "a.mendes",
    hostname: "front-desk-1",
    minutesAgo: 1_620,
    verified: null,
  },
  {
    din: "N902625000442",
    copyCount: 2,
    operatorUser: "a.mendes",
    hostname: "front-desk-1",
    minutesAgo: 1_705,
    verified: "passed",
  },
  {
    din: "N902625000441",
    copyCount: 1,
    operatorUser: "a.mendes",
    hostname: "front-desk-1",
    minutesAgo: 2_880,
    verified: "passed",
  },
  {
    din: "N902625000440",
    copyCount: 6,
    operatorUser: "a.mendes",
    hostname: "front-desk-1",
    minutesAgo: 2_950,
    verified: null,
  },
  {
    din: "W483625998201",
    copyCount: 1,
    operatorUser: "r.okafor",
    hostname: "collection-room-2",
    minutesAgo: 4_320,
    verified: "passed",
  },
  {
    din: "W483625998200",
    copyCount: 2,
    operatorUser: "r.okafor",
    hostname: "collection-room-2",
    minutesAgo: 4_400,
    verified: "passed",
  },
  {
    din: "G112625903990",
    copyCount: 1,
    operatorUser: "j.lindqvist",
    hostname: "front-desk-1",
    minutesAgo: 5_760,
    verified: null,
  },
  {
    din: "G112625903989",
    copyCount: 8,
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
    copyCount: seed.copyCount,
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

/**
 * Refuses settings the Rust side would refuse.
 *
 * `Settings::check` in `src-tauri/src/settings.rs` holds the real rules and
 * fails with the `invalid_input` code. These are the same rules with the same
 * sentences, so the settings screen behaves in a browser the way it behaves in
 * the app.
 */
function checkSettings(chosen: Settings): void {
  const { maxCopies, darkness, speedIps, verticalOffsetDots, horizontalOffsetDots } = chosen;
  if (maxCopies < 1) {
    reject("invalid_input", "the largest copy count must be at least 1");
  }
  if (maxCopies > MAX_COPIES) {
    reject("invalid_input", `the largest copy count must be ${MAX_COPIES} or fewer`);
  }
  if (darkness < DARKNESS_MIN || darkness > DARKNESS_MAX) {
    reject("invalid_input", `darkness must be from ${DARKNESS_MIN} to ${DARKNESS_MAX}`);
  }
  if (speedIps < SPEED_IPS_MIN || speedIps > SPEED_IPS_MAX) {
    reject(
      "invalid_input",
      `print speed must be from ${SPEED_IPS_MIN} to ${SPEED_IPS_MAX} inches per second`,
    );
  }
  for (const [name, offset] of [
    ["the vertical position", verticalOffsetDots],
    ["the horizontal position", horizontalOffsetDots],
  ] as const) {
    if (offset < OFFSET_DOTS_MIN || offset > OFFSET_DOTS_MAX) {
      reject("invalid_input", `${name} must be from ${OFFSET_DOTS_MIN} to ${OFFSET_DOTS_MAX} dots`);
    }
  }
}

/**
 * One answer for each command, in the shapes `Commands` names.
 *
 * Typing the whole table from `Commands` is what keeps the mock honest: a
 * command left out, or an answer built with the wrong fields, fails the
 * typecheck.
 */
type MockCommands = {
  [K in keyof Commands]: (
    args: Commands[K]["args"],
  ) => Commands[K]["result"] | Promise<Commands[K]["result"]>;
};

const handlers: MockCommands = {
  list_printers: () => printers,

  printer_state: ({ name }) => findPrinter(name).state,

  print_zpl: ({ name }) => {
    const printer = findPrinter(name);
    if (printer.state.kind !== "ready") {
      // ADR 0003: this call is the gate. A printer that would leave the job
      // waiting refuses the print run here, and the sentence is the one the
      // scan screen shows.
      reject("printer_not_ready", printerStateText(printer.state));
    }
    return { jobId: `mock-${nextPrintRunId}` };
  },

  record_print_run: ({ input }) => {
    if (storage.unavailable !== null) {
      reject("storage_unavailable", storage.unavailable);
    }
    const run: PrintRun = {
      id: nextPrintRunId,
      din: input.din,
      payload: input.payload,
      copyCount: input.copyCount,
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
  },

  record_verification: ({ input }) => {
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
  },

  list_print_runs: ({ query }) => {
    const prefix = (query.din ?? "").toUpperCase();
    const matching = printRuns
      .filter((run) => run.din.startsWith(prefix))
      .slice()
      .reverse();
    const offset = query.offset ?? 0;
    const limit = query.limit ?? matching.length;
    return matching.slice(offset, offset + limit);
  },

  get_settings: () => settings,

  set_settings: ({ settings: chosen }) => {
    checkSettings(chosen);
    settings = chosen;
    return settings;
  },

  storage_info: () => storage,
};

/**
 * Answers one command the way the Rust side would.
 *
 * The delay is there so the screens spend a moment in their loading states,
 * which is how they behave against a real printer.
 */
export async function mockInvoke<K extends keyof Commands>(
  command: K,
  args: Commands[K]["args"],
): Promise<Commands[K]["result"]> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const handler: MockCommands[K] = handlers[command];
  return handler(args);
}
