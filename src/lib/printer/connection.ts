/**
 * How a printer is attached to this computer, in the one form the UI shows.
 *
 * The only thing an operator needs to tell two printers apart is whether the
 * printer sits on the desk over USB or lives somewhere on the network, and in
 * the network case which address it answers on. Device URIs, serial numbers,
 * and driver names never reach the screen.
 *
 * The Rust side reports this as `PrinterInfo.connection`. Until every platform
 * fills that field in, `printerConnection` reads the same shape out of the
 * operating system's own description of the printer, which on both platforms
 * is a device URI.
 */

import type { PrinterConnection, PrinterInfo } from "@/lib/tauri/types";

/** URI schemes that mean the printer answers somewhere on the network. */
const NETWORK_SCHEMES = ["ipp", "ipps", "socket", "lpd", "http", "https"];

/** A printer nobody could classify. */
const UNKNOWN: PrinterConnection = { kind: "other", host: null };

/**
 * Reads a device URI such as `ipp://10.0.4.14/printers/back_room` or
 * `usb://Maker/Model?serial=123` into the connection it describes.
 *
 * Returns the `other` shape for anything that is not a URI, which is what a
 * plain driver name looks like.
 */
export function connectionFromDescription(description: string): PrinterConnection {
  const separator = description.indexOf("://");
  if (separator <= 0) {
    return UNKNOWN;
  }
  const scheme = description.slice(0, separator).toLowerCase();
  if (scheme === "usb") {
    return { kind: "usb", host: null };
  }
  if (!NETWORK_SCHEMES.includes(scheme)) {
    return UNKNOWN;
  }

  // Everything up to the next slash is the authority. Strip any `user@` in
  // front of it and any `:port` after it, so only the host is left.
  const rest = description.slice(separator + 3);
  const authority = rest.split("/")[0] ?? "";
  const afterCredentials = authority.slice(authority.lastIndexOf("@") + 1);
  const host = afterCredentials.split(":")[0] ?? "";
  return { kind: "network", host: host.length === 0 ? null : host };
}

/** The connection a printer reports, or the one its description implies. */
export function printerConnection(printer: PrinterInfo): PrinterConnection {
  return printer.connection ?? connectionFromDescription(printer.description);
}

/**
 * How a connection reads beside a printer's name, such as `USB` or
 * `Network 10.0.4.14`. An empty string when there is nothing worth saying.
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
