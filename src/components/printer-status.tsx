/**
 * Says in plain words what a printer is doing. The scan screen and the
 * settings screen both show this, so the wording is written once here.
 */

import { cn } from "cn";
import { PRINTER_FAULT, type PrinterState } from "@/lib/tauri/types";

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

/** True when a print run may be sent to a printer in this state. */
function isReady(state: PrinterState): boolean {
  return state.kind === "ready";
}

export interface PrinterStatusProps {
  /** The printer's state, or null while the app is still asking for it. */
  state: PrinterState | null;
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
  const ready = state !== null && isReady(state);
  const text = state === null ? "Reading the printer" : printerStateSummary(state);

  return (
    <span className={cn("inline-flex items-center gap-2 text-sm", className)}>
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full transition-colors duration-200",
          state === null ? "bg-muted-foreground/40" : ready ? "bg-ok" : "bg-destructive",
        )}
      />
      <span className={cn(state !== null && !ready ? "text-destructive" : "text-muted-foreground")}>
        {text}
      </span>
    </span>
  );
}
