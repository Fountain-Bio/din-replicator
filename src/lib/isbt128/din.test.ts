import { describe, expect, it } from "vitest";
import { barcodePayload, eyeReadable, validateDin } from "./din";

/** The sample DIN, scanned from a production label. Its check character is N. */
const SAMPLE_DIN = "W483626000011";

describe("validateDin", () => {
  it("splits a valid DIN into its FIN, year, and sequence", () => {
    expect(validateDin(SAMPLE_DIN)).toEqual({
      ok: true,
      din: SAMPLE_DIN,
      fin: "W4836",
      year: "26",
      sequence: "000011",
    });
  });

  it("accepts a digit as the first character", () => {
    expect(validateDin("9000116123456").ok).toBe(true);
  });

  it("accepts letters in characters 2 and 3", () => {
    expect(validateDin("WWW0016123456").ok).toBe(true);
  });

  it("rejects a string that is not 13 characters", () => {
    expect(validateDin("")).toEqual({ ok: false, reason: "wrong-length" });
    expect(validateDin("W48362600001")).toEqual({ ok: false, reason: "wrong-length" });
    expect(validateDin("W4836260000110")).toEqual({ ok: false, reason: "wrong-length" });
  });

  it("rejects O and 0 as the first character", () => {
    expect(validateDin("O483626000011")).toEqual({ ok: false, reason: "bad-first-character" });
    expect(validateDin("0483626000011")).toEqual({ ok: false, reason: "bad-first-character" });
  });

  it("rejects O in characters 2 and 3", () => {
    expect(validateDin("WO8626000011X")).toEqual({ ok: false, reason: "bad-facility-character" });
    expect(validateDin("W4O626000011X")).toEqual({ ok: false, reason: "bad-facility-character" });
  });

  it("rejects a letter anywhere in characters 4 to 13", () => {
    expect(validateDin("W48X260000111")).toEqual({ ok: false, reason: "non-digit" });
    expect(validateDin("W483626X00011")).toEqual({ ok: false, reason: "non-digit" });
  });
});

describe("barcodePayload", () => {
  it("builds the 16-character payload with no flag in use", () => {
    expect(barcodePayload(SAMPLE_DIN)).toBe("=W48362600001100");
  });

  it("uses the flag characters the caller asks for", () => {
    expect(barcodePayload(SAMPLE_DIN, "A1")).toBe("=W483626000011A1");
  });

  it("throws on a DIN that breaks a structure rule", () => {
    expect(() => barcodePayload("O483626000011")).toThrow();
  });

  it("throws on flag characters that ST-001 does not allow", () => {
    expect(() => barcodePayload(SAMPLE_DIN, "0")).toThrow();
    expect(() => barcodePayload(SAMPLE_DIN, "OO")).toThrow();
  });
});

describe("eyeReadable", () => {
  it("formats the text as FIN, year, and sequence", () => {
    expect(eyeReadable(SAMPLE_DIN).text).toBe("W4836 26 000011");
  });

  it("returns the parts a label lays out, including the check character", () => {
    expect(eyeReadable(SAMPLE_DIN)).toEqual({
      fin: "W4836",
      year: "26",
      sequence: "000011",
      flags: "00",
      check: "N",
      text: "W4836 26 000011",
    });
  });

  it("reports the flag characters the caller asks for, the same ones the barcode encodes", () => {
    expect(eyeReadable(SAMPLE_DIN, "A1").flags).toBe("A1");
    expect(barcodePayload(SAMPLE_DIN, "A1")).toBe("=W483626000011A1");
  });

  it("throws on a DIN that breaks a structure rule", () => {
    expect(() => eyeReadable("W483626X00011")).toThrow();
  });

  it("throws on flag characters that ST-001 does not allow", () => {
    expect(() => eyeReadable(SAMPLE_DIN, "OO")).toThrow();
  });
});
