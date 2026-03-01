export type EmailAuthSheetMode = "login" | "signup" | "forgot";

export type EmailAuthSheetState = {
  isOpen: boolean;
  isClosing: boolean;
  mode: EmailAuthSheetMode;
};

export type EmailAuthSheetTransition = "to_login" | "to_signup" | "to_forgot";

export function createDefaultEmailAuthSheetState(): EmailAuthSheetState {
  return {
    isOpen: false,
    isClosing: false,
    mode: "login",
  };
}

export function openEmailAuthSheet(): EmailAuthSheetState {
  return {
    isOpen: true,
    isClosing: false,
    mode: "login",
  };
}

export function transitionEmailAuthSheetMode(
  currentMode: EmailAuthSheetMode,
  transition: EmailAuthSheetTransition,
  isSubmitting: boolean,
): EmailAuthSheetMode {
  if (isSubmitting) return currentMode;
  if (transition === "to_signup") return "signup";
  if (transition === "to_forgot") return "forgot";
  return "login";
}

export function canStartClosingEmailAuthSheet(args: {
  isOpen: boolean;
  isClosing: boolean;
  isSubmitting: boolean;
}): boolean {
  return args.isOpen && !args.isClosing && !args.isSubmitting;
}

export function finishClosingEmailAuthSheet(): EmailAuthSheetState {
  return createDefaultEmailAuthSheetState();
}

