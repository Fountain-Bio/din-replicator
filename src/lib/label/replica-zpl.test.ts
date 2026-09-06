import { describe, expect, it } from "vitest";
import {
  BAR_HEIGHT_DOTS,
  buildBarcodeFieldData,
  buildReplicaZpl,
  chooseModuleWidthDots,
  countSymbolModules,
  DIN_TEXT_WIDTH_DOTS,
  DOTS_PER_INCH,
  DOTS_PER_MM,
  LABEL_HEIGHT_DOTS,
  LABEL_WIDTH_DOTS,
  MAX_COPIES,
  MODULE_WIDTH_CHOICES_DOTS,
  QUIET_ZONE_MIN_MODULES,
  replicaLabelGeometry,
  splitPayloadIntoSubsets,
  TEXT_HEIGHT_DOTS,
} from "./replica-zpl";

/** Converts a count of dots at 300 dpi to millimetres. */
function millimetres(dots: number): number {
  return (dots / DOTS_PER_INCH) * 25.4;
}

/** The DIN of a real source label. Its FIN starts with one letter and its K is N. */
const ONE_LETTER_FIN = "W483626000011";
/** A DIN whose FIN starts with two letters. Its K is A. */
const TWO_LETTER_FIN = "AB12326000011";
/** A DIN whose FIN starts with three letters. Its K is Y. */
const THREE_LETTER_FIN = "ABC1226000011";

/** Reads the `^FO` x coordinate of the one line of `zpl` that holds `marker`. */
function fieldOriginX(zpl: string, marker: string): number {
  const line = zpl.split("\n").find((candidate) => candidate.includes(marker));
  expect(line, `no ZPL line holds ${marker}`).toBeDefined();
  const match = /\^FO(\d+),/.exec(line!);
  expect(match, `no ^FO on the line holding ${marker}`).not.toBeNull();
  return Number(match![1]);
}

describe("buildBarcodeFieldData", () => {
  it("starts in subset B and switches to subset C before the digits", () => {
    expect(buildBarcodeFieldData("=W48362600001100")).toBe(">:=W>548362600001100");
  });

  it("keeps one digit in subset B when the remaining digits do not pair up", () => {
    // A two letter FIN leaves 13 digits, and subset C only takes whole pairs.
    expect(buildBarcodeFieldData("=AB1232600001100")).toBe(">:=AB1>5232600001100");
  });

  it("stays in subset B when the flag characters are letters", () => {
    // Subset C carries digits only, so a payload that ends in a letter never enters it.
    expect(buildBarcodeFieldData("=W4836260000110A")).toBe(">:=W4836260000110A");
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
  it("counts the 145 modules of a one letter FIN", () => {
    // Start B, `=`, `W`, the switch to subset C, and 7 digit pairs is 11 symbol characters.
    // With the check character that is 12 characters of 11 modules, plus a 13 module stop.
    expect(countSymbolModules(splitPayloadIntoSubsets("=W48362600001100"))).toBe(145);
    expect(11 * 12 + 13).toBe(145);
  });

  it("counts the 156 modules of a two letter FIN", () => {
    // The odd digit that subset C cannot pair up costs one more symbol character.
    expect(countSymbolModules(splitPayloadIntoSubsets("=AB1232600001100"))).toBe(156);
    expect(11 * 13 + 13).toBe(156);
  });

  it("counts one symbol character per subset B character", () => {
    // Start B, four data characters, check, stop.
    expect(countSymbolModules({ subsetB: "=ABC", subsetC: "" })).toBe(11 * 6 + 13);
  });
});

describe("chooseModuleWidthDots", () => {
  it("keeps the 3 dot module when the symbol and its quiet zones fit", () => {
    expect(chooseModuleWidthDots(145)).toBe(3);
    expect((145 + 2 * QUIET_ZONE_MIN_MODULES) * 3).toBeLessThanOrEqual(LABEL_WIDTH_DOTS);
  });

  it("drops to a 2 dot module when the 3 dot symbol overflows the stock", () => {
    // 156 modules at 3 dots is 468, and 468 plus two 30 dot quiet zones is 528.
    expect((156 + 2 * QUIET_ZONE_MIN_MODULES) * 3).toBeGreaterThan(LABEL_WIDTH_DOTS);
    expect(chooseModuleWidthDots(156)).toBe(2);
  });

  it("throws when even the narrowest module overflows the stock", () => {
    // 250 modules at 2 dots is 500, and the quiet zones need another 80.
    expect(() => chooseModuleWidthDots(250)).toThrow(/does not fit/);
  });

  it("offers the ST-001 section 6.1.3 module widths, widest first", () => {
    expect(MODULE_WIDTH_CHOICES_DOTS).toEqual([3, 2]);
    // 3 dots is the 0.25 mm target; 2 dots rounds to the 0.17 mm floor.
    expect(millimetres(3)).toBeCloseTo(0.254, 3);
    expect(millimetres(2)).toBeCloseTo(0.169, 3);
    expect(millimetres(2)).toBeGreaterThan(0.127);
  });
});

describe("replicaLabelGeometry", () => {
  it("prints a one letter FIN at 3 dots per module", () => {
    expect(replicaLabelGeometry(ONE_LETTER_FIN)).toEqual({
      moduleDots: 3,
      symbolModules: 145,
      symbolWidthDots: 435,
      symbolWidthMm: millimetres(435),
      quietZoneDots: 45,
    });
  });

  it("prints a two letter FIN at 2 dots per module", () => {
    expect(replicaLabelGeometry(TWO_LETTER_FIN)).toEqual({
      moduleDots: 2,
      symbolModules: 156,
      symbolWidthDots: 312,
      symbolWidthMm: millimetres(312),
      quietZoneDots: 106,
    });
  });

  it("prints a three letter FIN the same way as a two letter FIN", () => {
    expect(replicaLabelGeometry(THREE_LETTER_FIN).symbolModules).toBe(156);
    expect(replicaLabelGeometry(THREE_LETTER_FIN).moduleDots).toBe(2);
  });

  it("leaves at least 10 modules of quiet zone on each side", () => {
    for (const din of [ONE_LETTER_FIN, TWO_LETTER_FIN, THREE_LETTER_FIN]) {
      const geometry = replicaLabelGeometry(din);
      expect(geometry.quietZoneDots).toBeGreaterThanOrEqual(
        QUIET_ZONE_MIN_MODULES * geometry.moduleDots,
      );
      expect(geometry.symbolWidthDots + 2 * geometry.quietZoneDots).toBeLessThanOrEqual(
        LABEL_WIDTH_DOTS,
      );
    }
  });

  it("rejects a DIN that breaks the structure rules", () => {
    expect(() => replicaLabelGeometry("TOO-SHORT")).toThrow();
  });
});

describe("label geometry", () => {
  it("matches 1.75 by 0.75 inch stock at 300 dpi", () => {
    expect(DOTS_PER_INCH).toBe(300);
    expect(DOTS_PER_MM).toBe(12);
    expect(LABEL_WIDTH_DOTS).toBe(1.75 * DOTS_PER_INCH);
    expect(LABEL_HEIGHT_DOTS).toBe(0.75 * DOTS_PER_INCH);
  });

  it("prints bars taller than the ST-001 section 6.1.3 minimum", () => {
    for (const din of [ONE_LETTER_FIN, TWO_LETTER_FIN]) {
      const symbolLengthMm = replicaLabelGeometry(din).symbolWidthMm;
      expect(millimetres(BAR_HEIGHT_DOTS)).toBeGreaterThanOrEqual(5);
      expect(millimetres(BAR_HEIGHT_DOTS)).toBeGreaterThanOrEqual(0.15 * symbolLengthMm);
    }
  });

  it("keeps the eye-readable text near 2.5 mm", () => {
    expect(millimetres(TEXT_HEIGHT_DOTS)).toBeCloseTo(2.5, 1);
  });
});

describe("buildReplicaZpl", () => {
  const zpl = buildReplicaZpl({ din: ONE_LETTER_FIN, copies: 1 });

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

  it("opens and closes one label format", () => {
    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl.trimEnd().endsWith("^XZ")).toBe(true);
  });

  it("prints nothing but the barcode and the eye-readable line", () => {
    const fields = zpl.split("\n").filter((line) => line.includes("^FD") || line.includes("^GB"));
    expect(fields).toHaveLength(5);
  });

  it("builds the barcode and the text from the same DIN", () => {
    const twoLetter = buildReplicaZpl({ din: TWO_LETTER_FIN, copies: 1 });
    expect(twoLetter).toContain("^BY2");
    expect(twoLetter).toContain("^FD>:=AB1>5232600001100^FS");
    expect(twoLetter).toContain("^FDAB123 26 000011^FS");
    expect(twoLetter).toContain("^FDA^FS"); // The check character for this DIN.
  });

  it("uses the flag characters it was given", () => {
    const flagged = buildReplicaZpl({ din: ONE_LETTER_FIN, copies: 1, flags: "07" });
    expect(flagged).toContain("^FD>:=W>548362600001107^FS");
    expect(flagged).toContain("^A0R,26,26^FD07^FS");
  });

  it("rejects a DIN that breaks the structure rules", () => {
    expect(() => buildReplicaZpl({ din: "W48362600001", copies: 1 })).toThrow();
  });

  it("rejects flag characters outside the ST-001 set", () => {
    expect(() => buildReplicaZpl({ din: ONE_LETTER_FIN, copies: 1, flags: "0" })).toThrow();
    expect(() => buildReplicaZpl({ din: ONE_LETTER_FIN, copies: 1, flags: "OI" })).toThrow();
  });
});

describe("copy count", () => {
  it("sets ^PQ from the copy count", () => {
    expect(buildReplicaZpl({ din: ONE_LETTER_FIN, copies: 1 })).toContain("^PQ1");
    expect(buildReplicaZpl({ din: ONE_LETTER_FIN, copies: 7 })).toContain("^PQ7");
    expect(buildReplicaZpl({ din: ONE_LETTER_FIN, copies: MAX_COPIES })).toContain("^PQ999");
  });

  it("rejects a count outside 1 to 999", () => {
    for (const copies of [0, -1, 1000, 1.5, Number.NaN]) {
      expect(() => buildReplicaZpl({ din: ONE_LETTER_FIN, copies })).toThrow(/Copy count/);
    }
  });
});

describe("eye-readable line width", () => {
  // Font 0 is proportional, so the printed DIN is only as wide as its own characters. The
  // layout reserves room for the widest DIN that can exist instead: 13 glyphs at the widest
  // advance font 0 reaches at a 30 dot height, plus the two spaces in the text.
  const ESTIMATED_MAX_GLYPH_DOTS = 24;
  const ESTIMATED_SPACE_DOTS = 7;
  const worstCaseTextDots = 13 * ESTIMATED_MAX_GLYPH_DOTS + 2 * ESTIMATED_SPACE_DOTS;

  it("reserves at least the widest DIN's width for the DIN", () => {
    expect(DIN_TEXT_WIDTH_DOTS).toBeGreaterThanOrEqual(worstCaseTextDots);
  });

  it("keeps the flag characters clear of the widest DIN, whatever the module width", () => {
    for (const din of [ONE_LETTER_FIN, TWO_LETTER_FIN, THREE_LETTER_FIN]) {
      const zpl = buildReplicaZpl({ din, copies: 1 });
      const textLeft = fieldOriginX(zpl, "^A0N,30,30^FD" + din.slice(0, 3));
      const flagsLeft = fieldOriginX(zpl, "^A0R,");
      expect(flagsLeft - textLeft).toBeGreaterThanOrEqual(worstCaseTextDots);
    }
  });

  it("keeps the whole eye-readable line inside the label", () => {
    for (const din of [ONE_LETTER_FIN, TWO_LETTER_FIN, THREE_LETTER_FIN]) {
      const zpl = buildReplicaZpl({ din, copies: 1 });
      expect(fieldOriginX(zpl, "^A0N,30,30^FD" + din.slice(0, 3))).toBeGreaterThanOrEqual(0);
      expect(fieldOriginX(zpl, "^GB44,44,3") + 44).toBeLessThanOrEqual(LABEL_WIDTH_DOTS);
    }
  });

  it("puts the box under the last bar when the bars are the wider of the two", () => {
    const zpl = buildReplicaZpl({ din: ONE_LETTER_FIN, copies: 1 });
    const geometry = replicaLabelGeometry(ONE_LETTER_FIN);
    const barcodeLeft = fieldOriginX(zpl, "^BCN");
    expect(fieldOriginX(zpl, "^GB44,44,3") + 44).toBe(barcodeLeft + geometry.symbolWidthDots);
  });
});
