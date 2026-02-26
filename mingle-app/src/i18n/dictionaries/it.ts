import { createProfileLocalizedDictionary } from "@/i18n/dictionaries/create-profile-localized-dictionary";

export const itDictionary = createProfileLocalizedDictionary({
  authTitle: "Autenticazione",
  loginRequiredTitle: "Accesso richiesto",
  loginRequiredDescription: "Accedi con Apple o Google per usare il traduttore.",
  loginLoading: "Verifica della sessione...",
  signedInAs: "Accesso effettuato come",
  loginApple: "Accedi con Apple",
  loginGoogle: "Accedi con Google",
  loginDemo: "Accesso demo",
  logout: "Disconnetti",
  deleteAccount: "Elimina account",
  menuLabel: "Menu",
  deleteAccountConfirm: "Eliminare i dati dell'account e disconnettersi ora?",
  deleteAccountFailed: "Impossibile eliminare l'account. Riprova.",
  appleNotConfigured: "Le variabili d'ambiente Apple OAuth sono mancanti, quindi l'accesso con Apple non è disponibile.",
  googleNotConfigured: "Le variabili d'ambiente Google OAuth sono mancanti, quindi è disponibile solo l'accesso demo.",
  nativeSignInFailed: "Accesso nativo non riuscito. Riprova.",
});
