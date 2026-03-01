import { describe, expect, it } from "vitest";
import {
  canStartClosingEmailAuthSheet,
  createDefaultEmailAuthSheetState,
  finishClosingEmailAuthSheet,
  openEmailAuthSheet,
  transitionEmailAuthSheetMode,
} from "@/components/email-auth-sheet-state";

describe("email-auth-sheet-state", () => {
  it("creates closed default state", () => {
    expect(createDefaultEmailAuthSheetState()).toEqual({
      isOpen: false,
      isClosing: false,
      mode: "login",
    });
  });

  it("opens sheet with login mode", () => {
    expect(openEmailAuthSheet()).toEqual({
      isOpen: true,
      isClosing: false,
      mode: "login",
    });
  });

  it("transitions mode when not submitting", () => {
    expect(transitionEmailAuthSheetMode("login", "to_signup", false)).toBe("signup");
    expect(transitionEmailAuthSheetMode("signup", "to_forgot", false)).toBe("forgot");
    expect(transitionEmailAuthSheetMode("forgot", "to_login", false)).toBe("login");
  });

  it("prevents mode transition while submitting", () => {
    expect(transitionEmailAuthSheetMode("signup", "to_login", true)).toBe("signup");
    expect(transitionEmailAuthSheetMode("forgot", "to_signup", true)).toBe("forgot");
  });

  it("allows close transition only when open and idle", () => {
    expect(canStartClosingEmailAuthSheet({
      isOpen: true,
      isClosing: false,
      isSubmitting: false,
    })).toBe(true);
    expect(canStartClosingEmailAuthSheet({
      isOpen: false,
      isClosing: false,
      isSubmitting: false,
    })).toBe(false);
    expect(canStartClosingEmailAuthSheet({
      isOpen: true,
      isClosing: true,
      isSubmitting: false,
    })).toBe(false);
    expect(canStartClosingEmailAuthSheet({
      isOpen: true,
      isClosing: false,
      isSubmitting: true,
    })).toBe(false);
  });

  it("resets to default state after closing", () => {
    expect(finishClosingEmailAuthSheet()).toEqual(createDefaultEmailAuthSheetState());
  });
});
