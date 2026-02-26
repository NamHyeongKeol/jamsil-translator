import { createProfileLocalizedDictionary } from "@/i18n/dictionaries/create-profile-localized-dictionary";

export const thDictionary = createProfileLocalizedDictionary({
  authTitle: "การยืนยันตัวตน",
  loginRequiredTitle: "ต้องเข้าสู่ระบบ",
  loginRequiredDescription: "กรุณาเข้าสู่ระบบด้วย Apple หรือ Google เพื่อใช้ตัวแปลภาษา",
  loginLoading: "กำลังตรวจสอบเซสชัน...",
  signedInAs: "เข้าสู่ระบบเป็น",
  loginApple: "เข้าสู่ระบบด้วย Apple",
  loginGoogle: "เข้าสู่ระบบด้วย Google",
  loginDemo: "เข้าสู่ระบบเดโม",
  logout: "ออกจากระบบ",
  deleteAccount: "ลบบัญชี",
  menuLabel: "เมนู",
  deleteAccountConfirm: "ลบข้อมูลบัญชีและออกจากระบบตอนนี้หรือไม่?",
  deleteAccountFailed: "ลบบัญชีไม่สำเร็จ กรุณาลองอีกครั้ง",
  appleNotConfigured: "ไม่มีตัวแปรสภาพแวดล้อม Apple OAuth จึงไม่สามารถใช้การเข้าสู่ระบบด้วย Apple ได้",
  googleNotConfigured: "ไม่มีตัวแปรสภาพแวดล้อม Google OAuth จึงใช้ได้เฉพาะการเข้าสู่ระบบเดโม",
  nativeSignInFailed: "การเข้าสู่ระบบแบบเนทีฟล้มเหลว กรุณาลองอีกครั้ง",
});
