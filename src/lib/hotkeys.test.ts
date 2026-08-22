import { describe, expect, it } from "vitest";

import { isHotkeyIgnored } from "./hotkeys";

function target(overrides: Partial<HTMLElement> = {}): HTMLElement {
  return {
    isContentEditable: false,
    tagName: "DIV",
    closest: () => null,
    getAttribute: () => null,
    ...overrides,
  } as unknown as HTMLElement;
}

describe("isHotkeyIgnored", () => {
  it("keeps global shortcuts active on ordinary content", () => {
    expect(isHotkeyIgnored(target())).toBe(false);
  });

  it.each(["INPUT", "TEXTAREA", "SELECT", "BUTTON"])(
    "ignores shortcuts from %s controls",
    (tagName) => {
      expect(isHotkeyIgnored(target({ tagName }))).toBe(true);
    },
  );

  it("ignores editable, dialog and slider targets", () => {
    expect(isHotkeyIgnored(target({ isContentEditable: true }))).toBe(true);
    expect(isHotkeyIgnored(target({ closest: () => target() }))).toBe(true);
    expect(isHotkeyIgnored(target({ getAttribute: () => "slider" }))).toBe(true);
  });
});
