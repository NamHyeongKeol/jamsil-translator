import { createProfileLocalizedDictionary } from "@/i18n/dictionaries/create-profile-localized-dictionary";

export const zhTwDictionary = createProfileLocalizedDictionary({
  authTitle: "驗證",
  loginRequiredTitle: "需要登入",
  loginRequiredDescription: "請使用 Apple 或 Google 登入後再使用翻譯器。",
  loginLoading: "正在確認登入狀態...",
  signedInAs: "目前登入",
  loginApple: "使用 Apple 登入",
  loginGoogle: "使用 Google 登入",
  loginDemo: "示範登入",
  logout: "登出",
  deleteAccount: "刪除帳號",
  menuLabel: "選單",
  deleteAccountConfirm: "確定刪除帳號資料並立即登出嗎？",
  deleteAccountCancel: "取消",
  deleteAccountFailed: "刪除帳號失敗，請再試一次。",
  appleNotConfigured: "缺少 Apple OAuth 環境變數，無法使用 Apple 登入。",
  googleNotConfigured: "缺少 Google OAuth 環境變數，目前僅提供示範登入。",
  nativeSignInFailed: "原生登入失敗，請再試一次。",
});
