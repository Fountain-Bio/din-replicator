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
 * Every command the Rust side answers, with what it takes and what it gives
 * back.
 *
 * This is the one description of the bridge. `call` reads it, and the
 * development mock is typed from it as well, so a mock that answers the wrong
 * shape or forgets a command fails the typecheck rather than the app.
 *
 * A command that takes no arguments is written as `Record<never, never>`, which
 * is the empty object.
 */
export interface Commands {
  list_printers: { args: Record<never, never>; result: PrinterInfo[] };
  printer_state: { args: { name: string }; result: PrinterState };
  print_zpl: { args: { name: string; zpl: string; title: string }; result: PrintReceipt };
  record_print_run: { args: { input: PrintRunInput }; result: PrintRun };
  record_verification: { args: { input: VerificationInput }; result: PrintRun };
  list_print_runs: { args: { query: PrintRunQuery }; result: PrintRun[] };
  get_settings: { args: Record<never, never>; result: Settings };
  set_settings: { args: { settings: Settings }; result: Settings };
  storage_info: { args: Record<never, never>; result: StorageInfo };
}

/**
 * True when the app window has a Rust side behind it. Tauri puts
 * `__TAURI_INTERNALS__` on `window` before the page loads.
 */
export const HAS_TAURI_HOST = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * True when this build is running in a browser with no Tauri host, which in a
 * development build means `bun run dev` rather than `bun run tauri dev`.
 *
 * Each module that has a mock branch works this out for itself from
 * `import.meta.env.DEV`. A production build replaces that with false in the
 * module it is written in, which is what lets the bundler drop the branch and
 * the mock behind it.
 */
const USING_DEVELOPMENT_MOCK = import.meta.env.DEV && !HAS_TAURI_HOST;

/**
 * Sends one command to the Rust side, or to the development mock.
 *
 * The mock is loaded with a dynamic import inside the dead branch of a
 * constant, so a production build drops both the branch and the module.
 */
async function call<K extends keyof Commands>(
  command: K,
  args: Commands[K]["args"],
): Promise<Commands[K]["result"]> {
  if (USING_DEVELOPMENT_MOCK) {
    const { mockInvoke } = await import("./dev-mock");
    return mockInvoke(command, args);
  }
  return invoke<Commands[K]["result"]>(command, args);
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
  return call("list_printers", {});
}

/** The state of one printer, read fresh from the operating system. */
export function printerState(name: string): Promise<PrinterState> {
  return call("printer_state", { name });
}

/**
 * Sends one print run's ZPL to a printer.
 *
 * `title` is the job name the operating system's printer window shows. The
 * Rust command reads the printer's state first and rejects the call with the
 * `printer_not_ready` code when the printer would leave the job waiting, so
 * this call is the only gate a print run has to pass (ADR 0003).
 */
export function printZpl(name: string, zpl: string, title: string): Promise<PrintReceipt> {
  return call("print_zpl", { name, zpl, title });
}

/** Writes one print run to the print log and returns the stored row. */
export function recordPrintRun(input: PrintRunInput): Promise<PrintRun> {
  return call("record_print_run", { input });
}

/** Attaches a verification scan to a print run and returns the updated row. */
export function recordVerification(input: VerificationInput): Promise<PrintRun> {
  return call("record_verification", { input });
}

/** Print runs from the log, newest first. */
export function listPrintRuns(query: PrintRunQuery = {}): Promise<PrintRun[]> {
  return call("list_print_runs", { query });
}

/** The operator's saved choices. */
export function getSettings(): Promise<Settings> {
  return call("get_settings", {});
}

/** Saves the operator's choices and returns what was stored. */
export function setSettings(settings: Settings): Promise<Settings> {
  return call("set_settings", { settings });
}

/** Where the print log lives on this machine, or why there is none. */
export function storageInfo(): Promise<StorageInfo> {
  return call("storage_info", {});
}
