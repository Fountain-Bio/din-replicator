# Bundled label fonts

The eye-readable line on a replica is set in the printer's own font unless the
operator chooses one of the fonts in this directory. A chosen font travels to
the printer inside the label's own ZPL, so no font has to be installed on the
printer and nothing this app sends outlives the printer's next power cycle.

`LICENSES.md` records what each font is, which release it came from, and the
licence it carries. The licence text of each font sits beside it, exactly as
the font project ships it.

## What is here

| File                    | What it is                                             |
| ----------------------- | ------------------------------------------------------ |
| `characters.ts`         | Every character a replica label can print.             |
| `*-subset.ttf`          | The font, cut down to those characters.                |
| `*-subset.generated.ts` | The same file as hexadecimal, plus glyph measurements. |
| `*-ofl-1.1.txt`         | The font's licence, as the font project ships it.      |
| `LICENSES.md`           | What each font is and where it came from.              |

`../fonts.ts` reads the generated modules and builds the two ZPL commands a
bundled font needs: `~DU` to send the font, and `^A@` to set a field in it.

## Rebuilding

Run this from the top of the repository:

```sh
bun run scripts/subset-label-fonts.ts
```

It needs a network connection and `uv`. It downloads each font project's
release archive, takes the bold TrueType file and the licence text out of it,
and rewrites every file in this directory except `characters.ts` and this
README. Nothing else runs it, and the app reads only what it wrote.

The subsetting itself is `pyftsubset` from fontTools:

```sh
uv run --with fonttools pyftsubset Inter-Bold.ttf \
  --output-file=inter-bold-subset.ttf \
  --text='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ *=' \
  --layout-features= --no-hinting --drop-tables+=DSIG --name-IDs='*'
```

Dropping the OpenType features costs nothing, because the printer applies none
of them. The name table is kept whole, so the file still says what it is and
who licensed it. A subset comes out around five kilobytes, which is ten
kilobytes of hexadecimal in every label that uses it.

## Adding a character to a label

Add it to `characters.ts` and rebuild. A character that is not in the subset
prints as nothing, and the layout measures it as the widest character the font
holds, so a missing character leaves a gap rather than a line that runs off the
label.
