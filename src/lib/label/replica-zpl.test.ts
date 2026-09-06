import { describe, expect, it } from "vitest";
import { eyeReadable } from "../isbt128";
import { BUNDLED_LABEL_FONTS, LABEL_CHARACTERS } from "./fonts";
import {
  BAR_HEIGHT_DOTS,
  buildBarcodeFieldData,
  buildReplicaZpl,
  capHeightDots,
  chooseFontHeightDots,
  chooseModuleWidthDots,
  countSymbolModules,
  DARKNESS_MAX,
  DARKNESS_MIN,
  DEFAULT_PRINT_SETTINGS,
  DIN_TEXT_WIDTH_DOTS,
  DIN_TO_FLAGS_GAP_DOTS,
  dinTextWidthDots,
  DOTS_PER_INCH,
  DOTS_PER_MM,
  eyeReadableLineWidthDots,
  FLAGS_TO_BOX_GAP_DOTS,
  FONT_HEIGHT_CHOICES_DOTS,
  LABEL_HEIGHT_DOTS,
  LABEL_WIDTH_DOTS,
  LEFT_MARGIN_DOTS,
  MAX_COPIES,
  MODULE_WIDTH_CHOICES_DOTS,
  OFFSET_DOTS_MAX,
  OFFSET_DOTS_MIN,
  QUIET_ZONE_MIN_MODULES,
  replicaLabelGeometry,
  rotatedInkLeftOffsetDots,
  SPEED_IPS_MAX,
  SPEED_IPS_MIN,
  splitPayloadIntoSubsets,
  WIDEST_DIN_TEXT,
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
const EVERY_FIN_SHAPE = [ONE_LETTER_FIN, TWO_LETTER_FIN, THREE_LETTER_FIN];

/** Reads the `^FO` x coordinate of the one line of `zpl` that holds `marker`. */
function fieldOriginX(zpl: string, marker: string): number {
  const line = zpl.split("\n").find((candidate) => candidate.includes(marker));
  expect(line, `no ZPL line holds ${marker}`).toBeDefined();
  const match = /\^FO(\d+),/.exec(line!);
  expect(match, `no ^FO on the line holding ${marker}`).not.toBeNull();
  return Number(match![1]);
}

/** Reads the font height the eye-readable line was set in. */
function fontHeight(zpl: string): number {
  return Number(/\^A0N,(\d+),/.exec(zpl)![1]);
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
    for (const din of EVERY_FIN_SHAPE) {
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
    expect(BAR_HEIGHT_DOTS).toBe(110);
    expect(millimetres(BAR_HEIGHT_DOTS)).toBeCloseTo(9.3, 1);
    for (const din of EVERY_FIN_SHAPE) {
      const symbolLengthMm = replicaLabelGeometry(din).symbolWidthMm;
      expect(millimetres(BAR_HEIGHT_DOTS)).toBeGreaterThanOrEqual(5);
      expect(millimetres(BAR_HEIGHT_DOTS)).toBeGreaterThanOrEqual(0.15 * symbolLengthMm);
    }
  });

  it("stands the bars about three times the cap height of the text", () => {
    for (const din of EVERY_FIN_SHAPE) {
      const capHeight = capHeightDots(fontHeight(buildReplicaZpl({ din, copies: 1 })));
      expect(BAR_HEIGHT_DOTS / capHeight).toBeGreaterThan(2.5);
      expect(BAR_HEIGHT_DOTS / capHeight).toBeLessThan(4);
    }
  });
});

describe("dinTextWidthDots", () => {
  it("matches the width the renderer draws to within a dot", () => {
    // Measured from rendered text: 214 dots ink at font height 30, 358 at 50.
    expect(dinTextWidthDots("W4836 26 000011", 30)).toBeCloseTo(214, -0.5);
    expect(dinTextWidthDots("W4836 26 000011", 50)).toBeCloseTo(358, -0.5);
    expect(Math.abs(dinTextWidthDots("W4836 26 000011", 30) - 214)).toBeLessThanOrEqual(1);
    expect(Math.abs(dinTextWidthDots("W4836 26 000011", 50) - 358)).toBeLessThanOrEqual(1);
  });

  it("grows with the font height", () => {
    const text = "W4836 26 000011";
    for (let i = 1; i < FONT_HEIGHT_CHOICES_DOTS.length; i += 1) {
      expect(dinTextWidthDots(text, FONT_HEIGHT_CHOICES_DOTS[i - 1]!)).toBeGreaterThan(
        dinTextWidthDots(text, FONT_HEIGHT_CHOICES_DOTS[i]!),
      );
    }
  });

  it("treats an unlisted character as the widest one", () => {
    // `W` is the widest character font 0 draws, so nothing can measure wider per character.
    expect(dinTextWidthDots("@@@", 30)).toBe(dinTextWidthDots("WWW", 30));
  });
});

describe("the widest DIN the structure rules allow", () => {
  it("is three wide letters and ten digits", () => {
    expect(WIDEST_DIN_TEXT).toBe("WWW99 99 999999");
    // Any real DIN text is 13 characters and two spaces, and none is wider than this one.
    for (const din of EVERY_FIN_SHAPE) {
      const text = eyeReadable(din).text;
      expect(text).toHaveLength(WIDEST_DIN_TEXT.length);
      expect(dinTextWidthDots(text, 30)).toBeLessThanOrEqual(DIN_TEXT_WIDTH_DOTS);
    }
  });

  it("still fits on the narrowest bar code this app prints", () => {
    // 156 modules at 2 dots leaves the smallest right edge any label gets.
    const geometry = replicaLabelGeometry(TWO_LETTER_FIN);
    const lineRight = geometry.quietZoneDots + geometry.symbolWidthDots;
    expect(chooseFontHeightDots(WIDEST_DIN_TEXT, lineRight)).toBeGreaterThanOrEqual(30);
    expect(eyeReadableLineWidthDots(WIDEST_DIN_TEXT, 30)).toBeLessThanOrEqual(
      lineRight - LEFT_MARGIN_DOTS,
    );
  });
});

describe("chooseFontHeightDots", () => {
  it("takes the tallest font whose line still clears the left margin", () => {
    expect(FONT_HEIGHT_CHOICES_DOTS).toEqual([50, 46, 42, 38, 34, 30, 26]);
    expect(chooseFontHeightDots("W4836 26 000011", 480)).toBe(46);
    expect(chooseFontHeightDots("AB123 26 000011", 419)).toBe(38);
  });

  it("shrinks the font as the line loses room", () => {
    const text = "W4836 26 000011";
    expect(chooseFontHeightDots(text, 480)).toBeGreaterThan(chooseFontHeightDots(text, 400));
  });

  it("throws when the line does not fit at any font height", () => {
    expect(() => chooseFontHeightDots(WIDEST_DIN_TEXT, 200)).toThrow(/does not fit/);
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
    expect(zpl).toContain("^BCN,110,N,N,N,N^FD>:=W>548362600001100^FS");
  });

  it("centres the barcode across the label", () => {
    expect(zpl).toContain("^FO45,24^BCN");
  });

  it("prints the DIN, the flag characters, and the boxed check character", () => {
    expect(zpl).toContain("^A0N,46,46^FDW4836 26 000011^FS");
    // ^A0R turns the flag characters 90 degrees clockwise, per ST-001 section 7.4.1.
    expect(zpl).toContain("^A0R,46,46^FD00^FS");
    // ST-001 section 7.5.1.1 requires the box, and ^FB centres the character inside it.
    expect(zpl).toContain("^GB56,56,3^FS");
    expect(zpl).toContain("^A0N,46,46^FB56,1,0,C,0^FDN^FS");
  });

  it("sets the DIN and the flag characters in one font at one size", () => {
    const sizes = [...zpl.matchAll(/\^A0[NR],(\d+),(\d+)/g)].map((m) => `${m[1]}x${m[2]}`);
    expect(new Set(sizes)).toEqual(new Set(["46x46"]));
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

  it("opens and closes one label format after the session commands", () => {
    const lines = zpl.trimEnd().split("\n");
    expect(lines.filter((line) => line.startsWith("^XA"))).toHaveLength(1);
    expect(lines[lines.indexOf("^XA") - 1]).toMatch(/^~SD\d\d$/);
    expect(lines[lines.length - 1]).toBe("^XZ");
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
    expect(flagged).toContain("^A0R,46,46^FD07^FS");
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

describe("the eye-readable line", () => {
  it("ends the box on the right end of the bars", () => {
    for (const din of EVERY_FIN_SHAPE) {
      const zpl = buildReplicaZpl({ din, copies: 1 });
      const geometry = replicaLabelGeometry(din);
      const barcodeLeft = fieldOriginX(zpl, "^BCN");
      expect(fieldOriginX(zpl, "^GB56,56,3") + 56).toBe(barcodeLeft + geometry.symbolWidthDots);
    }
  });

  it("starts no further left than the margin", () => {
    for (const din of EVERY_FIN_SHAPE) {
      const zpl = buildReplicaZpl({ din, copies: 1 });
      expect(fieldOriginX(zpl, "^A0N," + fontHeight(zpl) + ",")).toBeGreaterThanOrEqual(
        LEFT_MARGIN_DOTS,
      );
    }
  });

  it("packs the DIN, the flag characters, and the box in that order without overlap", () => {
    for (const din of EVERY_FIN_SHAPE) {
      const zpl = buildReplicaZpl({ din, copies: 1 });
      const height = fontHeight(zpl);
      const dinLeft = fieldOriginX(zpl, "^FD" + eyeReadable(din).text);
      const flagsLeft = fieldOriginX(zpl, "^A0R,");
      const boxLeft = fieldOriginX(zpl, "^GB56,56,3");

      const dinRight = dinLeft + dinTextWidthDots(eyeReadable(din).text, height);
      const flagsInkLeft = flagsLeft + rotatedInkLeftOffsetDots(height);
      // The three parts sit at the gaps the layout names, whatever the font height.
      expect(flagsInkLeft - dinRight).toBe(DIN_TO_FLAGS_GAP_DOTS);
      expect(boxLeft - (flagsInkLeft + capHeightDots(height))).toBe(FLAGS_TO_BOX_GAP_DOTS);
    }
  });

  it("fits the whole label from the top margin to the bottom edge", () => {
    for (const din of EVERY_FIN_SHAPE) {
      const zpl = buildReplicaZpl({ din, copies: 1 });
      const boxLine = zpl.split("\n").find((line) => line.includes("^GB"))!;
      const boxTop = Number(/\^FO\d+,(\d+)/.exec(boxLine)![1]);
      const barcodeTop = Number(/\^FO\d+,(\d+)\^BCN/.exec(zpl)![1]);
      expect(barcodeTop).toBe(24);
      // ST-001 section 6.1.3: nothing prints in contact with the top or bottom of the bars.
      expect(boxTop).toBeGreaterThan(barcodeTop + BAR_HEIGHT_DOTS);
      expect(boxTop + 56).toBeLessThanOrEqual(LABEL_HEIGHT_DOTS);
      // The content is centred: the space above the bars matches the space below the box
      // to within a dot.
      expect(Math.abs(barcodeTop - (LABEL_HEIGHT_DOTS - (boxTop + 56)))).toBeLessThanOrEqual(1);
    }
  });
});

describe("print settings", () => {
  it("defaults to thermal transfer, darkness 16, 2 inches per second, and no shift", () => {
    expect(DEFAULT_PRINT_SETTINGS).toEqual({
      printMethod: "thermalTransfer",
      darkness: 16,
      speedIps: 2,
      verticalOffsetDots: 0,
      horizontalOffsetDots: 0,
    });
    const zpl = buildReplicaZpl({ din: ONE_LETTER_FIN, copies: 1 });
    expect(zpl.split("\n").slice(0, 5)).toEqual(["~SD16", "^XA", "^CI28", "^MTT", "^PR2,2,2"]);
  });

  it("switches the media type for direct thermal", () => {
    const zpl = buildReplicaZpl({
      din: ONE_LETTER_FIN,
      copies: 1,
      printSettings: {
        ...DEFAULT_PRINT_SETTINGS,
        printMethod: "directThermal",
        darkness: 8,
        speedIps: 6,
      },
    });
    expect(zpl.split("\n").slice(0, 5)).toEqual(["~SD08", "^XA", "^CI28", "^MTD", "^PR6,6,6"]);
  });

  it("keeps ~SD outside the label format, where the printer expects a control command", () => {
    const zpl = buildReplicaZpl({ din: ONE_LETTER_FIN, copies: 1 });
    const body = zpl.slice(zpl.indexOf("^XA"));
    expect(body).not.toContain("~SD");
    // ^MD would be added to ~SD, so the label leaves it alone.
    expect(zpl).not.toContain("^MD");
  });

  it("pads the darkness to the two digits ~SD takes", () => {
    for (const darkness of [DARKNESS_MIN, 5, DARKNESS_MAX]) {
      const zpl = buildReplicaZpl({
        din: ONE_LETTER_FIN,
        copies: 1,
        printSettings: { ...DEFAULT_PRINT_SETTINGS, darkness },
      });
      expect(zpl.split("\n")[0]).toBe(`~SD${String(darkness).padStart(2, "0")}`);
    }
  });

  it("rejects a darkness outside 0 to 30", () => {
    for (const darkness of [-1, 31, 16.5, Number.NaN]) {
      expect(() =>
        buildReplicaZpl({
          din: ONE_LETTER_FIN,
          copies: 1,
          printSettings: { ...DEFAULT_PRINT_SETTINGS, darkness },
        }),
      ).toThrow(/Darkness/);
    }
  });

  it("rejects a speed outside 2 to 6 inches per second", () => {
    for (const speedIps of [SPEED_IPS_MIN - 1, SPEED_IPS_MAX + 1, 3.5, Number.NaN]) {
      expect(() =>
        buildReplicaZpl({
          din: ONE_LETTER_FIN,
          copies: 1,
          printSettings: { ...DEFAULT_PRINT_SETTINGS, speedIps },
        }),
      ).toThrow(/Print speed/);
    }
  });

  it("moves the whole format on the stock by the print position offsets", () => {
    const zpl = buildReplicaZpl({
      din: ONE_LETTER_FIN,
      copies: 1,
      printSettings: { ...DEFAULT_PRINT_SETTINGS, verticalOffsetDots: 24, horizontalOffsetDots: 9 },
    });
    const lines = zpl.split("\n");

    // Both sit inside the format, straight after the label length, which is before the first
    // ^FS as ^LS requires.
    expect(lines[lines.indexOf(`^LL${LABEL_HEIGHT_DOTS}`) + 1]).toBe("^LT24");
    expect(lines[lines.indexOf(`^LL${LABEL_HEIGHT_DOTS}`) + 2]).toBe("^LS-9");
    expect(zpl.indexOf("^LS")).toBeLessThan(zpl.indexOf("^FS"));
  });

  it("turns the horizontal offset over, because ^LS shifts left", () => {
    for (const [horizontalOffsetDots, expected] of [
      [0, "^LS0"],
      [12, "^LS-12"],
      [-12, "^LS12"],
    ] as const) {
      const zpl = buildReplicaZpl({
        din: ONE_LETTER_FIN,
        copies: 1,
        printSettings: { ...DEFAULT_PRINT_SETTINGS, horizontalOffsetDots },
      });
      expect(zpl.split("\n")).toContain(expected);
    }
  });

  it("sends both offsets even when neither moves anything", () => {
    // ^LS holds until the printer is switched off, so a label that leaves it out would
    // inherit whatever the last one set.
    const zpl = buildReplicaZpl({ din: ONE_LETTER_FIN, copies: 1 });

    expect(zpl.split("\n")).toContain("^LT0");
    expect(zpl.split("\n")).toContain("^LS0");
  });

  it("rejects a print position outside the range the app allows", () => {
    for (const offset of [OFFSET_DOTS_MIN - 1, OFFSET_DOTS_MAX + 1, 2.5, Number.NaN]) {
      expect(() =>
        buildReplicaZpl({
          din: ONE_LETTER_FIN,
          copies: 1,
          printSettings: { ...DEFAULT_PRINT_SETTINGS, verticalOffsetDots: offset },
        }),
      ).toThrow(/Vertical position/);
      expect(() =>
        buildReplicaZpl({
          din: ONE_LETTER_FIN,
          copies: 1,
          printSettings: { ...DEFAULT_PRINT_SETTINGS, horizontalOffsetDots: offset },
        }),
      ).toThrow(/Horizontal position/);
    }
  });

  it("rejects a print method the printer does not have", () => {
    expect(() =>
      buildReplicaZpl({
        din: ONE_LETTER_FIN,
        copies: 1,
        printSettings: {
          ...DEFAULT_PRINT_SETTINGS,
          printMethod: "inkjet" as unknown as typeof DEFAULT_PRINT_SETTINGS.printMethod,
        },
      }),
    ).toThrow(/Print method/);
  });
});

describe("the label font", () => {
  /** The `~DU` download lines in `zpl`, which carry a bundled font to the printer. */
  function downloadCommands(zpl: string): string[] {
    return zpl.split("\n").filter((line) => line.startsWith("~DU"));
  }

  /** The font each text field names, in the order the fields are written. */
  function fontReferences(zpl: string): string[] {
    return [...zpl.matchAll(/\^A[0@][NR],\d+,\d+(?:,[^^]+)?/g)].map((match) => match[0]);
  }

  it("prints in the printer's own font when nobody chooses one", () => {
    for (const din of EVERY_FIN_SHAPE) {
      expect(buildReplicaZpl({ din, copies: 1 })).toBe(
        buildReplicaZpl({ din, copies: 1, labelFont: "printer" }),
      );
    }
  });

  it("sends nothing extra to the printer for the printer's own font", () => {
    const zpl = buildReplicaZpl({ din: ONE_LETTER_FIN, copies: 1, labelFont: "printer" });

    expect(downloadCommands(zpl)).toEqual([]);
    expect(fontReferences(zpl)).toEqual([
      `^A0N,${fontHeight(zpl)},${fontHeight(zpl)}`,
      `^A0R,${fontHeight(zpl)},${fontHeight(zpl)}`,
      `^A0N,${fontHeight(zpl)},${fontHeight(zpl)}`,
    ]);
  });

  for (const labelFont of ["sans", "mono"] as const) {
    const font = BUNDLED_LABEL_FONTS[labelFont];

    describe(font.displayName, () => {
      const zpl = buildReplicaZpl({ din: ONE_LETTER_FIN, copies: 1, labelFont });

      it("goes down to the printer once, ahead of the label format", () => {
        const downloads = downloadCommands(zpl);

        expect(downloads).toHaveLength(1);
        expect(zpl.indexOf(downloads[0]!)).toBeLessThan(zpl.indexOf("^XA"));
      });

      it("tells the printer how many bytes it is about to read", () => {
        const [path, byteCount, data] = downloadCommands(zpl)[0]!.slice("~DU".length).split(",");

        expect(path).toBe(font.zplPath);
        expect(Number(byteCount)).toBe(font.byteCount);
        // Two hexadecimal digits carry one byte, so the data is twice as long.
        expect(data).toHaveLength(font.byteCount * 2);
        expect(data).toMatch(/^[0-9A-F]+$/);
      });

      it("is named by all three text fields", () => {
        const height = Number(/\^A@N,(\d+),/.exec(zpl)![1]);

        expect(fontReferences(zpl)).toEqual([
          `^A@N,${height},${height},${font.zplPath}`,
          `^A@R,${height},${height},${font.zplPath}`,
          `^A@N,${height},${height},${font.zplPath}`,
        ]);
        expect(zpl).not.toContain("^A0");
      });

      it("places the check character itself rather than through a field block", () => {
        // The printer's own note on `~DU` says `^FB` does not work with a
        // downloaded font, so the check character is centred by measurement.
        expect(zpl).not.toContain("^FB");
      });

      it("holds a glyph for every character a label can show", () => {
        for (const character of LABEL_CHARACTERS) {
          expect(font.glyphs[character], `no glyph for "${character}"`).toBeDefined();
        }
      });

      it("leaves the widest DIN a font height that fits", () => {
        // 156 modules at 2 dots leaves the smallest right edge any label gets.
        const geometry = replicaLabelGeometry(TWO_LETTER_FIN);
        const lineRight = geometry.quietZoneDots + geometry.symbolWidthDots;
        const height = chooseFontHeightDots(WIDEST_DIN_TEXT, lineRight, labelFont);

        expect(FONT_HEIGHT_CHOICES_DOTS).toContain(height);
        expect(eyeReadableLineWidthDots(WIDEST_DIN_TEXT, height, labelFont)).toBeLessThanOrEqual(
          lineRight - LEFT_MARGIN_DOTS,
        );
      });

      it("keeps every shape of DIN inside the label", () => {
        for (const din of EVERY_FIN_SHAPE) {
          const built = buildReplicaZpl({ din, copies: 1, labelFont });
          const text = eyeReadable(din);
          const height = Number(/\^A@N,(\d+),/.exec(built)![1]);

          expect(fieldOriginX(built, `^FD${text.text}^FS`)).toBeGreaterThanOrEqual(
            LEFT_MARGIN_DOTS - dinTextWidthDots(text.text, height, labelFont),
          );
          expect(built).toContain(`^FD${text.text}^FS`);
          expect(built).toContain(`^FD${text.flags}^FS`);
          expect(built).toContain(`^FD${text.check}^FS`);
        }
      });
    });
  }
});
