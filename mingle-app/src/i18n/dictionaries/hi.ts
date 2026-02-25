import { createProfileLocalizedDictionary } from "@/i18n/dictionaries/create-profile-localized-dictionary";

export const hiDictionary = createProfileLocalizedDictionary({
  authTitle: "प्रमाणीकरण",
  loginRequiredTitle: "लॉगिन आवश्यक है",
  loginRequiredDescription: "अनुवादक उपयोग करने के लिए कृपया Apple या Google से लॉगिन करें।",
  loginLoading: "आपका सत्र जांचा जा रहा है...",
  signedInAs: "इस रूप में लॉगिन",
  loginApple: "Apple से लॉगिन",
  loginGoogle: "Google से लॉगिन",
  loginDemo: "डेमो लॉगिन",
  logout: "लॉगआउट",
  deleteAccount: "खाता हटाएं",
  menuLabel: "मेनू",
  deleteAccountConfirm: "क्या अभी खाता डेटा हटाकर लॉगआउट करना है?",
  deleteAccountFailed: "खाता हटाया नहीं जा सका। कृपया फिर से प्रयास करें।",
  appleNotConfigured: "Apple OAuth पर्यावरण चर मौजूद नहीं हैं, इसलिए Apple लॉगिन उपलब्ध नहीं है।",
  googleNotConfigured: "Google OAuth पर्यावरण चर मौजूद नहीं हैं, इसलिए केवल डेमो लॉगिन उपलब्ध है।",
  nativeSignInFailed: "नेटिव लॉगिन विफल रहा। कृपया फिर से प्रयास करें।",
});
