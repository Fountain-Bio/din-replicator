import { describe, expect, it } from "vitest";
import { keepsItsOwnKeys, type FocusedElement } from "./use-scan-listener";

/** A focused element with the fields a case cares about and defaults for the rest. */
function focused(fields: Partial<FocusedElement>): FocusedElement {
  return { tagName: "DIV", role: null, isContentEditable: false, ...fields };
}

describe("keepsItsOwnKeys", () => {
  it("lets the screen act on a key pressed with nothing focused", () => {
    expect(keepsItsOwnKeys(null)).toBe(false);
  });

  it("lets the screen act on a key pressed on plain markup", () => {
    expect(keepsItsOwnKeys(focused({ tagName: "DIV" }))).toBe(false);
    expect(keepsItsOwnKeys(focused({ tagName: "TR" }))).toBe(false);
  });

  it("leaves typing to the field it lands in", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(keepsItsOwnKeys(focused({ tagName }))).toBe(true);
    }
    expect(keepsItsOwnKeys(focused({ isContentEditable: true }))).toBe(true);
  });

  // Enter on a focused button activates that button. Letting the screen see
  // the same key press as well would start a print run from Clear, from Skip,
  // or from a screen tab in the header.
  it("leaves Enter to a focused button or link", () => {
    expect(keepsItsOwnKeys(focused({ tagName: "BUTTON" }))).toBe(true);
    expect(keepsItsOwnKeys(focused({ tagName: "A" }))).toBe(true);
  });

  it("leaves Enter to a control that only says it behaves like a button", () => {
    for (const role of ["button", "tab", "menuitem", "switch"]) {
      expect(keepsItsOwnKeys(focused({ tagName: "DIV", role }))).toBe(true);
    }
  });

  it("lets the screen act on a role that does not activate on Enter", () => {
    expect(keepsItsOwnKeys(focused({ tagName: "DIV", role: "status" }))).toBe(false);
    expect(keepsItsOwnKeys(focused({ tagName: "DIV", role: "presentation" }))).toBe(false);
  });
});
