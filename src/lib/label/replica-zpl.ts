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
 * Height of the bars in dots. 90 dots at 300 dpi is 7.6 mm. ST-001 section 6.1.3 asks for at
 * least 5 mm, or 15 percent of the bar code length if that is greater. The longest symbol
 * this app prints is 145 modules at 0.254 mm, which is 36.8 mm, and 15 percent of that is
 * 5.5 mm.
 */
export const BAR_HEIGHT_DOTS = 90;

/** Distance from the top edge of the label to the top of the bars. */
const BARCODE_TOP_DOTS = 36;

/**
 * Gap between the bottom of the bars and the top of the eye-readable text. ST-001 section
 * 6.1.3 allows no printing in direct contact with the top or bottom of the bar code.
 */
const BAR_TO_TEXT_GAP_DOTS = 30;

/**
 * Height of the eye-readable DIN in dots. 30 dots at 300 dpi is 2.5 mm. ST-001 section 7.4.2.1
 * caps most bar code text at 2 mm, and section 7.4.1 lifts that cap for the DIN so it can be
 * printed in a larger font.
 */
export const TEXT_HEIGHT_DOTS = 30;

/**
 * Widest a single glyph of ZPL font 0 gets at a 30 dot height. Font 0 is proportional, so the
 * printed width of the DIN depends on which characters it holds. `W` is the widest character
 * a DIN can contain and it advances 25 dots, measured by rendering font 0 at `^A0N,30,30`.
 */
export const MAX_GLYPH_WIDTH_DOTS = 25;

/** Width of a space in ZPL font 0 at a 30 dot height, measured the same way. */
export const SPACE_WIDTH_DOTS = 7;

/** The eye-readable DIN is 13 data characters with a space after the FIN and after the year. */
const DIN_TEXT_GLYPHS = 13;
const DIN_TEXT_SPACES = 2;

/**
 * Room the eye-readable DIN gets on the label.
 *
 * The widest DIN this app can print is three `W` characters followed by ten digits, which
 * measures 238 dots. Reserving 13 widest-case glyphs and two spaces gives 339 dots, so the
 * DIN cannot run into the flag characters whatever it holds.
 */
export const DIN_TEXT_WIDTH_DOTS =
  DIN_TEXT_GLYPHS * MAX_GLYPH_WIDTH_DOTS + DIN_TEXT_SPACES * SPACE_WIDTH_DOTS;

/**
 * Width of the flag character field. The flag characters are turned a quarter turn, so the
 * field is as wide as the font is tall.
 */
const FLAGS_FONT_DOTS = 26;

/** White space between the flag characters and the box around the check character. */
const FLAGS_TO_CHECK_BOX_GAP_DOTS = 26;

/** Outside size of the box that holds the check character. */
const CHECK_BOX_SIZE_DOTS = 44;
/** Line thickness of the box that holds the check character. */
const CHECK_BOX_THICKNESS_DOTS = 3;
/** Distance from the left edge of the box to the check character glyph. */
const CHECK_GLYPH_INSET_X_DOTS = 13;
/** Distance from the top edge of the box to the check character glyph. */
const CHECK_GLYPH_INSET_Y_DOTS = 12;

/**
 * Narrowest the eye-readable line can be and still hold everything it carries: the DIN, the
 * flag characters, and the boxed check character.
 */
const ROW_MIN_WIDTH_DOTS =
  DIN_TEXT_WIDTH_DOTS + FLAGS_FONT_DOTS + FLAGS_TO_CHECK_BOX_GAP_DOTS + CHECK_BOX_SIZE_DOTS;

/** Top of the eye-readable line. */
const TEXT_TOP_DOTS = BARCODE_TOP_DOTS + BAR_HEIGHT_DOTS + BAR_TO_TEXT_GAP_DOTS;
/** Top of the turned flag characters. */
const FLAGS_TOP_DOTS = TEXT_TOP_DOTS - 2;
/** Top edge of the box that holds the check character. */
const CHECK_BOX_TOP_DOTS = TEXT_TOP_DOTS - 12;

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

  // The choice above should already guarantee this. Check it anyway, because a barcode with
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
 * Builds the ZPL for one replica print run.
 *
 * The label carries a Code 128 barcode and one line of eye-readable text. Nothing else is
 * printed. Media darkness (`^MD`) is left alone so the printer keeps whatever the operator
 * set on it.
 *
 * Throws when the DIN or the flag characters break the ISBT 128 structure rules, when the
 * copy count is not a whole number from 1 to 999, or when the barcode cannot fit the stock.
 */
export function buildReplicaZpl(input: ReplicaLabel): string {
  if (!Number.isInteger(input.copies) || input.copies < 1 || input.copies > MAX_COPIES) {
    throw new Error(
      `Copy count must be a whole number from 1 to ${MAX_COPIES}, not ${input.copies}`,
    );
  }

  const payload = barcodePayload(input.din, input.flags);
  const text = eyeReadable(input.din, input.flags);
  const geometry = replicaLabelGeometry(input.din, input.flags);

  // The barcode is centred across the label, so its quiet zones come out equal.
  const symbolLeft = Math.round((LABEL_WIDTH_DOTS - geometry.symbolWidthDots) / 2);

  // The eye-readable line runs from the left end of the bars to the right end of them, which
  // is where the source labels put it. A narrow symbol cannot hold the DIN, the flag
  // characters, and the box, so the line widens on both sides until it can.
  const rowWidth = Math.max(geometry.symbolWidthDots, ROW_MIN_WIDTH_DOTS);
  const rowLeft = Math.round((LABEL_WIDTH_DOTS - rowWidth) / 2);
  const rowRight = rowLeft + rowWidth;

  // Everything in the line is placed from its right end, so the box sits under the last bar
  // whenever the bars are the wider of the two.
  const checkBoxLeft = rowRight - CHECK_BOX_SIZE_DOTS;
  const flagsLeft = checkBoxLeft - FLAGS_TO_CHECK_BOX_GAP_DOTS - FLAGS_FONT_DOTS;
  const dinTextBudget = flagsLeft - rowLeft;

  if (dinTextBudget < DIN_TEXT_WIDTH_DOTS) {
    throw new Error(
      `The eye-readable line gives the DIN ${dinTextBudget} dots, under the ` +
        `${DIN_TEXT_WIDTH_DOTS} dots its widest form needs`,
    );
  }
  if (rowLeft < 0 || rowRight > LABEL_WIDTH_DOTS) {
    throw new Error(`The eye-readable line runs from ${rowLeft} to ${rowRight}, off the label`);
  }

  const lines = [
    "^XA",
    // UTF-8 input, so label text means the same thing whatever the host sends.
    "^CI28",
    `^PW${LABEL_WIDTH_DOTS}`,
    `^LL${LABEL_HEIGHT_DOTS}`,

    // Module width for the barcode that follows.
    `^BY${geometry.moduleDots}`,
    // ^BCN,<height>,N,N,N,N: no rotation, no printed interpretation line, no UCC check
    // digit, and mode N so the subsets come from the invocation codes in the field data.
    `^FO${symbolLeft},${BARCODE_TOP_DOTS}^BCN,${BAR_HEIGHT_DOTS},N,N,N,N^FD${buildBarcodeFieldData(payload)}^FS`,

    // The DIN, in one sans serif scalable font at one size. ST-001 section 7.4.1 requires all
    // 13 DIN characters to be printed, and lets the DIN sit anywhere under its bar code.
    `^FO${rowLeft},${TEXT_TOP_DOTS}^A0N,${TEXT_HEIGHT_DOTS},${TEXT_HEIGHT_DOTS}^FD${text.text}^FS`,

    // The flag characters, turned a quarter turn clockwise. ST-001 section 7.4.1 asks for that
    // rotation so a reader can tell the flag characters apart from the DIN. `^A0R` is the ZPL
    // font orientation for 90 degrees clockwise.
    `^FO${flagsLeft},${FLAGS_TOP_DOTS}^A0R,${FLAGS_FONT_DOTS},${FLAGS_FONT_DOTS}^FD${text.flags}^FS`,

    // The check character in a box. ST-001 section 7.5 keeps the check character out of the
    // bar code, and section 7.5.1.1 requires a box drawn around it wherever it is printed.
    `^FO${checkBoxLeft},${CHECK_BOX_TOP_DOTS}^GB${CHECK_BOX_SIZE_DOTS},${CHECK_BOX_SIZE_DOTS},${CHECK_BOX_THICKNESS_DOTS}^FS`,
    `^FO${checkBoxLeft + CHECK_GLYPH_INSET_X_DOTS},${CHECK_BOX_TOP_DOTS + CHECK_GLYPH_INSET_Y_DOTS}^A0N,${TEXT_HEIGHT_DOTS},${TEXT_HEIGHT_DOTS}^FD${text.check}^FS`,

    `^PQ${input.copies}`,
    "^XZ",
  ];

  return lines.join("\n") + "\n";
}
