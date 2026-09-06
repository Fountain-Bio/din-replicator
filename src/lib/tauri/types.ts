/**
 * The shapes the Rust side sends over the Tauri bridge.
 *
 * Every type here mirrors a `serde` struct or enum in `src-tauri/src`. Keep the
 * two in step: a field renamed in Rust has to be renamed here as well.
 */

import type { LabelFont } from "@/lib/label/fonts";
import type { PrinterDotsPerInch } from "@/lib/label/replica-zpl";

/**
 * Which font the eye-readable line on a replica is printed in. The label
 * module owns the list, because it is what holds the fonts and builds the ZPL
 * that uses them. Rust names the same three values.
 */
export type { LabelFont };

/**
 * The print head resolutions a replica can be laid out for. The label module
 * owns the list for the same reason it owns the fonts: it is what turns inches
 * into dots. Rust names the same three numbers.
 */
export type { PrinterDotsPerInch };

/** What the printer reports about itself right now. */
export type PrinterState =
  /** The printer takes jobs and reports no fault. */
  | { kind: "ready" }
  /** Someone stopped the printer. A job sent now would wait instead of print. */
  | { kind: "paused" }
  /** The operating system cannot reach the printer. */
  | { kind: "offline" }
  /** The printer reports a fault. `detail` is one of the `PRINTER_FAULT` names. */
  | { kind: "error"; detail: string }
  /** The printer answered in a form the app does not recognise. */
  | { kind: "unknown" };

/**
 * The fault names `PrinterState` of kind `error` carries. Both platforms
 * translate their own vocabulary into this one set.
 */
export const PRINTER_FAULT = {
  mediaEmpty: "media-empty",
  mediaJam: "media-jam",
  doorOpen: "door-open",
  other: "printer-error",
} as const;

/**
 * How a printer is attached to this computer.
 *
 * `host` carries the address a network printer answers on, and is null for a
 * USB printer or a network printer whose address the operating system does not
 * give. `other` covers every attachment the app cannot name.
 */
export interface PrinterConnection {
  kind: "usb" | "network" | "other";
  host: string | null;
}

/** One printer as the operating system lists it. */
export interface PrinterInfo {
  /** The printer's name. Every other printer call takes this string. */
  name: string;
  /** What the operating system says the printer is. Can be empty. */
  description: string;
  /** How the printer is attached to this computer. */
  connection: PrinterConnection;
  /**
   * True when the operating system's name or description for this printer says
   * it is the label printer model the app prints replicas on. The UI puts
   * these first and marks them, because a replica only comes out right on one.
   */
  isZebra: boolean;
  state: PrinterState;
}

/** What the operating system gave back after it took a print run. */
export interface PrintReceipt {
  /** The operating system's own job identifier. Not every printer reports one. */
  jobId: string | null;
}

/** The result of scanning a freshly printed replica. */
export interface Verification {
  /** The raw string the scanner delivered. */
  scannedPayload: string;
  /** True when the scan carried the barcode payload of the printed DIN. */
  matched: boolean;
  /** When the verification scan happened, as an RFC 3339 timestamp. */
  verifiedAt: string;
}

/** One print action, as the print log stores it. */
export interface PrintRun {
  id: number;
  /** The 13-character DIN that was printed. */
  din: string;
  /** The 16-character barcode payload the replicas carry. */
  payload: string;
  /** Copy count: how many replicas this print run produced. */
  copyCount: number;
  /** The name of the printer the print run went to. */
  printerName: string;
  jobId: string | null;
  /** The operating system user name of the operator. */
  operatorUser: string;
  /** The name of the computer the print run came from. */
  hostname: string;
  /** When the print run was submitted, as an RFC 3339 timestamp. */
  printedAt: string;
  /** The exact ZPL that was sent, kept so a print run can be explained later. */
  zpl: string;
  /** The verification scan, or null when nobody verified this print run. */
  verification: Verification | null;
}

/** What `record_print_run` needs to write a print run to the log. */
export interface PrintRunInput {
  din: string;
  payload: string;
  copyCount: number;
  printerName: string;
  jobId: string | null;
  zpl: string;
}

/** What `record_verification` needs to attach a verification to a print run. */
export interface VerificationInput {
  printRunId: number;
  scannedPayload: string;
  matched: boolean;
}

/** Which print runs the history screen wants. */
export interface PrintRunQuery {
  /** Keep only print runs whose DIN starts with this string. */
  din?: string;
  limit?: number;
  offset?: number;
}

/**
 * How the printer puts ink on the label stock.
 *
 * Thermal transfer melts a ribbon onto the stock. Direct thermal has no
 * ribbon and darkens heat-sensitive stock instead. The two need different
 * label stock, so this follows what is loaded in the printer.
 */
export type PrintMethod = "thermalTransfer" | "directThermal";

/** The operator's saved choices. */
export interface Settings {
  /** The name of the printer replicas go to, or null when nobody has chosen one. */
  selectedPrinter: string | null;
  /** True when the app asks for a verification scan after every print run. */
  verifyAfterPrint: boolean;
  /** The largest copy count the scan screen allows. */
  maxCopies: number;
  /** Which of the two printing methods the loaded label stock needs. */
  printMethod: PrintMethod;
  /** How much heat the printer uses, from 0 to 30. Higher prints darker. */
  darkness: number;
  /** How fast the label leaves the printer, in inches per second, from 2 to 6. */
  speedIps: number;
  /** Which font the eye-readable line on a replica is printed in. */
  labelFont: LabelFont;
  /**
   * How far down the label the printed content is moved, in dots at 300 dpi,
   * from -100 to 100. Negative moves it up. This corrects a roll that sits a
   * little high or low in the printer.
   */
  verticalOffsetDots: number;
  /**
   * How far right along the label the printed content is moved, in dots at
   * 300 dpi, from -100 to 100. Negative moves it left.
   */
  horizontalOffsetDots: number;
  /** Width of one label in inches, across the direction the stock travels. */
  labelWidthInches: number;
  /** Height of one label in inches, along the direction the stock travels. */
  labelHeightInches: number;
  /** How many dots to the inch the print head lays down. */
  printerDotsPerInch: PrinterDotsPerInch;
}

/** Where the print log lives on this machine, or why there is none. */
export interface StorageInfo {
  /**
   * Full path of the SQLite file that holds the print log. Null when the app
   * has no log at all.
   */
  databasePath: string | null;
  /**
   * True when the file sits in a machine-wide directory, so every login on
   * this computer sees the same history. ADR 0004 explains why that matters.
   */
  machineWide: boolean;
  /**
   * Null while the print log works. Otherwise the reason it could not be
   * opened, in words the UI shows as they are. A print run that cannot be
   * recorded must not happen, so the app refuses to print while this is set.
   */
  unavailable: string | null;
}

/**
 * The shape a rejected command carries. Rust serialises its errors as
 * `{"code": "...", "message": "..."}`; `code` is stable and `message` is the
 * sentence to show.
 */
export interface CommandError {
  code: string;
  message: string;
}
