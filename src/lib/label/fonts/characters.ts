/**
 * Every character a replica label can print.
 *
 * The eye-readable line holds a DIN, two flag characters, and a check
 * character, so it can show digits and capital letters. `*` is one of the 37
 * values ISO 7064 MOD 37,2 can give a check character, and the space separates
 * the three parts of the DIN. `=` is the ISBT 128 data identifier, which the
 * bar code carries rather than the text, and it costs almost nothing to keep a
 * glyph for it.
 *
 * The bundled fonts are cut down to exactly these characters, which is what
 * makes each one a few kilobytes rather than a few hundred. Adding a character
 * to a label means adding it here and rebuilding the fonts with
 * `bun run scripts/subset-label-fonts.ts`.
 */
export const LABEL_CHARACTERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ *=";
