/**
 * Typed wrappers around the Tauri commands in `src-tauri/src/commands.rs`.
 *
 * Every screen calls the app's Rust side through this file, so the invoke
 * names and argument keys live in one place. Tauri turns a Rust parameter
 * named `print_run_id` into the wire key `printRunId`, so the argument objects
 * here are camelCase.
 *
 * When the app runs under `bun run dev` in a plain browser there is no Rust
 * side to talk to. In that case the calls go to the development mock in
 * `dev-mock.ts` instead, so the screens can be exercised without the backend.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  CommandError,
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
 * True when this build is running in a browser with no Tauri host. Tauri puts
 * `__TAURI_INTERNALS__` on `window` before the page loads, so its absence in a
 * development build means `bun run dev` rather than `bun run tauri dev`.
 */
const useDevelopmentMock =
  import.meta.env.DEV && typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);

/**
 * Sends one command to the Rust side, or to the development mock.
 *
 * The mock is loaded with a dynamic import inside the dead branch of a
 * constant, so a production build drops both the branch and the module.
 */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (useDevelopmentMock) {
    const { mockInvoke } = await import("./dev-mock");
    return mockInvoke<T>(command, args);
  }
  return invoke<T>(command, args);
}

/**
 * Reads the `code` and `message` a rejected command carries.
 *
 * Anything that is not the documented error shape, such as a thrown
 * `TypeError`, comes back with the code `unknown`.
 */
export function asCommandError(error: unknown): CommandError {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    const shape = error as { code: unknown; message: unknown };
    if (typeof shape.code === "string" && typeof shape.message === "string") {
      return { code: shape.code, message: shape.message };
    }
  }
  return { code: "unknown", message: String(error) };
}

/** Every printer installed on this machine, with its current state. */
export function listPrinters(): Promise<PrinterInfo[]> {
  return call<PrinterInfo[]>("list_printers");
}

/** The state of one printer, read fresh from the operating system. */
export function printerState(name: string): Promise<PrinterState> {
  return call<PrinterState>("printer_state", { name });
}

/**
 * Sends one print run's ZPL to a printer.
 *
 * `title` is the job name the operating system's printer window shows. The
 * Rust command reads the printer's state first and rejects the call when the
 * printer is not ready, so a replica never sits waiting on a stopped printer.
 */
export function printZpl(name: string, zpl: string, title: string): Promise<PrintReceipt> {
  return call<PrintReceipt>("print_zpl", { name, zpl, title });
}

/** Writes one print run to the print log and returns the stored row. */
export function recordPrintRun(input: PrintRunInput): Promise<PrintRun> {
  return call<PrintRun>("record_print_run", { input });
}

/** Attaches a verification scan to a print run and returns the updated row. */
export function recordVerification(input: VerificationInput): Promise<PrintRun> {
  return call<PrintRun>("record_verification", { input });
}

/** Print runs from the log, newest first. */
export function listPrintRuns(query: PrintRunQuery = {}): Promise<PrintRun[]> {
  return call<PrintRun[]>("list_print_runs", { query });
}

/** One print run from the log. */
export function getPrintRun(id: number): Promise<PrintRun> {
  return call<PrintRun>("get_print_run", { id });
}

/** The operator's saved choices. */
export function getSettings(): Promise<Settings> {
  return call<Settings>("get_settings");
}

/** Saves the operator's choices and returns what was stored. */
export function setSettings(settings: Settings): Promise<Settings> {
  return call<Settings>("set_settings", { settings });
}

/** Where the print log lives on this machine, or why there is none. */
export function storageInfo(): Promise<StorageInfo> {
  return call<StorageInfo>("storage_info");
}
