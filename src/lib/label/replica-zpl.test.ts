import { describe, expect, it } from "vitest";
import {
  barcodeLeftDots,
  BAR_HEIGHT_DOTS,
  buildBarcodeFieldData,
  buildReplicaZpl,
  countSymbolModules,
  DOTS_PER_INCH,
  DOTS_PER_MM,
  LABEL_HEIGHT_DOTS,
  LABEL_WIDTH_DOTS,
  MODULE_WIDTH_DOTS,
  QUIET_ZONE_MIN_DOTS,
  QUIET_ZONE_MIN_MODULES,
  splitPayloadIntoSubsets,
  symbolWidthDots,
  TEXT_HEIGHT_DOTS,
  type ReplicaLabel,
} from "./replica-zpl";

/** Converts a count of dots at 300 dpi to millimetres. */
function millimetres(dots: number): number {
  return (dots / DOTS_PER_INCH) * 25.4;
}

/** The real the facility source label. Its check character is N. */
const W483626000011: ReplicaLabel = {
  payload: "=W48362600001100",
  fin: "W4836",
  year: "26",
  sequence: "000011",
  flags: "00",
  check: "N",
  copies: 1,
};

describe("buildBarcodeFieldData", () => {
  it("starts in subset B and switches to subset C before the digits", () => {
    expect(buildBarcodeFieldData("=W48362600001100")).toBe(">:=W>548362600001100");
  });

  it("keeps one digit in subset B when the remaining digits do not pair up", () => {
    // A two letter FIN such as AB123 leaves 13 digits, and subset C only takes whole pairs.
    expect(buildBarcodeFieldData("=AB1232600001100")).toBe(">:=AB1>5232600001100");
  });
});

describe("splitPayloadIntoSubsets", () => {
  it("puts the data identifier and the FIN letter in subset B", () => {
    expect(splitPayloadIntoSubsets("=W48362600001100")).toEqual({
      subsetB: "=W",
      subsetC: "48362600001100",
    });
  });
});

describe("countSymbolModules", () => {
  it("counts the 145 modules of the the facility payload", () => {
    // Start B, `=`, `W`, the switch to subset C, and 7 digit pairs is 11 symbol characters.
    // With the check character that is 12 characters of 11 modules, plus a 13 module stop.
    expect(countSymbolModules(splitPayloadIntoSubsets("=W48362600001100"))).toBe(145);
    expect(11 * 12 + 13).toBe(145);
  });

  it("counts one symbol character per subset B character", () => {
    // Start B, four data characters, check, stop.
    expect(countSymbolModules({ subsetB: "=ABC", subsetC: "" })).toBe(11 * 6 + 13);
  });
});

describe("label geometry", () => {
  it("matches 1.75 by 0.75 inch stock at 300 dpi", () => {
    expect(DOTS_PER_INCH).toBe(300);
    expect(DOTS_PER_MM).toBe(12);
    expect(LABEL_WIDTH_DOTS).toBe(1.75 * DOTS_PER_INCH);
    expect(LABEL_HEIGHT_DOTS).toBe(0.75 * DOTS_PER_INCH);
  });

  it("prints a 0.25 mm module, the ST-001 section 6.1.3 target", () => {
    expect(millimetres(MODULE_WIDTH_DOTS)).toBeCloseTo(0.254, 3);
    expect(millimetres(MODULE_WIDTH_DOTS)).toBeGreaterThanOrEqual(0.17); // Section 6.1.3 floor.
  });

  it("fits the symbol and both quiet zones inside the label width", () => {
    const symbol = symbolWidthDots(W483626000011.payload);
    expect(symbol).toBe(145 * MODULE_WIDTH_DOTS);
    expect(symbol).toBe(435);

    const left = barcodeLeftDots(W483626000011.payload);
    const right = LABEL_WIDTH_DOTS - left - symbol;

    // Centred: the two quiet zones differ by at most the one dot that rounding can add.
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    // ST-001 section 6.1.3: at least 10 modules of quiet zone on each side.
    expect(QUIET_ZONE_MIN_DOTS).toBe(QUIET_ZONE_MIN_MODULES * MODULE_WIDTH_DOTS);
    expect(left).toBeGreaterThanOrEqual(QUIET_ZONE_MIN_DOTS);
    expect(right).toBeGreaterThanOrEqual(QUIET_ZONE_MIN_DOTS);
    expect(left + symbol + right).toBe(LABEL_WIDTH_DOTS);
  });

  it("prints bars taller than the ST-001 section 6.1.3 minimum", () => {
    const symbolLengthMm = millimetres(symbolWidthDots(W483626000011.payload));
    expect(symbolLengthMm).toBeCloseTo(36.8, 1);
    expect(millimetres(BAR_HEIGHT_DOTS)).toBeGreaterThanOrEqual(5);
    expect(millimetres(BAR_HEIGHT_DOTS)).toBeGreaterThanOrEqual(0.15 * symbolLengthMm);
  });

  it("keeps the eye-readable text near 2.5 mm", () => {
    expect(millimetres(TEXT_HEIGHT_DOTS)).toBeCloseTo(2.5, 1);
  });
});

describe("buildReplicaZpl", () => {
  const zpl = buildReplicaZpl(W483626000011);

  it("sets the label size to the loaded stock", () => {
    expect(zpl).toContain("^PW525");
    expect(zpl).toContain("^LL225");
  });

  it("sets UTF-8 input", () => {
    expect(zpl).toContain("^CI28");
  });

  it("sets the module width before the barcode", () => {
    expect(zpl.indexOf("^BY3")).toBeGreaterThan(-1);
    expect(zpl.indexOf("^BY3")).toBeLessThan(zpl.indexOf("^BC"));
  });

  it("emits the barcode in mode N with the subset invocation codes", () => {
    expect(zpl).toContain("^BCN,90,N,N,N,N^FD>:=W>548362600001100^FS");
  });

  it("centres the barcode across the label", () => {
    expect(zpl).toContain("^FO45,36^BCN");
  });

  it("prints the DIN, the flag characters, and the boxed check character", () => {
    expect(zpl).toContain("^A0N,30,30^FDW4836 26 000011^FS");
    // ^A0R turns the flag characters 90 degrees clockwise, per ST-001 section 7.4.1.
    expect(zpl).toContain("^A0R,26,26^FD00^FS");
    expect(zpl).toContain("^GB44,44,3^FS");
    expect(zpl).toContain("^A0N,30,30^FDN^FS");
  });

  it("keeps the check character out of the barcode", () => {
    const barcodeField = zpl.split("\n").find((line) => line.includes("^BC"));
    expect(barcodeField).toBeDefined();
    expect(barcodeField).not.toContain("N^FS");
    expect(barcodeField).toContain(">548362600001100");
  });

  it("leaves media darkness to the printer", () => {
    expect(zpl).not.toContain("^MD");
  });

  it("sets ^PQ from the copy count", () => {
    expect(zpl).toContain("^PQ1");
    expect(buildReplicaZpl({ ...W483626000011, copies: 7 })).toContain("^PQ7");
  });

  it("opens and closes one label format", () => {
    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl.trimEnd().endsWith("^XZ")).toBe(true);
  });

  it("prints nothing but the barcode and the eye-readable line", () => {
    const fields = zpl.split("\n").filter((line) => line.includes("^FD") || line.includes("^GB"));
    expect(fields).toHaveLength(5);
  });
});
