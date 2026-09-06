/**
 * The check character K that ISO/IEC 7064 MOD 37,2 derives from a DIN.
 *
 * ICCBBA ST-001 v6.2.2 section 7.5 puts K in the eye-readable text so a person
 * who types a DIN by hand can tell whether they typed it correctly. K is not
 * part of the barcode payload, so this app prints it only inside its box under
 * the barcode.
 */

/**
 * The characters ST-001 appendix A.3 gives a value to. The value of a character
 * is its position in this string, so "0" is 0, "A" is 10, and "*" is 36.
 */
const CHECK_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ*";

const MODULUS = 37;

/** True when `character` is one character that ST-001 appendix A.3 can produce as K. */
export function isCheckCharacter(character: string): boolean {
  return character.length === 1 && CHECK_ALPHABET.includes(character);
}

/**
 * Returns the check character for `din`.
 *
 * ST-001 appendix A.3 states the algorithm. The running sum starts at 0. For
 * each character the sum grows by the value of the character and then doubles,
 * modulo 37. K is the character whose value is (38 - sum) modulo 37.
 *
 * Callers pass the 13-character DIN. `validateDin` is the function that decides
 * whether a string is a DIN, so this function only rejects characters that
 * ST-001 appendix A.3 gives no value to.
 */
export function checkCharacter(din: string): string {
  let sum = 0;
  for (const character of din) {
    const value = CHECK_ALPHABET.indexOf(character);
    if (value < 0) {
      throw new Error(`"${character}" has no ISO 7064 MOD 37,2 value, so K is undefined`);
    }
    sum = ((sum + value) * 2) % MODULUS;
  }
  return CHECK_ALPHABET[(38 - sum) % MODULUS];
}
