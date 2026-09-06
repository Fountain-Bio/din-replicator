# Bundled label fonts

The app can print a replica label in the printer's own font or in one of the
fonts recorded here. Both bundled fonts are cut down to the characters a
replica label can show, so each file is a few kilobytes rather than a few
hundred. `scripts/subset-label-fonts.ts` rebuilds them, and `README.md`
in this directory says how.

ICCBBA IG-002 section 5.1.2 requires the eye-readable DIN to be set in a sans
serif typeface, and ST-001 section 7.4 requires the reader to be able to tell
0 from O and 1 from I. Both fonts here are sans serif and draw those four
characters apart from one another.

## Inter Bold

- **Name**: Inter Bold
- **Version**: 4.1 (`Version 4.001;git-9221beed3`)
- **Source**: https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip, file `extras/ttf/Inter-Bold.ttf`
- **Project**: https://github.com/rsms/inter
- **License**: SIL Open Font License 1.1, copied verbatim into `inter-ofl-1.1.txt`
- **Bundled as**: `inter-bold-subset.ttf`, 5028 bytes

A sans serif face drawn for screens and small print. Its zero is a narrow oval and its capital O a wide circle, and its digit one carries an angled flag where its capital I is a plain bar.

## JetBrains Mono Bold

- **Name**: JetBrains Mono Bold
- **Version**: 2.304 (`Version 2.304; ttfautohint (v1.8.4.7-5d5b)`)
- **Source**: https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip, file `fonts/ttf/JetBrainsMono-Bold.ttf`
- **Project**: https://github.com/JetBrains/JetBrainsMono
- **License**: SIL Open Font License 1.1, copied verbatim into `jetbrains-mono-ofl-1.1.txt`
- **Bundled as**: `jetbrains-mono-bold-subset.ttf`, 4880 bytes

A monospaced sans serif face drawn for reading code, where a misread character is a bug. Its zero carries a dot, its capital I has a bar at the top and the bottom, and every character is the same width, so a DIN lines up column by column.
