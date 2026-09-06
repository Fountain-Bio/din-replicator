/**
 * Renders replica label ZPL to PNGs so a person can check the layout without a printer.
 *
 * Run it with `bun run preview:label`. It writes one `.zpl` and one `.png` into `out/` for
 * each sample DIN and each font a label can be set in:
 *   - `label` is a DIN whose FIN starts with one letter. Its barcode is 145 modules.
 *   - `label-two-letter-fin` is a DIN whose FIN starts with two letters. Its barcode is 156
 *     modules, which is wider and can force a narrower module on small stock.
 *
 * A name with no font suffix is the printer's own font, which is what a replica is set in
 * unless the operator chooses otherwise. `-sans` and `-mono` are the two fonts the app
 * bundles and downloads to the printer with the label.
 *
 * `--width`, `--height`, and `--dpi` render the same samples on other label stock, so
 * `bun run preview:label -- --width 2 --height 1` writes `label-2x1.png` beside the default
 * `label.png`. Every file name says which stock it was rendered for, so one `out/` directory
 * can hold previews of several stocks at once.
 *
 * The renderer is zebrash, which runs locally, so label data never leaves the machine. It
 * reads a downloaded font out of the `~DU` command in the ZPL, so a preview of a bundled
 * font is drawn in the same bytes the printer is sent.
 *
 * Known gap: zebrash 1.0.3 mishandles the `>5` invocation code in `^BC` mode N. Zebra's own
 * invocation table maps `>5` to Code 128 value 99, CODE C, but zebrash re-emits the current
 * subset instead and keeps encoding in subset B. The preview therefore draws the digits one
 * symbol character each, so its barcode comes out wider than the printer's. Read the preview
 * for the text layout and the spacing under the bars, and take the symbol width from
 * `replicaLabelGeometry`, which the script prints for each sample.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { Drawer, Parser } from "@zebrash/node";
import { checkCharacter } from "../src/lib/isbt128";
import { LABEL_FONTS, type LabelFont } from "../src/lib/label/fonts";
import {
  buildReplicaZpl,
  DEFAULT_LABEL_STOCK,
  dotsPerMillimetre,
  labelLayout,
  type LabelStock,
  type PrinterDotsPerInch,
  PRINTER_DOTS_PER_INCH_CHOICES,
  replicaLabelGeometry,
} from "../src/lib/label/replica-zpl";

const OUT_DIR = new URL("../out/", import.meta.url);

/** The DINs this script renders, and the file name each one is written under. */
const SAMPLES = [
  { name: "label", din: "W483626000011" },
  { name: "label-two-letter-fin", din: "AB12326000011" },
];

/** What each font adds to a sample's file name. The printer's own font adds nothing. */
function suffix(labelFont: LabelFont): string {
  return labelFont === "printer" ? "" : `-${labelFont}`;
}

/**
 * What the stock adds to a sample's file name. The default stock adds nothing, so a plain
 * `bun run preview:label` keeps writing `label.png`. Other stock is named by its size, and by
 * its resolution as well when that is not the 300 dpi the default stock is printed at.
 */
function stockSuffix(stock: LabelStock): string {
  if (
    stock.widthInches === DEFAULT_LABEL_STOCK.widthInches &&
    stock.heightInches === DEFAULT_LABEL_STOCK.heightInches &&
    stock.dotsPerInch === DEFAULT_LABEL_STOCK.dotsPerInch
  ) {
    return "";
  }
  const size = `-${stock.widthInches}x${stock.heightInches}`;
  return stock.dotsPerInch === DEFAULT_LABEL_STOCK.dotsPerInch
    ? size
    : `${size}-${stock.dotsPerInch}dpi`;
}

/**
 * Reads `--width`, `--height`, and `--dpi` off the command line, in either the
 * `--width 2` or the `--width=2` form. Anything left out keeps the default stock's value.
 */
function stockFromCommandLine(argv: string[]): LabelStock {
  const named = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i]!;
    if (!argument.startsWith("--")) {
      throw new Error(`Unknown argument "${argument}". Use --width, --height, or --dpi.`);
    }
    const equals = argument.indexOf("=");
    if (equals === -1) {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`${argument} needs a value`);
      }
      named.set(argument.slice(2), value);
      i += 1;
    } else {
      named.set(argument.slice(2, equals), argument.slice(equals + 1));
    }
  }

  for (const name of named.keys()) {
    if (!["width", "height", "dpi"].includes(name)) {
      throw new Error(`Unknown option "--${name}". Use --width, --height, or --dpi.`);
    }
  }

  const number = (name: string, fallback: number): number => {
    const raw = named.get(name);
    if (raw === undefined) {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`--${name} takes a number, not "${raw}"`);
    }
    return value;
  };

  const dotsPerInch = number("dpi", DEFAULT_LABEL_STOCK.dotsPerInch);
  if (!PRINTER_DOTS_PER_INCH_CHOICES.includes(dotsPerInch as PrinterDotsPerInch)) {
    throw new Error(`--dpi takes ${PRINTER_DOTS_PER_INCH_CHOICES.join(", ")}, not ${dotsPerInch}`);
  }

  return {
    widthInches: number("width", DEFAULT_LABEL_STOCK.widthInches),
    heightInches: number("height", DEFAULT_LABEL_STOCK.heightInches),
    dotsPerInch: dotsPerInch as PrinterDotsPerInch,
  };
}

const stock = stockFromCommandLine(process.argv.slice(2));
const layout = labelLayout(stock);
const drawer = new Drawer();
await mkdir(OUT_DIR, { recursive: true });

console.log(
  `${stock.widthInches} by ${stock.heightInches} inch stock at ${stock.dotsPerInch} dpi = ` +
    `${layout.widthDots} by ${layout.heightDots} dots`,
);
console.log(
  `  modules ${layout.moduleWidthChoicesDots.join(", ")} dots, ` +
    `font heights ${layout.fontHeightChoicesDots.join(", ")} dots`,
);
console.log(
  `  bars ${layout.barHeightDots} dots tall from ${layout.barcodeTopDots} dots down, ` +
    `then a ${layout.barToLineGapDots} dot gap and a ${layout.checkBoxSizeDots} dot check box`,
);
console.log(
  `  left margin ${layout.leftMarginDots} dots, ` +
    `gaps ${layout.dinToFlagsGapDots} and ${layout.flagsToBoxGapDots} dots`,
);

for (const { name, din } of SAMPLES) {
  for (const labelFont of LABEL_FONTS) {
    const fileName = `${name}${stockSuffix(stock)}${suffix(labelFont)}`;
    const zpl = buildReplicaZpl({ din, copies: 1, labelFont, stock });
    const label = new Parser().parse(zpl)[0];
    if (label === undefined) {
      throw new Error(`zebrash parsed no label out of the ZPL for ${din}`);
    }

    const png = await drawer.drawLabelAsPng(label, {
      labelWidthMm: stock.widthInches * 25.4,
      labelHeightMm: stock.heightInches * 25.4,
      dpmm: dotsPerMillimetre(stock.dotsPerInch),
    });

    await writeFile(new URL(`${fileName}.zpl`, OUT_DIR), zpl);
    await writeFile(new URL(`${fileName}.png`, OUT_DIR), png);

    const geometry = replicaLabelGeometry(din, undefined, stock);
    const fontHeight = /\^A[0@][NR],(\d+),/.exec(zpl)?.[1] ?? "?";
    console.log(`out/${fileName}.png  DIN ${din}  K ${checkCharacter(din)}  font ${labelFont}`);
    console.log(
      `  ${geometry.symbolModules} modules at ${geometry.moduleDots} dots = ` +
        `${geometry.symbolWidthDots} dots (${geometry.symbolWidthMm.toFixed(1)} mm), ` +
        `quiet zone ${geometry.quietZoneDots} dots, text at ${fontHeight} dots, ` +
        `${zpl.length} bytes of ZPL`,
    );
  }
}

// A larger `dpmm` would be the obvious way to get a magnified preview, but zebrash 1.0.3
// treats ZPL coordinates as raw dots and only grows the canvas around them, so the label
// comes out the same size on a bigger sheet. Zoom the PNG in an image viewer instead.
