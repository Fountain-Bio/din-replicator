/**
 * The fonts a replica label can be printed in.
 *
 * The printer draws the eye-readable line in its own built-in font unless the
 * app hands it another one. `printer` leaves it to the built-in font, which is
 * what the source labels are set in. `sans` and `mono` send a font this app
 * bundles down to the printer with the label, and print the line in that.
 *
 * ICCBBA IG-002 section 5.1.2 requires the eye-readable DIN to be set in a
 * sans serif typeface, and ST-001 section 7.4 requires a reader to be able to
 * tell 0 from O and 1 from I. Both bundled faces are sans serif. Inter draws
 * the zero as a narrow oval against a wide round capital O, and gives the
 * digit one an angled flag where the capital I is a plain bar. JetBrains Mono
 * puts a dot inside the zero and bars across the top and bottom of the capital
 * I. `src/lib/label/fonts/LICENSES.md` records what each font is, where it was
 * downloaded from, and the licence it carries.
 *
 * A bundled font travels with every label as ASCII hex inside a `~DU`
 * download command, and the text fields name it with `^A@`. It is written to
 * `R:`, which is the printer's RAM, so it is gone when the printer is switched
 * off and nothing this app sends is left behind on the printer.
 */

import { INTER_BOLD_SUBSET } from "./fonts/inter-bold-subset.generated";
import { JETBRAINS_MONO_BOLD_SUBSET } from "./fonts/jetbrains-mono-bold-subset.generated";

export { LABEL_CHARACTERS } from "./fonts/characters";

/**
 * Which font the eye-readable line is printed in.
 *
 * `printer` is the printer's built-in scalable font 0, CG Triumvirate Bold
 * Condensed. `sans` and `mono` are the fonts this app bundles.
 */
export type LabelFont = "printer" | "sans" | "mono";

/** Every value `LabelFont` can take, in the order the settings screen lists them. */
export const LABEL_FONTS: readonly LabelFont[] = ["printer", "sans", "mono"] as const;

/** The font a replica is printed in when nobody has chosen one. */
export const DEFAULT_LABEL_FONT: LabelFont = "printer";

/**
 * One font the app carries and sends to the printer.
 *
 * Everything but `zplPath` comes out of the generated module beside the font
 * file, so the measurements always describe the bytes that are sent.
 */
export interface BundledLabelFont {
  /** The font's own name for itself, weight included. */
  displayName: string;
  /** The release of the font project the file was taken from. */
  version: string;
  /** The version string inside the font file. */
  fontVersion: string;
  /** The archive the font was downloaded from. */
  sourceUrl: string;
  /** The licence the font is offered under. */
  license: string;
  /** The subset TrueType file in `src/lib/label/fonts/`. */
  subsetFile: string;
  /** How many bytes that file holds. `~DU` has to be told this. */
  byteCount: number;
  /** The whole file as ASCII hex, two upper case digits to a byte. */
  hex: string;
  /** Height of a capital letter, as a fraction of the font height. */
  capHeightRatio: number;
  /** How far below a field's origin the baseline sits, as a fraction of the height. */
  baselineRatio: number;
  /** The font's own line height, as a fraction of the font height. */
  lineHeightRatio: number;
  /**
   * Advance width, left side bearing, and right side bearing of each
   * character, each as a fraction of the font height. The side bearings are
   * the white space the character leaves inside its advance.
   */
  glyphs: Record<string, [number, number, number]>;
  /** Where the printer keeps the font while it is printing. */
  zplPath: string;
}

/**
 * The fonts the app bundles, by the `LabelFont` value that chooses them.
 *
 * The `R:` prefix is the printer's RAM. `~DU` stores what it downloads under a
 * name of up to eight characters and the extension `.FNT`, so the two names
 * here are as long as they are allowed to be.
 */
export const BUNDLED_LABEL_FONTS: Record<"sans" | "mono", BundledLabelFont> = {
  sans: { ...INTER_BOLD_SUBSET, zplPath: "R:DINSANS.FNT" },
  mono: { ...JETBRAINS_MONO_BOLD_SUBSET, zplPath: "R:DINMONO.FNT" },
};

/** The bundled font `labelFont` chooses, or null when it is the printer's own. */
export function bundledLabelFont(labelFont: LabelFont): BundledLabelFont | null {
  return labelFont === "printer" ? null : BUNDLED_LABEL_FONTS[labelFont];
}

/**
 * The command that sends a bundled font to the printer.
 *
 * `~DUd:o.x,s,data` downloads a font as ASCII hex: `d:o.x` is where to keep
 * it, `s` is how many bytes it holds, and `data` is two hex digits per byte.
 * It is a tilde command, so it goes ahead of `^XA` rather than inside the
 * label format, and the printer acts on it as it reads it.
 *
 * The whole font goes down with every label. A subset font is a few kilobytes,
 * the printer overwrites the previous copy under the same name, and sending it
 * every time is what lets the app change fonts without tracking what the
 * printer already holds.
 */
export function fontDownloadCommand(font: BundledLabelFont): string {
  return `~DU${font.zplPath},${font.byteCount},${font.hex}`;
}

/**
 * The command that picks the font for the fields that follow.
 *
 * `^A0` names the printer's built-in font 0. `^A@o,h,w,d:f.x` names a font by
 * its file, which is how a downloaded font is used. `o` is the orientation,
 * `N` upright and `R` a quarter turn clockwise, and `h` and `w` are the height
 * and width of the character block in dots. A scalable font is drawn to that
 * block, so the same numbers mean the same size in either font.
 */
export function fontCommand(
  labelFont: LabelFont,
  orientation: "N" | "R",
  fontHeightDots: number,
): string {
  const bundled = bundledLabelFont(labelFont);
  if (bundled === null) {
    return `^A0${orientation},${fontHeightDots},${fontHeightDots}`;
  }
  return `^A@${orientation},${fontHeightDots},${fontHeightDots},${bundled.zplPath}`;
}

/** The advance width and side bearings of `character`, as fractions of the font height. */
function glyph(font: BundledLabelFont, character: string): [number, number, number] {
  const measured = font.glyphs[character];
  if (measured !== undefined) {
    return measured;
  }
  // A character the subset does not hold prints as nothing. Measuring it as
  // the widest character the font has keeps the line from being laid out
  // wider than it turns out to be.
  return widestGlyph(font);
}

/** The widest character the font holds. */
function widestGlyph(font: BundledLabelFont): [number, number, number] {
  let widest: [number, number, number] = [0, 0, 0];
  for (const measured of Object.values(font.glyphs)) {
    if (measured[0] > widest[0]) {
      widest = measured;
    }
  }
  return widest;
}

/**
 * How wide the ink of `text` runs at `fontHeightDots`.
 *
 * The advances of every character add up to how far the pen travels. The white
 * space the first and last characters leave inside their own advances is not
 * ink, so it comes off both ends.
 */
export function bundledTextWidthDots(
  font: BundledLabelFont,
  text: string,
  fontHeightDots: number,
): number {
  if (text.length === 0) {
    return 0;
  }
  let ratio = 0;
  for (const character of text) {
    ratio += glyph(font, character)[0];
  }
  ratio -= glyph(font, text[0]!)[1];
  ratio -= glyph(font, text[text.length - 1]!)[2];
  return Math.ceil(ratio * fontHeightDots);
}

/**
 * How far right of a field's origin the ink of `text` starts, in dots. A field
 * is placed by its advance, and the first character leaves white space inside
 * its own advance before the ink begins.
 */
export function bundledTextLeftBearingDots(
  font: BundledLabelFont,
  text: string,
  fontHeightDots: number,
): number {
  if (text.length === 0) {
    return 0;
  }
  return Math.round(glyph(font, text[0]!)[1] * fontHeightDots);
}

/** Height of a capital letter at `fontHeightDots`. */
export function bundledCapHeightDots(font: BundledLabelFont, fontHeightDots: number): number {
  return Math.round(font.capHeightRatio * fontHeightDots);
}

/**
 * How far below the origin of an upright field the top of a capital letter
 * sits, in dots. A field is placed by its character block, and the block holds
 * the room a letter with an ascender needs above the capitals.
 */
export function bundledUprightInkTopDots(font: BundledLabelFont, fontHeightDots: number): number {
  return Math.round((font.baselineRatio - font.capHeightRatio) * fontHeightDots);
}

/**
 * How far right of the origin of a field turned a quarter turn clockwise its
 * ink starts, in dots.
 *
 * A rotated field's characters lie on their side with their tops pointing
 * right and their baseline down the left. A character with no descender puts
 * its leftmost ink on that baseline, and the baseline sits a quarter of the
 * font's line height below the top of the character block.
 */
export function bundledRotatedInkLeftDots(font: BundledLabelFont, fontHeightDots: number): number {
  return Math.round((font.lineHeightRatio - font.baselineRatio) * fontHeightDots);
}
