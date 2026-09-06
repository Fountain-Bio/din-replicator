/**
 * Renders replica label ZPL to PNGs so a person can check the layout without a printer.
 *
 * Run it with `bun run preview:label`. It writes one `.zpl` and one `.png` into `out/` for
 * each sample DIN:
 *   - `label` is a DIN whose FIN starts with one letter. Its barcode is 145 modules and
 *     prints at 3 dots per module.
 *   - `label-two-letter-fin` is a DIN whose FIN starts with two letters. Its barcode is 156
 *     modules, which does not fit at 3 dots, so it prints at 2 dots per module.
 *
 * The renderer is zebrash, which runs locally, so label data never leaves the machine.
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
import {
  buildReplicaZpl,
  DOTS_PER_MM,
  LABEL_HEIGHT_MM,
  LABEL_WIDTH_MM,
  replicaLabelGeometry,
} from "../src/lib/label/replica-zpl";

const OUT_DIR = new URL("../out/", import.meta.url);

/** The DINs this script renders, and the file name each one is written under. */
const SAMPLES = [
  { name: "label", din: "W483626000011" },
  { name: "label-two-letter-fin", din: "AB12326000011" },
];

const drawer = new Drawer();
await mkdir(OUT_DIR, { recursive: true });

for (const { name, din } of SAMPLES) {
  const zpl = buildReplicaZpl({ din, copies: 1 });
  const label = new Parser().parse(zpl)[0];
  if (label === undefined) {
    throw new Error(`zebrash parsed no label out of the ZPL for ${din}`);
  }

  const png = await drawer.drawLabelAsPng(label, {
    labelWidthMm: LABEL_WIDTH_MM,
    labelHeightMm: LABEL_HEIGHT_MM,
    dpmm: DOTS_PER_MM,
  });

  await writeFile(new URL(`${name}.zpl`, OUT_DIR), zpl);
  await writeFile(new URL(`${name}.png`, OUT_DIR), png);

  const geometry = replicaLabelGeometry(din);
  const fontHeight = /\^A0N,(\d+),/.exec(zpl)?.[1] ?? "?";
  console.log(`out/${name}.png  DIN ${din}  K ${checkCharacter(din)}`);
  console.log(
    `  ${geometry.symbolModules} modules at ${geometry.moduleDots} dots = ` +
      `${geometry.symbolWidthDots} dots (${geometry.symbolWidthMm.toFixed(1)} mm), ` +
      `quiet zone ${geometry.quietZoneDots} dots, text at ${fontHeight} dots`,
  );
}

// A larger `dpmm` would be the obvious way to get a magnified preview, but zebrash 1.0.3
// treats ZPL coordinates as raw dots and only grows the canvas around them, so the label
// comes out the same size on a bigger sheet. Zoom the 300 dpi PNG in an image viewer instead.
