"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppLocale } from "@/i18n";

type NativeOAuthProvider = "apple" | "google";

type NativeOAuthLauncherProps = {
  locale: AppLocale;
  provider: NativeOAuthProvider;
  callbackUrl: string;
};

type LauncherText = {
  title: string;
  description: string;
  launching: string;
  retry: string;
};

const LAUNCHER_TEXT: Record<AppLocale, LauncherText> = {
  ko: {
    title: "로그인으로 이동 중",
    description: "잠시만 기다려 주세요. 자동으로 로그인 화면으로 이동합니다.",
    launching: "이동 중...",
    retry: "다시 시도",
  },
  en: {
    title: "Redirecting to sign in",
    description: "Please wait. We will open the sign-in flow automatically.",
    launching: "Redirecting...",
    retry: "Try again",
  },
  ja: {
    title: "ログインへ移動しています",
    description: "しばらくお待ちください。自動でログイン画面を開きます。",
    launching: "移動中...",
    retry: "再試行",
  },
  "zh-CN": {
    title: "正在跳转到登录",
    description: "请稍候，我们将自动打开登录流程。",
    launching: "跳转中...",
    retry: "重试",
  },
  "zh-TW": {
    title: "正在前往登入",
    description: "請稍候，我們會自動開啟登入流程。",
    launching: "前往中...",
    retry: "重試",
  },
  fr: {
    title: "Redirection vers la connexion",
    description: "Veuillez patienter. Nous ouvrirons automatiquement la connexion.",
    launching: "Redirection...",
    retry: "Réessayer",
  },
  de: {
    title: "Weiterleitung zur Anmeldung",
    description: "Bitte warten. Wir öffnen den Anmeldefluss automatisch.",
    launching: "Weiterleitung...",
    retry: "Erneut versuchen",
  },
  es: {
    title: "Redirigiendo al inicio de sesión",
    description: "Espera un momento. Abriremos el flujo de inicio automáticamente.",
    launching: "Redirigiendo...",
    retry: "Reintentar",
  },
  pt: {
    title: "Redirecionando para login",
    description: "Aguarde. Vamos abrir o fluxo de login automaticamente.",
    launching: "Redirecionando...",
    retry: "Tentar novamente",
  },
  it: {
    title: "Reindirizzamento all'accesso",
    description: "Attendi. Apriremo automaticamente il flusso di accesso.",
    launching: "Reindirizzamento...",
    retry: "Riprova",
  },
  ru: {
    title: "Переход к входу",
    description: "Пожалуйста, подождите. Мы автоматически откроем вход.",
    launching: "Переход...",
    retry: "Повторить",
  },
  ar: {
    title: "جارٍ التحويل إلى تسجيل الدخول",
    description: "يرجى الانتظار. سنفتح مسار تسجيل الدخول تلقائيًا.",
    launching: "جارٍ التحويل...",
    retry: "إعادة المحاولة",
  },
  hi: {
    title: "लॉगिन पर ले जाया जा रहा है",
    description: "कृपया प्रतीक्षा करें। हम लॉगिन प्रक्रिया अपने आप खोलेंगे।",
    launching: "रिडायरेक्ट हो रहा है...",
    retry: "फिर से प्रयास करें",
  },
  th: {
    title: "กำลังไปยังหน้าเข้าสู่ระบบ",
    description: "กรุณารอสักครู่ ระบบจะเปิดขั้นตอนเข้าสู่ระบบให้อัตโนมัติ",
    launching: "กำลังนำทาง...",
    retry: "ลองอีกครั้ง",
  },
  vi: {
    title: "Đang chuyển đến đăng nhập",
    description: "Vui lòng chờ. Chúng tôi sẽ tự động mở luồng đăng nhập.",
    launching: "Đang chuyển hướng...",
    retry: "Thử lại",
  },
};

function resolveSafeCallbackUrl(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    if (!parsed.pathname.startsWith("/api/native-auth/complete")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export default function NativeOAuthLauncher({
  locale,
  provider,
  callbackUrl,
}: NativeOAuthLauncherProps) {
  const router = useRouter();
  const launchedRef = useRef(false);
  const [isLaunching, setIsLaunching] = useState(true);
  const text = useMemo(() => LAUNCHER_TEXT[locale] ?? LAUNCHER_TEXT.ko, [locale]);

  const beginSignIn = useCallback(async () => {
    const safeCallbackUrl = resolveSafeCallbackUrl(callbackUrl);
    if (!safeCallbackUrl) {
      router.replace(`/${locale}`);
      return;
    }
    await signIn(provider, { callbackUrl: safeCallbackUrl });
  }, [callbackUrl, locale, provider, router]);

  const handleRetry = useCallback(() => {
    setIsLaunching(true);
    void beginSignIn().catch(() => {
      setIsLaunching(false);
    });
  }, [beginSignIn]);

  useEffect(() => {
    if (launchedRef.current) return;
    launchedRef.current = true;
    void beginSignIn().catch(() => {
      setIsLaunching(false);
    });
  }, [beginSignIn]);

  return (
    <main className="flex min-h-[100dvh] w-full items-center justify-center bg-white px-6">
      <section className="w-full max-w-[22rem] rounded-2xl border border-slate-200 bg-slate-50 px-6 py-7 text-center">
        <h1 className="text-lg font-semibold text-slate-900">{text.title}</h1>
        <p className="mt-2 text-sm text-slate-600">{text.description}</p>
        <button
          type="button"
          onClick={handleRetry}
          disabled={isLaunching}
          className="mt-5 inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLaunching ? text.launching : text.retry}
        </button>
      </section>
    </main>
  );
}
