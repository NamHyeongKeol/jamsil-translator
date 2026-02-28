import { createProfileLocalizedDictionary } from "@/i18n/dictionaries/create-profile-localized-dictionary";

export const viDictionary = createProfileLocalizedDictionary({
  authTitle: "Xác thực",
  loginRequiredTitle: "Yêu cầu đăng nhập",
  loginRequiredDescription: "Vui lòng đăng nhập bằng Apple hoặc Google để sử dụng trình dịch.",
  loginLoading: "Đang kiểm tra phiên của bạn...",
  signedInAs: "Đăng nhập với",
  loginApple: "Đăng nhập với Apple",
  loginGoogle: "Đăng nhập với Google",
  loginDemo: "Đăng nhập demo",
  logout: "Đăng xuất",
  deleteAccount: "Xóa tài khoản",
  menuLabel: "Trình đơn",
  deleteAccountConfirm: "Xóa dữ liệu tài khoản và đăng xuất ngay bây giờ?",
  deleteAccountCancel: "Hủy",
  deleteAccountFailed: "Xóa tài khoản thất bại. Vui lòng thử lại.",
  appleNotConfigured: "Thiếu biến môi trường Apple OAuth nên không thể đăng nhập bằng Apple.",
  googleNotConfigured: "Thiếu biến môi trường Google OAuth nên chỉ có thể đăng nhập demo.",
  nativeSignInFailed: "Đăng nhập native thất bại. Vui lòng thử lại.",
});
