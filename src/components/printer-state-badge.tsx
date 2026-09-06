/**
 * Says in plain words what a print queue is doing. The scan screen and the
 * settings screen both show this, so the wording is written once here.
 */

import { Badge } from "@/components/ui/badge";
import { PRINTER_FAULT, type PrinterState } from "@/lib/tauri/types";

/** The reason a print queue gives, as a sentence fragment an operator can act on. */
export function printerStateText(state: PrinterState): string {
  switch (state.kind) {
    case "ready":
      return "Ready";
    case "paused":
      return "Paused. Start the queue in the operating system's printer settings.";
    case "offline":
      return "Offline. Check the USB cable and the power switch.";
    case "unknown":
      return "State unknown. The print queue answered in a form this app does not recognise.";
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

/** True when a print run may be sent to a printer in this state. */
export function isReady(state: PrinterState): boolean {
  return state.kind === "ready";
}

export function PrinterStateBadge({ state }: { state: PrinterState }) {
  return (
    <Badge
      variant={isReady(state) ? "secondary" : "destructive"}
      className="h-auto max-w-full whitespace-normal px-2 py-0.5 text-sm"
    >
      {printerStateText(state)}
    </Badge>
  );
}
