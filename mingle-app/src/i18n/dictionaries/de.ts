import { createProfileLocalizedDictionary } from "@/i18n/dictionaries/create-profile-localized-dictionary";

export const deDictionary = createProfileLocalizedDictionary({
  authTitle: "Authentifizierung",
  loginRequiredTitle: "Anmeldung erforderlich",
  loginRequiredDescription: "Bitte melden Sie sich mit Apple oder Google an, um den Übersetzer zu nutzen.",
  loginLoading: "Sitzung wird überprüft...",
  signedInAs: "Angemeldet als",
  loginApple: "Mit Apple anmelden",
  loginGoogle: "Mit Google anmelden",
  loginDemo: "Demo-Anmeldung",
  logout: "Abmelden",
  deleteAccount: "Konto löschen",
  menuLabel: "Menü",
  deleteAccountConfirm: "Kontodaten löschen und jetzt abmelden?",
  deleteAccountFailed: "Konto konnte nicht gelöscht werden. Bitte erneut versuchen.",
  appleNotConfigured: "Apple OAuth-Umgebungsvariablen fehlen, daher ist Apple-Anmeldung nicht verfügbar.",
  googleNotConfigured: "Google OAuth-Umgebungsvariablen fehlen, daher ist nur Demo-Anmeldung verfügbar.",
  nativeSignInFailed: "Native Anmeldung fehlgeschlagen. Bitte erneut versuchen.",
});
