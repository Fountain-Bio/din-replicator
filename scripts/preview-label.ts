/**
 * Renders the replica label ZPL to a PNG so a person can check the layout without a printer.
 *
 * Run it with `bun run preview:label`. It writes `out/label.zpl` and `out/label.png`. The
 * sample DIN is the sample label W483626000011, whose check character is N.
 *
 * The renderer is zebrash, which runs locally, so label data never leaves the machine.
 *
 * Known gap: zebrash 1.0.3 mishandles the `>5` invocation code in `^BC` mode N. Zebra's own
 * invocation table maps `>5` to Code 128 value 99, CODE C, but zebrash re-emits the current
 * subset instead and keeps encoding in subset B. The preview therefore draws the digits one
 * symbol character each, so its barcode is 160 modules wide where the printer's is 145. Read
 * the preview for the text layout and the spacing under the bars, and take the symbol width
 * from the geometry constants in `src/lib/label/replica-zpl.ts`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { Drawer, Parser } from "@zebrash/node";
import {
  barcodeLeftDots,
  buildReplicaZpl,
  DOTS_PER_MM,
  LABEL_HEIGHT_MM,
  LABEL_WIDTH_MM,
  symbolWidthDots,
} from "../src/lib/label/replica-zpl";

const OUT_DIR = new URL("../out/", import.meta.url);
const PAYLOAD = "=W48362600001100";

const zpl = buildReplicaZpl({
  payload: PAYLOAD,
  fin: "W4836",
  year: "26",
  sequence: "000011",
  flags: "00",
  check: "N",
  copies: 1,
});

const label = new Parser().parse(zpl)[0];
if (label === undefined) {
  throw new Error("zebrash parsed no label out of the replica ZPL");
}

const png = await new Drawer().drawLabelAsPng(label, {
  labelWidthMm: LABEL_WIDTH_MM,
  labelHeightMm: LABEL_HEIGHT_MM,
  dpmm: DOTS_PER_MM,
});

await mkdir(OUT_DIR, { recursive: true });
await writeFile(new URL("label.zpl", OUT_DIR), zpl);
await writeFile(new URL("label.png", OUT_DIR), png);

console.log("wrote out/label.zpl and out/label.png");
console.log(
  `barcode on the printer: ${symbolWidthDots(PAYLOAD)} dots wide, starting at x=${barcodeLeftDots(PAYLOAD)}`,
);

// A larger `dpmm` would be the obvious way to get a magnified preview, but zebrash 1.0.3
// treats ZPL coordinates as raw dots and only grows the canvas around them, so the label
// comes out the same size on a bigger sheet. Zoom the 300 dpi PNG in an image viewer instead.
