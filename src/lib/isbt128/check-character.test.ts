import { describe, expect, it } from "vitest";
import { checkCharacter } from "./check-character";

/**
 * Every vector below is published by ICCBBA, except the last two, which come
 * from a sample label scanned from a production system and from a second DIN
 * in the same set.
 */
const VECTORS: Array<{ source: string; din: string; check: string }> = [
  { source: "ST-001 appendix A", din: "G123417654321", check: "A" },
  { source: "IG-033 figure 1", din: "A999917123456", check: "9" },
  { source: "ICCBBA FAQ", din: "A999914123458", check: "J" },
  { source: "IG-043 section 3.1.1", din: "W000016428175", check: "1" },
  { source: "IG-043 section 3.1.1", din: "A999916000065", check: "A" },
  { source: "IG-043 section 3.1.1", din: "W125607123456", check: "K" },
  { source: "IG-043 section 3.1.1", din: "C000306001458", check: "N" },
  { source: "IG-043 section 3.1.1", din: "P000206019063", check: "X" },
  { source: "IG-043 section 3.1.1", din: "9000116123456", check: "E" },
  { source: "IG-043 section 3.1.1", din: "5032116593212", check: "Q" },
  { source: "IG-043 section 3.1.1", din: "WWW0016123456", check: "6" },
  { source: "IG-043 section 3.1.1", din: "W000016123456", check: "X" },
  { source: "IG-043 section 3.1.1", din: "W000016987654", check: "U" },
  { source: "IG-043 section 3.1.1", din: "W000016000001", check: "C" },
  { source: "sample label", din: "W483626000011", check: "N" },
  { source: "sample label", din: "W483626000400", check: "Y" },
];

describe("checkCharacter", () => {
  for (const vector of VECTORS) {
    it(`gives ${vector.check} for ${vector.din} (${vector.source})`, () => {
      expect(checkCharacter(vector.din)).toBe(vector.check);
    });
  }

  it("throws when a character has no ISO 7064 MOD 37,2 value", () => {
    expect(() => checkCharacter("W48362600001-")).toThrow();
  });
});
