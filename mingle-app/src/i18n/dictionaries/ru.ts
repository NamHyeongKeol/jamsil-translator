import { createProfileLocalizedDictionary } from "@/i18n/dictionaries/create-profile-localized-dictionary";

export const ruDictionary = createProfileLocalizedDictionary({
  authTitle: "Авторизация",
  loginRequiredTitle: "Требуется вход",
  loginRequiredDescription: "Войдите через Apple или Google, чтобы пользоваться переводчиком.",
  loginLoading: "Проверяем вашу сессию...",
  signedInAs: "Вы вошли как",
  loginApple: "Войти через Apple",
  loginGoogle: "Войти через Google",
  loginDemo: "Демо-вход",
  logout: "Выйти",
  deleteAccount: "Удалить аккаунт",
  menuLabel: "Меню",
  deleteAccountConfirm: "Удалить данные аккаунта и выйти сейчас?",
  deleteAccountCancel: "Отмена",
  deleteAccountFailed: "Не удалось удалить аккаунт. Попробуйте снова.",
  appleNotConfigured: "Отсутствуют переменные окружения Apple OAuth, поэтому вход через Apple недоступен.",
  googleNotConfigured: "Отсутствуют переменные окружения Google OAuth, поэтому доступен только демо-вход.",
  nativeSignInFailed: "Ошибка нативного входа. Попробуйте снова.",
});
