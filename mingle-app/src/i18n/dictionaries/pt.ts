import { createProfileLocalizedDictionary } from "@/i18n/dictionaries/create-profile-localized-dictionary";

export const ptDictionary = createProfileLocalizedDictionary({
  authTitle: "Autenticação",
  loginRequiredTitle: "Login necessário",
  loginRequiredDescription: "Faça login com Apple ou Google para usar o tradutor.",
  loginLoading: "Verificando sua sessão...",
  signedInAs: "Conectado como",
  loginApple: "Entrar com Apple",
  loginGoogle: "Entrar com Google",
  loginDemo: "Login de demonstração",
  logout: "Sair",
  deleteAccount: "Excluir conta",
  menuLabel: "Menu",
  deleteAccountConfirm: "Excluir os dados da conta e sair agora?",
  deleteAccountFailed: "Falha ao excluir a conta. Tente novamente.",
  appleNotConfigured: "As variáveis de ambiente do Apple OAuth estão ausentes, então o login com Apple está indisponível.",
  googleNotConfigured: "As variáveis de ambiente do Google OAuth estão ausentes, então apenas o login de demonstração está disponível.",
  nativeSignInFailed: "Falha no login nativo. Tente novamente.",
});
