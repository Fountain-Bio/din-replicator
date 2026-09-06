/**
 * Rebuilds the bundled label fonts in `src/lib/label/fonts/`.
 *
 * Run it with `bun run scripts/subset-label-fonts.ts`. It needs a network
 * connection and `uv`, and it is the only thing that writes the files it
 * produces. Nothing in the app runs it; the app reads the files it committed.
 *
 * For each font it downloads the release archive the font project publishes,
 * takes the bold TrueType file and the licence text out of it, cuts the font
 * down to the characters a replica label can show, and writes:
 *
 *   - the subset TrueType file, a few kilobytes rather than a few hundred;
 *   - the licence text exactly as the project ships it;
 *   - a TypeScript module holding the subset as ASCII hex, ready to go into a
 *     `~DU` download command, together with the glyph measurements the label
 *     layout needs;
 *   - `LICENSES.md`, which records what each font is and where it came from.
 *
 * The subsetting is `pyftsubset` from fontTools, run through `uv` so no Python
 * environment has to be set up first. The measurements come from the same
 * tool reading the subset file, so they describe exactly the bytes the printer
 * is sent.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LABEL_CHARACTERS } from "../src/lib/label/fonts/characters";

/** Where the finished font files, licences, and modules are written. */
const FONTS_DIR = new URL("../src/lib/label/fonts/", import.meta.url);

/** Where the downloaded archives and the unpacked originals are kept. */
const WORK_DIR = new URL("../out/label-fonts/", import.meta.url);

/** One font this script bundles, and everything needed to rebuild it. */
interface FontSource {
  /** The `LabelFont` value this font is offered under. */
  key: "sans" | "mono";
  /** The font's own name for itself, weight included. */
  displayName: string;
  /** The release the archive was published under. */
  version: string;
  /** The archive the font project publishes for this release. */
  archiveUrl: string;
  /** Path of the bold TrueType file inside the archive. */
  archiveFontPath: string;
  /** Path of the licence text inside the archive. */
  archiveLicensePath: string;
  /** The licence the font is offered under. */
  license: string;
  /** The project's home page, for anyone checking the licence themselves. */
  projectUrl: string;
  /** Why this face suits a DIN, in one sentence for `LICENSES.md`. */
  suitability: string;
  /** File name the subset TrueType is written under. */
  subsetFile: string;
  /** File name the licence text is written under. */
  licenseFile: string;
  /** File name the generated module is written under. */
  moduleFile: string;
  /** The constant the generated module exports. */
  exportName: string;
}

const SOURCES: FontSource[] = [
  {
    key: "sans",
    displayName: "Inter Bold",
    version: "4.1",
    archiveUrl: "https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip",
    archiveFontPath: "extras/ttf/Inter-Bold.ttf",
    archiveLicensePath: "LICENSE.txt",
    license: "SIL Open Font License 1.1",
    projectUrl: "https://github.com/rsms/inter",
    suitability:
      "A sans serif face drawn for screens and small print. Its zero is a narrow oval and " +
      "its capital O a wide circle, and its digit one carries an angled flag where its " +
      "capital I is a plain bar.",
    subsetFile: "inter-bold-subset.ttf",
    licenseFile: "inter-ofl-1.1.txt",
    moduleFile: "inter-bold-subset.generated.ts",
    exportName: "INTER_BOLD_SUBSET",
  },
  {
    key: "mono",
    displayName: "JetBrains Mono Bold",
    version: "2.304",
    archiveUrl:
      "https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip",
    archiveFontPath: "fonts/ttf/JetBrainsMono-Bold.ttf",
    archiveLicensePath: "OFL.txt",
    license: "SIL Open Font License 1.1",
    projectUrl: "https://github.com/JetBrains/JetBrainsMono",
    suitability:
      "A monospaced sans serif face drawn for reading code, where a misread character is a " +
      "bug. Its zero carries a dot, its capital I has a bar at the top and the bottom, and " +
      "every character is the same width, so a DIN lines up column by column.",
    subsetFile: "jetbrains-mono-bold-subset.ttf",
    licenseFile: "jetbrains-mono-ofl-1.1.txt",
    moduleFile: "jetbrains-mono-bold-subset.generated.ts",
    exportName: "JETBRAINS_MONO_BOLD_SUBSET",
  },
];

/**
 * What fontTools reports about a subset font, in the font's own units.
 *
 * `advance`, `left`, and `right` are the advance width and the two side
 * bearings of one character. Side bearings are the white space the glyph
 * leaves inside its advance, so `advance - left - right` is how wide the ink
 * runs.
 */
interface FontMeasurements {
  unitsPerEm: number;
  capHeight: number;
  ascender: number;
  descender: number;
  familyName: string;
  versionName: string;
  glyphs: Record<string, { advance: number; left: number; right: number }>;
}

/** Runs a command, fails on a non-zero exit, and gives back what it printed. */
function run(command: string, args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(out);
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
    if (stdin !== undefined) {
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
  });
}

/** Downloads `url` into the working directory, keeping whatever is there already. */
async function download(url: string, into: URL): Promise<void> {
  if (await Bun.file(into).exists()) {
    return;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  await writeFile(into, new Uint8Array(await response.arrayBuffer()));
}

/**
 * Reads the measurements out of a TrueType file.
 *
 * The cap height comes from the `OS/2` table and the ascender and descender
 * from `hhea`, because those are the numbers a renderer reads when it lays a
 * line of text out.
 */
async function measure(fontPath: string): Promise<FontMeasurements> {
  const program = `
import json, sys
from fontTools.ttLib import TTFont

font = TTFont(sys.argv[1])
characters = sys.argv[2]
cmap = font.getBestCmap()
hmtx = font["hmtx"]
glyf = font["glyf"]

glyphs = {}
for character in characters:
    name = cmap[ord(character)]
    advance, left = hmtx[name]
    glyph = glyf[name]
    if glyph.numberOfContours == 0:
        glyphs[character] = {"advance": advance, "left": 0, "right": 0}
        continue
    glyph.recalcBounds(glyf)
    glyphs[character] = {
        "advance": advance,
        "left": glyph.xMin,
        "right": advance - glyph.xMax,
    }

json.dump(
    {
        "unitsPerEm": font["head"].unitsPerEm,
        "capHeight": font["OS/2"].sCapHeight,
        "ascender": font["hhea"].ascender,
        "descender": font["hhea"].descender,
        "familyName": font["name"].getDebugName(4),
        "versionName": font["name"].getDebugName(5),
        "glyphs": glyphs,
    },
    sys.stdout,
)
`;
  const out = await run(
    "uv",
    ["run", "--with", "fonttools", "python", "-", fontPath, LABEL_CHARACTERS],
    program,
  );
  return JSON.parse(out) as FontMeasurements;
}

/** Rounds a ratio to four places, which is a hundredth of a dot at label sizes. */
function ratio(value: number, unitsPerEm: number): number {
  return Math.round((value / unitsPerEm) * 10_000) / 10_000;
}

/** Writes the generated module for one font. */
async function writeModule(
  source: FontSource,
  bytes: Uint8Array,
  measurements: FontMeasurements,
): Promise<void> {
  const unitsPerEm = measurements.unitsPerEm;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(
    "",
  );

  const glyphLines = [...LABEL_CHARACTERS].map((character) => {
    const glyph = measurements.glyphs[character]!;
    return (
      `    ${JSON.stringify(character)}: [${ratio(glyph.advance, unitsPerEm)}, ` +
      `${ratio(glyph.left, unitsPerEm)}, ${ratio(glyph.right, unitsPerEm)}],`
    );
  });

  // zebrash puts the baseline three quarters of the way down the font's own
  // line height, which is the ascender plus the descender. The printer works
  // from the same metrics, so one number describes both.
  const lineHeight = measurements.ascender - measurements.descender;

  const module = `/**
 * ${measurements.familyName}, cut down to the characters a replica label can show.
 *
 * Generated by \`bun run scripts/subset-label-fonts.ts\`. Do not edit by hand.
 * ${source.projectUrl}, ${source.license}. See LICENSES.md.
 */

export const ${source.exportName} = {
  displayName: ${JSON.stringify(source.displayName)},
  version: ${JSON.stringify(source.version)},
  fontVersion: ${JSON.stringify(measurements.versionName)},
  sourceUrl: ${JSON.stringify(source.archiveUrl)},
  license: ${JSON.stringify(source.license)},
  subsetFile: ${JSON.stringify(source.subsetFile)},
  byteCount: ${bytes.length},
  capHeightRatio: ${ratio(measurements.capHeight, unitsPerEm)},
  baselineRatio: ${ratio(0.75 * lineHeight, unitsPerEm)},
  lineHeightRatio: ${ratio(lineHeight, unitsPerEm)},
  /** Advance width, left side bearing, and right side bearing of each character. */
  glyphs: {
${glyphLines.join("\n")}
  } as Record<string, [number, number, number]>,
  hex: "${hex}",
};
`;

  await writeFile(new URL(source.moduleFile, FONTS_DIR), module);
}

/** Writes the record of what each bundled font is and where it came from. */
async function writeLicenses(
  built: Array<{ source: FontSource; bytes: Uint8Array; measurements: FontMeasurements }>,
): Promise<void> {
  const sections = built.map(
    ({ source, bytes, measurements }) => `## ${source.displayName}

- **Name**: ${measurements.familyName}
- **Version**: ${source.version} (\`${measurements.versionName}\`)
- **Source**: ${source.archiveUrl}, file \`${source.archiveFontPath}\`
- **Project**: ${source.projectUrl}
- **License**: ${source.license}, copied verbatim into \`${source.licenseFile}\`
- **Bundled as**: \`${source.subsetFile}\`, ${bytes.length} bytes

${source.suitability}
`,
  );

  const text = `# Bundled label fonts

The app can print a replica label in the printer's own font or in one of the
fonts recorded here. Both bundled fonts are cut down to the characters a
replica label can show, so each file is a few kilobytes rather than a few
hundred. \`scripts/subset-label-fonts.ts\` rebuilds them, and \`README.md\`
in this directory says how.

ICCBBA IG-002 section 5.1.2 requires the eye-readable DIN to be set in a sans
serif typeface, and ST-001 section 7.4 requires the reader to be able to tell
0 from O and 1 from I. Both fonts here are sans serif and draw those four
characters apart from one another.

${sections.join("\n")}`;

  await writeFile(new URL("LICENSES.md", FONTS_DIR), text);
}

await mkdir(WORK_DIR, { recursive: true });
await mkdir(FONTS_DIR, { recursive: true });

const built: Array<{ source: FontSource; bytes: Uint8Array; measurements: FontMeasurements }> = [];

for (const source of SOURCES) {
  const archive = new URL(`${source.key}.zip`, WORK_DIR);
  const unpacked = new URL(`${source.key}/`, WORK_DIR);

  console.log(`${source.displayName}: downloading ${source.archiveUrl}`);
  await download(source.archiveUrl, archive);
  await rm(unpacked, { recursive: true, force: true });
  await run("unzip", [
    "-o",
    "-q",
    fileURLToPath(archive),
    source.archiveFontPath,
    source.archiveLicensePath,
    "-d",
    fileURLToPath(unpacked),
  ]);

  const original = fileURLToPath(new URL(source.archiveFontPath, unpacked));
  const subset = fileURLToPath(new URL(source.subsetFile, FONTS_DIR));

  // --layout-features='' drops every OpenType feature: the printer applies
  // none of them, so keeping them would only add bytes. The name table is kept
  // whole, so the file still says what it is and who licensed it.
  await run("uv", [
    "run",
    "--with",
    "fonttools",
    "pyftsubset",
    original,
    `--output-file=${subset}`,
    `--text=${LABEL_CHARACTERS}`,
    "--layout-features=",
    "--no-hinting",
    "--drop-tables+=DSIG",
    "--name-IDs=*",
  ]);

  await writeFile(
    new URL(source.licenseFile, FONTS_DIR),
    await readFile(new URL(source.archiveLicensePath, unpacked)),
  );

  const bytes = new Uint8Array(await readFile(subset));
  const measurements = await measure(subset);
  await writeModule(source, bytes, measurements);
  built.push({ source, bytes, measurements });

  console.log(
    `  ${source.subsetFile}: ${bytes.length} bytes, ` +
      `${[...LABEL_CHARACTERS].length} characters, ` +
      `cap height ${ratio(measurements.capHeight, measurements.unitsPerEm)} em`,
  );
}

await writeLicenses(built);
console.log("LICENSES.md written");
