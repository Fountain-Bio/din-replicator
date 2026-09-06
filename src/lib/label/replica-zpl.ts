/**
 * ZPL for the replica label.
 *
 * The app prints replicas on a Zebra ZD411t at 300 dpi on 1.75 by 0.75 inch label stock.
 * A replica carries the same barcode payload and eye-readable text as its source label, so
 * the layout copies what the blood establishment computer system prints on the facility's source labels: a Code 128 barcode
 * across the top, and one line under it holding the DIN, the flag characters turned on their
 * side, and the check character inside a box.
 *
 * Every geometry and layout rule cited here comes from ICCBBA ST-001 v6.2.2.
 * This file takes strings that are already parsed and validated. It does no ISBT 128 work of
 * its own.
 */

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
 * Width of one Code 128 module in dots, set with `^BY`. Three dots at 300 dpi is 0.254 mm.
 * ST-001 section 6.1.3 gives 0.25 mm as the target X dimension for a container label, and
 * 0.17 mm as the smallest allowed.
 */
export const MODULE_WIDTH_DOTS = 3;

/**
 * Smallest quiet zone the symbol may have on each side. ST-001 section 6.1.3 sets it at ten
 * times the X dimension. The layout leaves more than this.
 */
export const QUIET_ZONE_MIN_MODULES = 10;
export const QUIET_ZONE_MIN_DOTS = QUIET_ZONE_MIN_MODULES * MODULE_WIDTH_DOTS;

/**
 * Height of the bars in dots. 90 dots at 300 dpi is 7.6 mm. ST-001 section 6.1.3 asks for at
 * least 5 mm, or 15 percent of the bar code length if that is greater. A 145 module symbol at
 * 0.254 mm per module is 36.8 mm long, and 15 percent of that is 5.5 mm.
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

/** Top of the eye-readable line. */
const TEXT_TOP_DOTS = BARCODE_TOP_DOTS + BAR_HEIGHT_DOTS + BAR_TO_TEXT_GAP_DOTS;

/**
 * Height of the flag characters. They are printed turned a quarter turn, so on the label this
 * measurement runs across the label rather than down it.
 */
const FLAGS_HEIGHT_DOTS = 26;
/** Left edge of the turned flag characters. */
const FLAGS_LEFT_DOTS = 332;
/** Top of the turned flag characters. */
const FLAGS_TOP_DOTS = TEXT_TOP_DOTS - 2;

/** Outside size of the box that holds the check character. */
const CHECK_BOX_SIZE_DOTS = 44;
/** Line thickness of the box that holds the check character. */
const CHECK_BOX_THICKNESS_DOTS = 3;
/** Top edge of the box that holds the check character. */
const CHECK_BOX_TOP_DOTS = TEXT_TOP_DOTS - 12;
/** Distance from the left inside edge of the box to the check character glyph. */
const CHECK_GLYPH_INSET_X_DOTS = 13;
/** Distance from the top inside edge of the box to the check character glyph. */
const CHECK_GLYPH_INSET_Y_DOTS = 12;

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

/** Everything needed to print one replica. All strings come from the parsed source label. */
export interface ReplicaLabel {
  /** The 16 character barcode payload: `=`, the 13 character DIN, and the flag characters. */
  payload: string;
  /** The five character FIN at the start of the DIN. */
  fin: string;
  /** The two digit year of the DIN. */
  year: string;
  /** The six digit sequence of the DIN. */
  sequence: string;
  /** The two flag characters that follow the DIN inside the barcode. */
  flags: string;
  /** The check character. It is eye-readable only and never enters the barcode. */
  check: string;
  /** Copy count: how many replicas this print run produces. */
  copies: number;
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
 * 16 character payload fit on 1.75 inch stock. Subset B carries the `=` data identifier and
 * the letters at the start of the FIN. Subset C carries the digits that follow. Subset C only
 * takes whole pairs, so when an odd number of digits is left the first of them stays in
 * subset B.
 */
export function splitPayloadIntoSubsets(payload: string): SubsetSplit {
  let boundary = 1; // The `=` data identifier always goes in subset B.
  while (boundary < payload.length && !/[0-9]/.test(payload[boundary]!)) {
    boundary += 1;
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

/** Width of the printed symbol in dots, quiet zones not counted. */
export function symbolWidthDots(payload: string): number {
  return countSymbolModules(splitPayloadIntoSubsets(payload)) * MODULE_WIDTH_DOTS;
}

/** Left edge of the barcode that centres the symbol across the label width. */
export function barcodeLeftDots(payload: string): number {
  return Math.round((LABEL_WIDTH_DOTS - symbolWidthDots(payload)) / 2);
}

/**
 * Builds the ZPL for one replica print run.
 *
 * The label carries a Code 128 barcode and one line of eye-readable text. Nothing else is
 * printed. Media darkness (`^MD`) is left alone so the printer keeps whatever the operator
 * set on it.
 */
export function buildReplicaZpl(input: ReplicaLabel): string {
  const barcodeLeft = barcodeLeftDots(input.payload);
  const barcodeRight = barcodeLeft + symbolWidthDots(input.payload);
  const fieldData = buildBarcodeFieldData(input.payload);
  const dinText = `${input.fin} ${input.year} ${input.sequence}`;
  // The box sits under the right end of the bars, which is where the blood establishment computer system puts it.
  const checkBoxLeft = barcodeRight - CHECK_BOX_SIZE_DOTS;

  const lines = [
    "^XA",
    // UTF-8 input, so label text means the same thing whatever the host sends.
    "^CI28",
    `^PW${LABEL_WIDTH_DOTS}`,
    `^LL${LABEL_HEIGHT_DOTS}`,

    // Module width for the barcode that follows.
    `^BY${MODULE_WIDTH_DOTS}`,
    // ^BCN,<height>,N,N,N,N: no rotation, no printed interpretation line, no UCC check
    // digit, and mode N so the subsets come from the invocation codes in the field data.
    `^FO${barcodeLeft},${BARCODE_TOP_DOTS}^BCN,${BAR_HEIGHT_DOTS},N,N,N,N^FD${fieldData}^FS`,

    // The DIN, in one sans serif scalable font at one size. ST-001 section 7.4.1 requires all
    // 13 DIN characters to be printed, and lets the DIN sit anywhere under its bar code.
    `^FO${barcodeLeft},${TEXT_TOP_DOTS}^A0N,${TEXT_HEIGHT_DOTS},${TEXT_HEIGHT_DOTS}^FD${dinText}^FS`,

    // The flag characters, turned a quarter turn clockwise. ST-001 section 7.4.1 asks for that
    // rotation so a reader can tell the flag characters apart from the DIN. `^A0R` is the ZPL
    // font orientation for 90 degrees clockwise.
    `^FO${FLAGS_LEFT_DOTS},${FLAGS_TOP_DOTS}^A0R,${FLAGS_HEIGHT_DOTS},${FLAGS_HEIGHT_DOTS}^FD${input.flags}^FS`,

    // The check character in a box. ST-001 section 7.5 keeps the check character out of the
    // bar code, and section 7.5.1.1 requires a box drawn around it wherever it is printed.
    `^FO${checkBoxLeft},${CHECK_BOX_TOP_DOTS}^GB${CHECK_BOX_SIZE_DOTS},${CHECK_BOX_SIZE_DOTS},${CHECK_BOX_THICKNESS_DOTS}^FS`,
    `^FO${checkBoxLeft + CHECK_GLYPH_INSET_X_DOTS},${CHECK_BOX_TOP_DOTS + CHECK_GLYPH_INSET_Y_DOTS}^A0N,${TEXT_HEIGHT_DOTS},${TEXT_HEIGHT_DOTS}^FD${input.check}^FS`,

    `^PQ${input.copies}`,
    "^XZ",
  ];

  return lines.join("\n") + "\n";
}
