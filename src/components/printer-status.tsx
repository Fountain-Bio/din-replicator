/**
 * Says in plain words what a printer is doing and how it is attached.
 *
 * Every sentence the app has about a printer's state is in this file. The scan
 * screen, the settings screen, and the development mock all read them from
 * here, so an operator meets one wording wherever the answer appears.
 */

import { cn } from "cn";
import { PRINTER_FAULT, type PrinterConnection, type PrinterState } from "@/lib/tauri/types";

/** What the printer reports, as a sentence an operator can act on. */
export function printerStateText(state: PrinterState): string {
  switch (state.kind) {
    case "ready":
      return "Ready";
    case "paused":
      return "Paused. Start the printer in the operating system's printer settings.";
    case "offline":
      return "Offline. Check the USB cable and the power switch.";
    case "unknown":
      return "State unknown. The printer answered in a form this app does not recognise.";
    case "error":
      switch (state.detail) {
        case PRINTER_FAULT.mediaEmpty:
          return "Out of label stock. Load a new roll.";
        case PRINTER_FAULT.mediaJam:
          return "Label stock is jammed. Clear the jam and close the printer.";
        case PRINTER_FAULT.doorOpen:
          return "The cover is open. Close it.";
        default:
          return "The printer reports a fault. Check the printer.";
      }
  }
}

/** The same answer in two or three words, for a line that has to stay short. */
function printerStateSummary(state: PrinterState): string {
  switch (state.kind) {
    case "ready":
      return "Ready";
    case "paused":
      return "Paused";
    case "offline":
      return "Offline";
    case "unknown":
      return "State unknown";
    case "error":
      switch (state.detail) {
        case PRINTER_FAULT.mediaEmpty:
          return "Out of label stock";
        case PRINTER_FAULT.mediaJam:
          return "Label stock jammed";
        case PRINTER_FAULT.doorOpen:
          return "Cover open";
        default:
          return "Printer fault";
      }
  }
}

/**
 * How a connection reads beside a printer's name, such as `USB` or
 * `Network 192.0.2.14`. An empty string when there is nothing worth saying.
 *
 * Whether the printer sits on the desk or somewhere on the network is all an
 * operator needs to tell two printers apart. Device URIs, serial numbers, and
 * driver names never reach the screen.
 */
export function connectionText(connection: PrinterConnection): string {
  switch (connection.kind) {
    case "usb":
      return "USB";
    case "network":
      return connection.host === null ? "Network" : `Network ${connection.host}`;
    case "other":
      return "";
  }
}

export interface PrinterStatusProps {
  /** What the printer reports about itself right now. */
  state: PrinterState;
  className?: string;
}

/**
 * A coloured dot and the two or three words the printer reports.
 *
 * A dot rather than a filled badge, because this line sits next to the work
 * rather than in front of it, and a printer that is ready should be the
 * quietest thing on the screen. The whole sentence, with what to do about the
 * fault, belongs on the message that stops a print run, not on a status line
 * an operator passes over every minute.
 */
export function PrinterStatus({ state, className }: PrinterStatusProps) {
  const ready = state.kind === "ready";

  return (
    <span className={cn("inline-flex items-center gap-2 text-sm", className)}>
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full transition-colors duration-200",
          ready ? "bg-ok" : "bg-destructive",
        )}
      />
      <span className={cn(ready ? "text-muted-foreground" : "text-destructive")}>
        {printerStateSummary(state)}
      </span>
    </span>
  );
}
