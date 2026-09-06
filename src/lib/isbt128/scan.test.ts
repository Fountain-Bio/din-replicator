import { describe, expect, it } from "vitest";
import { checkCharacter } from "./check-character";
import { barcodePayload } from "./din";
import { parseScan } from "./scan";

/** The DIN on the real the facility source label. Its check character is N. */
const FOUNTAIN_DIN = "W483626000011";

/** A DIN from the same the facility set whose check character is "0". */
const ZERO_CHECK_DIN = "W483626000289";

describe("parseScan", () => {
  it("reads a bare DIN", () => {
    expect(parseScan(FOUNTAIN_DIN)).toEqual({ kind: "din", din: FOUNTAIN_DIN, form: "bare" });
  });

  it("reads the compliant 16-character payload and reports its flag characters", () => {
    expect(parseScan("=W48362600001100")).toEqual({
      kind: "din",
      din: FOUNTAIN_DIN,
      form: "payload",
      flags: "00",
    });
  });

  it("reads the 15-character the earlier label tool form and confirms its check character", () => {
    expect(parseScan("=W483626000011N")).toEqual({
      kind: "din",
      din: FOUNTAIN_DIN,
      form: "legacy-check",
      scannedCheck: "N",
      checkMatches: true,
    });
  });

  it("reports a check character that does not match the DIN", () => {
    expect(parseScan("=W483626000011X")).toEqual({
      kind: "din",
      din: FOUNTAIN_DIN,
      form: "legacy-check",
      scannedCheck: "X",
      checkMatches: false,
    });
  });

  it("reads the the earlier label tool form after a scanner rule appended a 0", () => {
    expect(parseScan("=W483626000011N0")).toEqual({
      kind: "din",
      din: FOUNTAIN_DIN,
      form: "legacy-check-suffixed",
      scannedCheck: "N",
      checkMatches: true,
    });
  });

  /**
   * "X0" is a legal pair of flag characters and "X" is not the check character
   * of this DIN, so the scan is the compliant payload. The check character
   * followed by "0" is the only ambiguous pair, and `parseDinStructure`
   * explains why.
   */
  it("treats a 16-character scan whose trailing pair is not K and 0 as flag characters", () => {
    expect(parseScan("=W483626000011X0")).toEqual({
      kind: "din",
      din: FOUNTAIN_DIN,
      form: "payload",
      flags: "X0",
    });
  });

  /**
   * One DIN in thirty-seven has "0" as its check character. Reading a trailing
   * "00" as the the earlier label tool form would misreport the replicas this app
   * prints for those DINs.
   */
  it("reads a trailing 00 as flag characters even when the check character is 0", () => {
    expect(checkCharacter(ZERO_CHECK_DIN)).toBe("0");
    expect(parseScan("=W48362600028900")).toEqual({
      kind: "din",
      din: ZERO_CHECK_DIN,
      form: "payload",
      flags: "00",
    });
  });

  it("reports two trailing characters that are neither flag characters nor a check character and 0", () => {
    expect(parseScan("=W483626000011IZ")).toEqual({
      kind: "not-din",
      reason: "bad-flag-characters",
    });
  });

  it("uppercases a scan", () => {
    expect(parseScan("w483626000011")).toEqual({ kind: "din", din: FOUNTAIN_DIN, form: "bare" });
    expect(parseScan("=w483626000011n0")).toEqual({
      kind: "din",
      din: FOUNTAIN_DIN,
      form: "legacy-check-suffixed",
      scannedCheck: "N",
      checkMatches: true,
    });
  });

  it("drops the carriage return and line feed a scanner sends as a terminator", () => {
    expect(parseScan("W483626000011\r\n")).toEqual({
      kind: "din",
      din: FOUNTAIN_DIN,
      form: "bare",
    });
    expect(parseScan("  =W48362600001100\r\n")).toEqual({
      kind: "din",
      din: FOUNTAIN_DIN,
      form: "payload",
      flags: "00",
    });
  });

  it("names a blood group scan", () => {
    expect(parseScan("=%5100")).toEqual({ kind: "not-din", reason: "blood-group" });
  });

  it("names a product code scan", () => {
    expect(parseScan("=<E8341V00")).toEqual({ kind: "not-din", reason: "product-code" });
  });

  it("names an expiration scan under either data identifier", () => {
    expect(parseScan("&>0261232359")).toEqual({ kind: "not-din", reason: "expiration" });
    expect(parseScan("=>0261232359")).toEqual({ kind: "not-din", reason: "expiration" });
  });

  it("names any other ISBT 128 structure", () => {
    expect(parseScan("&,001A0000")).toEqual({ kind: "not-din", reason: "other-isbt128-structure" });
    expect(parseScan("=}1234")).toEqual({ kind: "not-din", reason: "other-isbt128-structure" });
  });

  it("reports the structure rule a 13-character scan breaks", () => {
    expect(parseScan("O483626000011")).toEqual({ kind: "not-din", reason: "bad-first-character" });
    expect(parseScan("0483626000011")).toEqual({ kind: "not-din", reason: "bad-first-character" });
    expect(parseScan("=W4836260000A100")).toEqual({ kind: "not-din", reason: "non-digit" });
  });

  it("reports an empty scan", () => {
    expect(parseScan("")).toEqual({ kind: "not-din", reason: "empty" });
    expect(parseScan("  \r\n")).toEqual({ kind: "not-din", reason: "empty" });
  });

  it("reports a scan that resembles nothing in ISBT 128", () => {
    expect(parseScan("HELLO")).toEqual({ kind: "not-din", reason: "unrecognized" });
  });

  it("reads back the payload this app prints", () => {
    expect(parseScan(barcodePayload(FOUNTAIN_DIN))).toEqual({
      kind: "din",
      din: FOUNTAIN_DIN,
      form: "payload",
      flags: "00",
    });
  });
});
