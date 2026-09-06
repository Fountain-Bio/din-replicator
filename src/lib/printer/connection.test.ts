import { describe, expect, it } from "vitest";
import type { PrinterInfo } from "@/lib/tauri/types";
import { connectionFromDescription, connectionText, printerConnection } from "./connection";

/** A printer with the fields these tests care about and defaults for the rest. */
function printer(fields: Partial<PrinterInfo>): PrinterInfo {
  return {
    name: "Label_Printer",
    description: "",
    isZebra: true,
    state: { kind: "ready" },
    ...fields,
  };
}

describe("connectionFromDescription", () => {
  it("reads a USB device URI", () => {
    expect(connectionFromDescription("usb://Label%20Printer/ZD411?serial=ABC123456789")).toEqual({
      kind: "usb",
      host: null,
    });
  });

  it("reads the host out of a network device URI", () => {
    expect(connectionFromDescription("ipp://10.0.4.14/printers/back_room")).toEqual({
      kind: "network",
      host: "10.0.4.14",
    });
  });

  it("drops the port from a network host", () => {
    expect(connectionFromDescription("ipps://10.0.4.16:631/printers/front_office")).toEqual({
      kind: "network",
      host: "10.0.4.16",
    });
  });

  it("drops credentials in front of a network host", () => {
    expect(connectionFromDescription("socket://operator@printers.example:9100")).toEqual({
      kind: "network",
      host: "printers.example",
    });
  });

  it("treats a driver name as an unknown connection", () => {
    expect(connectionFromDescription("ZDesigner ZD411-300dpi ZPL")).toEqual({
      kind: "other",
      host: null,
    });
  });

  it("treats an empty description as an unknown connection", () => {
    expect(connectionFromDescription("")).toEqual({ kind: "other", host: null });
  });

  it("treats a scheme it does not know as an unknown connection", () => {
    expect(connectionFromDescription("dnssd://Label._pdl-datastream._tcp.local/")).toEqual({
      kind: "other",
      host: null,
    });
  });
});

describe("printerConnection", () => {
  it("uses the field the Rust side reports", () => {
    const reported = printer({
      description: "ipp://10.0.4.14/printers/back_room",
      connection: { kind: "usb", host: null },
    });
    expect(printerConnection(reported)).toEqual({ kind: "usb", host: null });
  });

  it("falls back to the description while the field is absent", () => {
    expect(printerConnection(printer({ description: "usb://Label%20Printer/ZD411" }))).toEqual({
      kind: "usb",
      host: null,
    });
  });
});

describe("connectionText", () => {
  it("names a USB printer", () => {
    expect(connectionText({ kind: "usb", host: null })).toBe("USB");
  });

  it("names a network printer with its address", () => {
    expect(connectionText({ kind: "network", host: "10.0.4.14" })).toBe("Network 10.0.4.14");
  });

  it("names a network printer with no address", () => {
    expect(connectionText({ kind: "network", host: null })).toBe("Network");
  });

  it("says nothing about an unknown connection", () => {
    expect(connectionText({ kind: "other", host: null })).toBe("");
  });
});
