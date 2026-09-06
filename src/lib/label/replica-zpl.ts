/**
 * ZPL for the replica label.
 *
 * The app prints replicas on a Zebra ZD411t at 300 dpi on 1.75 by 0.75 inch label stock.
 * A replica carries the same barcode payload and eye-readable text as its source label, so
 * the layout copies what the source labels show: a Code 128 barcode across the top, and one
 * line under it holding the DIN, the flag characters turned on their side, and the check
 * character inside a box.
 *
 * Every geometry and layout rule cited here comes from ICCBBA ST-001 v6.2.2.
 * The caller passes a DIN. This file asks `../isbt128` for the barcode payload and the
 * eye-readable text, so the barcode and the text can never disagree.
 */

import { barcodePayload, eyeReadable } from "../isbt128";
import {
  bundledCapHeightDots,
  bundledLabelFont,
  bundledRotatedInkLeftDots,
  bundledTextLeftBearingDots,
  bundledTextWidthDots,
  bundledUprightInkTopDots,
  DEFAULT_LABEL_FONT,
  fontCommand,
  fontDownloadCommand,
  type LabelFont,
} from "./fonts";

/** Print resolution of the ZD411t. Every dot measurement in this file is at 300 dpi. */
export const DOTS_PER_INCH = 300;

/**
 * Print resolution in dots per millimetre. A 300 dpi head is really 11.81 dots/mm, and both
 * Zebra and the zebrash preview renderer call it 12. Millimetre figures in the comments are
 * worked out from 300 dpi rather than from this rounded number.
 */
export const DOTS_PER_MM = 12;

/** Label stock width: 1.75 inch. */
export const LABEL_WIDTH_MM = 44.45;
/** Label stock height: 0.75 inch. */
export const LABEL_HEIGHT_MM = 19.05;

/** Label stock width in dots. 1.75 in at 300 dpi. */
export const LABEL_WIDTH_DOTS = 525;
/** Label stock height in dots. 0.75 in at 300 dpi. */
export const LABEL_HEIGHT_DOTS = 225;

/**
 * Module widths this app will print, widest first.
 *
 * Three dots at 300 dpi is 0.254 mm, the target X dimension ST-001 section 6.1.3 gives for a
 * container label. Two dots is 0.169 mm, which rounds to the 0.17 mm floor the same section
 * sets, and sits well above the 0.127 mm the section allows once a facility has checked the
 * dimension against its own readers.
 *
 * A DIN whose FIN starts with two or three letters needs 156 modules rather than 145, and
 * 156 modules at three dots does not leave room for the quiet zones on 1.75 inch stock. Those
 * labels drop to two dots per module.
 */
export const MODULE_WIDTH_CHOICES_DOTS = [3, 2] as const;

/**
 * Smallest quiet zone the symbol may have on each side. ST-001 section 6.1.3 sets it at ten
 * times the X dimension.
 */
export const QUIET_ZONE_MIN_MODULES = 10;

/**
 * Height of the bars in dots. 110 dots at 300 dpi is 9.3 mm, and the bars stand about three
 * times the cap height of the text below them, matching the source labels. ST-001 section
 * 6.1.3 asks for at least 5 mm, or 15 percent of the bar code length if that is greater. The
 * longest symbol this app prints is 145 modules at 0.254 mm, which is 36.8 mm, and 15 percent
 * of that is 5.5 mm.
 */
export const BAR_HEIGHT_DOTS = 110;

/**
 * Distance from the top edge of the label to the top of the bars. The bars, the gap, and
 * the eye-readable line together are 176 dots tall, so 24 dots above them leaves 25 below
 * and the content sits centred on the 225 dot label.
 */
const BARCODE_TOP_DOTS = 24;

/**
 * Gap between the bottom of the bars and the top of the eye-readable line. ST-001 section
 * 6.1.3 allows no printing in direct contact with the top or bottom of the bar code.
 */
const BAR_TO_LINE_GAP_DOTS = 10;

/**
 * White space between the ink of the DIN and the ink of the rotated flag characters.
 *
 * 16 dots at 300 dpi is 1.4 mm. A narrower gap reads as part of the DIN, which is what the
 * first printed replicas showed: the flag characters looked like two more digits on the end
 * of the donation number.
 */
export const DIN_TO_FLAGS_GAP_DOTS = 16;

/**
 * White space between the ink of the rotated flag characters and the left edge of the box
 * around the check character. 12 dots at 300 dpi is 1.0 mm.
 */
export const FLAGS_TO_BOX_GAP_DOTS = 12;

/** White space the eye-readable line leaves at the left edge of the label. */
export const LEFT_MARGIN_DOTS = 20;

/**
 * Font heights the eye-readable line may use, tallest first.
 *
 * The line has to reach from the left margin to the right end of the bars, and a DIN with
 * wide characters or a narrow bar code needs a smaller font to get there. `buildReplicaZpl`
 * takes the first height on this list whose line fits.
 *
 * The last height is only ever reached by the worst case the ISBT 128 structure rules allow:
 * a FIN of three wide letters, printed in a bundled font on the narrowest bar code this app
 * prints. Every DIN a facility has issued so far lands well above it.
 */
export const FONT_HEIGHT_CHOICES_DOTS = [50, 46, 42, 38, 34, 30, 26] as const;

/**
 * How wide each character of ZPL font 0 is, as a fraction of the font height.
 *
 * Font 0 is proportional, so the printed DIN is only as wide as its own characters. These
 * ratios come from rendering every character a DIN can hold at font heights 30 and 50 and
 * measuring the advance; the two sets agree, so the ratios hold at every height in between.
 *
 * The printer's font 0 is CG Triumvirate Bold Condensed, which is narrower than the face the
 * preview renderer draws. Sizing the line from the preview's measurements therefore leaves
 * the printed line a little narrower than planned, never wider.
 */
const GLYPH_ADVANCE_RATIO: Record<string, number> = {
  ...Object.fromEntries([..."0123456789EFLTZ"].map((c) => [c, 0.5])),
  ...Object.fromEntries([..."ABCKPSVXY"].map((c) => [c, 0.556])),
  ...Object.fromEntries([..."DGHNQRU"].map((c) => [c, 0.611])),
  I: 0.278,
  J: 0.444,
  M: 0.778,
  W: 0.833,
};

/** Advance of a character this table does not list. `W` is the widest font 0 gets. */
const WIDEST_ADVANCE_RATIO = 0.833;

/** Advance of a space in ZPL font 0, as a fraction of the font height. */
const SPACE_ADVANCE_RATIO = 0.234;

/**
 * White space ZPL font 0 leaves after the last character of a field, as a fraction of the font
 * height. An advance carries this trailing side bearing, but the ink stops before it, so the
 * last character's share comes off the width of a whole string.
 */
const TRAILING_BEARING_RATIO = 0.155;

/**
 * Height of a capital letter in ZPL font 0, as a fraction of the font height. The rotated flag
 * characters lie on their side, so this is also how far across the label they reach.
 */
const CAP_HEIGHT_RATIO = 0.78;

/** How far a rotated field's ink sits right of its `^FO` origin, as a fraction of the height. */
const ROTATED_INK_LEFT_RATIO = 0.22;

/** How far below its `^FO` origin a rotated field's ink starts. */
const ROTATED_INK_TOP_DOTS = 2;

/** How far the two rotated flag characters reach down the label, as a fraction of the height. */
const ROTATED_INK_HEIGHT_RATIO = 0.91;

/** How far above its `^FO` origin an upright field's ink starts. */
const UPRIGHT_INK_TOP_DOTS = 2;

/** Outside size of the box that holds the check character. */
const CHECK_BOX_SIZE_DOTS = 56;
/** Line thickness of the box that holds the check character. */
const CHECK_BOX_THICKNESS_DOTS = 3;

/** The eye-readable text of the widest DIN the ISBT 128 structure rules allow. */
export const WIDEST_DIN_TEXT = "WWW99 99 999999";

/**
 * Width of the widest possible DIN at the smallest font this app will use. Every DIN prints
 * at this width or less, so a line that has room for it has room for any DIN.
 */
export const DIN_TEXT_WIDTH_DOTS = dinTextWidthDots(WIDEST_DIN_TEXT, 30);

/**
 * How the printer puts ink on the label. The ZD411t on this desk is a thermal transfer
 * printer, so it needs a ribbon and prints faint when it is left in direct thermal mode.
 */
export type PrintMethod = "thermalTransfer" | "directThermal";

/** Printer settings the app sends with every label. */
export interface PrintSettings {
  /** Thermal transfer uses a ribbon. Direct thermal marks heat-sensitive stock instead. */
  printMethod: PrintMethod;
  /** Absolute darkness, 0 to 30. Higher burns more, which darkens the bars and the text. */
  darkness: number;
  /** Print speed in whole inches per second, 2 to 6. Slower gives crisper bar edges. */
  speedIps: number;
  /**
   * How far down the label the whole printed image is moved, in dots. Negative moves it up.
   * This corrects where the printer starts printing on the stock, not where the layout puts
   * anything on the label.
   */
  verticalOffsetDots: number;
  /** How far right along the label the whole printed image is moved, in dots. */
  horizontalOffsetDots: number;
}

/** Smallest and largest darkness the `~SD` command takes. */
export const DARKNESS_MIN = 0;
export const DARKNESS_MAX = 30;

/** Smallest and largest print speed the ZD411t takes, in whole inches per second. */
export const SPEED_IPS_MIN = 2;
export const SPEED_IPS_MAX = 6;

/**
 * How far the app will move the printed image on the stock, in dots.
 *
 * A hundred dots at 300 dpi is a third of an inch, which is further than a correctly loaded
 * roll is ever out by, and a larger shift would push the bar code off the label. The printer
 * itself accepts more than this in both directions.
 */
export const OFFSET_DOTS_MIN = -100;
export const OFFSET_DOTS_MAX = 100;

/**
 * What the app sends when the caller names no settings. The ZD411t prints faint on this label
 * stock at its factory darkness, so the default asks for more heat and a slower pass.
 */
export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  printMethod: "thermalTransfer",
  darkness: 16,
  speedIps: 3,
  verticalOffsetDots: 0,
  horizontalOffsetDots: 0,
};

/** ZPL media type letter for each print method. */
const MEDIA_TYPE_LETTER: Record<PrintMethod, string> = {
  thermalTransfer: "T",
  directThermal: "D",
};

/** Largest copy count the app will send. A run longer than this is a mistake, not a request. */
export const MAX_COPIES = 999;

/**
 * ZPL invocation code that starts Code 128 subset B inside an `^FD` field. `>` is the default
 * ZPL invocation delimiter, and `:` selects start character B.
 */
const START_SUBSET_B = ">:";
/**
 * ZPL invocation code that switches to Code 128 subset C part way through a field. Zebra's
 * `^BC` invocation table maps `>5` to Code 128 value 99, which is CODE C in subsets A and B.
 */
const SWITCH_TO_SUBSET_C = ">5";

/** One replica print run. */
export interface ReplicaLabel {
  /** The 13-character DIN to print. */
  din: string;
  /** Copy count: how many replicas this print run produces, from 1 to 999. */
  copies: number;
  /** The two flag characters that follow the DIN inside the barcode. Defaults to `00`. */
  flags?: string;
  /** How the printer should burn this label. Defaults to `DEFAULT_PRINT_SETTINGS`. */
  printSettings?: PrintSettings;
  /**
   * Which font the eye-readable line is set in. Defaults to `printer`, the
   * printer's own font, which is the font the source labels use.
   */
  labelFont?: LabelFont;
}

/** What the printed barcode will measure, for the UI to show under the preview. */
export interface ReplicaLabelGeometry {
  /** Width of one Code 128 module in dots. */
  moduleDots: number;
  /** Number of modules in the whole symbol, start and stop characters included. */
  symbolModules: number;
  /** Width of the printed symbol in dots, quiet zones not counted. */
  symbolWidthDots: number;
  /** Width of the printed symbol in millimetres, quiet zones not counted. */
  symbolWidthMm: number;
  /** Narrower of the two quiet zones in dots. */
  quietZoneDots: number;
}

/** How the barcode payload is split between the two Code 128 subsets. */
export interface SubsetSplit {
  /** Characters encoded in subset B, starting with the `=` data identifier. */
  subsetB: string;
  /** Digits encoded in subset C, two digits to a symbol character. */
  subsetC: string;
}

/**
 * Decides which characters go in Code 128 subset B and which go in subset C.
 *
 * ST-001 section 6.1.1 requires that a switch to subset C be possible where it shortens the
 * bar code. Subset C packs two digits into one symbol character, and that is what makes a
 * 16 character payload fit on 1.75 inch stock.
 *
 * Subset C carries digits and nothing else, so it takes the run of digits that reaches the
 * end of the payload. Everything before that run stays in subset B: the `=` data identifier,
 * the letters at the start of the FIN, and, when the flag characters are letters rather than
 * digits, the whole tail. Subset C also takes whole pairs only, so a run of odd length leaves
 * its first digit behind in subset B.
 */
export function splitPayloadIntoSubsets(payload: string): SubsetSplit {
  let boundary = payload.length;
  // Stop at index 1 so the `=` data identifier always stays in subset B.
  while (boundary > 1 && /[0-9]/.test(payload[boundary - 1]!)) {
    boundary -= 1;
  }
  if ((payload.length - boundary) % 2 === 1) {
    boundary += 1;
  }
  return { subsetB: payload.slice(0, boundary), subsetC: payload.slice(boundary) };
}

/**
 * Builds the `^FD` field data for the barcode, with the ZPL invocation codes that pick the
 * Code 128 subsets by hand.
 *
 * The `^BC` command runs in mode N, which turns off the printer's own subset picking. The
 * field data therefore names the subsets itself: `>:` to start in subset B, then `=` and the
 * leading FIN letters, then `>5` to switch to subset C, then the digits.
 *
 * For payload `=W48362600001100` the result is `>:=W>548362600001100`.
 */
export function buildBarcodeFieldData(payload: string): string {
  const { subsetB, subsetC } = splitPayloadIntoSubsets(payload);
  if (subsetC.length === 0) {
    return START_SUBSET_B + subsetB;
  }
  return START_SUBSET_B + subsetB + SWITCH_TO_SUBSET_C + subsetC;
}

/**
 * Counts the modules a Code 128 symbol occupies, given how its data splits across subsets.
 *
 * A Code 128 symbol is a start character, some symbol characters, a check character, and a
 * stop character. Every character is 11 modules wide except the stop character, which is 13.
 * Each subset B character is one symbol character. Each pair of subset C digits is one symbol
 * character, and the switch into subset C costs one more.
 */
export function countSymbolModules(split: SubsetSplit): number {
  const subsetCSymbols = split.subsetC.length === 0 ? 0 : 1 + split.subsetC.length / 2;
  const symbolCharacters = split.subsetB.length + subsetCSymbols;
  const startAndCheck = 2;
  return 11 * (startAndCheck + symbolCharacters) + 13;
}

/**
 * Picks the widest module width whose symbol still leaves a full quiet zone on each side of
 * the label. Throws when even the narrowest choice overflows the stock.
 */
export function chooseModuleWidthDots(symbolModules: number): number {
  for (const moduleDots of MODULE_WIDTH_CHOICES_DOTS) {
    const needed = (symbolModules + 2 * QUIET_ZONE_MIN_MODULES) * moduleDots;
    if (needed <= LABEL_WIDTH_DOTS) {
      return moduleDots;
    }
  }
  throw new Error(
    `A ${symbolModules} module bar code does not fit on ${LABEL_WIDTH_DOTS} dot wide stock`,
  );
}

/** Reports what the barcode for `din` will measure once printed. */
export function replicaLabelGeometry(din: string, flags?: string): ReplicaLabelGeometry {
  const payload = barcodePayload(din, flags);
  const symbolModules = countSymbolModules(splitPayloadIntoSubsets(payload));
  const moduleDots = chooseModuleWidthDots(symbolModules);
  const symbolWidthDots = symbolModules * moduleDots;
  const left = Math.round((LABEL_WIDTH_DOTS - symbolWidthDots) / 2);
  const right = LABEL_WIDTH_DOTS - left - symbolWidthDots;
  const quietZoneDots = Math.min(left, right);

  // `chooseModuleWidthDots` should already guarantee this. Check it anyway, because a barcode with
  // too little white space beside it can fail to scan without looking wrong on the label.
  if (quietZoneDots < QUIET_ZONE_MIN_MODULES * moduleDots) {
    throw new Error(
      `Quiet zone of ${quietZoneDots} dots is under the ${QUIET_ZONE_MIN_MODULES} module ` +
        `minimum of ${QUIET_ZONE_MIN_MODULES * moduleDots} dots for DIN ${din}`,
    );
  }

  return {
    moduleDots,
    symbolModules,
    symbolWidthDots,
    symbolWidthMm: (symbolWidthDots / DOTS_PER_INCH) * 25.4,
    quietZoneDots,
  };
}

/**
 * How wide the ink of `text` runs at `fontHeightDots` in the font `labelFont` names.
 *
 * The figure is the sum of the character advances less the trailing side bearing of the last
 * one. For font 0 it is checked against rendered text and lands within a dot of the ink at
 * every font height this app uses. A bundled font is measured from the TrueType file itself,
 * so its figure is exact.
 */
export function dinTextWidthDots(
  text: string,
  fontHeightDots: number,
  labelFont: LabelFont = DEFAULT_LABEL_FONT,
): number {
  const bundled = bundledLabelFont(labelFont);
  if (bundled !== null) {
    return bundledTextWidthDots(bundled, text, fontHeightDots);
  }

  let ratio = 0;
  for (const character of text) {
    if (character === " ") {
      ratio += SPACE_ADVANCE_RATIO;
    } else {
      ratio += GLYPH_ADVANCE_RATIO[character] ?? WIDEST_ADVANCE_RATIO;
    }
  }
  return Math.ceil(ratio * fontHeightDots) - Math.round(TRAILING_BEARING_RATIO * fontHeightDots);
}

/**
 * How far right of a field's `^FO` origin the ink of `text` starts.
 *
 * The measurements for font 0 fold this into the width, so an upright field in
 * font 0 begins its ink where its origin sits. A bundled font is measured
 * character by character, and the first character's own white space is not ink.
 */
function textLeftBearingDots(text: string, fontHeightDots: number, labelFont: LabelFont): number {
  const bundled = bundledLabelFont(labelFont);
  return bundled === null ? 0 : bundledTextLeftBearingDots(bundled, text, fontHeightDots);
}

/** Height of a capital letter at `fontHeightDots`. */
export function capHeightDots(
  fontHeightDots: number,
  labelFont: LabelFont = DEFAULT_LABEL_FONT,
): number {
  const bundled = bundledLabelFont(labelFont);
  if (bundled !== null) {
    return bundledCapHeightDots(bundled, fontHeightDots);
  }
  return Math.round(CAP_HEIGHT_RATIO * fontHeightDots);
}

/**
 * How far below an upright field's `^FO` origin the top of a capital letter
 * sits. Font 0 puts its ink two dots above the origin, so this is negative for
 * the printer's own font.
 */
function uprightInkTopDots(fontHeightDots: number, labelFont: LabelFont): number {
  const bundled = bundledLabelFont(labelFont);
  if (bundled !== null) {
    return bundledUprightInkTopDots(bundled, fontHeightDots);
  }
  return -UPRIGHT_INK_TOP_DOTS;
}

/**
 * How far below a rotated field's `^FO` origin its ink starts. The rotated
 * flag characters run down the label, so this is where they begin.
 */
function rotatedInkTopDots(text: string, fontHeightDots: number, labelFont: LabelFont): number {
  const bundled = bundledLabelFont(labelFont);
  if (bundled !== null) {
    return bundledTextLeftBearingDots(bundled, text, fontHeightDots);
  }
  return ROTATED_INK_TOP_DOTS;
}

/** How far down the label the rotated flag characters reach. */
function rotatedInkHeightDots(text: string, fontHeightDots: number, labelFont: LabelFont): number {
  const bundled = bundledLabelFont(labelFont);
  if (bundled !== null) {
    return bundledTextWidthDots(bundled, text, fontHeightDots);
  }
  return Math.round(ROTATED_INK_HEIGHT_RATIO * fontHeightDots);
}

/**
 * How far right of its `^FO` origin a rotated field's ink starts. A rotated field carries the
 * white space that would sit above an upright one, so its origin is not where the ink begins.
 */
export function rotatedInkLeftOffsetDots(
  fontHeightDots: number,
  labelFont: LabelFont = DEFAULT_LABEL_FONT,
): number {
  const bundled = bundledLabelFont(labelFont);
  if (bundled !== null) {
    return bundledRotatedInkLeftDots(bundled, fontHeightDots);
  }
  return Math.round(ROTATED_INK_LEFT_RATIO * fontHeightDots);
}

/**
 * Width of the whole eye-readable line at `fontHeightDots`: the DIN, a gap, the flag
 * characters on their side, another gap, and the box around the check character.
 */
export function eyeReadableLineWidthDots(
  dinText: string,
  fontHeightDots: number,
  labelFont: LabelFont = DEFAULT_LABEL_FONT,
): number {
  return (
    dinTextWidthDots(dinText, fontHeightDots, labelFont) +
    DIN_TO_FLAGS_GAP_DOTS +
    capHeightDots(fontHeightDots, labelFont) +
    FLAGS_TO_BOX_GAP_DOTS +
    CHECK_BOX_SIZE_DOTS
  );
}

/**
 * Picks the tallest font whose eye-readable line still starts at or right of the left margin.
 *
 * The line is right-aligned on the last bar, so the room it has is everything from the left
 * margin to `lineRightDots`. Throws when even the smallest font on the list overflows that.
 */
export function chooseFontHeightDots(
  dinText: string,
  lineRightDots: number,
  labelFont: LabelFont = DEFAULT_LABEL_FONT,
): number {
  for (const fontHeightDots of FONT_HEIGHT_CHOICES_DOTS) {
    const left = lineRightDots - eyeReadableLineWidthDots(dinText, fontHeightDots, labelFont);
    if (left >= LEFT_MARGIN_DOTS) {
      return fontHeightDots;
    }
  }
  throw new Error(
    `The eye-readable line for "${dinText}" does not fit between ${LEFT_MARGIN_DOTS} and ` +
      `${lineRightDots} dots at any font height`,
  );
}

/**
 * Checks print settings against the ranges the printer accepts, and throws outside them.
 *
 * The settings can come from a saved settings file, so a runtime check earns its keep even
 * though TypeScript already narrows the print method.
 */
export function validatePrintSettings(settings: PrintSettings): void {
  if (!(settings.printMethod in MEDIA_TYPE_LETTER)) {
    throw new Error(
      `Print method must be thermalTransfer or directThermal, not "${settings.printMethod}"`,
    );
  }
  if (
    !Number.isInteger(settings.darkness) ||
    settings.darkness < DARKNESS_MIN ||
    settings.darkness > DARKNESS_MAX
  ) {
    throw new Error(
      `Darkness must be a whole number from ${DARKNESS_MIN} to ${DARKNESS_MAX}, not ${settings.darkness}`,
    );
  }
  if (
    !Number.isInteger(settings.speedIps) ||
    settings.speedIps < SPEED_IPS_MIN ||
    settings.speedIps > SPEED_IPS_MAX
  ) {
    throw new Error(
      `Print speed must be a whole number of inches per second from ${SPEED_IPS_MIN} to ${SPEED_IPS_MAX}, not ${settings.speedIps}`,
    );
  }
  for (const [name, offset] of [
    ["Vertical position", settings.verticalOffsetDots],
    ["Horizontal position", settings.horizontalOffsetDots],
  ] as const) {
    if (!Number.isInteger(offset) || offset < OFFSET_DOTS_MIN || offset > OFFSET_DOTS_MAX) {
      throw new Error(
        `${name} must be a whole number of dots from ${OFFSET_DOTS_MIN} to ${OFFSET_DOTS_MAX}, not ${offset}`,
      );
    }
  }
}

/**
 * Builds the ZPL for one replica print run.
 *
 * The label carries a Code 128 barcode and one line of eye-readable text. Nothing else is
 * printed. Media darkness (`^MD`) is left alone so the printer keeps whatever the operator
 * set on it.
 *
 * `~SD` sets the darkness for the printer's whole session, so it goes on its own line ahead of
 * the format; the printer reads a tilde command outside `^XA` and `^XZ`. The print method and
 * the speed belong to the label itself and sit inside the format. `^MD` is left alone so the
 * two darkness commands cannot fight each other.
 *
 * A label set in a bundled font carries that font ahead of the format as well, in a `~DU`
 * download command. The default font is the printer's own, and a label set in it is byte for
 * byte what this app printed before it offered a choice of font.
 *
 * Throws when the DIN or the flag characters break the ISBT 128 structure rules, when the
 * copy count is not a whole number from 1 to 999, when a print setting is out of range, or
 * when the barcode cannot fit the stock.
 */
export function buildReplicaZpl(input: ReplicaLabel): string {
  if (!Number.isInteger(input.copies) || input.copies < 1 || input.copies > MAX_COPIES) {
    throw new Error(
      `Copy count must be a whole number from 1 to ${MAX_COPIES}, not ${input.copies}`,
    );
  }

  const printSettings = input.printSettings ?? DEFAULT_PRINT_SETTINGS;
  validatePrintSettings(printSettings);

  const labelFont = input.labelFont ?? DEFAULT_LABEL_FONT;
  const bundled = bundledLabelFont(labelFont);

  const payload = barcodePayload(input.din, input.flags);
  const text = eyeReadable(input.din, input.flags);
  const geometry = replicaLabelGeometry(input.din, input.flags);

  // The barcode is centred across the label, so its quiet zones come out equal.
  const symbolLeft = Math.round((LABEL_WIDTH_DOTS - geometry.symbolWidthDots) / 2);
  const symbolRight = symbolLeft + geometry.symbolWidthDots;
  const barsBottom = BARCODE_TOP_DOTS + BAR_HEIGHT_DOTS;

  // The eye-readable line is right-aligned on the last bar and packed tight, the way the
  // source labels set it. A wide DIN or a narrow bar code leaves less room, so the font
  // shrinks until the line reaches back no further than the left margin.
  const fontHeight = chooseFontHeightDots(text.text, symbolRight, labelFont);
  const capHeight = capHeightDots(fontHeight, labelFont);

  // Right to left: the box sits under the last bar, the flag characters sit beside it, and
  // the DIN fills what is left.
  const checkBoxLeft = symbolRight - CHECK_BOX_SIZE_DOTS;
  const flagsInkLeft = checkBoxLeft - FLAGS_TO_BOX_GAP_DOTS - capHeight;
  const dinInkLeft =
    flagsInkLeft - DIN_TO_FLAGS_GAP_DOTS - dinTextWidthDots(text.text, fontHeight, labelFont);
  const dinLeft = dinInkLeft - textLeftBearingDots(text.text, fontHeight, labelFont);
  const flagsLeft = flagsInkLeft - rotatedInkLeftOffsetDots(fontHeight, labelFont);

  // The box, the DIN, and the flag characters all sit on one centre line under the bars.
  const checkBoxTop = barsBottom + BAR_TO_LINE_GAP_DOTS;
  const centreY = checkBoxTop + CHECK_BOX_SIZE_DOTS / 2;
  const dinTop = Math.round(centreY - capHeight / 2) - uprightInkTopDots(fontHeight, labelFont);
  const flagsInkHeight = rotatedInkHeightDots(text.flags, fontHeight, labelFont);
  const flagsTop =
    Math.round(centreY - flagsInkHeight / 2) - rotatedInkTopDots(text.flags, fontHeight, labelFont);

  if (dinInkLeft < LEFT_MARGIN_DOTS) {
    throw new Error(
      `The eye-readable line starts at ${dinInkLeft} dots, left of the ` +
        `${LEFT_MARGIN_DOTS} dot margin`,
    );
  }
  if (checkBoxTop + CHECK_BOX_SIZE_DOTS > LABEL_HEIGHT_DOTS) {
    throw new Error(
      `The eye-readable line ends at ${checkBoxTop + CHECK_BOX_SIZE_DOTS} dots, ` +
        `below the ${LABEL_HEIGHT_DOTS} dot label`,
    );
  }

  // The check character is centred inside its box. Font 0 leaves that to `^FB`, which
  // centres a field across a width the command names. A downloaded font is placed by hand
  // instead, because the printer's own note on `~DU` says `^FB` does not work with one.
  const checkInkWidth = dinTextWidthDots(text.check, fontHeight, labelFont);
  const checkLeft =
    checkBoxLeft +
    Math.round((CHECK_BOX_SIZE_DOTS - checkInkWidth) / 2) -
    textLeftBearingDots(text.check, fontHeight, labelFont);

  const lines = [
    // ~SD is a control command, not part of a label format, and it holds for the session.
    // It takes two digits, 00 to 30.
    `~SD${String(printSettings.darkness).padStart(2, "0")}`,

    // A bundled font travels with the label, ahead of the format, and lands in the
    // printer's RAM. Nothing of it is left on the printer once it is switched off.
    ...(bundled === null ? [] : [fontDownloadCommand(bundled)]),

    "^XA",
    // UTF-8 input, so label text means the same thing whatever the host sends.
    "^CI28",
    // ^MTT for thermal transfer, ^MTD for direct thermal.
    `^MT${MEDIA_TYPE_LETTER[printSettings.printMethod]}`,
    // ^PR takes the print, slew, and backfeed speeds. They all move at the same rate here.
    `^PR${printSettings.speedIps},${printSettings.speedIps},${printSettings.speedIps}`,
    `^PW${LABEL_WIDTH_DOTS}`,
    `^LL${LABEL_HEIGHT_DOTS}`,

    // Where the printer puts the whole format on the stock. These correct a roll that sits a
    // little high or a little to one side in the printer; they move nothing within the label.
    //
    // `^LTx` takes dot rows, -120 to 120 on this printer. The guide says a negative value
    // moves the format towards the top of the label and a positive value moves it away from
    // the top, so a positive `verticalOffsetDots` moves the printed content down the label.
    //
    // `^LSa` takes dots, and its parameter is a shift left value: a positive number moves the
    // content left. The setting reads the other way round, because an operator nudging a
    // label to the right should type a positive number, so the sign is turned over here.
    // `^LS` holds until the printer is switched off, so it is sent on every label, zero
    // included, and never left behind for the next print run to inherit.
    `^LT${printSettings.verticalOffsetDots}`,
    `^LS${-printSettings.horizontalOffsetDots}`,

    // Module width for the barcode that follows.
    `^BY${geometry.moduleDots}`,
    // ^BCN,<height>,N,N,N,N: no rotation, no printed interpretation line, no UCC check
    // digit, and mode N so the subsets come from the invocation codes in the field data.
    `^FO${symbolLeft},${BARCODE_TOP_DOTS}^BCN,${BAR_HEIGHT_DOTS},N,N,N,N^FD${buildBarcodeFieldData(payload)}^FS`,

    // The DIN, in one font at one size. Font 0 on the ZD411t is CG Triumvirate Bold
    // Condensed, so it prints bold without any further instruction, and both bundled fonts
    // are bold faces. ST-001 section 7.4.1 requires all 13 DIN characters to be printed and
    // lets the DIN sit anywhere under its bar code.
    `^FO${dinLeft},${dinTop}${fontCommand(labelFont, "N", fontHeight)}^FD${text.text}^FS`,

    // The flag characters, turned a quarter turn clockwise. ST-001 section 7.4.1 asks for that
    // rotation so a reader can tell the flag characters apart from the DIN. `R` is the ZPL
    // field orientation for 90 degrees clockwise.
    `^FO${flagsLeft},${flagsTop}${fontCommand(labelFont, "R", fontHeight)}^FD${text.flags}^FS`,

    // The check character in a box. ST-001 section 7.5 keeps the check character out of the
    // bar code, and section 7.5.1.1 requires a box drawn around it wherever it is printed.
    `^FO${checkBoxLeft},${checkBoxTop}^GB${CHECK_BOX_SIZE_DOTS},${CHECK_BOX_SIZE_DOTS},${CHECK_BOX_THICKNESS_DOTS}^FS`,
    bundled === null
      ? `^FO${checkBoxLeft},${dinTop}^A0N,${fontHeight},${fontHeight}^FB${CHECK_BOX_SIZE_DOTS},1,0,C,0^FD${text.check}^FS`
      : `^FO${checkLeft},${dinTop}${fontCommand(labelFont, "N", fontHeight)}^FD${text.check}^FS`,

    `^PQ${input.copies}`,
    "^XZ",
  ];

  return lines.join("\n") + "\n";
}
