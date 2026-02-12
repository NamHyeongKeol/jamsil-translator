export type MobilePlatform = "web" | "ios" | "android";

export type MobileRuntimeInfo = {
  platform: MobilePlatform;
  nativeBridge: boolean;
  safeAreaEnabled: boolean;
  backgroundAudioReady: boolean;
  pushReady: boolean;
};

declare global {
  interface Window {
    Capacitor?: {
      getPlatform?: () => string;
      isNativePlatform?: () => boolean;
    };
  }
}

function detectPlatformFromUserAgent(userAgent: string): MobilePlatform {
  if (/iphone|ipad|ipod/i.test(userAgent)) {
    return "ios";
  }
  if (/android/i.test(userAgent)) {
    return "android";
  }
  return "web";
}

export function detectMobileRuntime(): MobileRuntimeInfo {
  if (typeof window === "undefined") {
    return {
      platform: "web",
      nativeBridge: false,
      safeAreaEnabled: false,
      backgroundAudioReady: false,
      pushReady: false,
    };
  }

  const capacitorPlatform = window.Capacitor?.getPlatform?.();
  const nativeBridge = Boolean(window.Capacitor?.isNativePlatform?.());

  const platform =
    capacitorPlatform === "ios" || capacitorPlatform === "android"
      ? capacitorPlatform
      : detectPlatformFromUserAgent(window.navigator.userAgent);

  return {
    platform,
    nativeBridge,
    safeAreaEnabled: platform !== "web",
    backgroundAudioReady: platform !== "web",
    pushReady: platform !== "web",
  };
}
