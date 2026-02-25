import { createProfileLocalizedDictionary } from "@/i18n/dictionaries/create-profile-localized-dictionary";

export const frDictionary = createProfileLocalizedDictionary({
  authTitle: "Authentification",
  loginRequiredTitle: "Connexion requise",
  loginRequiredDescription: "Veuillez vous connecter avec Apple ou Google pour utiliser le traducteur.",
  loginLoading: "Vérification de votre session...",
  signedInAs: "Connecté en tant que",
  loginApple: "Se connecter avec Apple",
  loginGoogle: "Se connecter avec Google",
  loginDemo: "Connexion démo",
  logout: "Se déconnecter",
  deleteAccount: "Supprimer le compte",
  menuLabel: "Menu",
  deleteAccountConfirm: "Supprimer les données du compte et se déconnecter maintenant ?",
  deleteAccountFailed: "Échec de la suppression du compte. Veuillez réessayer.",
  appleNotConfigured: "Les variables d'environnement Apple OAuth sont manquantes. La connexion Apple est indisponible.",
  googleNotConfigured: "Les variables d'environnement Google OAuth sont manquantes. Seule la connexion démo est disponible.",
  nativeSignInFailed: "Échec de la connexion native. Veuillez réessayer.",
});
